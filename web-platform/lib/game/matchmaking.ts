import { and, asc, eq, gte, ne } from "drizzle-orm";
import { db, games, matchQueue } from "@/db/client";
import {
  DEFAULT_SPECTATOR_DELAY_MS,
  MATCH_WINDOW,
  QUEUE_STALE_MS,
  RATING_CATEGORY,
} from "./constants";
import { GameError } from "./errors";
import {
  abortWaitingGamesOf,
  ensureRating,
  findOngoingGameId,
  lockUsers,
} from "./service";
import { dbNowMs } from "./time";
import { getTimeControl, ratingCategoryFor } from "./timeControls";
import type { MatchStatus } from "./types";

/** Phạm vi chênh lệch Elo được chấp nhận sau khi đã chờ `waitedMs`. */
export function matchWindow(waitedMs: number): number {
  const { base, step, intervalMs, max } = MATCH_WINDOW;
  return Math.min(max, base + step * Math.floor(waitedMs / intervalMs));
}

export async function joinQueue(userId: string, timeControlId: string): Promise<void> {
  const timeControl = getTimeControl(timeControlId);
  if (!timeControl) throw new GameError("bad_request", "Thể thức không hợp lệ.");

  await db.transaction(async (tx) => {
    await lockUsers(tx, [userId]);
    const active = await findOngoingGameId(tx, userId);
    if (active) {
      throw new GameError("already_in_game", "Bạn đang có một ván chưa kết thúc.", 409, {
        gameId: active,
      });
    }
    const now = await dbNowMs(tx);
    await abortWaitingGamesOf(tx, userId, now); // đã tìm trận thì bỏ thách đấu đang chờ
    const rating = await ensureRating(tx, userId, RATING_CATEGORY);
    await tx
      .insert(matchQueue)
      .values({
        userId,
        timeControlId: timeControl.id,
        rating: rating.rating,
        joinedAtMs: now,
        lastSeenMs: now,
      })
      .onConflictDoUpdate({
        target: matchQueue.userId,
        set: {
          timeControlId: timeControl.id,
          rating: rating.rating,
          joinedAtMs: now,
          lastSeenMs: now,
        },
      });
  });
}

export async function leaveQueue(userId: string): Promise<void> {
  await db.delete(matchQueue).where(eq(matchQueue.userId, userId));
}

/**
 * Mỗi lượt poll của người đang chờ vừa giữ mục của mình còn sống, vừa thử ghép.
 * Không cần tiến trình nền. Hai người cùng thử ghép một lúc: mỗi người khoá dòng
 * của mình rồi chỉ lấy dòng đối thủ nếu chưa ai khác khoá (SKIP LOCKED), nên không
 * bao giờ tạo hai ván cho một người; trường hợp "lướt qua nhau" thì lượt poll sau sẽ ghép.
 */
export async function queueStatus(userId: string): Promise<MatchStatus> {
  return db.transaction(async (tx): Promise<MatchStatus> => {
    const now = await dbNowMs(tx);

    const [mine] = await tx
      .select()
      .from(matchQueue)
      .where(eq(matchQueue.userId, userId))
      .for("update");

    if (!mine) {
      // Không còn trong hàng chờ: hoặc đã được ghép (đối thủ tạo ván giúp), hoặc chưa vào.
      const gameId = await findOngoingGameId(tx, userId);
      return gameId ? { state: "matched", gameId } : { state: "idle" };
    }

    await tx
      .update(matchQueue)
      .set({ lastSeenMs: now })
      .where(eq(matchQueue.userId, userId));

    const waitedMs = now - mine.joinedAtMs;
    const candidates = await tx
      .select()
      .from(matchQueue)
      .where(
        and(
          eq(matchQueue.timeControlId, mine.timeControlId),
          ne(matchQueue.userId, userId),
          gte(matchQueue.lastSeenMs, now - QUEUE_STALE_MS),
        ),
      )
      .orderBy(asc(matchQueue.joinedAtMs));

    let best: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      const allowed = Math.max(matchWindow(waitedMs), matchWindow(now - candidate.joinedAtMs));
      const gap = Math.abs(candidate.rating - mine.rating);
      if (gap <= allowed && (!best || gap < Math.abs(best.rating - mine.rating))) {
        best = candidate;
      }
    }

    const searching: MatchStatus = {
      state: "searching",
      waitedMs,
      windowElo: matchWindow(waitedMs),
      timeControlId: mine.timeControlId,
    };
    if (!best) return searching;

    // Khoá dòng đối thủ; nếu người khác đang giữ thì bỏ qua, lượt sau thử lại.
    const [locked] = await tx
      .select()
      .from(matchQueue)
      .where(eq(matchQueue.userId, best.userId))
      .for("update", { skipLocked: true });
    if (!locked) return searching;

    await lockUsers(tx, [userId, locked.userId]);
    const opponentBusy = await findOngoingGameId(tx, locked.userId);
    if (opponentBusy) {
      await tx.delete(matchQueue).where(eq(matchQueue.userId, locked.userId));
      return searching;
    }
    const meBusy = await findOngoingGameId(tx, userId);
    if (meBusy) {
      await tx.delete(matchQueue).where(eq(matchQueue.userId, userId));
      return { state: "matched", gameId: meBusy };
    }

    const timeControl = getTimeControl(mine.timeControlId);
    if (!timeControl) {
      await tx.delete(matchQueue).where(eq(matchQueue.userId, userId));
      return { state: "idle" };
    }

    const iAmWhite = Math.random() < 0.5;
    const [game] = await tx
      .insert(games)
      .values({
        whitePlayerId: iAmWhite ? userId : locked.userId,
        blackPlayerId: iAmWhite ? locked.userId : userId,
        status: "ongoing",
        rated: true,
        isPublic: true,
        ratingCategory: ratingCategoryFor(),
        timeBaseMs: timeControl.baseMs,
        incrementMs: timeControl.incrementMs,
        whiteMs: timeControl.baseMs,
        blackMs: timeControl.baseMs,
        startedAtMs: now,
        clockAtMs: now,
        whiteSeenMs: now,
        blackSeenMs: now,
        spectatorDelayMs: DEFAULT_SPECTATOR_DELAY_MS,
      })
      .returning({ id: games.id });
    await tx.delete(matchQueue).where(eq(matchQueue.userId, userId));
    await tx.delete(matchQueue).where(eq(matchQueue.userId, locked.userId));
    return { state: "matched", gameId: game.id };
  });
}
