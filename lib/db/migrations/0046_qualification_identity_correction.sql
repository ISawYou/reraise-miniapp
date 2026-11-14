-- Narrow, transaction-scoped support for the reviewed completed-final identity
-- correction. The application must set the exact event/tournament/source/target
-- scope in LOCAL transaction state before changing a player_id.
CREATE OR REPLACE FUNCTION public.qualification_identity_repair_scope_matches(eid uuid, tid uuid, source_id uuid, target_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT current_setting('app.qualification_identity_repair_scope', true)
   = concat(eid::text, ':', tid::text, ':', source_id::text, ':', target_id::text);
$$;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_array(value jsonb, source_id uuid, target_id uuid)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT COALESCE((SELECT jsonb_agg(CASE WHEN item #>> '{}'=source_id::text THEN to_jsonb(target_id::text) ELSE item END ORDER BY ord)
   FROM jsonb_array_elements(COALESCE(value,'[]'::jsonb)) WITH ORDINALITY AS x(item,ord)), '[]'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_outcome(old_value jsonb, source_id uuid, target_id uuid)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_set(
   jsonb_set(
     jsonb_set(old_value, '{survivorIds}', public.qualification_identity_repair_array(old_value->'survivorIds', source_id, target_id), true),
     '{arrivedIds}', public.qualification_identity_repair_array(old_value->'arrivedIds', source_id, target_id), true),
   '{eliminations}', COALESCE((SELECT jsonb_agg(
     CASE WHEN item->>'playerId'=source_id::text THEN jsonb_set(item, '{playerId}', to_jsonb(target_id::text), true) ELSE item END
     ORDER BY ord) FROM jsonb_array_elements(old_value->'eliminations') WITH ORDINALITY AS x(item,ord)), '[]'::jsonb), true);
$$;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_scope_matches(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_array(jsonb,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_outcome(jsonb,uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_r2_closed_registration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.tournament_id=NEW.tournament_id AND OLD.player_id IS DISTINCT FROM NEW.player_id
   AND to_jsonb(OLD)-ARRAY['player_id','updated_at'] = to_jsonb(NEW)-ARRAY['player_id','updated_at']
   AND EXISTS(SELECT 1 FROM public.qualification_events e WHERE e.final_tournament_id=NEW.tournament_id
     AND public.qualification_identity_repair_scope_matches(e.id,NEW.tournament_id,OLD.player_id,NEW.player_id)) THEN RETURN NEW; END IF;
 IF (SELECT tournament_type FROM public.tournaments WHERE id=NEW.tournament_id)='qualification_final' AND NOT EXISTS(SELECT 1 FROM public.qualification_events e JOIN public.qualification_invitations i ON i.event_id=e.id WHERE e.final_tournament_id=NEW.tournament_id AND e.final_roster_locked_at IS NOT NULL AND e.status IN ('final','completed') AND i.player_id=NEW.player_id AND i.status='accepted' AND NEW.status IN ('registered','attended')) THEN RAISE EXCEPTION 'Финал отбора закрыт: только зафиксированные подтверждённые приглашения' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.qualification_guard_registration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE eid uuid; locked_at timestamptz; phase text; tid uuid; pid uuid;
BEGIN
 IF TG_OP='DELETE' THEN tid:=OLD.tournament_id;pid:=OLD.player_id;ELSE tid:=NEW.tournament_id;pid:=NEW.player_id;END IF;
 SELECT id,final_roster_locked_at,status INTO eid,locked_at,phase FROM public.qualification_events WHERE final_tournament_id=tid;
 IF eid IS NULL THEN
  IF TG_OP='UPDATE' AND OLD.tournament_id<>NEW.tournament_id AND EXISTS(SELECT 1 FROM public.qualification_events WHERE final_tournament_id=OLD.tournament_id) THEN RAISE EXCEPTION 'Нельзя переносить участника зафиксированного квалификационного финала' USING ERRCODE='23514';END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.tournament_id=NEW.tournament_id AND OLD.player_id IS DISTINCT FROM NEW.player_id
   AND to_jsonb(OLD)-ARRAY['player_id','updated_at'] = to_jsonb(NEW)-ARRAY['player_id','updated_at']
   AND public.qualification_identity_repair_scope_matches(eid,tid,OLD.player_id,NEW.player_id) THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.status='registered' AND public.qualification_manual_remove_permitted(eid,OLD.id,pid) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'Состав квалификационного финала зафиксирован' USING ERRCODE='23514';
 END IF;
 IF locked_at IS NULL OR phase NOT IN ('final','completed') OR NEW.status NOT IN ('registered','attended') OR NOT EXISTS(SELECT 1 FROM public.qualification_invitations WHERE event_id=eid AND player_id=pid AND status='accepted') THEN RAISE EXCEPTION 'Регистрация в квалификационный финал только по подтверждённому приглашению и после фиксации состава' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (OLD.tournament_id<>NEW.tournament_id OR OLD.player_id<>NEW.player_id) THEN RAISE EXCEPTION 'Нельзя переносить участника квалификационного финала' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.qualification_r2_freeze_live() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; typ text; phase text; eid uuid;
BEGIN
 IF TG_OP='DELETE' THEN tid:=OLD.tournament_id; ELSE tid:=NEW.tournament_id; END IF;
 SELECT tournament_type INTO typ FROM public.tournaments WHERE id=tid;
 IF TG_OP='UPDATE' AND OLD.tournament_id=NEW.tournament_id AND OLD.player_id IS DISTINCT FROM NEW.player_id
   AND to_jsonb(OLD)-ARRAY['player_id','updated_at'] = to_jsonb(NEW)-ARRAY['player_id','updated_at']
   AND EXISTS(SELECT 1 FROM public.qualification_events e WHERE e.final_tournament_id=tid AND public.qualification_identity_repair_scope_matches(e.id,tid,OLD.player_id,NEW.player_id)) THEN RETURN NEW; END IF;
 IF typ='qualification_final' THEN
   SELECT status INTO phase FROM public.tournaments WHERE id=tid FOR UPDATE;
   IF phase='completed' THEN RAISE EXCEPTION 'Спортивный исход финала зафиксирован' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.qualification_r2_freeze_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; tid uuid; source_id uuid; target_id uuid; scope text;
BEGIN
 SELECT e.id,e.final_tournament_id INTO eid,tid FROM public.qualification_events e WHERE e.id=OLD.id;
 scope:=current_setting('app.qualification_identity_repair_scope',true);
 IF OLD.final_outcome IS NOT NULL AND NEW.final_outcome IS DISTINCT FROM OLD.final_outcome THEN
   IF scope IS NOT NULL AND split_part(scope,':',1)=eid::text AND split_part(scope,':',2)=tid::text THEN
     source_id:=split_part(scope,':',3)::uuid; target_id:=split_part(scope,':',4)::uuid;
     IF NEW.final_outcome=public.qualification_identity_repair_outcome(OLD.final_outcome,source_id,target_id) THEN RETURN NEW; END IF;
   END IF;
   RAISE EXCEPTION 'Итог трёх оставшихся неизменяем' USING ERRCODE='23514';
 END IF;
 IF NEW.final_outcome IS NOT NULL AND (jsonb_array_length(NEW.final_outcome->'survivorIds')<>3 OR NEW.final_roster_locked_at IS NULL OR NEW.status NOT IN ('final','completed')) THEN RAISE EXCEPTION 'Нужны три оставшихся игрока зафиксированного финала' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tournament_operation_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE tid uuid; state text;
BEGIN
 tid:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
 IF TG_OP='UPDATE' AND OLD.tournament_id IS DISTINCT FROM NEW.tournament_id THEN RAISE EXCEPTION 'Перенос операционной строки между турнирами запрещён' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.tournament_id=NEW.tournament_id AND OLD.player_id IS DISTINCT FROM NEW.player_id
   AND to_jsonb(OLD)-ARRAY['player_id','updated_at'] = to_jsonb(NEW)-ARRAY['player_id','updated_at']
   AND EXISTS(SELECT 1 FROM public.qualification_events e WHERE e.final_tournament_id=tid AND public.qualification_identity_repair_scope_matches(e.id,tid,OLD.player_id,NEW.player_id)) THEN RETURN NEW; END IF;
 SELECT status INTO state FROM public.tournaments WHERE id=tid FOR UPDATE;
 IF state='completed' THEN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM public.players WHERE id=OLD.player_id) THEN RETURN OLD; END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND public.account_merge_row_permitted(TG_TABLE_NAME,TG_OP,to_jsonb(OLD),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(NEW) ELSE NULL END) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Завершённый турнир доступен только для просмотра' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
