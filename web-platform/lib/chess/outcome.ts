import type { Chess, Color } from "chess.js";

export type Outcome = "win" | "loss" | "draw";

interface StatusInput {
  game: Chess;
  humanColor: Color;
  resigned: boolean;
  aiThinking: boolean;
}

// Suy ra kết quả (nếu ván đã xong) và dòng trạng thái hiển thị từ thế cờ.
export function getGameStatus({
  game,
  humanColor,
  resigned,
  aiThinking,
}: StatusInput): { outcome: Outcome | null; statusText: string } {
  const turn = game.turn();

  if (resigned) {
    return { outcome: "loss", statusText: "Bạn đã xin thua." };
  }
  if (game.isCheckmate()) {
    const winner: Color = turn === "w" ? "b" : "w";
    return {
      outcome: winner === humanColor ? "win" : "loss",
      statusText: `Chiếu bí! ${winner === "w" ? "Trắng" : "Đen"} thắng.`,
    };
  }
  if (game.isStalemate()) {
    return { outcome: "draw", statusText: "Hòa do hết nước đi hợp lệ (pat)." };
  }
  if (game.isInsufficientMaterial()) {
    return { outcome: "draw", statusText: "Hòa do không đủ quân để chiếu bí." };
  }
  if (game.isThreefoldRepetition()) {
    return { outcome: "draw", statusText: "Hòa do lặp lại thế cờ 3 lần." };
  }
  if (game.isDraw()) {
    return { outcome: "draw", statusText: "Hòa theo luật 50 nước." };
  }
  if (aiThinking) {
    return { outcome: null, statusText: "AI đang suy nghĩ…" };
  }
  if (game.isCheck()) {
    return {
      outcome: null,
      statusText:
        turn === humanColor ? "Bạn đang bị chiếu!" : "AI đang bị chiếu.",
    };
  }
  return {
    outcome: null,
    statusText: turn === humanColor ? "Đến lượt bạn." : "Đến lượt AI.",
  };
}
