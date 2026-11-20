import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, games, moves, ratings, user } from "@/db/client";
import {
  ABANDON_MS,
  CLOCK_START_PLY,
  DEFAULT_RATING,
  DEFAULT_SPECTATOR_DELAY_MS,
  HEARTBEAT_WRITE_MS,
  LOBBY_FRESH_MS,
  RATING_CATEGORY,
  WAITING_EXPIRE_MS,
} from "./constants";
import {
  activeSide,
  applyMoveToClock,
  detectTermination,
  isOffline,
  otherSide,
  projectClock,
  settleClock,
  silentFor,
  type ClockState,
  type Side,
  type Termination,
} from "./clock";
import { computeElo } from "./elo";
import { GameError } from "./errors";
import { displayName } from "./names";
import {
  buildPgn,
  normalizeOutcome,
  positionOutcome,
  replay,
  timeoutOutcome,
  type Outcome,
} from "./rules";
import { dbNowMs, type Tx } from "./time";
import { formatTimeControl, ratingCategoryFor } from "./timeControls";
import type {
  GameStatus,
  GameView,
  LiveGameSummary,
  MeInfo,
  OpenChallenge,
  PlayerInfo,
} from "./types";

type Db = typeof db;
type Reader = Pick<Db, "select">;
export type GameRow = typeof games.$inferSelect;
type GamePatch = Partial<typeof games.$inferInsert>;

// ---------------------------------------------------------------------------
// Tiện ích nhỏ
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertGameId(id: string) {
  if (!UUID_RE.test(id)) throw new GameError("not_found", "Không tìm thấy ván cờ.", 404);
}

export function sideOfUser(game: GameRow, userId: string | null): Side | null {
  if (!userId) return null;
  if (game.whitePlayerId === userId) return "w";
  if (game.blackPlayerId === userId) return "b";
  return null;
}

export function clockStateOf(game: GameRow, plyCount = game.plyCount): ClockState {
  return {
    plyCount,
    remainingMs: { w: game.whiteMs, b: game.blackMs },
    clockAtMs: game.clockAtMs,
    seenMs: { w: game.whiteSeenMs, b: game.blackSeenMs },
    budgetMs: { w: game.whiteBudgetMs, b: game.blackBudgetMs },
  };
}

function clockColumns(state: ClockState): GamePatch {
  return {
    whiteMs: Math.max(0, Math.round(state.remainingMs.w)),
    blackMs: Math.max(0, Math.round(state.remainingMs.b)),
    clockAtMs: state.clockAtMs,
    whiteBudgetMs: Math.max(0, Math.round(state.budgetMs.w)),
    blackBudgetMs: Math.max(0, Math.round(state.budgetMs.b)),
  };
}

const seenColumn = (side: Side, now: number): GamePatch =>
  side === "w" ? { whiteSeenMs: now } : { blackSeenMs: now };

async function lockGame(tx: Tx, id: string): Promise<GameRow | undefined> {
  const [row] = await tx.select().from(games).where(eq(games.id, id)).for("update");
  return row;
}

async function loadSans(exec: Reader, gameId: string): Promise<string[]> {
  const rows = await exec
    .select({ san: moves.san })
    .from(moves)
    .where(eq(moves.gameId, gameId))
    .orderBy(asc(moves.ply));
  return rows.map((row) => row.san);
}

/**
 * Khoá theo người dùng trong suốt giao dịch, để hai luồng khác nhau (nhận thách
 * đấu, ghép trận) không cùng đưa một người vào hai ván. Luôn khoá theo thứ tự
 * id để không bị kẹt chéo.
 */
export async function lockUsers(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
  }
}

export async function findOngoingGameId(
  exec: Reader,
  userId: string,
): Promise<string | null> {
  const [row] = await exec
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        eq(games.status, "ongoing"),
        or(eq(games.whitePlayerId, userId), eq(games.blackPlayerId, userId)),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function ensureRating(tx: Tx, userId: string, category = RATING_CATEGORY) {
  await tx.insert(ratings).values({ userId, category }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.category, category)));
  return row;
}

