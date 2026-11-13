ALTER TABLE "tournament_operations" ADD CONSTRAINT "operations_envelopes_nonnegative" CHECK ("tournament_operations"."mystery_envelopes_won" is null or "tournament_operations"."mystery_envelopes_won">=0);
--> statement-breakpoint
CREATE TABLE public.account_merge_maintenance (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL,
 source_id uuid NOT NULL, target_id uuid NOT NULL, actor_id uuid NOT NULL, intent_id uuid,
 scope jsonb NOT NULL, finished boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT account_merge_maintenance_transaction_id_backend_pid_pk PRIMARY KEY(transaction_id,backend_pid)
);
REVOKE ALL ON public.account_merge_maintenance FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.issue_account_merge_maintenance(sid uuid,tid uuid,aid uuid,iid uuid,plan jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE table_name text; source_rows jsonb; target_rows jsonb; expected jsonb; item jsonb; patch jsonb; record jsonb; tournament uuid;
 scope jsonb := '{"source":{},"target":{},"expected":{}}'::jsonb;
BEGIN
 IF sid=tid OR jsonb_typeof(plan)<>'array' OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=sid AND merged_into_player_id IS NULL) OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=tid AND merged_into_player_id IS NULL) THEN RAISE EXCEPTION 'ACCOUNT_MERGE: invalid pair'; END IF;
 IF iid IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=aid AND role='admin' AND NOT is_blocked AND merged_into_player_id IS NULL) THEN RAISE EXCEPTION 'ACCOUNT_MERGE: admin authorization required' USING ERRCODE='42501'; END IF;
 ELSE
  IF aid<>tid OR NOT EXISTS(SELECT 1 FROM public.player_merge_intents i WHERE i.id=iid AND i.target_player_id=tid AND i.source_player_id=sid AND i.status='pending' AND i.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ACCOUNT_MERGE: server-issued intent required' USING ERRCODE='42501'; END IF;
 END IF;
 FOREACH table_name IN ARRAY ARRAY['tournament_attendance','tournament_player_eliminations','tournament_rebuy_state'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_object_agg(tournament_id::text,to_jsonb(r)-''updated_at''),''{}''::jsonb) FROM public.%I r WHERE player_id=$1',table_name) INTO source_rows USING sid;
  EXECUTE format('SELECT coalesce(jsonb_object_agg(tournament_id::text,to_jsonb(r)-''updated_at''),''{}''::jsonb) FROM public.%I r WHERE player_id=$1',table_name) INTO target_rows USING tid;
  expected:='{}'::jsonb;
  FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
   patch:=item->table_name;
   IF patch IS NULL OR patch='null'::jsonb THEN CONTINUE; END IF;
   tournament:=(item->>'tournamentId')::uuid;
   IF NOT source_rows ? tournament::text OR NOT target_rows ? tournament::text THEN RAISE EXCEPTION 'ACCOUNT_MERGE: collision snapshot missing'; END IF;
   IF table_name='tournament_attendance' AND patch-ARRAY['arrived','arrived_at']<>'{}'::jsonb OR table_name='tournament_player_eliminations' AND patch-ARRAY['eliminated','eliminated_at']<>'{}'::jsonb OR table_name='tournament_rebuy_state' AND patch-ARRAY['rebuys','addons']<>'{}'::jsonb THEN RAISE EXCEPTION 'ACCOUNT_MERGE: unsupported collision fields'; END IF;
   EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::public.%I,$1)) - ''updated_at''',table_name) INTO record USING (target_rows->tournament::text)||patch;
   expected:=expected||jsonb_build_object(tournament::text,record);
  END LOOP;
  scope:=jsonb_set(scope,ARRAY['source',table_name],source_rows);
  scope:=jsonb_set(scope,ARRAY['target',table_name],target_rows);
  scope:=jsonb_set(scope,ARRAY['expected',table_name],expected);
 END LOOP;
 INSERT INTO public.account_merge_maintenance(transaction_id,backend_pid,source_id,target_id,actor_id,intent_id,scope) VALUES(txid_current(),pg_backend_pid(),sid,tid,aid,iid,scope);
END $$;
REVOKE ALL ON FUNCTION public.issue_account_merge_maintenance(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.account_merge_row_permitted(table_name text,operation text,before_row jsonb,after_row jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE permit public.account_merge_maintenance; tournament text; old_player uuid; expected jsonb; actual_target jsonb;
BEGIN
 IF table_name NOT IN ('tournament_attendance','tournament_player_eliminations','tournament_rebuy_state') THEN RETURN false; END IF;
 SELECT * INTO permit FROM public.account_merge_maintenance WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND NOT finished;
 IF NOT FOUND THEN RETURN false; END IF;
 tournament:=before_row->>'tournament_id';old_player:=(before_row->>'player_id')::uuid;
 expected:=permit.scope#>ARRAY['expected',table_name,tournament];
 IF old_player=permit.source_id AND before_row-'updated_at'=permit.scope#>ARRAY['source',table_name,tournament] THEN
  IF operation='UPDATE' AND after_row->>'player_id'=permit.target_id::text AND after_row-ARRAY['player_id','updated_at']=before_row-ARRAY['player_id','updated_at'] THEN RETURN true; END IF;
  IF operation='DELETE' AND expected IS NOT NULL THEN
   EXECUTE format('SELECT to_jsonb(r)-''updated_at'' FROM public.%I r WHERE tournament_id=$1 AND player_id=$2',table_name) INTO actual_target USING tournament::uuid,permit.target_id;
   RETURN actual_target=expected;
  END IF;
 END IF;
 IF operation='UPDATE' AND old_player=permit.target_id AND before_row-'updated_at'=permit.scope#>ARRAY['target',table_name,tournament] AND after_row-'updated_at'=expected THEN RETURN true; END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.account_merge_row_permitted(text,text,jsonb,jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.tournament_operation_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE tid uuid; state text;
BEGIN
 tid:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
 IF TG_OP='UPDATE' AND OLD.tournament_id IS DISTINCT FROM NEW.tournament_id THEN RAISE EXCEPTION 'Перенос операционной строки между турнирами запрещён' USING ERRCODE='23514'; END IF;
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
--> statement-breakpoint
CREATE TRIGGER operation_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_operations FOR EACH ROW EXECUTE FUNCTION public.tournament_operation_completion_guard();
--> statement-breakpoint
CREATE TRIGGER attendance_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_attendance FOR EACH ROW EXECUTE FUNCTION public.tournament_operation_completion_guard();
--> statement-breakpoint
CREATE TRIGGER elimination_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_player_eliminations FOR EACH ROW EXECUTE FUNCTION public.tournament_operation_completion_guard();
--> statement-breakpoint
-- Preserve the applied 0038 SQL hash. Extend only its live-state branch with
-- the same exact-row merge permission; registration/deadline rules stay intact.
DO $$
DECLARE definition text; needle text := 'IF t.status=''completed'' THEN RAISE EXCEPTION ''Завершённый турнир нельзя редактировать'' USING ERRCODE=''23514''; END IF;';
BEGIN
 definition:=pg_get_functiondef('public.tournament_r2_deadline_guard()'::regprocedure);
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Expected 0038 guard not found; refusing migration'; END IF;
 definition:=replace(definition,needle,'IF TG_OP=''UPDATE'' AND public.account_merge_row_permitted(TG_TABLE_NAME,TG_OP,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF; '||needle);
 EXECUTE definition;
END $$;
