import type { Color, PieceSymbol } from "chess.js";
import type { Board } from "./board";

const START_COUNTS: Record<PieceSymbol, number> = {
  p: 8,
  n: 2,
  b: 2,
  r: 2,
  q: 1,
  k: 1,
};
const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};
const CAPTURE_ORDER: PieceSymbol[] = ["q", "r", "b", "n", "p"];

// Tính quân đã bị bắt + chênh lệch vật chất từ thế cờ hiện tại.
// Lưu ý: nếu tốt phong cấp thì "quân bị bắt" hiển thị có thể lệch 1 chút so với
// thực tế (sẽ sửa ở bước 2).
export function analyzeMaterial(board: Board) {
  const counts: Record<Color, Record<PieceSymbol, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const row of board) {
    for (const square of row) {
      if (square) counts[square.color][square.type] += 1;
    }
  }

  const score = (color: Color) =>
    (Object.keys(PIECE_VALUE) as PieceSymbol[]).reduce(
      (sum, type) => sum + counts[color][type] * PIECE_VALUE[type],
      0
    );

  // Các quân của ĐỐI THỦ mà `color` đã bắt được
  const capturedBy = (color: Color): PieceSymbol[] => {
    const opponent: Color = color === "w" ? "b" : "w";
    return CAPTURE_ORDER.flatMap((type) =>
      Array.from(
        { length: Math.max(0, START_COUNTS[type] - counts[opponent][type]) },
        () => type
      )
    );
  };

  const diff = score("w") - score("b");
  return {
    capturedBy: { w: capturedBy("w"), b: capturedBy("b") },
    advantage: { w: Math.max(0, diff), b: Math.max(0, -diff) },
  };
}
