import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  pgEnum,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";

export const gameStatusEnum = pgEnum("game_status", [
  "waiting",
  "ongoing",
  "finished",
  "aborted",
]);

export const gameResultEnum = pgEnum("game_result", [
  "white",
  "black",
  "draw",
  "aborted",
]);

export const games = pgTable("games", {
  id: uuid("id").defaultRandom().primaryKey(),
  whitePlayerId: text("white_player_id").references(() => user.id),
  blackPlayerId: text("black_player_id").references(() => user.id), // null nếu đấu với AI
  isVsAi: boolean("is_vs_ai").default(false).notNull(),
  status: gameStatusEnum("status").default("waiting").notNull(),
  result: gameResultEnum("result"),
  pgn: text("pgn").default("").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

export const moves = pgTable("moves", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id")
    .references(() => games.id)
    .notNull(),
  ply: integer("ply").notNull(),
  san: text("san").notNull(),
  fenAfter: text("fen_after").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});