import { eq } from "drizzle-orm";
import { aiGames, db, user } from "@/db/client";
import { LEVELS, getLevel } from "@/lib/levels";
import { GameError } from "./errors";
import { displayName } from "./names";
import {
  buildPgn,
  positionOutcome,
  replay,
  type GameResult,
  type Outcome,
  type ResultReason,
} from "./rules";

// Ván với AI chạy ở trình duyệt, nên server không "chơi" ván mà chỉ GHI LẠI:
// trình duyệt gửi toàn bộ danh sách nước đi sau mỗi nước, server dựng lại ván để
// kiểm tra tính hợp lệ và tự suy ra kết quả (chiếu bí, hòa...). Gửi cả danh sách
// (thay vì từng nước) giúp lưu lặp lại không sao, và hoàn tác vẫn đúng.

/** Chặn dữ liệu bất thường; ván cờ thật hiếm khi vượt quá vài trăm nước. */
export const MAX_AI_GAME_PLIES = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AiGameSaved {
  id: string;
  status: "ongoing" | "finished";
  result: GameResult | null;
  reason: ResultReason | null;
  plyCount: number;
}

export interface SaveAiGameInput {
  sans: unknown;
  /** Người chơi bấm "Xin thua". */
  resigned?: unknown;
}

function notFound(): never {
  throw new GameError("not_found", "Không tìm thấy ván cờ.", 404);
}

function pgnResult(result: GameResult | null): string {
  if (result === "white") return "1-0";
  if (result === "black") return "0-1";
  if (result === "draw") return "1/2-1/2";
  return "*";
}

export async function createAiGame(
  userId: string,
  input: { humanColor: unknown; levelId: unknown },
): Promise<string> {
  if (input.humanColor !== "w" && input.humanColor !== "b") {
    throw new GameError("bad_request", "Màu quân không hợp lệ.");
  }
  const levelId = input.levelId;
  if (typeof levelId !== "string" || !LEVELS.some((level) => level.id === levelId)) {
    throw new GameError("bad_request", "Mức độ AI không hợp lệ.");
  }
  const [row] = await db
    .insert(aiGames)
    .values({ userId, humanColor: input.humanColor, levelId })
    .returning({ id: aiGames.id });
  return row.id;
}

export async function saveAiGame(
  userId: string,
  gameId: string,
  input: SaveAiGameInput,
): Promise<AiGameSaved> {
  if (!UUID_RE.test(gameId)) notFound();
  const { sans } = input;
  if (
    !Array.isArray(sans) ||
    sans.length > MAX_AI_GAME_PLIES ||
    !sans.every((san) => typeof san === "string" && san.length > 0 && san.length < 16)
  ) {
    throw new GameError("bad_request", "Danh sách nước đi không hợp lệ.");
  }
  const moveList = sans as string[];

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(aiGames)
      .where(eq(aiGames.id, gameId))
      .for("update");
    // Ván của người khác cũng báo "không tìm thấy" để không lộ việc nó tồn tại.
    if (!row || row.userId !== userId) notFound();

    const saved = (patch: Partial<AiGameSaved> = {}): AiGameSaved => ({
      id: row.id,
      status: row.status,
      result: row.result,
      reason: row.reason,
      plyCount: row.plyCount,
      ...patch,
    });

    // Ván đã kết thúc thì kết quả được chốt, không sửa nữa (lưu lại y hệt thì bỏ qua).
    if (row.status === "finished") {
      if (JSON.stringify(row.sans) === JSON.stringify(moveList)) return saved();
      throw new GameError("invalid_state", "Ván này đã kết thúc, không thể sửa.", 409);
    }

    let chess;
    try {
      chess = replay(moveList);
    } catch {
      throw new GameError("bad_request", "Danh sách nước đi có nước không hợp lệ.");
    }

    let outcome: Outcome | null = positionOutcome(chess);
    if (!outcome && input.resigned === true) {
      outcome = {
        result: row.humanColor === "w" ? "black" : "white",
        reason: "resign",
      };
    }

    let pgn = "";
    if (moveList.length > 0) {
      const [owner] = await tx
        .select({ id: user.id, name: user.name, isAnonymous: user.isAnonymous })
        .from(user)
        .where(eq(user.id, userId));
      const humanName = owner ? displayName(owner) : "Người chơi";
      const aiName = `ChessNet AI (${getLevel(row.levelId).label})`;
      pgn = buildPgn(moveList, {
        Event: "Cờ Vua Online (đấu với AI)",
        Date: row.createdAt.toISOString().slice(0, 10).replaceAll("-", "."),
        White: row.humanColor === "w" ? humanName : aiName,
        Black: row.humanColor === "b" ? humanName : aiName,
        Result: pgnResult(outcome?.result ?? null),
      });
    }

    const now = new Date();
    await tx
      .update(aiGames)
      .set({
        sans: moveList,
        plyCount: moveList.length,
        pgn,
        updatedAt: now,
        ...(outcome
          ? {
              status: "finished" as const,
              result: outcome.result,
              reason: outcome.reason,
              finishedAt: now,
            }
          : {}),
      })
      .where(eq(aiGames.id, gameId));

    return saved({
      plyCount: moveList.length,
      ...(outcome
        ? { status: "finished", result: outcome.result, reason: outcome.reason }
        : {}),
    });
  });
}
