CREATE TABLE "admin_tournament_admissions" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"registration_id" uuid,
	"phase" text NOT NULL,
	"arrival_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"transaction_id" bigint NOT NULL,
	"backend_pid" bigint NOT NULL,
	"input" jsonb NOT NULL,
	"snapshot_before" jsonb,
	"rules_before" jsonb NOT NULL,
	CONSTRAINT "admin_admission_phase" CHECK ("admin_tournament_admissions"."phase" in ('normal','after_time','after_snapshot')),
	CONSTRAINT "admin_admission_state" CHECK ("admin_tournament_admissions"."state" in ('pending','succeeded'))
);

--> statement-breakpoint
REVOKE ALL ON public.admin_tournament_admissions FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.admin_admission_permitted(tid uuid,pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.admin_tournament_admissions a JOIN public.players p ON p.id=a.actor_id
 WHERE a.request_id::text=current_setting('reraise.admin_admission',true)
 AND a.tournament_id=tid AND a.player_id=pid AND a.state='pending'
 AND a.transaction_id=txid_current() AND a.backend_pid=pg_backend_pid()
 AND p.role IN ('admin','operator') AND NOT p.is_blocked AND p.merged_into_player_id IS NULL);
$$;
REVOKE ALL ON FUNCTION public.admin_admission_permitted(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.admin_issue_admission_permit(rid uuid,tid uuid,pid uuid,aid uuid,expected_phase text,confirmed boolean,arrival boolean,payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tournaments; phase text; frozen jsonb;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=tid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_ADMISSION: Турнир не найден'; END IF;
 IF t.status='completed' THEN RAISE EXCEPTION 'STAFF_ADMISSION: Турнир завершён — добавление запрещено'; END IF;
 PERFORM 1 FROM public.players WHERE id=aid AND role IN ('admin','operator') AND NOT is_blocked AND merged_into_player_id IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_ADMISSION: Недостаточно прав'; END IF;
 PERFORM 1 FROM public.players WHERE id=pid AND NOT is_blocked AND merged_into_player_id IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_ADMISSION: Выберите действующий незаблокированный аккаунт'; END IF;
 SELECT to_jsonb(s) INTO frozen FROM public.tournament_late_registration s WHERE tournament_id=tid;
 phase:=CASE WHEN frozen IS NOT NULL THEN 'after_snapshot' WHEN t.late_registration_ends_at IS NOT NULL AND clock_timestamp()>=t.late_registration_ends_at THEN 'after_time' ELSE 'normal' END;
 IF phase IS DISTINCT FROM expected_phase OR (phase<>'normal' AND confirmed IS DISTINCT FROM true) THEN RAISE EXCEPTION 'STAFF_ADMISSION: Состояние регистрации изменилось — подтвердите добавление заново'; END IF;
 IF t.tournament_type='qualification_final' THEN RAISE EXCEPTION 'STAFF_ADMISSION: Финал отбора ведётся через подтверждённый состав'; END IF;
 INSERT INTO public.admin_tournament_admissions(request_id,tournament_id,player_id,actor_id,phase,arrival_confirmed,transaction_id,backend_pid,input,snapshot_before,rules_before)
 VALUES(rid,tid,pid,aid,phase,arrival,txid_current(),pg_backend_pid(),payload,frozen,jsonb_build_object('formula',t.rating_formula_version,'guarantee',t.rating_guarantee,'multiplier',t.placement_points_multiplier,'type',t.tournament_type));
 PERFORM set_config('reraise.admin_admission',rid::text,true);
END $$;
REVOKE ALL ON FUNCTION public.admin_issue_admission_permit(uuid,uuid,uuid,uuid,text,boolean,boolean,jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tournament_r2_deadline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE t public.tournaments; frozen boolean; is_new boolean;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=NEW.tournament_id FOR UPDATE;
 IF TG_TABLE_NAME='registrations' THEN
  is_new:=CASE WHEN TG_OP='INSERT' THEN NEW.status IN ('registered','waitlist','attended') ELSE OLD.status NOT IN ('registered','attended') AND NEW.status IN ('registered','waitlist','attended') END;
  IF is_new THEN
   IF t.status='completed' THEN RAISE EXCEPTION 'Турнир завершён — добавление запрещено' USING ERRCODE='23514'; END IF;
   SELECT EXISTS(SELECT 1 FROM public.tournament_late_registration WHERE tournament_id=NEW.tournament_id) INTO frozen;
   IF public.admin_admission_permitted(NEW.tournament_id,NEW.player_id) AND NEW.status IN ('registered','attended') THEN
    IF (SELECT count(*) FROM public.registrations r WHERE r.tournament_id=NEW.tournament_id AND r.status IN ('registered','attended') AND NOT EXISTS(SELECT 1 FROM public.tournament_player_eliminations e WHERE e.tournament_id=r.tournament_id AND e.player_id=r.player_id AND e.eliminated))>=t.max_players THEN RAISE EXCEPTION 'STAFF_ADMISSION: Свободных мест нет — добавление невозможно'; END IF;
    IF NOT t.is_final AND (EXISTS(SELECT 1 FROM public.players p WHERE p.id=NEW.player_id AND p.online_registration_restricted_at IS NOT NULL) OR NEW.no_show_at IS NOT NULL) THEN RAISE EXCEPTION 'STAFF_ADMISSION: Требуется отдельное подтверждение допуска после неявки'; END IF;
    IF (SELECT r.player_id FROM public.registrations r JOIN public.players p ON p.id=r.player_id WHERE r.tournament_id=NEW.tournament_id AND r.status='waitlist' AND r.no_show_at IS NULL AND (t.is_final OR p.online_registration_restricted_at IS NULL) AND p.merged_into_player_id IS NULL AND NOT p.is_blocked ORDER BY r.created_at,r.id LIMIT 1) IS DISTINCT FROM NEW.player_id AND EXISTS(SELECT 1 FROM public.registrations r JOIN public.players p ON p.id=r.player_id WHERE r.tournament_id=NEW.tournament_id AND r.status='waitlist' AND r.no_show_at IS NULL AND (t.is_final OR p.online_registration_restricted_at IS NULL) AND p.merged_into_player_id IS NULL AND NOT p.is_blocked) THEN RAISE EXCEPTION 'STAFF_ADMISSION: Сначала допустите первого игрока из листа ожидания'; END IF;
   END IF;
   IF (frozen OR (t.late_registration_ends_at IS NOT NULL AND clock_timestamp()>=t.late_registration_ends_at)) AND NOT public.admin_admission_permitted(NEW.tournament_id,NEW.player_id) THEN
    RAISE EXCEPTION 'Поздняя регистрация закрыта по времени' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSE
  IF t.late_registration_ends_at IS NOT NULL AND clock_timestamp()>=t.late_registration_ends_at THEN
   -- A confirmed staff admission may record ONE initial stack, never a re-entry/add-on.
   IF public.admin_admission_permitted(NEW.tournament_id,NEW.player_id) AND NEW.rebuys=1 AND NEW.addons=0 AND EXISTS(SELECT 1 FROM public.admin_tournament_admissions a WHERE a.request_id::text=current_setting('reraise.admin_admission',true) AND a.arrival_confirmed) THEN RETURN NEW; END IF;
   IF TG_OP='INSERT' AND (NEW.rebuys>0 OR NEW.addons>0) THEN RAISE EXCEPTION 'Покупка стеков после поздней регистрации запрещена' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND (NEW.rebuys>OLD.rebuys OR NEW.addons>OLD.addons) THEN RAISE EXCEPTION 'Покупка стеков после поздней регистрации запрещена' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.admin_admission_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE s public.tournament_late_registration; placement_pool bigint;
BEGIN
 IF NEW.status='completed' AND OLD.status<>'completed' AND EXISTS(SELECT 1 FROM public.admin_tournament_admissions WHERE tournament_id=NEW.id AND state='succeeded') THEN
  IF EXISTS(SELECT 1 FROM public.admin_tournament_admissions a JOIN public.registrations g ON g.tournament_id=a.tournament_id AND g.player_id=a.player_id LEFT JOIN public.results r ON r.tournament_id=g.tournament_id AND r.player_id=g.player_id LEFT JOIN public.tournament_attendance att ON att.tournament_id=g.tournament_id AND att.player_id=g.player_id WHERE a.tournament_id=NEW.id AND a.state='succeeded' AND g.status IN ('registered','attended') AND (r.id IS NULL OR (att.arrived AND r.arrived IS DISTINCT FROM true))) THEN RAISE EXCEPTION 'Состав изменился — обновите результаты перед завершением' USING ERRCODE='23514'; END IF;
  SELECT * INTO s FROM public.tournament_late_registration WHERE tournament_id=NEW.id;
  IF FOUND AND NEW.rating_formula_version='v2' AND NOT NEW.is_final THEN
   IF EXISTS(SELECT 1 FROM public.results r WHERE r.tournament_id=NEW.id AND (r.itm_points IS DISTINCT FROM CASE WHEN r.arrived THEN coalesce((SELECT (p->>'points')::int FROM jsonb_array_elements(s.rating_places) p WHERE (p->>'place')::int=r.place),0) ELSE 0 END)) THEN RAISE EXCEPTION 'Очки за места не совпадают с зафиксированным снимком' USING ERRCODE='23514'; END IF;
   SELECT coalesce(sum((p->>'points')::bigint),0) INTO placement_pool FROM jsonb_array_elements(s.rating_places) p;
   IF (SELECT coalesce(sum(itm_points),0) FROM public.results WHERE tournament_id=NEW.id)>placement_pool THEN RAISE EXCEPTION 'Зафиксированный фонд очков увеличен' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_admission_completion BEFORE UPDATE OF status ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.admin_admission_completion_guard();