export async function abortWaitingGamesOf(tx: Tx, userId: string, now: number) {
  await tx
    .update(games)
    .set({
      status: "aborted",
      result: "aborted",
      reason: "aborted",
      endedAtMs: now,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(games.status, "waiting"),
        or(eq(games.whitePlayerId, userId), eq(games.blackPlayerId, userId)),
      ),
    );
}

// ---------------------------------------------------------------------------
// Kết thúc ván (nơi DUY NHẤT cập nhật Elo)
// ---------------------------------------------------------------------------

async function finishGame(
  tx: Tx,
  game: GameRow,
  sans: string[],
  rawOutcome: Outcome,
  now: number,
  clock: ClockState,
) {
  const outcome = normalizeOutcome(rawOutcome, sans.length);
  const aborted = outcome.result === "aborted";

  const patch: GamePatch = {
    status: aborted ? "aborted" : "finished",
    result: outcome.result,
    reason: outcome.reason,
    endedAtMs: now,
    finishedAt: new Date(),
    drawOfferedBy: null,
    plyCount: sans.length,
    ...clockColumns(clock),
  };

  const whiteId = game.whitePlayerId;
  const blackId = game.blackPlayerId;

  if (game.rated && !aborted && whiteId && blackId) {
    const category = game.ratingCategory;
    await ensureRating(tx, whiteId, category);
    await ensureRating(tx, blackId, category);
    // Khoá hai dòng rating theo thứ tự id để không kẹt chéo giữa các ván.
    const rows = await tx
      .select()
      .from(ratings)
      .where(and(inArray(ratings.userId, [whiteId, blackId]), eq(ratings.category, category)))
      .orderBy(asc(ratings.userId))
      .for("update");
    const white = rows.find((row) => row.userId === whiteId)!;
    const black = rows.find((row) => row.userId === blackId)!;
    const score = outcome.result === "white" ? 1 : outcome.result === "black" ? 0 : 0.5;
    const elo = computeElo(
      { rating: white.rating, gamesPlayed: white.gamesPlayed },
      { rating: black.rating, gamesPlayed: black.gamesPlayed },
      score,
    );

    const bump = (column: AnyPgColumn, condition: boolean) =>
      condition ? sql`${column} + 1` : sql`${column}`;
    const update = (userId: string, after: number, won: boolean, drew: boolean) =>
      tx
        .update(ratings)
        .set({
          rating: after,
          gamesPlayed: sql`${ratings.gamesPlayed} + 1`,
          wins: bump(ratings.wins, won),
          draws: bump(ratings.draws, drew),
          losses: bump(ratings.losses, !won && !drew),
          updatedAt: new Date(),
        })
        .where(and(eq(ratings.userId, userId), eq(ratings.category, category)));
    const drew = outcome.result === "draw";
    await update(whiteId, elo.whiteAfter, outcome.result === "white", drew);
    await update(blackId, elo.blackAfter, outcome.result === "black", drew);

    patch.whiteRatingBefore = white.rating;
    patch.whiteRatingAfter = elo.whiteAfter;
    patch.blackRatingBefore = black.rating;
    patch.blackRatingAfter = elo.blackAfter;
  }

  if (sans.length > 0) {
    const ids = [whiteId, blackId].filter((id): id is string => Boolean(id));
    const named = ids.length
      ? await tx
          .select({ id: user.id, name: user.name, isAnonymous: user.isAnonymous })
          .from(user)
          .where(inArray(user.id, ids))
      : [];
    const nameOf = (id: string | null) => {
      const found = named.find((row) => row.id === id);
      return found ? displayName(found) : "?";
    };
    const pgnResult =
      outcome.result === "white"
        ? "1-0"
        : outcome.result === "black"
          ? "0-1"
          : outcome.result === "draw"
            ? "1/2-1/2"
            : "*";
    patch.pgn = buildPgn(sans, {
      Event: "Cờ Vua Online",
      Date: new Date(now).toISOString().slice(0, 10).replaceAll("-", "."),
      White: nameOf(whiteId),
      Black: nameOf(blackId),
      Result: pgnResult,
      TimeControl: `${Math.round(game.timeBaseMs / 1000)}+${Math.round(game.incrementMs / 1000)}`,
    });
  }

  await tx.update(games).set(patch).where(eq(games.id, game.id));
}

