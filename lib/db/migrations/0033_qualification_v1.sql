CREATE TABLE "qualification_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"rules" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"final_date" date NOT NULL,
	"best_results_count" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"final_tournament_id" uuid,
	"winner_player_id" uuid,
	"ranking_fingerprint" text,
	"tie_resolution" jsonb,
	"qualification_closed_at" timestamp with time zone,
	"final_roster_locked_at" timestamp with time zone,
	"squad_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualification_event_status_check" CHECK ("qualification_events"."status" IN ('draft','qualifying','inviting','final','completed')),
	CONSTRAINT "qualification_best_count_check" CHECK ("qualification_events"."best_results_count" BETWEEN 1 AND 6),
	CONSTRAINT "qualification_event_version_check" CHECK ("qualification_events"."version">0),
	CONSTRAINT "qualification_event_title_check" CHECK (char_length(btrim("qualification_events"."title")) BETWEEN 2 AND 120),
	CONSTRAINT "qualification_event_slug_check" CHECK ("qualification_events"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "qualification_locked_phase_check" CHECK ("qualification_events"."status" NOT IN ('final','completed') OR ("qualification_events"."final_roster_locked_at" IS NOT NULL AND "qualification_events"."final_tournament_id" IS NOT NULL AND "qualification_events"."winner_player_id" IS NOT NULL)),
	CONSTRAINT "qualification_completed_check" CHECK ("qualification_events"."status" <> 'completed' OR "qualification_events"."squad_confirmed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "qualification_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"qualifying_rank" integer NOT NULL,
	"seat" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"replaces_id" uuid,
	CONSTRAINT "qualification_invitation_status_check" CHECK ("qualification_invitations"."status" IN ('pending','accepted','declined','cancelled','replaced')),
	CONSTRAINT "qualification_invitation_seat_check" CHECK ("qualification_invitations"."seat" BETWEEN 1 AND 18),
	CONSTRAINT "qualification_invitation_rank_check" CHECK ("qualification_invitations"."qualifying_rank" >=2)
);
--> statement-breakpoint
CREATE TABLE "qualification_tournament_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"scheduled_date" date NOT NULL,
	"tournament_id" uuid,
	"display_order" integer NOT NULL,
	CONSTRAINT "qualification_slot_order_check" CHECK ("qualification_tournament_slots"."display_order" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "qualification_squad_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"selection_source" text NOT NULL,
	"slot" integer NOT NULL,
	"final_place" integer,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "qualification_squad_source_slot_check" CHECK (("qualification_squad_members"."selection_source" IN ('qualification_winner','captain') AND "qualification_squad_members"."slot"=0) OR ("qualification_squad_members"."selection_source"='final_top3' AND "qualification_squad_members"."slot" BETWEEN 1 AND 3))
);
--> statement-breakpoint
ALTER TABLE "qualification_audit" ADD CONSTRAINT "qualification_audit_event_id_qualification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."qualification_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_audit" ADD CONSTRAINT "qualification_audit_actor_id_players_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_events" ADD CONSTRAINT "qualification_events_final_tournament_id_tournaments_id_fk" FOREIGN KEY ("final_tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_events" ADD CONSTRAINT "qualification_events_winner_player_id_players_id_fk" FOREIGN KEY ("winner_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_invitations" ADD CONSTRAINT "qualification_invitations_event_id_qualification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."qualification_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_invitations" ADD CONSTRAINT "qualification_invitations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_invitations" ADD CONSTRAINT "qualification_invitations_replaces_id_qualification_invitations_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."qualification_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_tournament_slots" ADD CONSTRAINT "qualification_tournament_slots_event_id_qualification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."qualification_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_tournament_slots" ADD CONSTRAINT "qualification_tournament_slots_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_squad_members" ADD CONSTRAINT "qualification_squad_members_event_id_qualification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."qualification_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_squad_members" ADD CONSTRAINT "qualification_squad_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qualification_audit_event_idx" ON "qualification_audit" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_event_slug_key" ON "qualification_events" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_final_tournament_key" ON "qualification_events" USING btree ("final_tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_active_player_key" ON "qualification_invitations" USING btree ("event_id","player_id") WHERE "qualification_invitations"."status" IN ('pending','accepted');--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_active_seat_key" ON "qualification_invitations" USING btree ("event_id","seat") WHERE "qualification_invitations"."status" IN ('pending','accepted');--> statement-breakpoint
CREATE INDEX "qualification_invitation_history_idx" ON "qualification_invitations" USING btree ("event_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_slot_date_key" ON "qualification_tournament_slots" USING btree ("event_id","scheduled_date");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_slot_order_key" ON "qualification_tournament_slots" USING btree ("event_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_slot_tournament_key" ON "qualification_tournament_slots" USING btree ("event_id","tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_squad_player_key" ON "qualification_squad_members" USING btree ("event_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_squad_slot_key" ON "qualification_squad_members" USING btree ("event_id","selection_source","slot");--> statement-breakpoint
-- Narrow database guard: every existing registration entry point is covered,
-- including operator/manual imports. No change to ordinary tournaments.
CREATE FUNCTION qualification_guard_registration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; locked_at timestamptz; phase text; tid uuid; pid uuid;
BEGIN
  IF TG_OP='DELETE' THEN tid:=OLD.tournament_id; pid:=OLD.player_id;
  ELSE tid:=NEW.tournament_id; pid:=NEW.player_id; END IF;
  SELECT id,final_roster_locked_at,status INTO eid,locked_at,phase FROM qualification_events WHERE final_tournament_id=tid;
  IF eid IS NULL THEN
    IF TG_OP='UPDATE' AND OLD.tournament_id<>NEW.tournament_id AND EXISTS(SELECT 1 FROM qualification_events WHERE final_tournament_id=OLD.tournament_id) THEN
      RAISE EXCEPTION 'Нельзя переносить участника зафиксированного квалификационного финала' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Состав квалификационного финала зафиксирован' USING ERRCODE='23514'; END IF;
  IF locked_at IS NULL OR phase NOT IN ('final','completed') OR NEW.status NOT IN ('registered','attended') OR NOT EXISTS(
    SELECT 1 FROM qualification_invitations WHERE event_id=eid AND player_id=pid AND status='accepted'
  ) THEN RAISE EXCEPTION 'Регистрация в квалификационный финал только по подтверждённому приглашению и после фиксации состава' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (OLD.tournament_id<>NEW.tournament_id OR OLD.player_id<>NEW.player_id) THEN
    RAISE EXCEPTION 'Нельзя переносить участника квалификационного финала' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_registration_guard BEFORE INSERT OR UPDATE OR DELETE ON registrations FOR EACH ROW EXECUTE FUNCTION qualification_guard_registration();
--> statement-breakpoint
CREATE FUNCTION qualification_guard_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ft tournaments%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>NEW.status AND NOT ((OLD.status='draft' AND NEW.status='qualifying') OR (OLD.status='qualifying' AND NEW.status='inviting') OR (OLD.status='inviting' AND NEW.status IN ('qualifying','final')) OR (OLD.status='final' AND NEW.status='completed')) THEN RAISE EXCEPTION 'Недопустимый переход этапа квалификации' USING ERRCODE='23514'; END IF;
    IF OLD.final_roster_locked_at IS NOT NULL AND NEW.final_tournament_id IS DISTINCT FROM OLD.final_tournament_id THEN RAISE EXCEPTION 'Финал уже зафиксирован' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.final_tournament_id IS NOT NULL THEN
    IF TG_OP='INSERT' OR NEW.final_tournament_id IS DISTINCT FROM OLD.final_tournament_id THEN
      SELECT * INTO ft FROM tournaments WHERE id=NEW.final_tournament_id FOR UPDATE;
    ELSE
      SELECT * INTO ft FROM tournaments WHERE id=NEW.final_tournament_id;
    END IF;
    IF NOT FOUND OR ft.kind<>'free' OR ft.is_final OR ft.max_players<>18 OR (ft.start_at AT TIME ZONE NEW.timezone)::date<>NEW.final_date OR EXISTS(SELECT 1 FROM qualification_tournament_slots WHERE tournament_id=NEW.final_tournament_id) THEN RAISE EXCEPTION 'Нужен отдельный бесплатный финал на 18 мест без is_final' USING ERRCODE='23514'; END IF;
    IF TG_OP='INSERT' OR NEW.final_tournament_id IS DISTINCT FROM OLD.final_tournament_id THEN
      IF EXISTS(SELECT 1 FROM registrations WHERE tournament_id=NEW.final_tournament_id AND status<>'cancelled') THEN RAISE EXCEPTION 'У назначаемого финала уже есть участники' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  IF NEW.status='completed' AND (SELECT count(*) FROM qualification_squad_members WHERE event_id=NEW.id AND confirmed_at IS NOT NULL)<>5 THEN RAISE EXCEPTION 'Нужны пять подтверждённых участников сборной' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_event_guard BEFORE INSERT OR UPDATE ON qualification_events FOR EACH ROW EXECUTE FUNCTION qualification_guard_event();
--> statement-breakpoint
CREATE FUNCTION qualification_guard_slot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tournament_id IS NOT NULL AND EXISTS(SELECT 1 FROM qualification_events WHERE final_tournament_id=NEW.tournament_id) THEN RAISE EXCEPTION 'Финал нельзя включить в квалификационные источники' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_slot_guard BEFORE INSERT OR UPDATE ON qualification_tournament_slots FOR EACH ROW EXECUTE FUNCTION qualification_guard_slot();
--> statement-breakpoint
CREATE FUNCTION qualification_guard_final_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM qualification_events e WHERE e.final_tournament_id=NEW.id AND (NEW.kind<>'free' OR NEW.is_final OR NEW.max_players<>18 OR (NEW.start_at AT TIME ZONE e.timezone)::date<>e.final_date)) THEN RAISE EXCEPTION 'Связанный qualification-финал должен оставаться обычным бесплатным турниром на 18 мест' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_final_settings_guard BEFORE UPDATE OF kind,is_final,max_players,start_at ON tournaments FOR EACH ROW EXECUTE FUNCTION qualification_guard_final_settings();
