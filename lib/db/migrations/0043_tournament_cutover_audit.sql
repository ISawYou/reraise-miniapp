CREATE TABLE "tournament_source_audit" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"comparison" jsonb NOT NULL,
	"imported" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
