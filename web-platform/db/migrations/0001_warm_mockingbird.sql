CREATE TYPE "public"."game_result_reason" AS ENUM('checkmate', 'resign', 'timeout', 'abandon', 'agreement', 'stalemate', 'repetition', 'insufficient', 'fifty_move', 'aborted', 'aborted_no_move', 'aborted_both_gone');--> statement-breakpoint
CREATE TABLE "match_queue" (
	"user_id" text PRIMARY KEY NOT NULL,
	"time_control_id" text NOT NULL,
	"rating" integer NOT NULL,
	"joined_at_ms" bigint NOT NULL,
	"last_seen_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"user_id" text NOT NULL,
	"category" text DEFAULT 'standard' NOT NULL,
	"rating" integer DEFAULT 1000 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "games_white_player_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "games_black_player_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "time_base_ms" integer DEFAULT 300000 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "increment_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "rated" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "rating_category" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "is_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "spectator_delay_ms" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "ply_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "result_reason" "game_result_reason";--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "draw_offered_by" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_ms" integer DEFAULT 300000 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_ms" integer DEFAULT 300000 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "clock_at_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "started_at_ms" bigint;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "ended_at_ms" bigint;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_seen_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_seen_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_budget_ms" integer DEFAULT 90000 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_budget_ms" integer DEFAULT 90000 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_rating_before" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "white_rating_after" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_rating_before" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "black_rating_after" integer;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "played_at_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "white_ms_after" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "black_ms_after" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "match_queue" ADD CONSTRAINT "match_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_white_player_id_user_id_fk" FOREIGN KEY ("white_player_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_black_player_id_user_id_fk" FOREIGN KEY ("black_player_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "games" USING btree ("status");--> statement-breakpoint
CREATE INDEX "games_white_player_idx" ON "games" USING btree ("white_player_id");--> statement-breakpoint
CREATE INDEX "games_black_player_idx" ON "games" USING btree ("black_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moves_game_ply_uq" ON "moves" USING btree ("game_id","ply");