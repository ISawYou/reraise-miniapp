CREATE TABLE "staff_tournament_live_edits" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"actor_id" uuid,
	"source" text NOT NULL,
	"rebuys" integer NOT NULL,
	"addons" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"transaction_id" bigint NOT NULL,
	"backend_pid" integer NOT NULL,
	"previous_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_live_edit_source" CHECK ("staff_tournament_live_edits"."source" in ('staff','sheet_sync')),
	CONSTRAINT "staff_live_edit_state" CHECK ("staff_tournament_live_edits"."state" in ('pending','succeeded')),
	CONSTRAINT "staff_live_edit_values" CHECK ("staff_tournament_live_edits"."rebuys" >= 0 and "staff_tournament_live_edits"."addons" >= 0)
);
--> statement-breakpoint
REVOKE ALL ON public.staff_tournament_live_edits FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.staff_live_edit_permitted(tid uuid,pid uuid,new_rebuys integer,new_addons integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.staff_tournament_live_edits e
   WHERE e.request_id::text=current_setting('reraise.staff_live_edit',true)
   AND e.tournament_id=tid AND e.player_id=pid AND e.state='pending'
   AND e.rebuys=new_rebuys AND e.addons=new_addons
   AND e.transaction_id=txid_current() AND e.backend_pid=pg_backend_pid()
 );
$$;
REVOKE ALL ON FUNCTION public.staff_live_edit_permitted(uuid,uuid,integer,integer) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.issue_staff_live_edit_permit(
 rid uuid,tid uuid,pid uuid,aid uuid,edit_source text,new_rebuys integer,new_addons integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tournaments; previous jsonb;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=tid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_LIVE_EDIT: Турнир не найден'; END IF;
 IF t.status='completed' THEN RAISE EXCEPTION 'STAFF_LIVE_EDIT: Завершённый турнир нельзя редактировать'; END IF;
 IF new_rebuys<0 OR new_addons<0 THEN RAISE EXCEPTION 'STAFF_LIVE_EDIT: Значения не могут быть отрицательными'; END IF;
 PERFORM 1 FROM public.registrations WHERE tournament_id=tid AND player_id=pid AND status IN ('registered','attended') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_LIVE_EDIT: Игрок не входит в текущий состав'; END IF;
 IF edit_source='staff' THEN
   PERFORM 1 FROM public.players WHERE id=aid AND role IN ('admin','operator') AND NOT is_blocked AND merged_into_player_id IS NULL FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_LIVE_EDIT: Недостаточно прав'; END IF;
 ELSIF edit_source='sheet_sync' THEN
   IF aid IS NOT NULL THEN RAISE EXCEPTION 'STAFF_LIVE_EDIT: Некорректный источник'; END IF;
   IF EXISTS(SELECT 1 FROM public.tournament_late_registration WHERE tournament_id=tid) THEN
     RAISE EXCEPTION 'STAFF_LIVE_EDIT: После фиксации фонда требуется ручная проверка';
   END IF;
 ELSE
   RAISE EXCEPTION 'STAFF_LIVE_EDIT: Некорректный источник';
 END IF;
 SELECT jsonb_build_object('rebuys',rebuys,'addons',addons) INTO previous
 FROM public.tournament_rebuy_state WHERE tournament_id=tid AND player_id=pid;
 INSERT INTO public.staff_tournament_live_edits(
   request_id,tournament_id,player_id,actor_id,source,rebuys,addons,
   transaction_id,backend_pid,previous_state
 ) VALUES(rid,tid,pid,aid,edit_source,new_rebuys,new_addons,txid_current(),pg_backend_pid(),previous);
 PERFORM set_config('reraise.staff_live_edit',rid::text,true);
END $$;
REVOKE ALL ON FUNCTION public.issue_staff_live_edit_permit(uuid,uuid,uuid,uuid,text,integer,integer) FROM PUBLIC;
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
  IF t.status='completed' THEN RAISE EXCEPTION 'Завершённый турнир нельзя редактировать' USING ERRCODE='23514'; END IF;
  IF t.late_registration_ends_at IS NOT NULL AND clock_timestamp()>=t.late_registration_ends_at THEN
   IF public.admin_admission_permitted(NEW.tournament_id,NEW.player_id) AND NEW.rebuys=1 AND NEW.addons=0 AND EXISTS(SELECT 1 FROM public.admin_tournament_admissions a WHERE a.request_id::text=current_setting('reraise.admin_admission',true) AND a.arrival_confirmed) THEN RETURN NEW; END IF;
   IF public.staff_live_edit_permitted(NEW.tournament_id,NEW.player_id,NEW.rebuys,NEW.addons) THEN RETURN NEW; END IF;
   IF TG_OP='INSERT' AND (NEW.rebuys>0 OR NEW.addons>0) THEN RAISE EXCEPTION 'Покупка стеков после поздней регистрации запрещена' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND (NEW.rebuys>OLD.rebuys OR NEW.addons>OLD.addons) THEN RAISE EXCEPTION 'Покупка стеков после поздней регистрации запрещена' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
