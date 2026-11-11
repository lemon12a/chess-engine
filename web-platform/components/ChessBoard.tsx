"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Chess, type Color, type Move, type Square } from "chess.js";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { authClient } from "@/lib/auth-client";
import { getAiParams } from "@/lib/levels";
import { findKingSquare } from "@/lib/chess/board";
import { analyzeMaterial } from "@/lib/chess/material";
import { getGameStatus } from "@/lib/chess/outcome";
import { BoardGrid } from "@/components/chess/BoardGrid";
import { MoveList } from "@/components/chess/MoveList";
import { PlayerBar } from "@/components/chess/PlayerBar";

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8000";
const MIN_THINK_MS = 1000; // AI "suy nghĩ" tối thiểu 1 giây cho tự nhiên

interface ChessBoardProps {
  humanColor: Color;
  levelId: string;
  levelLabel: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ChessBoard({
  humanColor,
  levelId,
  levelLabel,
}: ChessBoardProps) {
  // Một đối tượng Chess duy nhất cho cả ván; `setVersion` chỉ dùng để ép render
  // lại mỗi khi thế cờ thay đổi.
  const [game] = useState(() => new Chess());
  const [, setVersion] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [resigned, setResigned] = useState(false);
  const [flipped, setFlipped] = useState(humanColor === "b");

  // Mỗi lần reset/hoàn tác/xin thua, tăng số này để bỏ qua kết quả của yêu cầu
  // AI đang chờ (tránh AI đi nước cũ vào ván mới).
  const requestIdRef = useRef(0);

  const { data: session } = authClient.useSession();
  const humanName = session?.user.name ?? "Khách";

  // ---- Dữ liệu suy ra từ thế cờ hiện tại ----
  const turn = game.turn();
  const board = game.board();
  const history = game.history({ verbose: true });
  const lastMove: Move | undefined = history[history.length - 1];
  const material = analyzeMaterial(board);
  const isOver = resigned || game.isGameOver();
  const legalTargets: Square[] = selected
    ? game.moves({ square: selected, verbose: true }).map((move) => move.to)
    : [];
  const checkedKingSquare = game.isCheck() ? findKingSquare(board, turn) : null;
  const canUndo =
    !aiThinking &&
    !resigned &&
    history.some((move) => move.color === humanColor);

  const { outcome, statusText } = getGameStatus({
    game,
    humanColor,
    resigned,
    aiThinking,
  });

  // ---- Gọi AI service ----
  async function requestAiMove() {
    if (game.isGameOver()) return;
    requestIdRef.current += 1;
    const myRequest = requestIdRef.current;
    setAiThinking(true);
    setAiError(null);

    try {
      const fetchPromise = fetch(`${AI_SERVICE_URL}/ai-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: game.fen(), ...getAiParams(levelId) }),
      }).then((res) => {
        if (!res.ok) throw new Error(`AI service trả về lỗi ${res.status}`);
        return res.json() as Promise<{ move: string }>;
      });

      const [data] = await Promise.all([fetchPromise, delay(MIN_THINK_MS)]);
      if (myRequest !== requestIdRef.current) return; // ván đã đổi trong lúc chờ

      const from = data.move.slice(0, 2) as Square;
      const to = data.move.slice(2, 4) as Square;
      const promotion = data.move.slice(4, 5) || undefined;
      try {
        game.move({ from, to, promotion });
      } catch {
        throw new Error(`AI trả về nước đi không hợp lệ: ${data.move}`);
      }
      setVersion((v) => v + 1);
    } catch (error) {
      if (myRequest !== requestIdRef.current) return;
      // TypeError = không kết nối được (service tắt, sai cổng, bị CORS chặn)
      setAiError(
        error instanceof TypeError
          ? "Không nhận được phản hồi từ AI service"
          : error instanceof Error
            ? error.message
            : "Lỗi không xác định",
      );
    } finally {
      if (myRequest === requestIdRef.current) setAiThinking(false);
    }
  }

  // ---- Các thao tác của người chơi ----
  function handleSquareClick(square: Square) {
    if (isOver || aiThinking || turn !== humanColor) return;

    if (selected && legalTargets.includes(square)) {
      // MVP: tự động phong Hậu (sẽ thay ở bước 3)
      const move = game.move({ from: selected, to: square, promotion: "q" });
      setSelected(null);
      setVersion((v) => v + 1);
      if (move && !game.isGameOver()) void requestAiMove();
      return;
    }

    const piece = game.get(square);
    setSelected(piece && piece.color === humanColor ? square : null);
  }

  function resetGame() {
    requestIdRef.current += 1;
    game.reset();
    setSelected(null);
    setResigned(false);
    setAiThinking(false);
    setAiError(null);
    setVersion((v) => v + 1);
    if (humanColor === "b") void requestAiMove(); // AI cầm Trắng, đi trước
  }

  function handleUndo() {
    if (!canUndo) return;
    requestIdRef.current += 1;
    // Lùi tới trước nước đi gần nhất của người chơi (kèm nước đáp trả của AI)
    let undone = game.undo();
    while (undone && undone.color !== humanColor) undone = game.undo();
    setSelected(null);
    setAiError(null);
    setVersion((v) => v + 1);
  }

  function handleResign() {
    if (isOver) return;
    requestIdRef.current += 1;
    setAiThinking(false);
    setSelected(null);
    setResigned(true);
  }

  // Nếu người chơi cầm Đen thì AI (Trắng) phải đi trước khi vào ván.
  useEffect(() => {
    if (humanColor !== "b") return;
    // setTimeout để tránh gọi setState đồng bộ trong effect; cleanup để StrictMode
    // (chạy effect 2 lần ở môi trường dev) không gửi 2 yêu cầu.
    const timer = setTimeout(() => {
      void requestAiMove();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Chuẩn bị dữ liệu hiển thị ----
  const topColor: Color = flipped ? "w" : "b";
  const bottomColor: Color = flipped ? "b" : "w";

  function renderBar(color: Color) {
    const isHuman = color === humanColor;
    return (
      <PlayerBar
        name={isHuman ? humanName : "ChessNet AI"}
        tag={isHuman ? "Bạn" : `AI · ${levelLabel}`}
        color={color}
        captured={material.capturedBy[color]}
        advantage={material.advantage[color]}
        active={!isOver && turn === color}
        thinking={!isHuman && aiThinking}
      />
    );
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
          selected={selected}
          legalTargets={legalTargets}
          lastMove={lastMove}
          checkedKingSquare={checkedKingSquare}
          clickable={!isOver && !aiThinking}
          onSquareClick={handleSquareClick}
        />
        {renderBar(bottomColor)}
      </Stack>

      {/* ---- Cột thông tin bên phải ---- */}
      <Stack gap="sm" style={{ flex: "1 1 280px", maxWidth: 360, minWidth: 0 }}>
        <Paper withBorder p="md" radius="md" bg="dark.6">
          <Group justify="space-between" mb={6} wrap="nowrap">
            <Text fw={700}>Ván đấu với AI</Text>
            <Badge variant="light">{levelLabel}</Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {statusText}
          </Text>
        </Paper>

        {aiError ? (
          <Alert color="red" variant="light" title="Không kết nối được AI">
            <Text size="sm" mb="xs">
              {aiError}. Hãy kiểm tra AI service đã chạy chưa (mặc định cổng
              8000).
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => void requestAiMove()}
            >
              Thử lại
            </Button>
          </Alert>
        ) : null}

        {outcome ? (
          <Alert
            variant="light"
            color={
              outcome === "win" ? "green" : outcome === "loss" ? "red" : "gray"
            }
            title={
              outcome === "win"
                ? "Bạn thắng!"
                : outcome === "loss"
                  ? "Bạn thua"
                  : "Hòa"
            }
          >
            <Text size="sm" mb="xs">
              {statusText}
            </Text>
            <Button size="xs" onClick={resetGame}>
              Ván mới
            </Button>
          </Alert>
        ) : null}

        <MoveList sans={history.map((move) => move.san)} />

        <SimpleGrid cols={2} spacing="xs">
          <Button onClick={resetGame}>Ván mới</Button>
          <Button variant="default" onClick={() => setFlipped((f) => !f)}>
            Lật bàn cờ
          </Button>
          <Button variant="default" onClick={handleUndo} disabled={!canUndo}>
            Hoàn tác
          </Button>
          <Button
            variant="light"
            color="red"
            onClick={handleResign}
            disabled={isOver}
          >
            Xin thua
          </Button>
        </SimpleGrid>

        <Anchor component={Link} href="/" size="sm" c="dimmed">
          ← Đổi thiết lập ván
        </Anchor>
      </Stack>
    </Box>
  );
}
