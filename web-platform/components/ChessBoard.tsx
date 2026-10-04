"use client";

import { useState, useMemo } from "react";
import { Chess, type Square } from "chess.js";
import { Badge, Group, Stack, Text } from "@mantine/core";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const PIECE_UNICODE: Record<string, Record<string, string>> = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

export function ChessBoard() {
  const game = useMemo(() => new Chess(), []);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);

  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return game.moves({ square: selected, verbose: true }).map((m) => m.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, version]);

  function handleSquareClick(square: Square) {
    if (selected && legalTargets.includes(square)) {
      game.move({ from: selected, to: square, promotion: "q" });
      setSelected(null);
      setVersion((v) => v + 1);
      return;
    }
    const piece = game.get(square);
    if (piece && piece.color === game.turn()) {
      setSelected(square);
    } else {
      setSelected(null);
    }
  }

  const status = useMemo(() => {
    if (game.isCheckmate())
      return `Chiếu bí! ${game.turn() === "w" ? "Đen" : "Trắng"} thắng.`;
    if (game.isDraw()) return "Hòa cờ.";
    if (game.isCheck())
      return `${game.turn() === "w" ? "Trắng" : "Đen"} đang bị chiếu.`;
    return `Đến lượt ${game.turn() === "w" ? "Trắng" : "Đen"}.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const board = game.board();

  return (
    <Stack align="center" gap="md">
      <Group>
        <Badge color="blue">2 người (offline)</Badge>
        <Text fw={600}>{status}</Text>
      </Group>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, 1fr)",
          gridTemplateRows: "repeat(8, 1fr)",
          width: "min(90vw, 480px)",
          height: "min(90vw, 480px)",
          border: "4px solid #33422e",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {board.map((row, rowIdx) =>
          row.map((piece, colIdx) => {
            const square = `${FILES[colIdx]}${RANKS[rowIdx]}` as Square;
            const isLight = (rowIdx + colIdx) % 2 === 0;
            const isSelected = selected === square;
            const isTarget = legalTargets.includes(square);

            return (
              <div
                key={square}
                onClick={() => handleSquareClick(square)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "min(7vw, 32px)",
                  cursor: "pointer",
                  background: isLight ? "#eeeed2" : "#6c9152",
                  userSelect: "none",
                }}
              >
                {isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(255,213,79,0.65)",
                    }}
                  />
                )}
                {isTarget && (
                  <div
                    style={{
                      position: "absolute",
                      width: piece ? "100%" : "32%",
                      height: piece ? "100%" : "32%",
                      borderRadius: piece ? 0 : "50%",
                      background: "rgba(33,150,243,0.35)",
                    }}
                  />
                )}
                {rowIdx === 7 && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 2,
                      right: 3,
                      fontSize: "0.6rem",
                      fontWeight: 600,
                      opacity: 0.65,
                      zIndex: 1,
                      color: isLight ? "#6c9152" : "#eeeed2",
                    }}
                  >
                    {FILES[colIdx]}
                  </span>
                )}
                {colIdx === 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: 3,
                      fontSize: "0.6rem",
                      fontWeight: 600,
                      opacity: 0.65,
                      zIndex: 1,
                      color: isLight ? "#6c9152" : "#eeeed2",
                    }}
                  >
                    {RANKS[rowIdx]}
                  </span>
                )}
                {piece && (
                  <span
                    style={{
                      position: "relative",
                      zIndex: 2,
                      fontVariantEmoji: "text",
                      fontFamily:
                        "'Segoe UI Symbol', 'Noto Sans Symbols 2', 'Arial Unicode MS', sans-serif",
                    }}
                  >
                    {PIECE_UNICODE[piece.color][piece.type]}
                  </span>
                )}
              </div>
            );
          }),
        )}
      </div>
    </Stack>
  );
}