async function endByTermination(
  tx: Tx,
  game: GameRow,
  sans: string[],
  termination: Termination,
  now: number,
) {
  let clock = settleClock(clockStateOf(game, sans.length), now);
  let outcome: Outcome;
  switch (termination.kind) {
    case "abandon":
      outcome = {
        result: termination.loser === "w" ? "black" : "white",
        reason: "abandon",
      };
      break;
    case "timeout":
      outcome = timeoutOutcome(replay(sans), termination.loser);
      clock = {
        ...clock,
        remainingMs: { ...clock.remainingMs, [termination.loser]: 0 },
      };
      break;
    case "no_first_move":
      outcome = { result: "aborted", reason: "aborted_no_move" };
      break;
    case "both_gone":
      outcome = { result: "aborted", reason: "aborted_both_gone" };
      break;
  }
  await finishGame(tx, game, sans, outcome, now, clock);
}

/** Ghi tín hiệu sống của `side` và chốt đồng hồ (để phần mất kết nối được tính đúng). */
async function touchRow(
  tx: Tx,
  game: GameRow,
  side: Side,
  plyCount: number,
  now: number,
) {
  const settled = settleClock(clockStateOf(game, plyCount), now);
  await tx
    .update(games)
    .set({ ...clockColumns(settled), ...seenColumn(side, now) })
    .where(eq(games.id, game.id));
}

// ---------------------------------------------------------------------------
// Khung chạy cho mọi thao tác của người chơi trong ván đang diễn ra
// ---------------------------------------------------------------------------

interface MutationContext {
  tx: Tx;
  game: GameRow;
  side: Side;
  sans: string[];
  now: number;
}

async function mutateOngoing(
  gameId: string,
  userId: string,
  action: (context: MutationContext) => Promise<void>,
): Promise<void> {
  assertGameId(gameId);
  const outcome = await db.transaction(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (!game) throw new GameError("not_found", "Không tìm thấy ván cờ.", 404);
    const side = sideOfUser(game, userId);
    if (!side) throw new GameError("forbidden", "Bạn không phải người chơi của ván này.", 403);
    if (game.status !== "ongoing") return "over" as const;

    const sans = await loadSans(tx, gameId);
    const now = await dbNowMs(tx);
    // Nếu ván lẽ ra đã kết thúc (hết giờ, bỏ cuộc) thì kết thúc nó trước,
    // rồi báo cho người gọi biết. Không áp thao tác của họ lên ván đã xong.
    const termination = detectTermination(clockStateOf(game, sans.length), now);
    if (termination) {
      await endByTermination(tx, game, sans, termination, now);
      return "over" as const;
    }
    await action({ tx, game, side, sans, now });
    return "done" as const;
  });
  if (outcome === "over") {
    throw new GameError("game_over", "Ván cờ đã kết thúc.", 409);
  }
}

// ---------------------------------------------------------------------------
// Thao tác của người chơi
// ---------------------------------------------------------------------------

export interface CreateChallengeOptions {
  baseMs: number;
  incrementMs: number;
  color: Side | "random";
  rated: boolean;
  isPublic: boolean;
  spectatorDelayMs?: number;
}

