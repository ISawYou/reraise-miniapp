CREATE TABLE "achievement_visual_configs" (
	"visual_key" text PRIMARY KEY NOT NULL,
	"asset_url" text NOT NULL,
	"scale" integer DEFAULT 100 NOT NULL,
	"offset_x" integer DEFAULT 0 NOT NULL,
	"offset_y" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_visual_configs_scale_check" CHECK ("achievement_visual_configs"."scale" BETWEEN 50 AND 200),
	CONSTRAINT "achievement_visual_configs_offset_x_check" CHECK ("achievement_visual_configs"."offset_x" BETWEEN -100 AND 100),
	CONSTRAINT "achievement_visual_configs_offset_y_check" CHECK ("achievement_visual_configs"."offset_y" BETWEEN -100 AND 100)
);
