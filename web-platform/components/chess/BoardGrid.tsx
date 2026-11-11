import type { CSSProperties } from "react";
import type { Square } from "chess.js";
import { Box } from "@mantine/core";
import { pieceSrc } from "@/lib/pieces";
import {
  BOARD_DARK,
  BOARD_LIGHT,
  FILES,
  INDEXES,
  RANKS,
  type Board,
} from "@/lib/chess/board";

interface BoardGridProps {
  board: Board;
  flipped: boolean;
  selected: Square | null;
  legalTargets: Square[];
  lastMove?: { from: Square; to: Square };
  checkedKingSquare: Square | null;
  /** false khi ván đã xong hoặc AI đang nghĩ: con trỏ không còn là bàn tay */
  clickable: boolean;
  onSquareClick: (square: Square) => void;
}

function overlay(background: string): CSSProperties {
  return { position: "absolute", inset: 0, background };
}

export function BoardGrid({
  board,
  flipped,
  selected,
  legalTargets,
  lastMove,
  checkedKingSquare,
  clickable,
  onSquareClick,
}: BoardGridProps) {
  const rowOrder = flipped ? [...INDEXES].reverse() : INDEXES;
  const colOrder = flipped ? [...INDEXES].reverse() : INDEXES;

  return (
    <Box
      style={{
        width: "100%",
        aspectRatio: "1 / 1",
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gridTemplateRows: "repeat(8, 1fr)",
        border: "4px solid #33422e",
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
      }}
    >
      {rowOrder.map((r, displayRow) =>
        colOrder.map((c, displayCol) => {
          const piece = board[r][c];
          const square = `${FILES[c]}${RANKS[r]}` as Square;
          const isLight = (r + c) % 2 === 0;
          const isSelected = selected === square;
          const isTarget = legalTargets.includes(square);
          const isLastMove =
            lastMove !== undefined &&
            (lastMove.from === square || lastMove.to === square);
          const labelColor = isLight ? BOARD_DARK : BOARD_LIGHT;

          return (
            <div
              key={square}
              onClick={() => onSquareClick(square)}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: clickable ? "pointer" : "default",
                background: isLight ? BOARD_LIGHT : BOARD_DARK,
                userSelect: "none",
              }}
            >
              {isLastMove ? (
                <div style={overlay("rgba(255, 235, 59, 0.35)")} />
              ) : null}
              {isSelected ? (
                <div style={overlay("rgba(255, 235, 59, 0.6)")} />
              ) : null}
              {checkedKingSquare === square ? (
                <div
                  style={overlay(
                    "radial-gradient(circle, rgba(255,0,0,0.8) 0%, rgba(255,0,0,0) 70%)"
                  )}
                />
              ) : null}

              {isTarget ? (
                piece ? (
                  <div
                    style={overlay(
                      "radial-gradient(circle, rgba(0,0,0,0) 62%, rgba(20,85,30,0.5) 64%)"
                    )}
                  />
                ) : (
                  <div
                    style={{
                      position: "absolute",
                      width: "30%",
                      height: "30%",
                      borderRadius: "50%",
                      background: "rgba(20, 85, 30, 0.5)",
                    }}
                  />
                )
              ) : null}

              {displayCol === 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: 3,
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    color: labelColor,
                    zIndex: 1,
                  }}
                >
                  {RANKS[r]}
                </span>
              ) : null}
              {displayRow === 7 ? (
                <span
                  style={{
                    position: "absolute",
                    bottom: 1,
                    right: 3,
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    color: labelColor,
                    zIndex: 1,
                  }}
                >
                  {FILES[c]}
                </span>
              ) : null}

              {piece ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pieceSrc(piece.color, piece.type)}
                  alt={`${piece.color}${piece.type}`}
                  draggable={false}
                  style={{
                    position: "relative",
                    zIndex: 2,
                    width: "88%",
                    height: "88%",
                    pointerEvents: "none",
                  }}
                />
              ) : null}
            </div>
          );
        })
      )}
    </Box>
  );
}