export async function createChallenge(
  userId: string,
  options: CreateChallengeOptions,
): Promise<string> {
  return db.transaction(async (tx) => {
    await lockUsers(tx, [userId]);
    const active = await findOngoingGameId(tx, userId);
    if (active) {
      throw new GameError("already_in_game", "Bạn đang có một ván chưa kết thúc.", 409, {
        gameId: active,
      });
    }
    const now = await dbNowMs(tx);
    await abortWaitingGamesOf(tx, userId, now); // mỗi người chỉ giữ một thách đấu
    const side: Side =
      options.color === "random" ? (Math.random() < 0.5 ? "w" : "b") : options.color;
    const [row] = await tx
      .insert(games)
      .values({
        whitePlayerId: side === "w" ? userId : null,
        blackPlayerId: side === "b" ? userId : null,
        status: "waiting",
        rated: options.rated,
        isPublic: options.isPublic,
        ratingCategory: ratingCategoryFor(),
        timeBaseMs: options.baseMs,
        incrementMs: options.incrementMs,
        whiteMs: options.baseMs,
        blackMs: options.baseMs,
        clockAtMs: now,
        whiteSeenMs: side === "w" ? now : 0,
        blackSeenMs: side === "b" ? now : 0,
        spectatorDelayMs: options.spectatorDelayMs ?? DEFAULT_SPECTATOR_DELAY_MS,
      })
      .returning({ id: games.id });
    return row.id;
  });
}

export async function joinGame(userId: string, gameId: string): Promise<void> {
  assertGameId(gameId);
  const flag = await db.transaction(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (!game) throw new GameError("not_found", "Không tìm thấy ván cờ.", 404);
    if (sideOfUser(game, userId) && game.status === "ongoing") return "ok" as const; // đã ở trong ván
    if (game.status !== "waiting") {
      throw new GameError("invalid_state", "Ván này đã bắt đầu hoặc đã bị hủy.", 409);
    }
    const creatorId = game.whitePlayerId ?? game.blackPlayerId;
    if (!creatorId) throw new GameError("invalid_state", "Thách đấu không hợp lệ.", 409);
    if (creatorId === userId) {
      throw new GameError("bad_request", "Bạn không thể tự chơi với chính mình.");
    }

    await lockUsers(tx, [userId, creatorId]);
    const now = await dbNowMs(tx);
    const creatorSeen = game.whitePlayerId ? game.whiteSeenMs : game.blackSeenMs;
    const creatorActive = await findOngoingGameId(tx, creatorId);
    if (now - creatorSeen > WAITING_EXPIRE_MS || creatorActive) {
      await finishGame(tx, game, [], { result: "aborted", reason: "aborted" }, now, clockStateOf(game));
      // Phải ghi nhận việc huỷ trước khi báo lỗi, nên báo lỗi ở ngoài giao dịch.
      return "expired" as const;
    }
    const joinerActive = await findOngoingGameId(tx, userId);
    if (joinerActive) {
      throw new GameError("already_in_game", "Bạn đang có một ván chưa kết thúc.", 409, {
        gameId: joinerActive,
      });
    }

    await tx
      .update(games)
      .set({
        whitePlayerId: game.whitePlayerId ?? userId,
        blackPlayerId: game.blackPlayerId ?? userId,
        status: "ongoing",
        startedAtMs: now,
        clockAtMs: now,
        whiteSeenMs: now,
        blackSeenMs: now,
      })
      .where(eq(games.id, gameId));
    return "ok" as const;
  });
  if (flag === "expired") {
    throw new GameError("expired", "Thách đấu này đã hết hạn.", 410);
  }
}

export interface MoveInput {
  from: string;
  to: string;
  promotion?: string;
  expectedPly: number;
}

