import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import { aiGames, db, games, moves, user } from "@/db/client";
import { getLevel } from "@/lib/levels";
import { displayName } from "./names";
import { dbNowMs } from "./time";
import { formatTimeControl } from "./timeControls";
import type { GameResult } from "./rules";
import {
  HISTORY_PAGE_SIZE,
  type HistoryFilter,
  type HistoryItem,
  type HistoryKind,
  type HistoryOutcome,
  type ReplayData,
} from "./historyTypes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AI_OPPONENT = { name: "ChessNet AI", isGuest: false };
const LEFT_GUEST = { name: "Khách đã rời", isGuest: true };

type Person = { name: string; isGuest: boolean };

async function loadPeople(ids: (string | null)[]): Promise<Map<string, Person>> {
  const realIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, Person>();
  if (realIds.length === 0) return map;
  const rows = await db
    .select({ id: user.id, name: user.name, isAnonymous: user.isAnonymous })
    .from(user)
    .where(inArray(user.id, realIds));
  for (const row of rows) {
    map.set(row.id, { name: displayName(row), isGuest: Boolean(row.isAnonymous) });
  }
  return map;
}

function outcomeFor(result: GameResult | null, myColor: "w" | "b"): HistoryOutcome {
  if (result === "draw") return "draw";
  if (result === "white") return myColor === "w" ? "win" : "loss";
  if (result === "black") return myColor === "b" ? "win" : "loss";
  return "aborted";
}

/**
 * Lịch sử của một người: ván giữa người với người (bảng games) gộp với ván với AI
 * (bảng ai_games), mới nhất lên đầu. Đủ nhanh cho quy mô đồ án: mỗi nguồn lấy
 * tối đa offset + limit + 1 dòng rồi gộp lại.
 */
export async function listHistory(
  userId: string,
  options: { filter?: HistoryFilter; offset?: number; limit?: number } = {},
): Promise<{ items: HistoryItem[]; hasMore: boolean }> {
  const filter = options.filter ?? "all";
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = options.limit ?? HISTORY_PAGE_SIZE;
  const take = offset + limit + 1;

  const pvpRows =
    filter === "ai"
      ? []
      : await db
          .select()
          .from(games)
          .where(
            and(
              or(eq(games.whitePlayerId, userId), eq(games.blackPlayerId, userId)),
              // Bỏ các thách đấu bị hủy khi chưa ai đi nước nào.
              or(eq(games.status, "finished"), and(eq(games.status, "aborted"), gt(games.plyCount, 0))),
            ),
          )
          .orderBy(desc(games.finishedAt))
          .limit(take);

  const aiRows =
    filter === "pvp"
      ? []
      : await db
          .select()
          .from(aiGames)
          .where(and(eq(aiGames.userId, userId), gt(aiGames.plyCount, 0)))
          .orderBy(desc(aiGames.updatedAt))
          .limit(take);

  const people = await loadPeople(
    pvpRows.flatMap((game) => [game.whitePlayerId, game.blackPlayerId]),
  );

  const entries: { at: number; item: HistoryItem }[] = [];

  for (const game of pvpRows) {
    const myColor = game.whitePlayerId === userId ? "w" : "b";
    const opponentId = myColor === "w" ? game.blackPlayerId : game.whitePlayerId;
    const at = (game.finishedAt ?? game.createdAt).getTime();
    const before = myColor === "w" ? game.whiteRatingBefore : game.blackRatingBefore;
    const after = myColor === "w" ? game.whiteRatingAfter : game.blackRatingAfter;
    entries.push({
      at,
      item: {
        kind: "pvp",
        id: game.id,
        outcome: game.status === "aborted" ? "aborted" : outcomeFor(game.result, myColor),
        reason: game.reason,
        myColor,
        opponent: (opponentId && people.get(opponentId)) || LEFT_GUEST,
        plyCount: game.plyCount,
        endedAt: new Date(at).toISOString(),
        timeControl: formatTimeControl(game.timeBaseMs, game.incrementMs),
        rated: game.rated,
        ratingBefore: game.rated ? before : null,
        ratingAfter: game.rated ? after : null,
        levelLabel: null,
      },
    });
  }

  for (const game of aiRows) {
    entries.push({
      at: game.updatedAt.getTime(),
      item: {
        kind: "ai",
        id: game.id,
        outcome:
          game.status === "ongoing" ? "unfinished" : outcomeFor(game.result, game.humanColor),
        reason: game.reason,
        myColor: game.humanColor,
        opponent: AI_OPPONENT,
        plyCount: game.plyCount,
        endedAt: game.updatedAt.toISOString(),
        timeControl: null,
        rated: null,
        ratingBefore: null,
        ratingAfter: null,
        levelLabel: getLevel(game.levelId).label,
      },
    });
  }

  entries.sort((a, b) => b.at - a.at);
  return {
    items: entries.slice(offset, offset + limit).map((entry) => entry.item),
    hasMore: entries.length > offset + limit,
  };
}

