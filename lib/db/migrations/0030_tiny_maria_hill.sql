ALTER TABLE "players" ADD COLUMN "online_registration_restricted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "no_show_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "waitlist_promotion_notification_claimed_at" timestamp with time zone;