-- Narrow, audited database authorization for the single reviewed completed-final
-- identity correction. The application never authorizes this with a GUC alone:
-- the SECURITY DEFINER functions below create a DB-backed, transaction-bound
-- permit after checking the actor, exact IDs and current state.
CREATE TABLE public.qualification_identity_repair_permits (
  permit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id bigint NOT NULL,
  backend_pid integer NOT NULL,
  event_id uuid NOT NULL,
  final_tournament_id uuid NOT NULL,
  source_player_id uuid NOT NULL,
  target_player_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  audit_id uuid NOT NULL REFERENCES public.qualification_audit(id),
  operation text NOT NULL,
  expected_version integer NOT NULL,
  squad_member_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qualification_identity_repair_permit_tx_key UNIQUE (transaction_id, backend_pid),
  CONSTRAINT qualification_identity_repair_permit_operation_check CHECK (operation IN ('apply', 'reverse')),
  CONSTRAINT qualification_identity_repair_permit_event_check CHECK (event_id='1b98f989-5668-4461-9126-5e36397929e7'::uuid),
  CONSTRAINT qualification_identity_repair_permit_final_check CHECK (final_tournament_id='bd2c3795-1a1a-4f9a-a1f2-6f018f2c0902'::uuid),
  CONSTRAINT qualification_identity_repair_permit_source_check CHECK (source_player_id='9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid),
  CONSTRAINT qualification_identity_repair_permit_target_check CHECK (target_player_id='1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid)
);
REVOKE ALL ON TABLE public.qualification_identity_repair_permits FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_permit_id()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
DECLARE value text:=nullif(current_setting('app.qualification_identity_repair_permit',true),'');
BEGIN
  IF value IS NULL OR value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN NULL; END IF;
  RETURN value::uuid;
END $$;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_permit_id() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_permit_matches(
  p_table_name text, p_event_id uuid, p_tournament_id uuid, p_row_id uuid, p_old_player_id uuid, p_new_player_id uuid
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.qualification_identity_repair_permits p
   WHERE p.permit_id=public.qualification_identity_repair_permit_id()
     AND p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND NOT p.used
     AND p.event_id=p_event_id
     AND (p_tournament_id IS NULL OR p.final_tournament_id=p_tournament_id)
     AND EXISTS(SELECT 1 FROM public.qualification_audit a JOIN public.players actor ON actor.id=p.actor_id WHERE a.id=p.audit_id AND a.event_id=p.event_id AND actor.role='admin' AND NOT actor.is_blocked AND actor.merged_into_player_id IS NULL AND ((p.operation='apply' AND a.action='completed_identity_correction' AND a.detail->>'oldPlayerId'=p.source_player_id::text AND a.detail->>'newPlayerId'=p.target_player_id::text) OR (p.operation='reverse' AND a.action='completed_identity_correction_reversal' AND a.detail->>'oldPlayerId'=p.target_player_id::text AND a.detail->>'newPlayerId'=p.source_player_id::text)))
     AND ((p.operation='apply' AND p_old_player_id=p.source_player_id AND p_new_player_id=p.target_player_id)
       OR (p.operation='reverse' AND p_old_player_id=p.target_player_id AND p_new_player_id=p.source_player_id))
     AND ((p_table_name='qualification_squad_members' AND p_tournament_id IS NULL AND p_row_id=p.squad_member_id)
       OR (p_table_name='qualification_invitations' AND p_row_id=p.invitation_id)
       OR (p_table_name='registrations' AND p_row_id=p.registration_id)
       OR (p_table_name='tournament_attendance' AND p_row_id IS NULL))
 );
$$;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_permit_matches(text,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_array(value jsonb, source_id uuid, target_id uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT COALESCE((SELECT jsonb_agg(CASE WHEN item #>> '{}'=source_id::text THEN to_jsonb(target_id::text) ELSE item END ORDER BY ord)
   FROM jsonb_array_elements(COALESCE(value,'[]'::jsonb)) WITH ORDINALITY AS x(item,ord)), '[]'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_outcome(old_value jsonb, source_id uuid, target_id uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_set(jsonb_set(jsonb_set(old_value,'{survivorIds}',public.qualification_identity_repair_array(old_value->'survivorIds',source_id,target_id),true),'{arrivedIds}',public.qualification_identity_repair_array(old_value->'arrivedIds',source_id,target_id),true),'{eliminations}',COALESCE((SELECT jsonb_agg(CASE WHEN item->>'playerId'=source_id::text THEN jsonb_set(item,'{playerId}',to_jsonb(target_id::text),true) ELSE item END ORDER BY ord) FROM jsonb_array_elements(old_value->'eliminations') WITH ORDINALITY AS x(item,ord)),'[]'::jsonb),true);
$$;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_array(jsonb,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_outcome(jsonb,uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_outcome_allowed(old_value jsonb, new_value jsonb, eid uuid, tid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.qualification_identity_repair_permits p
   WHERE p.permit_id=public.qualification_identity_repair_permit_id()
     AND p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND NOT p.used
     AND p.event_id=eid AND p.final_tournament_id=tid
     AND EXISTS(SELECT 1 FROM public.qualification_audit a JOIN public.players actor ON actor.id=p.actor_id WHERE a.id=p.audit_id AND a.event_id=p.event_id AND actor.role='admin' AND NOT actor.is_blocked AND actor.merged_into_player_id IS NULL AND ((p.operation='apply' AND a.action='completed_identity_correction' AND a.detail->>'oldPlayerId'=p.source_player_id::text AND a.detail->>'newPlayerId'=p.target_player_id::text) OR (p.operation='reverse' AND a.action='completed_identity_correction_reversal' AND a.detail->>'oldPlayerId'=p.target_player_id::text AND a.detail->>'newPlayerId'=p.source_player_id::text)))
     AND new_value=CASE WHEN p.operation='apply' THEN public.qualification_identity_repair_outcome(old_value,p.source_player_id,p.target_player_id) ELSE public.qualification_identity_repair_outcome(old_value,p.target_player_id,p.source_player_id) END
 );
$$;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_outcome_allowed(jsonb,jsonb,uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_begin(actor_id uuid, expected_version integer, reason text)
RETURNS TABLE(permit_id uuid, audit_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event_row public.qualification_events%ROWTYPE; actor_row public.players%ROWTYPE; permit uuid:=gen_random_uuid(); audit_row uuid:=gen_random_uuid();
DECLARE squad_row uuid; invitation_row uuid; registration_row uuid; attendance_count integer;
BEGIN
  SELECT * INTO actor_row FROM public.players WHERE id=qualification_identity_repair_begin.actor_id FOR UPDATE;
  IF NOT FOUND OR actor_row.role<>'admin' OR actor_row.is_blocked OR actor_row.merged_into_player_id IS NOT NULL THEN RAISE EXCEPTION 'Только действующий Super Admin может выполнить коррекцию' USING ERRCODE='42501'; END IF;
  IF length(btrim(reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Причина коррекции должна быть от 10 до 500 символов' USING ERRCODE='22023'; END IF;
  SELECT * INTO event_row FROM public.qualification_events WHERE id='1b98f989-5668-4461-9126-5e36397929e7'::uuid FOR UPDATE;
  IF NOT FOUND OR event_row.status<>'completed' OR event_row.final_tournament_id<>'bd2c3795-1a1a-4f9a-a1f2-6f018f2c0902'::uuid OR event_row.version<>expected_version OR event_row.final_outcome IS NULL THEN RAISE EXCEPTION 'Состояние события не соответствует утверждённой коррекции' USING ERRCODE='40001'; END IF;
  SELECT id INTO squad_row FROM public.qualification_squad_members WHERE event_id=event_row.id AND selection_source='final_top3' AND slot=1 AND player_id='9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid;
  IF squad_row IS NULL OR (SELECT count(*) FROM public.qualification_squad_members WHERE event_id=event_row.id)<>5 OR (SELECT count(DISTINCT player_id) FROM public.qualification_squad_members WHERE event_id=event_row.id)<>5 THEN RAISE EXCEPTION 'Состав сборной не соответствует утверждённому состоянию' USING ERRCODE='40001'; END IF;
  SELECT id INTO invitation_row FROM public.qualification_invitations WHERE event_id=event_row.id AND player_id='9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid AND status='accepted';
  IF invitation_row IS NULL OR (SELECT count(*) FROM public.qualification_invitations WHERE event_id=event_row.id AND player_id='9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid AND status='accepted')<>1 OR EXISTS(SELECT 1 FROM public.qualification_invitations WHERE event_id=event_row.id AND player_id='1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid AND status IN ('pending','accepted')) THEN RAISE EXCEPTION 'Приглашение не соответствует утверждённому состоянию' USING ERRCODE='40001'; END IF;
  SELECT id INTO registration_row FROM public.registrations WHERE tournament_id=event_row.final_tournament_id AND player_id='9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid AND status IN ('registered','attended');
  IF registration_row IS NULL OR (SELECT count(*) FROM public.registrations WHERE tournament_id=event_row.final_tournament_id AND player_id='9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid AND status IN ('registered','attended'))<>1 OR EXISTS(SELECT 1 FROM public.registrations WHERE tournament_id=event_row.final_tournament_id AND player_id='1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid AND status<>'cancelled') THEN RAISE EXCEPTION 'Регистрация не соответствует утверждённому состоянию' USING ERRCODE='40001'; END IF;
  SELECT count(*) INTO attendance_count FROM public.tournament_attendance WHERE tournament_id=event_row.final_tournament_id AND player_id='9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid AND arrived;
  IF attendance_count<>1 OR EXISTS(SELECT 1 FROM public.tournament_attendance WHERE tournament_id=event_row.final_tournament_id AND player_id='1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid) THEN RAISE EXCEPTION 'Приход не соответствует утверждённому состоянию' USING ERRCODE='40001'; END IF;
  IF NOT (event_row.final_outcome->'survivorIds' ? '9571d26e-cea2-47d2-b37b-854cad67d3e9') OR (event_row.final_outcome->'survivorIds' ? '1e802bf2-e6ab-4861-9863-3d3ebc40cce8') OR NOT (event_row.final_outcome->'arrivedIds' ? '9571d26e-cea2-47d2-b37b-854cad67d3e9') OR (event_row.final_outcome->'arrivedIds' ? '1e802bf2-e6ab-4861-9863-3d3ebc40cce8') THEN RAISE EXCEPTION 'Frozen final outcome не соответствует утверждённому состоянию' USING ERRCODE='40001'; END IF;
  INSERT INTO public.qualification_audit(id,event_id,actor_id,action,detail) VALUES(audit_row,event_row.id,actor_row.id,'completed_identity_correction',jsonb_build_object('oldPlayerId','9571d26e-cea2-47d2-b37b-854cad67d3e9','newPlayerId','1e802bf2-e6ab-4861-9863-3d3ebc40cce8','qualificationEventId',event_row.id,'finalTournamentId',event_row.final_tournament_id,'squadMemberId',squad_row,'invitationId',invitation_row,'registrationId',registration_row,'reason',btrim(reason),'expectedVersion',expected_version,'permitId',permit));
  INSERT INTO public.qualification_identity_repair_permits(permit_id,transaction_id,backend_pid,event_id,final_tournament_id,source_player_id,target_player_id,actor_id,audit_id,operation,expected_version,squad_member_id,invitation_id,registration_id) VALUES(permit,txid_current(),pg_backend_pid(),event_row.id,event_row.final_tournament_id,'9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid,'1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid,actor_row.id,audit_row,'apply',expected_version,squad_row,invitation_row,registration_row);
  PERFORM set_config('app.qualification_identity_repair_permit',permit::text,true);
  RETURN QUERY SELECT permit,audit_row;
END $$;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_begin(uuid,integer,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_begin_reversal(actor_id uuid, original_audit_id uuid, expected_version integer, reason text)
RETURNS TABLE(permit_id uuid, audit_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event_row public.qualification_events%ROWTYPE; actor_row public.players%ROWTYPE; original public.qualification_audit%ROWTYPE; permit uuid:=gen_random_uuid(); audit_row uuid:=gen_random_uuid();
DECLARE squad_row uuid; invitation_row uuid; registration_row uuid;
BEGIN
  SELECT * INTO actor_row FROM public.players WHERE id=qualification_identity_repair_begin_reversal.actor_id FOR UPDATE;
  IF NOT FOUND OR actor_row.role<>'admin' OR actor_row.is_blocked OR actor_row.merged_into_player_id IS NOT NULL THEN RAISE EXCEPTION 'Только действующий Super Admin может выполнить reversal' USING ERRCODE='42501'; END IF;
  IF length(btrim(reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Причина reversal должна быть от 10 до 500 символов' USING ERRCODE='22023'; END IF;
  SELECT * INTO original FROM public.qualification_audit WHERE id=original_audit_id AND event_id='1b98f989-5668-4461-9126-5e36397929e7'::uuid AND action='completed_identity_correction' FOR SHARE;
  IF NOT FOUND OR original.detail->>'oldPlayerId'<>'9571d26e-cea2-47d2-b37b-854cad67d3e9' OR original.detail->>'newPlayerId'<>'1e802bf2-e6ab-4861-9863-3d3ebc40cce8' OR original.detail->>'finalTournamentId'<>'bd2c3795-1a1a-4f9a-a1f2-6f018f2c0902' OR EXISTS(SELECT 1 FROM public.qualification_audit WHERE event_id=original.event_id AND action='completed_identity_correction_reversal' AND detail->>'originalAuditId'=original_audit_id::text) THEN RAISE EXCEPTION 'Исходный audit для reversal не подтверждён или уже отменён' USING ERRCODE='40901'; END IF;
  SELECT * INTO event_row FROM public.qualification_events WHERE id=original.event_id FOR UPDATE;
  IF event_row.status<>'completed' OR event_row.final_tournament_id<>'bd2c3795-1a1a-4f9a-a1f2-6f018f2c0902'::uuid OR event_row.version<>expected_version OR expected_version<>((original.detail->>'expectedVersion')::integer+1) THEN RAISE EXCEPTION 'Версия или статус события не соответствуют reversal' USING ERRCODE='40001'; END IF;
  SELECT id INTO squad_row FROM public.qualification_squad_members WHERE id=(original.detail->>'squadMemberId')::uuid AND event_id=event_row.id AND player_id='1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid;
  SELECT id INTO invitation_row FROM public.qualification_invitations WHERE id=(original.detail->>'invitationId')::uuid AND event_id=event_row.id AND player_id='1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid AND status='accepted';
  SELECT id INTO registration_row FROM public.registrations WHERE id=(original.detail->>'registrationId')::uuid AND tournament_id=event_row.final_tournament_id AND player_id='1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid AND status IN ('registered','attended');
  IF squad_row IS NULL OR invitation_row IS NULL OR registration_row IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_attendance WHERE tournament_id=event_row.final_tournament_id AND player_id='1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid AND arrived) OR NOT (event_row.final_outcome->'survivorIds' ? '1e802bf2-e6ab-4861-9863-3d3ebc40cce8') OR (event_row.final_outcome->'survivorIds' ? '9571d26e-cea2-47d2-b37b-854cad67d3e9') THEN RAISE EXCEPTION 'Текущее состояние не соответствует безопасному reversal' USING ERRCODE='40001'; END IF;
  INSERT INTO public.qualification_audit(id,event_id,actor_id,action,detail) VALUES(audit_row,event_row.id,actor_row.id,'completed_identity_correction_reversal',jsonb_build_object('originalAuditId',original_audit_id,'oldPlayerId','1e802bf2-e6ab-4861-9863-3d3ebc40cce8','newPlayerId','9571d26e-cea2-47d2-b37b-854cad67d3e9','finalTournamentId',event_row.final_tournament_id,'squadMemberId',squad_row,'invitationId',invitation_row,'registrationId',registration_row,'reason',btrim(reason),'expectedVersion',expected_version,'permitId',permit));
  INSERT INTO public.qualification_identity_repair_permits(permit_id,transaction_id,backend_pid,event_id,final_tournament_id,source_player_id,target_player_id,actor_id,audit_id,operation,expected_version,squad_member_id,invitation_id,registration_id) VALUES(permit,txid_current(),pg_backend_pid(),event_row.id,event_row.final_tournament_id,'9571d26e-cea2-47d2-b37b-854cad67d3e9'::uuid,'1e802bf2-e6ab-4861-9863-3d3ebc40cce8'::uuid,actor_row.id,audit_row,'reverse',expected_version,squad_row,invitation_row,registration_row);
  PERFORM set_config('app.qualification_identity_repair_permit',permit::text,true);
  RETURN QUERY SELECT permit,audit_row;
END $$;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_begin_reversal(uuid,uuid,integer,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_identity_repair_finish(permit_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.qualification_identity_repair_permits SET used=true
   WHERE qualification_identity_repair_permits.permit_id=qualification_identity_repair_finish.permit_id
     AND transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND NOT used;
  IF NOT FOUND THEN RAISE EXCEPTION 'Identity repair permit is not active in this transaction' USING ERRCODE='42501'; END IF;
  PERFORM set_config('app.qualification_identity_repair_permit','',true);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.qualification_identity_repair_finish(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.qualification_r2_closed_registration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.tournament_id=NEW.tournament_id AND OLD.player_id IS DISTINCT FROM NEW.player_id AND to_jsonb(OLD)-ARRAY['player_id','updated_at'] = to_jsonb(NEW)-ARRAY['player_id','updated_at'] AND EXISTS(SELECT 1 FROM public.qualification_events e WHERE e.final_tournament_id=NEW.tournament_id AND public.qualification_identity_repair_permit_matches('registrations',e.id,NEW.tournament_id,OLD.id,OLD.player_id,NEW.player_id)) THEN RETURN NEW; END IF;
 IF (SELECT tournament_type FROM public.tournaments WHERE id=NEW.tournament_id)='qualification_final' AND NOT EXISTS(SELECT 1 FROM public.qualification_events e JOIN public.qualification_invitations i ON i.event_id=e.id WHERE e.final_tournament_id=NEW.tournament_id AND e.final_roster_locked_at IS NOT NULL AND e.status IN ('final','completed') AND i.player_id=NEW.player_id AND i.status='accepted' AND NEW.status IN ('registered','attended')) THEN RAISE EXCEPTION 'Финал отбора закрыт: только зафиксированные подтверждённые приглашения' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.qualification_guard_registration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE eid uuid; locked_at timestamptz; phase text; tid uuid; pid uuid;
BEGIN
 IF TG_OP='DELETE' THEN tid:=OLD.tournament_id;pid:=OLD.player_id;ELSE tid:=NEW.tournament_id;pid:=NEW.player_id;END IF;
 SELECT id,final_roster_locked_at,status INTO eid,locked_at,phase FROM public.qualification_events WHERE final_tournament_id=tid;
 IF eid IS NULL THEN IF TG_OP='UPDATE' AND OLD.tournament_id<>NEW.tournament_id AND EXISTS(SELECT 1 FROM public.qualification_events WHERE final_tournament_id=OLD.tournament_id) THEN RAISE EXCEPTION 'Нельзя переносить участника зафиксированного квалификационного финала' USING ERRCODE='23514';END IF; IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF; END IF;
 IF TG_OP='UPDATE' AND OLD.tournament_id=NEW.tournament_id AND OLD.player_id IS DISTINCT FROM NEW.player_id AND to_jsonb(OLD)-ARRAY['player_id','updated_at'] = to_jsonb(NEW)-ARRAY['player_id','updated_at'] AND public.qualification_identity_repair_permit_matches('registrations',eid,tid,OLD.id,OLD.player_id,NEW.player_id) THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN IF OLD.status='registered' AND public.qualification_manual_remove_permitted(eid,OLD.id,pid) THEN RETURN OLD;END IF; RAISE EXCEPTION 'Состав квалификационного финала зафиксирован' USING ERRCODE='23514'; END IF;
 IF locked_at IS NULL OR phase NOT IN ('final','completed') OR NEW.status NOT IN ('registered','attended') OR NOT EXISTS(SELECT 1 FROM public.qualification_invitations WHERE event_id=eid AND player_id=pid AND status='accepted') THEN RAISE EXCEPTION 'Регистрация в квалификационный финал только по подтверждённому приглашению и после фиксации состава' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (OLD.tournament_id<>NEW.tournament_id OR OLD.player_id<>NEW.player_id) THEN RAISE EXCEPTION 'Нельзя переносить участника квалификационного финала' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.qualification_r2_freeze_live() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; typ text; phase text; eid uuid;
BEGIN
 IF TG_OP='DELETE' THEN tid:=OLD.tournament_id; ELSE tid:=NEW.tournament_id; END IF;
 SELECT tournament_type INTO typ FROM public.tournaments WHERE id=tid;
 IF TG_OP='UPDATE' AND OLD.tournament_id=NEW.tournament_id AND OLD.player_id IS DISTINCT FROM NEW.player_id AND TG_TABLE_NAME='tournament_attendance' AND to_jsonb(OLD)-ARRAY['player_id','updated_at'] = to_jsonb(NEW)-ARRAY['player_id','updated_at'] AND EXISTS(SELECT 1 FROM public.qualification_events e WHERE e.final_tournament_id=tid AND public.qualification_identity_repair_permit_matches('tournament_attendance',e.id,tid,NULL,OLD.player_id,NEW.player_id)) THEN RETURN NEW; END IF;
 IF typ='qualification_final' THEN SELECT status INTO phase FROM public.tournaments WHERE id=tid FOR UPDATE; IF phase='completed' THEN RAISE EXCEPTION 'Спортивный исход финала зафиксирован' USING ERRCODE='23514'; END IF; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.qualification_r2_freeze_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; tid uuid;
BEGIN
 SELECT e.id,e.final_tournament_id INTO eid,tid FROM public.qualification_events e WHERE e.id=OLD.id;
 IF OLD.status='completed' AND to_jsonb(NEW)-ARRAY['final_outcome','version','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['final_outcome','version','updated_at'] THEN RAISE EXCEPTION 'Завершённое квалификационное событие доступно только для просмотра' USING ERRCODE='23514'; END IF;
 IF OLD.final_outcome IS NOT NULL AND NEW.final_outcome IS DISTINCT FROM OLD.final_outcome THEN
   IF public.qualification_identity_repair_outcome_allowed(OLD.final_outcome,NEW.final_outcome,eid,tid) AND NEW.version=OLD.version+1 THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Итог трёх оставшихся неизменяем' USING ERRCODE='23514';
 END IF;
 IF NEW.final_outcome IS NOT NULL AND (jsonb_array_length(NEW.final_outcome->'survivorIds')<>3 OR NEW.final_roster_locked_at IS NULL OR NEW.status NOT IN ('final','completed')) THEN RAISE EXCEPTION 'Нужны три оставшихся игрока зафиксированного финала' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.qualification_identity_squad_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; tid uuid;
BEGIN
 eid:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
 SELECT final_tournament_id INTO tid FROM public.qualification_events WHERE id=eid AND status='completed';
 IF tid IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='UPDATE' AND OLD.event_id=NEW.event_id AND OLD.player_id IS DISTINCT FROM NEW.player_id AND to_jsonb(OLD)-'player_id'=to_jsonb(NEW)-'player_id' AND public.qualification_identity_repair_permit_matches('qualification_squad_members',eid,NULL,OLD.id,OLD.player_id,NEW.player_id) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Состав завершённой квалификации доступен только для просмотра' USING ERRCODE='23514';
END $$;

CREATE OR REPLACE FUNCTION public.qualification_identity_invitation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; tid uuid;
BEGIN
 eid:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
 SELECT final_tournament_id INTO tid FROM public.qualification_events WHERE id=eid AND status='completed';
 IF tid IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='UPDATE' AND OLD.event_id=NEW.event_id AND OLD.player_id IS DISTINCT FROM NEW.player_id AND to_jsonb(OLD)-'player_id'=to_jsonb(NEW)-'player_id' AND public.qualification_identity_repair_permit_matches('qualification_invitations',eid,tid,OLD.id,OLD.player_id,NEW.player_id) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Приглашения завершённой квалификации доступны только для просмотра' USING ERRCODE='23514';
END $$;

DROP TRIGGER IF EXISTS qualification_identity_squad_guard ON public.qualification_squad_members;
CREATE TRIGGER qualification_identity_squad_guard BEFORE INSERT OR UPDATE OR DELETE ON public.qualification_squad_members FOR EACH ROW EXECUTE FUNCTION public.qualification_identity_squad_guard();
DROP TRIGGER IF EXISTS qualification_identity_invitation_guard ON public.qualification_invitations;
CREATE TRIGGER qualification_identity_invitation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.qualification_invitations FOR EACH ROW EXECUTE FUNCTION public.qualification_identity_invitation_guard();

CREATE OR REPLACE FUNCTION public.tournament_operation_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE tid uuid; state text;
BEGIN
 tid:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
 IF TG_OP='UPDATE' AND OLD.tournament_id IS DISTINCT FROM NEW.tournament_id THEN RAISE EXCEPTION 'Перенос операционной строки между турнирами запрещён' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='tournament_attendance' AND OLD.tournament_id=NEW.tournament_id AND OLD.player_id IS DISTINCT FROM NEW.player_id AND to_jsonb(OLD)-ARRAY['player_id','updated_at'] = to_jsonb(NEW)-ARRAY['player_id','updated_at'] AND EXISTS(SELECT 1 FROM public.qualification_events e WHERE e.final_tournament_id=tid AND public.qualification_identity_repair_permit_matches('tournament_attendance',e.id,tid,NULL,OLD.player_id,NEW.player_id)) THEN RETURN NEW; END IF;
 SELECT status INTO state FROM public.tournaments WHERE id=tid FOR UPDATE;
 IF state='completed' THEN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM public.players WHERE id=OLD.player_id) THEN RETURN OLD; END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND public.account_merge_row_permitted(TG_TABLE_NAME,TG_OP,to_jsonb(OLD),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(NEW) ELSE NULL END) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  RAISE EXCEPTION 'Завершённый турнир доступен только для просмотра' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
