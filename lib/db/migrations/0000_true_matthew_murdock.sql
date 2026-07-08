CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint,
	"email" text,
	"username" text,
	"display_name" text NOT NULL,
	"admin_display_name" text,
	"pending_display_name" text,
	"nickname_status" text DEFAULT 'approved' NOT NULL,
	"telegram_avatar_url" text,
	"custom_avatar_url" text,
	"avatar_updated_at" timestamp with time zone,
	"role" text DEFAULT 'player' NOT NULL,
	"accepted_terms_at" timestamp with time zone,
	"accepted_terms_version" text,
	"profile_completed_at" timestamp with time zone,
	"can_access_free" boolean DEFAULT true NOT NULL,
	"can_access_paid" boolean DEFAULT false NOT NULL,
	"can_access_cash" boolean DEFAULT false NOT NULL,
	"referral_count" integer DEFAULT 0 NOT NULL,
	"free_reentries_balance" integer DEFAULT 0 NOT NULL,
	"yandex_review_bonus_claimed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "players_role_check" CHECK ("players"."role" IN ('player', 'admin')),
	CONSTRAINT "players_identity_present" CHECK ("players"."telegram_id" IS NOT NULL OR "players"."email" IS NOT NULL),
	CONSTRAINT "players_display_name_length" CHECK (char_length("players"."display_name") BETWEEN 1 AND 100),
	CONSTRAINT "players_pending_display_name_length" CHECK ("players"."pending_display_name" IS NULL OR char_length("players"."pending_display_name") BETWEEN 1 AND 100),
	CONSTRAINT "players_admin_display_name_length" CHECK ("players"."admin_display_name" IS NULL OR char_length("players"."admin_display_name") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_title_length" CHECK (char_length("seasons"."title") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"google_sheet_tab_name" text,
	"start_at" timestamp with time zone NOT NULL,
	"max_players" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"kind" text DEFAULT 'free' NOT NULL,
	"tournament_type" text DEFAULT 'classic' NOT NULL,
	"season_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_title_length" CHECK (char_length("tournaments"."title") BETWEEN 1 AND 200),
	CONSTRAINT "tournaments_max_players_check" CHECK ("tournaments"."max_players" > 0),
	CONSTRAINT "tournaments_status_check" CHECK ("tournaments"."status" IN ('draft', 'open', 'closed', 'completed')),
	CONSTRAINT "tournaments_kind_check" CHECK ("tournaments"."kind" IN ('free', 'paid', 'cash')),
	CONSTRAINT "tournaments_tournament_type_check" CHECK ("tournaments"."tournament_type" IN ('classic', 'phoenix', 'deep_stack', 'bounty', 'win_the_button'))
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_status_check" CHECK ("registrations"."status" IN ('registered', 'waitlist', 'cancelled', 'attended'))
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"season_id" uuid,
	"place" integer NOT NULL,
	"reentries" integer DEFAULT 0 NOT NULL,
	"knockouts" integer DEFAULT 0 NOT NULL,
	"rating_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "results_place_check" CHECK ("results"."place" > 0),
	CONSTRAINT "results_rating_points_check" CHECK ("results"."rating_points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "player_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"achievement_code" text NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_achievements_current_value_check" CHECK ("player_achievements"."current_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tournament_live_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"arrived" boolean DEFAULT false NOT NULL,
	"rebuys" integer DEFAULT 0 NOT NULL,
	"addons" integer DEFAULT 0 NOT NULL,
	"knockouts" integer DEFAULT 0 NOT NULL,
	"place" integer,
	"sheet_row_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_live_entries_registration_id_unique" UNIQUE("registration_id")
);
--> statement-breakpoint
CREATE TABLE "tournament_player_eliminations" (
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"eliminated" boolean DEFAULT false NOT NULL,
	"eliminated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_player_eliminations_tournament_id_player_id_pk" PRIMARY KEY("tournament_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "email_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"player_id" uuid,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resend_after_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_otp_codes_purpose_check" CHECK ("email_otp_codes"."purpose" IN ('login', 'link_email'))
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_label" text,
	"metadata" jsonb,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_live_entries" ADD CONSTRAINT "tournament_live_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_live_entries" ADD CONSTRAINT "tournament_live_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_live_entries" ADD CONSTRAINT "tournament_live_entries_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_player_eliminations" ADD CONSTRAINT "tournament_player_eliminations_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_player_eliminations" ADD CONSTRAINT "tournament_player_eliminations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_otp_codes" ADD CONSTRAINT "email_otp_codes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "players_email_unique_idx" ON "players" USING btree (lower("email")) WHERE "players"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "players_role_idx" ON "players" USING btree ("role");--> statement-breakpoint
CREATE INDEX "players_nickname_status_idx" ON "players" USING btree ("nickname_status");--> statement-breakpoint
CREATE INDEX "seasons_is_active_idx" ON "seasons" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "tournaments_status_idx" ON "tournaments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tournaments_start_at_idx" ON "tournaments" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "tournaments_season_id_idx" ON "tournaments" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "tournaments_kind_idx" ON "tournaments" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "tournaments_tournament_type_idx" ON "tournaments" USING btree ("tournament_type");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_player_id_tournament_id_key" ON "registrations" USING btree ("player_id","tournament_id");--> statement-breakpoint
CREATE INDEX "registrations_player_id_idx" ON "registrations" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "registrations_status_idx" ON "registrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "registrations_tournament_id_idx" ON "registrations" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "registrations_tournament_id_status_idx" ON "registrations" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "results_tournament_id_player_id_key" ON "results" USING btree ("tournament_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "results_tournament_id_place_key" ON "results" USING btree ("tournament_id","place");--> statement-breakpoint
CREATE INDEX "results_player_id_idx" ON "results" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "results_tournament_id_idx" ON "results" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "results_season_id_idx" ON "results" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_achievements_player_id_achievement_code_key" ON "player_achievements" USING btree ("player_id","achievement_code");--> statement-breakpoint
CREATE INDEX "player_achievements_code_idx" ON "player_achievements" USING btree ("achievement_code");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_live_entries_tournament_id_player_id_key" ON "tournament_live_entries" USING btree ("tournament_id","player_id");--> statement-breakpoint
CREATE INDEX "tournament_live_entries_player_id_idx" ON "tournament_live_entries" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "email_otp_codes_active_idx" ON "email_otp_codes" USING btree ("email","purpose","consumed_at","expires_at");--> statement-breakpoint
CREATE INDEX "email_otp_codes_email_purpose_idx" ON "email_otp_codes" USING btree ("email","purpose","created_at");--> statement-breakpoint
CREATE INDEX "email_otp_codes_expires_at_idx" ON "email_otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "email_otp_codes_player_id_idx" ON "email_otp_codes" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "activity_events_created_idx" ON "activity_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_player_created_idx" ON "activity_events" USING btree ("player_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_type_created_idx" ON "activity_events" USING btree ("event_type","created_at" DESC NULLS LAST);