ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_tournament_type_check";--> statement-breakpoint
ALTER TABLE "qualification_events" ADD COLUMN "final_outcome" jsonb;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_tournament_type_check" CHECK ("tournaments"."tournament_type" IN ('qualification_final', 'classic', 'phoenix', 'deep_stack', 'bounty', 'boss_bounty', 'win_the_button', 'mystery_bounty', 'crazy_pineapple', 'bomb_pot', 'boost_rating', 'free_roll'));--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN starting_stack integer;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN late_registration_ends_at timestamptz;
--> statement-breakpoint
ALTER TABLE tournaments ADD CONSTRAINT tournament_optional_stack CHECK (starting_stack IS NULL OR starting_stack>0);
--> statement-breakpoint
ALTER TABLE tournaments ADD CONSTRAINT tournament_optional_deadline CHECK (late_registration_ends_at IS NULL OR late_registration_ends_at>start_at);
--> statement-breakpoint
-- Additive guards: no historical UPDATE, no data seed and no rating rewrite.
ALTER TABLE tournaments ADD CONSTRAINT qualification_final_shape CHECK (tournament_type<>'qualification_final' OR (kind='free' AND NOT is_final AND max_players=18 AND starting_stack IS NOT DISTINCT FROM 50000 AND late_registration_ends_at IS NULL AND rating_guarantee IS NULL));
--> statement-breakpoint
CREATE FUNCTION qualification_r2_guard_entries() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE typ text; phase text; entries integer;
BEGIN
 SELECT tournament_type,status INTO typ,phase FROM tournaments WHERE id=NEW.tournament_id;
 IF typ='qualification_final' THEN
   SELECT status INTO phase FROM tournaments WHERE id=NEW.tournament_id FOR UPDATE;
   IF TG_TABLE_NAME='results' THEN RAISE EXCEPTION 'Финал отбора не создаёт рейтинговые results' USING ERRCODE='23514'; END IF;
   IF phase='completed' THEN RAISE EXCEPTION 'Финал уже завершён' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='results' THEN entries:=NEW.reentries; ELSE entries:=NEW.rebuys; END IF;
 IF typ='qualification_final' AND (entries>1 OR NEW.addons<>0) THEN RAISE EXCEPTION 'Финал: один первоначальный стек, без Re-entry и Add-on' USING ERRCODE='23514'; END IF;
 IF typ='phoenix' AND phase<>'completed' AND (entries>2 OR NEW.addons<>0) THEN RAISE EXCEPTION 'PHOENIX: максимум один Re-entry, без Add-on' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_r2_rebuy_guard BEFORE INSERT OR UPDATE ON tournament_rebuy_state FOR EACH ROW EXECUTE FUNCTION qualification_r2_guard_entries();
--> statement-breakpoint
CREATE TRIGGER qualification_r2_live_entry_guard BEFORE INSERT OR UPDATE ON tournament_live_entries FOR EACH ROW EXECUTE FUNCTION qualification_r2_guard_entries();
--> statement-breakpoint
CREATE TRIGGER qualification_r2_result_guard BEFORE INSERT OR UPDATE ON results FOR EACH ROW EXECUTE FUNCTION qualification_r2_guard_entries();
--> statement-breakpoint
CREATE FUNCTION qualification_r2_closed_registration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT tournament_type FROM tournaments WHERE id=NEW.tournament_id)='qualification_final' AND NOT EXISTS(SELECT 1 FROM qualification_events e JOIN qualification_invitations i ON i.event_id=e.id WHERE e.final_tournament_id=NEW.tournament_id AND e.final_roster_locked_at IS NOT NULL AND e.status IN ('final','completed') AND i.player_id=NEW.player_id AND i.status='accepted' AND NEW.status IN ('registered','attended')) THEN RAISE EXCEPTION 'Финал отбора закрыт: только зафиксированные подтверждённые приглашения' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_r2_registration_guard BEFORE INSERT OR UPDATE ON registrations FOR EACH ROW EXECUTE FUNCTION qualification_r2_closed_registration();
--> statement-breakpoint
CREATE FUNCTION qualification_r2_freeze_live() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; typ text; phase text;
BEGIN
 IF TG_OP='DELETE' THEN tid:=OLD.tournament_id; ELSE tid:=NEW.tournament_id; END IF;
 SELECT tournament_type INTO typ FROM tournaments WHERE id=tid;
 IF typ='qualification_final' THEN
   SELECT status INTO phase FROM tournaments WHERE id=tid FOR UPDATE;
   IF phase='completed' THEN RAISE EXCEPTION 'Спортивный исход финала зафиксирован' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_r2_attendance_freeze BEFORE INSERT OR UPDATE OR DELETE ON tournament_attendance FOR EACH ROW EXECUTE FUNCTION qualification_r2_freeze_live();
