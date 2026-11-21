"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { useClipboard } from "@mantine/hooks";
import { Anchor, Badge, Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { BoardGrid } from "@/components/chess/BoardGrid";
import { MoveList } from "@/components/chess/MoveList";
import { PlayerBar } from "@/components/chess/PlayerBar";
import { findKingSquare } from "@/lib/chess/board";
import { analyzeMaterial } from "@/lib/chess/material";
import { REASON_LABEL, formatPlayedAt, signed } from "@/lib/game/historyLabels";
import type { ReplayData } from "@/lib/game/historyTypes";
import { replay } from "@/lib/game/rules";

function resultTitle(data: ReplayData): string {
  if (data.status === "ongoing") return "Ván chưa kết thúc";
  if (data.status === "aborted" || data.result === "aborted") return "Ván đã hủy";
  if (data.result === "draw") return "Hòa";
  const winner = data.result === "white" ? "w" : "b";
  if (data.myColor) return winner === data.myColor ? "Bạn thắng" : "Bạn thua";
  return winner === "w" ? "Trắng thắng" : "Đen thắng";
}

function safeReplay(sans: string[]): Chess {
  try {
    return replay(sans);
  } catch {
    return new Chess();
  }
}

export function ReplayView({ data }: { data: ReplayData }) {
  const total = data.sans.length;
  const [ply, setPly] = useState(total); // mở ra ở thế cờ cuối cùng
  const [flipped, setFlipped] = useState(data.myColor === "b");
  const clipboard = useClipboard({ timeout: 2000 });

  // ← → chuyển nước, Home/End về đầu/cuối.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      if (event.key === "ArrowLeft") setPly((value) => Math.max(0, value - 1));
      else if (event.key === "ArrowRight") setPly((value) => Math.min(total, value + 1));
      else if (event.key === "Home") setPly(0);
      else if (event.key === "End") setPly(total);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [total]);

  const chess = useMemo(() => safeReplay(data.sans.slice(0, ply)), [data.sans, ply]);
  const board = chess.board();
  const lastVerbose = chess.history({ verbose: true }).at(-1);
  const lastMove = lastVerbose ? { from: lastVerbose.from, to: lastVerbose.to } : undefined;
  const checkedKingSquare = chess.isCheck() ? findKingSquare(board, chess.turn()) : null;
  const material = analyzeMaterial(board);

  const topColor = flipped ? "w" : "b";
  const bottomColor = flipped ? "b" : "w";

  function renderBar(color: "w" | "b") {
    const player = color === "w" ? data.white : data.black;
    const rating = (color === "w" ? data.ratings.white : data.ratings.black)?.before;
    const isMe = data.myColor === color;
    const tag =
      data.kind === "ai" && !isMe ? `AI · ${data.levelLabel}` : isMe ? "Bạn" : "";
    return (
      <PlayerBar
        name={player.name}
        tag={tag}
        color={color}
        captured={material.capturedBy[color]}
        advantage={material.advantage[color]}
        active={false}
        thinking={false}
        rating={rating}
      />
    );
  }

  const myRating = data.myColor
    ? data.myColor === "w"
      ? data.ratings.white
      : data.ratings.black
    : null;
  const reason =
    data.status !== "ongoing" && data.reason ? REASON_LABEL[data.reason] : null;

  function downloadPgn() {
    const blob = new Blob([data.pgn], { type: "application/x-chess-pgn" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `co-vua-${data.id.slice(0, 8)}.pgn`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Box
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      {/* ---- Cột bàn cờ ---- */}
      <Stack gap="xs" style={{ flex: "1 1 360px", maxWidth: 560, minWidth: 0 }}>
        {renderBar(topColor)}
        <BoardGrid
          board={board}
          flipped={flipped}
          selected={null}
          legalTargets={[]}
          lastMove={lastMove}
          checkedKingSquare={checkedKingSquare}
          clickable={false}
          onSquareClick={() => {}}
        />
        {renderBar(bottomColor)}
      </Stack>

      {/* ---- Cột thông tin bên phải ---- */}
      <Stack gap="sm" style={{ flex: "1 1 280px", maxWidth: 360, minWidth: 0 }}>
        <Paper withBorder p="md" radius="md" bg="dark.6">
          <Text fw={700} size="lg">
            {resultTitle(data)}
          </Text>
          {reason ? (
            <Text size="sm" c="dimmed">
              {reason}
            </Text>
          ) : data.status === "ongoing" ? (
            <Text size="sm" c="dimmed">
              Ván này chưa chơi xong (đã thoát giữa chừng). Bạn vẫn xem lại được các
              nước đã đi.
            </Text>
          ) : null}
          <Group gap={6} mt="sm">
            {data.kind === "ai" ? (
              <Badge variant="light">AI · {data.levelLabel}</Badge>
            ) : (
              <>
                {data.timeControl ? <Badge variant="light">{data.timeControl}</Badge> : null}
                <Badge variant="light" color={data.rated ? "green" : "gray"}>
                  {data.rated ? "Xếp hạng" : "Giao hữu"}
                </Badge>
              </>
            )}
          </Group>
          {myRating ? (
            <Text size="sm" mt="xs">
              Elo: {myRating.before} → {myRating.after} ({signed(myRating.after - myRating.before)})
            </Text>
          ) : null}
          <Text size="xs" c="dimmed" mt="xs" suppressHydrationWarning>
            {formatPlayedAt(data.playedAt)}
          </Text>
        </Paper>

        <MoveList sans={data.sans} activePly={ply} onSelect={setPly} />

        <Group grow gap="xs">
          <Button variant="default" aria-label="Về đầu ván" disabled={ply === 0} onClick={() => setPly(0)}>
            «
          </Button>
          <Button variant="default" aria-label="Lùi một nước" disabled={ply === 0} onClick={() => setPly(ply - 1)}>
            ‹
          </Button>
          <Button variant="default" aria-label="Tiến một nước" disabled={ply === total} onClick={() => setPly(ply + 1)}>
            ›
          </Button>
          <Button variant="default" aria-label="Đến cuối ván" disabled={ply === total} onClick={() => setPly(total)}>
            »
          </Button>
        </Group>

        <Group grow gap="xs">
          <Button variant="default" onClick={() => setFlipped((value) => !value)}>
            Lật bàn cờ
          </Button>
          <Button variant="default" disabled={!data.pgn} onClick={() => clipboard.copy(data.pgn)}>
            {clipboard.copied ? "Đã sao chép" : "Sao chép PGN"}
          </Button>
          <Button variant="default" disabled={!data.pgn} onClick={downloadPgn}>
            Tải PGN
          </Button>
        </Group>

        <Anchor component={Link} href="/history" size="sm" c="dimmed">
          ← Lịch sử ván đấu
        </Anchor>
      </Stack>
    </Box>
  );
}
