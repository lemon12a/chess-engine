import { Chess, type Color } from "chess.js";
import { MIN_PLIES_FOR_RESULT } from "./constants";

export type GameResult = "white" | "black" | "draw" | "aborted";
export type ResultReason =
  | "checkmate"
  | "resign"
  | "timeout"
  | "abandon"
  | "agreement"
  | "stalemate"
  | "repetition"
  | "insufficient"
  | "fifty_move"
  | "aborted"
  | "aborted_no_move"
  | "aborted_both_gone";

export interface Outcome {
  result: GameResult;
  reason: ResultReason;
}

/** Dựng lại thế cờ từ danh sách nước đi (SAN). Ném lỗi nếu có nước phi pháp. */
export function replay(sans: string[]): Chess {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess;
}

/**
 * `color` có còn khả năng chiếu bí không? Xấp xỉ theo luật thực dụng:
 * có Tốt/Xe/Hậu, hoặc từ 2 quân nhẹ trở lên thì còn; chỉ vua hoặc vua + 1 quân nhẹ thì không.
 * (Không xét trường hợp đặc biệt đối thủ tự bí vua mình.)
 */
export function canDeliverMate(chess: Chess, color: Color): boolean {
  let minors = 0;
  for (const row of chess.board()) {
    for (const square of row) {
      if (!square || square.color !== color) continue;
      if (square.type === "p" || square.type === "r" || square.type === "q") {
        return true;
      }
      if (square.type === "n" || square.type === "b") minors += 1;
    }
  }
  return minors >= 2;
}

/** Kết quả suy ra thẳng từ thế cờ (chiếu bí, pat, hòa luật). Null nếu ván còn tiếp. */
export function positionOutcome(chess: Chess): Outcome | null {
  if (chess.isCheckmate()) {
    return {
      result: chess.turn() === "w" ? "black" : "white",
      reason: "checkmate",
    };
  }
  if (chess.isStalemate()) return { result: "draw", reason: "stalemate" };
  if (chess.isInsufficientMaterial()) return { result: "draw", reason: "insufficient" };
  if (chess.isThreefoldRepetition()) return { result: "draw", reason: "repetition" };
  if (chess.isDrawByFiftyMoves()) return { result: "draw", reason: "fifty_move" };
  return null;
}

/** Hết giờ: đối thủ thắng, trừ khi họ không còn đủ quân để chiếu bí thì hòa. */
export function timeoutOutcome(chess: Chess, loser: Color): Outcome {
  const winner: Color = loser === "w" ? "b" : "w";
  if (!canDeliverMate(chess, winner)) {
    return { result: "draw", reason: "insufficient" };
  }
  return { result: winner === "w" ? "white" : "black", reason: "timeout" };
}

/**
 * Kết thúc ván chưa đủ số nước (trừ chiếu bí) thì huỷ, không tính Elo.
 * Chặn kiểu "cho thua nhanh để bơm Elo".
 */
export function normalizeOutcome(outcome: Outcome, plyCount: number): Outcome {
  if (outcome.result === "aborted") return outcome;
  if (outcome.reason === "checkmate") return outcome;
  if (plyCount < MIN_PLIES_FOR_RESULT) {
    return { result: "aborted", reason: "aborted" };
  }
  return outcome;
}

export function buildPgn(
  sans: string[],
  headers: Record<string, string>,
): string {
  const chess = new Chess();
  for (const [key, value] of Object.entries(headers)) chess.setHeader(key, value);
  for (const san of sans) chess.move(san);
  return chess.pgn();
}