/**
 * Dữ liệu để xem lại một ván. Trả về null nếu không có hoặc người xem không được xem:
 * - Ván với AI: chỉ chủ ván.
 * - Ván giữa người: chỉ khi đã kết thúc; người ngoài chỉ xem được ván công khai và
 *   chỉ sau khi hết độ trễ của khán giả (không để lộ kết quả sớm hơn người đang xem trực tiếp).
 */
export async function getReplay(
  kind: HistoryKind,
  id: string,
  viewerId: string | null,
): Promise<ReplayData | null> {
  if (!UUID_RE.test(id)) return null;
  return kind === "ai" ? getAiReplay(id, viewerId) : getPvpReplay(id, viewerId);
}

async function getAiReplay(id: string, viewerId: string | null): Promise<ReplayData | null> {
  if (!viewerId) return null;
  const [game] = await db.select().from(aiGames).where(eq(aiGames.id, id));
  if (!game || game.userId !== viewerId) return null;

  const people = await loadPeople([viewerId]);
  const me = people.get(viewerId) ?? LEFT_GUEST;
  return {
    kind: "ai",
    id: game.id,
    status: game.status,
    result: game.result,
    reason: game.reason,
    sans: game.sans,
    pgn: game.pgn,
    white: game.humanColor === "w" ? me : AI_OPPONENT,
    black: game.humanColor === "b" ? me : AI_OPPONENT,
    myColor: game.humanColor,
    playedAt: game.createdAt.toISOString(),
    timeControl: null,
    rated: null,
    levelLabel: getLevel(game.levelId).label,
    ratings: { white: null, black: null },
  };
}

async function getPvpReplay(id: string, viewerId: string | null): Promise<ReplayData | null> {
  const [game] = await db.select().from(games).where(eq(games.id, id));
  if (!game) return null;
  if (game.status !== "finished" && game.status !== "aborted") return null;
  if (game.plyCount === 0) return null;

  const myColor: "w" | "b" | null =
    viewerId && game.whitePlayerId === viewerId
      ? "w"
      : viewerId && game.blackPlayerId === viewerId
        ? "b"
        : null;
  if (!myColor) {
    if (!game.isPublic) return null;
    const now = await dbNowMs(db);
    if (now - (game.endedAtMs ?? 0) < game.spectatorDelayMs) return null;
  }

  const rows = await db
    .select({ san: moves.san })
    .from(moves)
    .where(eq(moves.gameId, id))
    .orderBy(asc(moves.ply));
  const people = await loadPeople([game.whitePlayerId, game.blackPlayerId]);
  const person = (playerId: string | null) =>
    (playerId && people.get(playerId)) || LEFT_GUEST;
  const rating = (before: number | null, after: number | null) =>
    game.rated && before !== null && after !== null ? { before, after } : null;

  return {
    kind: "pvp",
    id: game.id,
    status: game.status,
    result: game.result,
    reason: game.reason,
    sans: rows.map((row) => row.san),
    pgn: game.pgn,
    white: person(game.whitePlayerId),
    black: person(game.blackPlayerId),
    myColor,
    playedAt: (game.finishedAt ?? game.createdAt).toISOString(),
    timeControl: formatTimeControl(game.timeBaseMs, game.incrementMs),
    rated: game.rated,
    levelLabel: null,
    ratings: {
      white: rating(game.whiteRatingBefore, game.whiteRatingAfter),
      black: rating(game.blackRatingBefore, game.blackRatingAfter),
    },
  };
}