--> statement-breakpoint
CREATE TRIGGER qualification_r2_elimination_freeze BEFORE INSERT OR UPDATE OR DELETE ON tournament_player_eliminations FOR EACH ROW EXECUTE FUNCTION qualification_r2_freeze_live();
--> statement-breakpoint
CREATE FUNCTION qualification_r2_freeze_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.final_outcome IS NOT NULL AND NEW.final_outcome IS DISTINCT FROM OLD.final_outcome THEN RAISE EXCEPTION 'Итог трёх оставшихся неизменяем' USING ERRCODE='23514'; END IF;
 IF NEW.final_outcome IS NOT NULL AND (jsonb_array_length(NEW.final_outcome->'survivorIds')<>3 OR NEW.final_roster_locked_at IS NULL OR NEW.status NOT IN ('final','completed')) THEN RAISE EXCEPTION 'Нужны три оставшихся игрока зафиксированного финала' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_r2_outcome_guard BEFORE UPDATE ON qualification_events FOR EACH ROW EXECUTE FUNCTION qualification_r2_freeze_outcome();
--> statement-breakpoint
CREATE FUNCTION qualification_r2_guard_tournament() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tournament_type='qualification_final' THEN
   IF TG_OP='UPDATE' AND OLD.tournament_type<>NEW.tournament_type AND (OLD.status='completed' OR EXISTS(SELECT 1 FROM results WHERE tournament_id=NEW.id)) THEN RAISE EXCEPTION 'Исторический турнир нельзя преобразовать в финал отбора' USING ERRCODE='23514'; END IF;
   IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM qualification_events WHERE final_tournament_id=NEW.id AND final_outcome IS NOT NULL) THEN RAISE EXCEPTION 'Используйте специальное завершение на трёх оставшихся' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.tournament_type='qualification_final' AND NEW.tournament_type<>OLD.tournament_type AND EXISTS(SELECT 1 FROM qualification_events WHERE final_tournament_id=NEW.id) THEN RAISE EXCEPTION 'Нельзя сменить тип связанного финала' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_r2_tournament_guard BEFORE INSERT OR UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION qualification_r2_guard_tournament();
--> statement-breakpoint
CREATE FUNCTION tournament_r2_deadline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deadline timestamptz;
BEGIN
 SELECT late_registration_ends_at INTO deadline FROM tournaments WHERE id=NEW.tournament_id;
 IF deadline IS NOT NULL AND clock_timestamp()>=deadline THEN
   IF TG_TABLE_NAME='registrations' THEN
     IF TG_OP='INSERT' AND NEW.status IN ('registered','waitlist') THEN RAISE EXCEPTION 'Поздняя регистрация закрыта по времени' USING ERRCODE='23514'; END IF;
     IF TG_OP='UPDATE' AND OLD.status NOT IN ('registered','attended') AND NEW.status IN ('registered','waitlist') THEN RAISE EXCEPTION 'Поздняя регистрация закрыта по времени' USING ERRCODE='23514'; END IF;
   ELSE
     IF TG_OP='INSERT' AND (NEW.rebuys>0 OR NEW.addons>0) THEN RAISE EXCEPTION 'Покупка стеков после поздней регистрации запрещена' USING ERRCODE='23514'; END IF;
     IF TG_OP='UPDATE' AND (NEW.rebuys>OLD.rebuys OR NEW.addons>OLD.addons) THEN RAISE EXCEPTION 'Покупка стеков после поздней регистрации запрещена' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tournament_r2_registration_deadline BEFORE INSERT OR UPDATE ON registrations FOR EACH ROW EXECUTE FUNCTION tournament_r2_deadline_guard();
--> statement-breakpoint
CREATE TRIGGER tournament_r2_rebuy_deadline BEFORE INSERT OR UPDATE ON tournament_rebuy_state FOR EACH ROW EXECUTE FUNCTION tournament_r2_deadline_guard();
