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
import { authClient, ensureSession } from "@/lib/auth-client";
import { aiGameApi } from "@/lib/game/api";
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

// idle: chưa có gì để lưu · saving: đang gửi lên server · saved: đã lưu · error: lưu lỗi
type SaveStatus = "idle" | "saving" | "saved" | "error";

// Mỗi ván có một "bộ ghi" riêng: id bản ghi trên server (tạo khi có nước đi đầu tiên)
// và một hàng đợi để các lần lưu chạy lần lượt, không bao giờ chồng lên nhau.
interface Recorder {
  id: string | null;
  queue: Promise<void>;
}
const newRecorder = (): Recorder => ({ id: null, queue: Promise.resolve() });

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

  // ---- Lưu lịch sử ván đấu ----
  const recorderRef = useRef<Recorder>(newRecorder());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedGameId, setSavedGameId] = useState<string | null>(null);

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
  // Ván đã kết thúc thì kết quả được chốt trong lịch sử, nên không cho hoàn tác nữa.
  const canUndo =
    !aiThinking && !isOver && history.some((move) => move.color === humanColor);

  const { outcome, statusText } = getGameStatus({
    game,
    humanColor,
    resigned,
    aiThinking,
  });

  // ---- Lưu lịch sử ----
  // Gửi toàn bộ danh sách nước đi hiện tại; server tự kiểm tra và suy ra kết quả.
  // Lỗi lưu không làm gián đoạn ván cờ: chỉ báo cho người chơi và cho thử lại.
  function persist(options: { resigned?: boolean } = {}) {
    const sans = game.history();
    const recorder = recorderRef.current;
    if (sans.length === 0 && !recorder.id) return; // chưa có gì để lưu
    setSaveStatus("saving");
    recorder.queue = recorder.queue.then(async () => {
      try {
        if (!recorder.id) {
          await ensureSession(); // khách chưa có tài khoản thì tạo tài khoản khách
          recorder.id = await aiGameApi.create({ humanColor, levelId });
        }
        await aiGameApi.save(recorder.id, { sans, resigned: options.resigned });
        if (recorder === recorderRef.current) {
          setSavedGameId(recorder.id);
          setSaveStatus("saved");
        }
      } catch {
        if (recorder === recorderRef.current) setSaveStatus("error");
      }
    });
  }

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
      persist();
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
      if (move) persist();
      if (move && !game.isGameOver()) void requestAiMove();
      return;
    }

    const piece = game.get(square);
    setSelected(piece && piece.color === humanColor ? square : null);
  }

  function resetGame() {
    requestIdRef.current += 1;
    // Ván cũ giữ nguyên trong lịch sử; ván mới sẽ có bản ghi riêng khi có nước đi đầu.
    recorderRef.current = newRecorder();
    setSavedGameId(null);
    setSaveStatus("idle");
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
    persist(); // lịch sử luôn khớp với thế cờ đang hiển thị
  }

  function handleResign() {
    if (isOver) return;
    requestIdRef.current += 1;
    setAiThinking(false);
    setSelected(null);
    setResigned(true);
    persist({ resigned: true });
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
            {outcome ? "Ván đã kết thúc." : statusText}
          </Text>
        </Paper>

        {saveStatus === "error" ? (
          <Alert
            color="yellow"
            variant="light"
            title="Chưa lưu được lịch sử ván"
          >
            <Text size="sm" mb="xs">
              Ván vẫn chơi bình thường. Hãy thử lưu lại để ván này có trong Lịch
              sử ván đấu.
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => persist({ resigned })}
            >
              Thử lưu lại
            </Button>
          </Alert>
        ) : null}

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
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text size="xs" c="dimmed">
                {saveStatus === "saved"
                  ? "Đã lưu vào lịch sử."
                  : saveStatus === "saving"
                    ? "Đang lưu vào lịch sử…"
                    : ""}
              </Text>
              {savedGameId && saveStatus === "saved" ? (
                <Button
                  component={Link}
                  href={`/history/ai/${savedGameId}`}
                  size="xs"
                >
                  Xem lại ván
                </Button>
              ) : null}
            </Group>
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
