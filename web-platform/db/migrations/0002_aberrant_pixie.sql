CREATE TABLE "ai_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"human_color" text NOT NULL,
	"level_id" text NOT NULL,
	"status" text DEFAULT 'ongoing' NOT NULL,
	"result" "game_result",
	"result_reason" "game_result_reason",
	"sans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ply_count" integer DEFAULT 0 NOT NULL,
	"pgn" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_games" ADD CONSTRAINT "ai_games_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_games_user_idx" ON "ai_games" USING btree ("user_id","created_at");