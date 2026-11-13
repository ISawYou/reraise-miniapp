ALTER TABLE "tournament_operations" ADD COLUMN "comment" text;
--> statement-breakpoint
ALTER TABLE "tournament_operations" ADD CONSTRAINT "operations_comment_length" CHECK ("comment" IS NULL OR char_length("comment")<=1000);
