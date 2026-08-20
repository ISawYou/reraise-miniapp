CREATE TABLE "academy_lesson_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"lesson_code" text NOT NULL,
	"attempts_count" integer DEFAULT 0 NOT NULL,
	"last_score_percent" integer NOT NULL,
	"best_score_percent" integer NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"first_completed_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_lesson_progress_attempts_count_check" CHECK ("academy_lesson_progress"."attempts_count" >= 0),
	CONSTRAINT "academy_lesson_progress_last_score_check" CHECK ("academy_lesson_progress"."last_score_percent" BETWEEN 0 AND 100),
	CONSTRAINT "academy_lesson_progress_best_score_check" CHECK ("academy_lesson_progress"."best_score_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "academy_training_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"lesson_code" text NOT NULL,
	"score_percent" integer NOT NULL,
	"passed" boolean NOT NULL,
	"first_pass" boolean DEFAULT false NOT NULL,
	"new_best" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_training_attempts_score_check" CHECK ("academy_training_attempts"."score_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "academy_lesson_progress" ADD CONSTRAINT "academy_lesson_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_training_attempts" ADD CONSTRAINT "academy_training_attempts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academy_lesson_progress_player_lesson_key" ON "academy_lesson_progress" USING btree ("player_id","lesson_code");--> statement-breakpoint
CREATE INDEX "academy_lesson_progress_lesson_code_idx" ON "academy_lesson_progress" USING btree ("lesson_code");--> statement-breakpoint
CREATE INDEX "academy_training_attempts_player_lesson_idx" ON "academy_training_attempts" USING btree ("player_id","lesson_code");--> statement-breakpoint
ALTER TABLE "academy_lesson_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "academy_training_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "record_academy_training_attempt"(
	"p_attempt_id" uuid,
	"p_player_id" uuid,
	"p_lesson_code" text,
	"p_score_percent" integer,
	"p_passed" boolean
)
RETURNS TABLE (
	"lesson_code" text,
	"attempts_count" integer,
	"last_score_percent" integer,
	"best_score_percent" integer,
	"passed" boolean,
	"first_completed_at" timestamptz,
	"last_attempt_at" timestamptz,
	"is_new_attempt" boolean,
	"first_pass" boolean,
	"new_best" boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
	v_attempt academy_training_attempts%ROWTYPE;
	v_progress academy_lesson_progress%ROWTYPE;
	v_previous_progress academy_lesson_progress%ROWTYPE;
	v_now timestamptz;
	v_first_pass boolean;
	v_new_best boolean;
BEGIN
	IF p_score_percent < 0 OR p_score_percent > 100 THEN
		RAISE EXCEPTION 'Academy score must be between 0 and 100';
	END IF;

	-- Serialize one player+lesson aggregate while unrelated lessons continue concurrently.
	PERFORM pg_advisory_xact_lock(
		hashtextextended(p_player_id::text || ':' || p_lesson_code, 0)
	);
	v_now := clock_timestamp();

	INSERT INTO academy_training_attempts (
		id, player_id, lesson_code, score_percent, passed, completed_at
	)
	VALUES (
		p_attempt_id, p_player_id, p_lesson_code, p_score_percent, p_passed, v_now
	)
	ON CONFLICT (id) DO NOTHING
	RETURNING * INTO v_attempt;

	IF v_attempt.id IS NULL THEN
		SELECT attempt.* INTO v_attempt
		FROM academy_training_attempts AS attempt
		WHERE attempt.id = p_attempt_id;

		IF v_attempt.player_id <> p_player_id
			OR v_attempt.lesson_code <> p_lesson_code
			OR v_attempt.score_percent <> p_score_percent
			OR v_attempt.passed <> p_passed THEN
			RAISE EXCEPTION 'Academy attempt id was already used with different data';
		END IF;

		SELECT progress.* INTO v_progress
		FROM academy_lesson_progress AS progress
		WHERE progress.player_id = p_player_id
			AND progress.lesson_code = p_lesson_code;

		RETURN QUERY SELECT
			v_progress.lesson_code,
			v_progress.attempts_count,
			v_progress.last_score_percent,
			v_progress.best_score_percent,
			v_progress.passed,
			v_progress.first_completed_at,
			v_progress.last_attempt_at,
			false,
			v_attempt.first_pass,
			v_attempt.new_best;
		RETURN;
	END IF;

	SELECT progress.* INTO v_previous_progress
	FROM academy_lesson_progress AS progress
	WHERE progress.player_id = p_player_id
		AND progress.lesson_code = p_lesson_code;

	INSERT INTO academy_lesson_progress (
		player_id,
		lesson_code,
		attempts_count,
		last_score_percent,
		best_score_percent,
		passed,
		first_completed_at,
		last_attempt_at,
		created_at,
		updated_at
	)
	VALUES (
		p_player_id,
		p_lesson_code,
		1,
		p_score_percent,
		p_score_percent,
		p_passed,
		CASE WHEN p_passed THEN v_now ELSE NULL END,
		v_now,
		v_now,
		v_now
	)
	ON CONFLICT (player_id, lesson_code) DO UPDATE SET
		attempts_count = academy_lesson_progress.attempts_count + 1,
		last_score_percent = EXCLUDED.last_score_percent,
		best_score_percent = GREATEST(
			academy_lesson_progress.best_score_percent,
			EXCLUDED.best_score_percent
		),
		passed = academy_lesson_progress.passed OR EXCLUDED.passed,
		first_completed_at = COALESCE(
			academy_lesson_progress.first_completed_at,
			EXCLUDED.first_completed_at
		),
		last_attempt_at = EXCLUDED.last_attempt_at,
		updated_at = v_now
	RETURNING * INTO v_progress;

	v_first_pass := p_passed AND COALESCE(v_previous_progress.passed, false) = false;
	v_new_best := v_previous_progress.id IS NULL
		OR p_score_percent > v_previous_progress.best_score_percent;

	UPDATE academy_training_attempts AS attempt SET
		first_pass = v_first_pass,
		new_best = v_new_best
	WHERE attempt.id = p_attempt_id;

	RETURN QUERY SELECT
		v_progress.lesson_code,
		v_progress.attempts_count,
		v_progress.last_score_percent,
		v_progress.best_score_percent,
		v_progress.passed,
		v_progress.first_completed_at,
		v_progress.last_attempt_at,
		true,
		v_first_pass,
		v_new_best;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "record_academy_training_attempt"(uuid, uuid, text, integer, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "record_academy_training_attempt"(uuid, uuid, text, integer, boolean) TO CURRENT_USER;