export async function makeMove(
  gameId: string,
  userId: string,
  input: MoveInput,
): Promise<void> {
  await mutateOngoing(gameId, userId, async ({ tx, game, side, sans, now }) => {
    const plyCount = sans.length;
    if (activeSide(plyCount) !== side) {
      throw new GameError("not_your_turn", "Chưa đến lượt bạn.", 409);
    }
    if (input.expectedPly !== plyCount) {
      throw new GameError("out_of_sync", "Thế cờ đã thay đổi, hãy thử lại.", 409);
    }

    const chess = replay(sans);
    let san: string;
    try {
      san = chess.move({
        from: input.from,
        to: input.to,
        promotion: input.promotion,
      }).san;
    } catch {
      throw new GameError("illegal_move", "Nước đi không hợp lệ.");
    }

    const clock = applyMoveToClock(
      clockStateOf(game, plyCount),
      side,
      now,
      game.incrementMs,
    );
    await tx.insert(moves).values({
      gameId: game.id,
      ply: plyCount,
      san,
      fenAfter: chess.fen(),
      playedAtMs: now,
      whiteMsAfter: Math.max(0, Math.round(clock.remainingMs.w)),
      blackMsAfter: Math.max(0, Math.round(clock.remainingMs.b)),
    });

    const allSans = [...sans, san];
    const outcome = positionOutcome(chess);
    if (outcome) {
      await finishGame(tx, game, allSans, outcome, now, clock);
      return;
    }
    // Đi quân tức là từ chối lời xin hòa của đối thủ.
    const drawOfferedBy =
      game.drawOfferedBy && game.drawOfferedBy !== side ? null : game.drawOfferedBy;
    await tx
      .update(games)
      .set({
        plyCount: allSans.length,
        drawOfferedBy,
        ...clockColumns(clock),
        ...seenColumn(side, now),
      })
      .where(eq(games.id, game.id));
  });
}

/** Xin thua; với thách đấu chưa có đối thủ thì là huỷ thách đấu. */
export async function resignGame(gameId: string, userId: string): Promise<void> {
  assertGameId(gameId);
  const cancelled = await db.transaction(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (!game) throw new GameError("not_found", "Không tìm thấy ván cờ.", 404);
    if (game.status !== "waiting") return false;
    if (!sideOfUser(game, userId)) {
      throw new GameError("forbidden", "Bạn không phải người chơi của ván này.", 403);
    }
    const now = await dbNowMs(tx);
    await finishGame(tx, game, [], { result: "aborted", reason: "aborted" }, now, clockStateOf(game));
    return true;
  });
  if (cancelled) return;

  await mutateOngoing(gameId, userId, async ({ tx, game, side, sans, now }) => {
    const clock = settleClock(clockStateOf(game, sans.length), now);
    await finishGame(
      tx,
      game,
      sans,
      { result: side === "w" ? "black" : "white", reason: "resign" },
      now,
      clock,
    );
  });
}

export type DrawAction = "offer" | "accept" | "decline";

export async function respondDraw(
  gameId: string,
  userId: string,
  action: DrawAction,
): Promise<void> {
  await mutateOngoing(gameId, userId, async ({ tx, game, side, sans, now }) => {
    const opponent = otherSide(side);
    const offered = game.drawOfferedBy;

    const acceptDraw = async () => {
      const clock = settleClock(clockStateOf(game, sans.length), now);
      await finishGame(tx, game, sans, { result: "draw", reason: "agreement" }, now, clock);
    };

    if (action === "accept") {
      if (offered !== opponent) {
        throw new GameError("invalid_state", "Đối thủ chưa xin hòa.", 409);
      }
      await acceptDraw();
      return;
    }
    if (action === "decline") {
      if (offered !== opponent) {
        throw new GameError("invalid_state", "Đối thủ chưa xin hòa.", 409);
      }
      await tx.update(games).set({ drawOfferedBy: null }).where(eq(games.id, game.id));
      await touchRow(tx, game, side, sans.length, now);
      return;
    }
    // offer
    if (offered === opponent) {
      await acceptDraw(); // hai bên cùng muốn hòa
      return;
    }
    if (offered === side) return;
    await tx.update(games).set({ drawOfferedBy: side }).where(eq(games.id, game.id));
    await touchRow(tx, game, side, sans.length, now);
  });
}

// ---------------------------------------------------------------------------
// Đồng bộ (heartbeat + xử lý hết giờ/bỏ cuộc) và dựng view
// ---------------------------------------------------------------------------

