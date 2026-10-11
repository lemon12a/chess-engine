"use client";

import { useState, useMemo } from "react";
import { Chess, type Square } from "chess.js";
import { Badge, Group, SegmentedControl, Stack, Text } from "@mantine/core";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const PIECE_UNICODE: Record<string, Record<string, string>> = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};
const AI_SERVICE_URL = "http://localhost:8000";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ChessBoard() {
  const game = useMemo(() => new Chess(), []);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [humanColor, setHumanColor] = useState<"w" | "b">("w");

  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return game.moves({ square: selected, verbose: true }).map((m) => m.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, version]);

  async function requestAiMove() {
    if (game.isGameOver()) return;
    setAiThinking(true);
    try {
      const fetchPromise = fetch(`${AI_SERVICE_URL}/ai-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: game.fen(), simulations: 15 }),
      }).then((res) => {
        if (!res.ok) throw new Error(`AI service lỗi: ${res.status}`);
        return res.json() as Promise<{ move: string }>;
      });

      // Đảm bảo AI "suy nghĩ" tối thiểu 1 giây cho tự nhiên, dù API trả nhanh hơn
      const [data] = await Promise.all([fetchPromise, delay(1000)]);

      const from = data.move.slice(0, 2) as Square;
      const to = data.move.slice(2, 4) as Square;
      const promotion = data.move.slice(4, 5) || undefined;

      game.move({ from, to, promotion });
      setVersion((v) => v + 1);
    } catch (err) {
      console.error("Không gọi được AI service:", err);
    } finally {
      setAiThinking(false);
    }
  }

  function handleSquareClick(square: Square) {
    if (game.turn() !== humanColor || aiThinking) return;

    if (selected && legalTargets.includes(square)) {
      const move = game.move({ from: selected, to: square, promotion: "q" });
      setSelected(null);
      setVersion((v) => v + 1);
      if (move && !game.isGameOver()) {
        requestAiMove();
      }
      return;
    }

    const piece = game.get(square);
    if (piece && piece.color === game.turn()) {
      setSelected(square);
    } else {
      setSelected(null);
    }
  }

  function handleNewGame(color: "w" | "b") {
    game.reset();
    setHumanColor(color);
    setSelected(null);
    setVersion((v) => v + 1);
    if (color === "b") {
      requestAiMove(); // AI cầm Trắng, đi trước
    }
  }

  const status = useMemo(() => {
    if (game.isCheckmate())
      return `Chiếu bí! ${game.turn() === "w" ? "Đen" : "Trắng"} thắng.`;
    if (game.isDraw()) return "Hòa cờ.";
    if (aiThinking) return "AI đang suy nghĩ...";
    if (game.isCheck())
      return `${game.turn() === "w" ? "Trắng" : "Đen"} đang bị chiếu.`;
    return `Đến lượt ${game.turn() === "w" ? "Trắng" : "Đen"}.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, aiThinking]);

  const board = game.board();

  return (
    <Stack align="center" gap="md">
      <SegmentedControl
        value={humanColor}
        onChange={(value) => handleNewGame(value as "w" | "b")}
        data={[
          { label: "Bạn cầm quân Trắng", value: "w" },
          { label: "Bạn cầm quân Đen", value: "b" },
        ]}
      />
      <Group>
        <Badge color="grape">Đấu với AI</Badge>
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
