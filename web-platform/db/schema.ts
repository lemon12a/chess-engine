import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  uuid,
  pgEnum,
  primaryKey,
  index,
  uniqueIndex,
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

// Lý do kết thúc ván (hiển thị cho người chơi, khán giả).
export const gameResultReasonEnum = pgEnum("game_result_reason", [
  "checkmate",
  "resign",
  "timeout",
  "abandon", // mất kết nối quá lâu
  "agreement",
  "stalemate",
  "repetition",
  "insufficient",
  "fifty_move",
  "aborted", // kết thúc quá sớm hoặc bị huỷ, không tính Elo
  "aborted_no_move", // có người chưa đi nước đầu tiên
  "aborted_both_gone", // cả hai cùng mất kết nối
]);

// Mọi mốc thời gian dùng cho đồng hồ lưu dạng mili giây (bigint) lấy từ đồng hồ
// của chính DB, để không phụ thuộc múi giờ hay giờ của máy chủ ứng dụng.
const ms = (name: string) => bigint(name, { mode: "number" });

export const games = pgTable(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Khi tài khoản bị xoá (khách gộp vào tài khoản cũ) thì ván vẫn còn.
    whitePlayerId: text("white_player_id").references(() => user.id, {
      onDelete: "set null",
    }),
    blackPlayerId: text("black_player_id").references(() => user.id, {
      onDelete: "set null",
    }),
    isVsAi: boolean("is_vs_ai").default(false).notNull(),
    status: gameStatusEnum("status").default("waiting").notNull(),
    result: gameResultEnum("result"),
    pgn: text("pgn").default("").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),

    // ---- Thể thức ----
    timeBaseMs: integer("time_base_ms").default(300000).notNull(),
    incrementMs: integer("increment_ms").default(0).notNull(),
    rated: boolean("rated").default(true).notNull(),
    ratingCategory: text("rating_category").default("standard").notNull(),
    isPublic: boolean("is_public").default(true).notNull(),
    /** Khán giả thấy ván trễ chừng này mili giây (người chơi không bị trễ). */
    spectatorDelayMs: integer("spectator_delay_ms").default(10000).notNull(),

    // ---- Trạng thái ván ----
    plyCount: integer("ply_count").default(0).notNull(),
    reason: gameResultReasonEnum("result_reason"),
    drawOfferedBy: text("draw_offered_by").$type<"w" | "b">(),

    // ---- Đồng hồ: thời gian còn lại tính tại thời điểm clockAtMs ----
    whiteMs: integer("white_ms").default(300000).notNull(),
    blackMs: integer("black_ms").default(300000).notNull(),
    clockAtMs: ms("clock_at_ms").default(0).notNull(),
    startedAtMs: ms("started_at_ms"),
    endedAtMs: ms("ended_at_ms"),

    // ---- Hiện diện (phát hiện AFK) ----
    whiteSeenMs: ms("white_seen_ms").default(0).notNull(),
    blackSeenMs: ms("black_seen_ms").default(0).notNull(),
    /** Quỹ thời gian còn được đóng băng đồng hồ khi mất kết nối. */
    whiteBudgetMs: integer("white_budget_ms").default(90000).notNull(),
    blackBudgetMs: integer("black_budget_ms").default(90000).notNull(),

    // ---- Elo (chỉ có khi ván tính điểm và đã kết thúc) ----
    whiteRatingBefore: integer("white_rating_before"),
    whiteRatingAfter: integer("white_rating_after"),
    blackRatingBefore: integer("black_rating_before"),
    blackRatingAfter: integer("black_rating_after"),
  },
  (table) => [
    index("games_status_idx").on(table.status),
    index("games_white_player_idx").on(table.whitePlayerId),
    index("games_black_player_idx").on(table.blackPlayerId),
  ],
);

export const moves = pgTable(
  "moves",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .references(() => games.id)
      .notNull(),
    ply: integer("ply").notNull(),
    san: text("san").notNull(),
    fenAfter: text("fen_after").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Thời điểm đi (giờ DB), và đồng hồ hai bên ngay sau nước đi này.
    // Dùng cho độ trễ của khán giả.
    playedAtMs: ms("played_at_ms").default(0).notNull(),
    whiteMsAfter: integer("white_ms_after").default(0).notNull(),
    blackMsAfter: integer("black_ms_after").default(0).notNull(),
  },
  (table) => [uniqueIndex("moves_game_ply_uq").on(table.gameId, table.ply)],
);

export const ratings = pgTable(
  "ratings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category").default("standard").notNull(),
    rating: integer("rating").default(1000).notNull(),
    gamesPlayed: integer("games_played").default(0).notNull(),
    wins: integer("wins").default(0).notNull(),
    draws: integer("draws").default(0).notNull(),
    losses: integer("losses").default(0).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.category] })],
);

export const matchQueue = pgTable("match_queue", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timeControlId: text("time_control_id").notNull(),
  rating: integer("rating").notNull(),
  joinedAtMs: ms("joined_at_ms").notNull(),
  lastSeenMs: ms("last_seen_ms").notNull(),
});