/**
 * Mỗi lượt poll gọi hàm này. Hầu hết lượt chỉ đọc; chỉ ghi khi (a) ván lẽ ra
 * đã kết thúc, hoặc (b) tín hiệu sống của người chơi đã cũ hơn HEARTBEAT_WRITE_MS.
 * Nhờ vậy không cần tiến trình chạy nền: ai poll thì người đó kích hoạt việc xử lý.
 */
async function syncGame(gameId: string, viewerId: string | null): Promise<void> {
  const [row] = await db.select().from(games).where(eq(games.id, gameId));
  if (!row) throw new GameError("not_found", "Không tìm thấy ván cờ.", 404);
  if (row.status !== "ongoing" && row.status !== "waiting") return;

  const now = await dbNowMs(db);
  const side = sideOfUser(row, viewerId);
  let needsWrite = false;
  if (row.status === "ongoing") {
    const state = clockStateOf(row);
    needsWrite =
      detectTermination(state, now) !== null ||
      (side !== null && now - state.seenMs[side] > HEARTBEAT_WRITE_MS);
  } else {
    const creatorSeen = row.whitePlayerId ? row.whiteSeenMs : row.blackSeenMs;
    needsWrite =
      now - creatorSeen > WAITING_EXPIRE_MS ||
      (side !== null && now - creatorSeen > HEARTBEAT_WRITE_MS);
  }
  if (!needsWrite) return;

  await db.transaction(async (tx) => {
    const game = await lockGame(tx, gameId);
    if (!game || (game.status !== "ongoing" && game.status !== "waiting")) return;
    const lockedNow = await dbNowMs(tx);
    const lockedSide = sideOfUser(game, viewerId);

    if (game.status === "waiting") {
      const creatorSeen = game.whitePlayerId ? game.whiteSeenMs : game.blackSeenMs;
      if (lockedNow - creatorSeen > WAITING_EXPIRE_MS) {
        await finishGame(tx, game, [], { result: "aborted", reason: "aborted" }, lockedNow, clockStateOf(game));
      } else if (lockedSide) {
        await tx.update(games).set(seenColumn(lockedSide, lockedNow)).where(eq(games.id, gameId));
      }
      return;
    }

    const sans = await loadSans(tx, gameId);
    const termination = detectTermination(clockStateOf(game, sans.length), lockedNow);
    if (termination) {
      await endByTermination(tx, game, sans, termination, lockedNow);
    } else if (lockedSide) {
      await touchRow(tx, game, lockedSide, sans.length, lockedNow);
    }
  });
}

interface MoveRow {
  san: string;
  playedAtMs: number;
  whiteMsAfter: number;
  blackMsAfter: number;
}

type PlayerRecord = { name: string; isGuest: boolean; rating: number };

async function loadPlayers(
  exec: Reader,
  ids: (string | null)[],
  category: string,
): Promise<Record<string, PlayerRecord>> {
  const realIds = ids.filter((id): id is string => Boolean(id));
  if (realIds.length === 0) return {};
  const users = await exec
    .select({ id: user.id, name: user.name, isAnonymous: user.isAnonymous })
    .from(user)
    .where(inArray(user.id, realIds));
  const rated = await exec
    .select()
    .from(ratings)
    .where(and(inArray(ratings.userId, realIds), eq(ratings.category, category)));
  const result: Record<string, PlayerRecord> = {};
  for (const u of users) {
    result[u.id] = {
      name: displayName(u),
      isGuest: Boolean(u.isAnonymous),
      rating: rated.find((r) => r.userId === u.id)?.rating ?? DEFAULT_RATING,
    };
  }
  return result;
}

/**
 * Dựng view cho một người xem. Hàm thuần (không đụng DB) nên test được.
 * Khán giả (không phải người chơi) thấy ván trễ `spectatorDelayMs`.
 */
