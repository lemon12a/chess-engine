import type { Color, PieceSymbol } from "chess.js";

// Bộ quân đang dùng, phải khớp tên thư mục trong public/pieces/:
// "cburnett" | "chessnut" | "merida"
export const PIECE_SET = "cburnett";

// Ví dụ: pieceSrc("w", "k") -> "/pieces/cburnett/wK.svg"
export function pieceSrc(color: Color, type: PieceSymbol) {
  return `/pieces/${PIECE_SET}/${color}${type.toUpperCase()}.svg`;
}
