import type { Chess, Color, Square } from "chess.js";

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
export const INDEXES = [0, 1, 2, 3, 4, 5, 6, 7];

export const BOARD_LIGHT = "#eeeed2";
export const BOARD_DARK = "#6c9152";

export type Board = ReturnType<Chess["board"]>;

export function findKingSquare(board: Board, color: Color): Square | null {
  for (const row of board) {
    for (const square of row) {
      if (square && square.type === "k" && square.color === color) {
        return square.square;
      }
    }
  }
  return null;
}