export function buildView(
  game: GameRow,
  moveRows: MoveRow[],
  players: Record<string, PlayerRecord>,
  viewerId: string | null,
  now: number,
): GameView {
  const side = sideOfUser(game, viewerId);
  const ended = game.status === "finished" || game.status === "aborted";

  let status: GameStatus = game.status;
  let visible = moveRows;
  let endHidden = false;

  if (side === null && game.startedAtMs !== null) {
    const cutoff = now - game.spectatorDelayMs;
    visible = moveRows.filter((row) => row.playedAtMs <= cutoff);
    endHidden = ended && (game.endedAtMs ?? 0) > cutoff;
    if (endHidden) status = "ongoing";
  }

  const sans = visible.map((row) => row.san);
  const showEnd = ended && !endHidden;

  let clocks: GameView["clocks"];
  if (status === "ongoing") {
    if (side) {
      const projection = projectClock(clockStateOf(game, sans.length), now);
      clocks = {
        whiteMs: projection.remainingMs.w,
        blackMs: projection.remainingMs.b,
        ticking: projection.ticking,
      };
    } else {
      const cutoff = now - game.spectatorDelayMs;
      const last = visible[visible.length - 1];
      if (last && visible.length >= CLOCK_START_PLY) {
        const active = activeSide(visible.length);
        const remaining = { w: last.whiteMsAfter, b: last.blackMsAfter };
        remaining[active] = Math.max(
          0,
          remaining[active] - Math.max(0, cutoff - last.playedAtMs),
        );
        clocks = {
          whiteMs: remaining.w,
          blackMs: remaining.b,
          ticking: remaining[active] > 0 ? active : null,
        };
      } else {
        clocks = { whiteMs: game.timeBaseMs, blackMs: game.timeBaseMs, ticking: null };
      }
    }
  } else {
    clocks = { whiteMs: game.whiteMs, blackMs: game.blackMs, ticking: null };
  }

  const state = clockStateOf(game, sans.length);
  const live = side !== null && status === "ongoing";
  const presence: GameView["presence"] = {
    offline: {
      w: live && isOffline(state, "w", now),
      b: live && isOffline(state, "b", now),
    },
    abandonInMs: {
      w: live && isOffline(state, "w", now) ? Math.max(0, ABANDON_MS - silentFor(state, "w", now)) : null,
      b: live && isOffline(state, "b", now) ? Math.max(0, ABANDON_MS - silentFor(state, "b", now)) : null,
    },
  };

  const playerInfo = (id: string | null, before: number | null, after: number | null): PlayerInfo | null => {
    if (!id) return null;
    const record = players[id] ?? { name: "Khách đã rời", isGuest: true, rating: DEFAULT_RATING };
    const withDelta = showEnd && game.rated && before !== null && after !== null;
    return {
      id,
      name: record.name,
      isGuest: record.isGuest,
      rating: record.rating,
      ratingBefore: withDelta ? before : null,
      ratingAfter: withDelta ? after : null,
    };
  };

  return {
    id: game.id,
    status,
    result: showEnd ? game.result : null,
    reason: showEnd ? game.reason : null,
    rated: game.rated,
    timeControl: {
      label: formatTimeControl(game.timeBaseMs, game.incrementMs),
      baseMs: game.timeBaseMs,
      incrementMs: game.incrementMs,
    },
    white: playerInfo(game.whitePlayerId, game.whiteRatingBefore, game.whiteRatingAfter),
    black: playerInfo(game.blackPlayerId, game.blackRatingBefore, game.blackRatingAfter),
    sans,
    plyCount: sans.length,
    clocks,
    presence,
    drawOfferedBy: side ? game.drawOfferedBy : null,
    serverNowMs: now,
    viewer: {
      userId: viewerId,
      side,
      isCreator: game.status === "waiting" && side !== null,
    },
    delayMs: side ? 0 : game.spectatorDelayMs,
  };
}

