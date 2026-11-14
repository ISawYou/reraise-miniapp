ALTER TABLE "qualification_invitations" ALTER COLUMN "qualifying_rank" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "qualification_invitations" ADD COLUMN "manual_admission" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qualification_invitations" ADD CONSTRAINT "qualification_invitation_admission_check" CHECK (("qualification_invitations"."manual_admission" AND "qualification_invitations"."qualifying_rank" IS NULL) OR (NOT "qualification_invitations"."manual_admission" AND "qualification_invitations"."qualifying_rank" IS NOT NULL AND "qualification_invitations"."qualifying_rank">=2));--> statement-breakpoint
CREATE FUNCTION public.qualification_final_has_gameplay(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tournament_attendance WHERE tournament_id=tid AND (arrived OR arrived_at IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.tournament_player_eliminations WHERE tournament_id=tid AND (eliminated OR eliminated_at IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.tournament_rebuy_state WHERE tournament_id=tid AND (rebuys>0 OR addons>0))
 OR EXISTS(SELECT 1 FROM public.tournament_live_entries WHERE tournament_id=tid)
 OR EXISTS(SELECT 1 FROM public.registrations WHERE tournament_id=tid AND status='attended')
 OR EXISTS(SELECT 1 FROM public.results WHERE tournament_id=tid)
 OR EXISTS(SELECT 1 FROM public.tournament_late_registration WHERE tournament_id=tid)
 OR EXISTS(SELECT 1 FROM public.tournament_mystery_bounty WHERE tournament_id=tid)
 OR EXISTS(SELECT 1 FROM public.tournament_operations WHERE tournament_id=tid AND (paid=true OR place IS NOT NULL OR coalesce(free_reentries,0)>0 OR coalesce(knockouts,0)>0 OR coalesce(boss_knockouts,0)>0 OR coalesce(mystery_points,0)>0 OR coalesce(mystery_envelopes_won,0)>0));
$$;
REVOKE ALL ON FUNCTION public.qualification_final_has_gameplay(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.qualification_manual_remove_permitted(eid uuid,rid uuid,pid uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.qualification_events e JOIN public.qualification_audit a ON a.event_id=e.id JOIN public.players actor ON actor.id=a.actor_id
 WHERE e.id=eid AND e.slug='put-v-kaliningrad-2026' AND e.status='final' AND e.final_roster_locked_at IS NOT NULL AND e.final_outcome IS NULL
 AND actor.role='admin' AND NOT actor.is_blocked AND actor.merged_into_player_id IS NULL
 AND a.action IN ('manual_remove_finalist','manual_replace_finalist')
 AND a.detail->>'registrationId'=rid::text AND a.detail->>'removedPlayer'=pid::text
 AND a.detail->>'eventVersion'=e.version::text
 AND a.detail->>'transactionId'=txid_current()::text AND a.detail->>'backendPid'=pg_backend_pid()::text
 AND a.detail->>'confirmed'='true' AND length(btrim(a.detail->>'reason')) BETWEEN 3 AND 500
 AND NOT public.qualification_final_has_gameplay(e.final_tournament_id)
 AND EXISTS(SELECT 1 FROM public.qualification_invitations i WHERE i.event_id=e.id AND i.player_id=pid AND i.status IN ('cancelled','replaced')));
$$;
REVOKE ALL ON FUNCTION public.qualification_manual_remove_permitted(uuid,uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.qualification_guard_registration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE eid uuid; locked_at timestamptz; phase text; tid uuid; pid uuid;
BEGIN
 IF TG_OP='DELETE' THEN tid:=OLD.tournament_id;pid:=OLD.player_id;ELSE tid:=NEW.tournament_id;pid:=NEW.player_id;END IF;
 SELECT id,final_roster_locked_at,status INTO eid,locked_at,phase FROM public.qualification_events WHERE final_tournament_id=tid;
 IF eid IS NULL THEN
  IF TG_OP='UPDATE' AND OLD.tournament_id<>NEW.tournament_id AND EXISTS(SELECT 1 FROM public.qualification_events WHERE final_tournament_id=OLD.tournament_id) THEN RAISE EXCEPTION 'Нельзя переносить участника зафиксированного квалификационного финала' USING ERRCODE='23514';END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
 END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.status='registered' AND public.qualification_manual_remove_permitted(eid,OLD.id,pid) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'Состав квалификационного финала зафиксирован' USING ERRCODE='23514';
 END IF;
 IF locked_at IS NULL OR phase NOT IN ('final','completed') OR NEW.status NOT IN ('registered','attended') OR NOT EXISTS(SELECT 1 FROM public.qualification_invitations WHERE event_id=eid AND player_id=pid AND status='accepted') THEN RAISE EXCEPTION 'Регистрация в квалификационный финал только по подтверждённому приглашению и после фиксации состава' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (OLD.tournament_id<>NEW.tournament_id OR OLD.player_id<>NEW.player_id) THEN RAISE EXCEPTION 'Нельзя переносить участника квалификационного финала' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
