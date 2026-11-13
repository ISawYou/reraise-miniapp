ALTER TABLE "tournament_operations" ADD CONSTRAINT "operations_envelopes_nonnegative" CHECK ("tournament_operations"."mystery_envelopes_won" is null or "tournament_operations"."mystery_envelopes_won">=0);
--> statement-breakpoint
CREATE FUNCTION public.tournament_operation_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE tid uuid; state text;
BEGIN
 tid:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
 SELECT status INTO state FROM public.tournaments WHERE id=tid FOR UPDATE;
 IF state='completed' THEN RAISE EXCEPTION 'Завершённый турнир доступен только для просмотра' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER operation_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_operations FOR EACH ROW EXECUTE FUNCTION public.tournament_operation_completion_guard();
--> statement-breakpoint
CREATE TRIGGER attendance_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_attendance FOR EACH ROW EXECUTE FUNCTION public.tournament_operation_completion_guard();
--> statement-breakpoint
CREATE TRIGGER elimination_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_player_eliminations FOR EACH ROW EXECUTE FUNCTION public.tournament_operation_completion_guard();