export async function getGameView(
  gameId: string,
  viewerId: string | null,
): Promise<GameView> {
  assertGameId(gameId);
  await syncGame(gameId, viewerId);

  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game) throw new GameError("not_found", "Không tìm thấy ván cờ.", 404);
  const moveRows = await db
    .select({
      san: moves.san,
      playedAtMs: moves.playedAtMs,
      whiteMsAfter: moves.whiteMsAfter,
      blackMsAfter: moves.blackMsAfter,
    })
    .from(moves)
    .where(eq(moves.gameId, gameId))
    .orderBy(asc(moves.ply));
  const players = await loadPlayers(
    db,
    [game.whitePlayerId, game.blackPlayerId],
    game.ratingCategory,
  );
  const now = await dbNowMs(db);
  return buildView(game, moveRows, players, viewerId, now);
}

// ---------------------------------------------------------------------------
// Danh sách cho sảnh / trang xem trực tiếp / thông tin cá nhân
// ---------------------------------------------------------------------------

export async function listOpenChallenges(): Promise<OpenChallenge[]> {
  const now = await dbNowMs(db);
  const rows = await db
    .select()
    .from(games)
    .where(and(eq(games.status, "waiting"), eq(games.isPublic, true)))
    .orderBy(desc(games.createdAt))
    .limit(50);
  const fresh = rows.filter((game) => {
    const seen = game.whitePlayerId ? game.whiteSeenMs : game.blackSeenMs;
    return now - seen <= LOBBY_FRESH_MS;
  });
  const players = await loadPlayers(
    db,
    fresh.map((game) => game.whitePlayerId ?? game.blackPlayerId),
    RATING_CATEGORY,
  );
  return fresh.flatMap((game) => {
    const creatorId = game.whitePlayerId ?? game.blackPlayerId;
    const creator = creatorId ? players[creatorId] : undefined;
    if (!creator) return [];
    return [
      {
        id: game.id,
        creator,
        creatorSide: (game.whitePlayerId ? "w" : "b") as Side,
        timeControl: formatTimeControl(game.timeBaseMs, game.incrementMs),
        rated: game.rated,
      },
    ];
  });
}

export async function listLiveGames(): Promise<LiveGameSummary[]> {
  const rows = await db
    .select()
    .from(games)
    .where(and(eq(games.status, "ongoing"), eq(games.isPublic, true)))
    .orderBy(desc(games.createdAt))
    .limit(50);
  const players = await loadPlayers(
    db,
    rows.flatMap((game) => [game.whitePlayerId, game.blackPlayerId]),
    RATING_CATEGORY,
  );
  const summaries = rows.map((game) => ({
    id: game.id,
    white: game.whitePlayerId ? (players[game.whitePlayerId] ?? null) : null,
    black: game.blackPlayerId ? (players[game.blackPlayerId] ?? null) : null,
    timeControl: formatTimeControl(game.timeBaseMs, game.incrementMs),
    rated: game.rated,
    plyCount: game.plyCount,
  }));
  const average = (item: LiveGameSummary) =>
    ((item.white?.rating ?? 0) + (item.black?.rating ?? 0)) / 2;
  return summaries.sort((a, b) => average(b) - average(a)).slice(0, 30);
}

export async function getMe(userId: string): Promise<MeInfo> {
  const [u] = await db
    .select({ id: user.id, name: user.name, isAnonymous: user.isAnonymous })
    .from(user)
    .where(eq(user.id, userId));
  if (!u) {
    return { user: null, rating: null, gamesPlayed: 0, activeGameId: null, waitingGameId: null };
  }
  const [rating] = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.category, RATING_CATEGORY)));
  const activeGameId = await findOngoingGameId(db, userId);
  const [waiting] = await db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        eq(games.status, "waiting"),
        or(eq(games.whitePlayerId, userId), eq(games.blackPlayerId, userId)),
      ),
    )
    .limit(1);
  return {
    user: { id: u.id, name: displayName(u), isGuest: Boolean(u.isAnonymous) },
    rating: rating?.rating ?? DEFAULT_RATING,
    gamesPlayed: rating?.gamesPlayed ?? 0,
    activeGameId,
    waitingGameId: waiting?.id ?? null,
  };
}
