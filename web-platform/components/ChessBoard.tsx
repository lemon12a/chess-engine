"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Chess,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from "chess.js";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { authClient } from "@/lib/auth-client";
import { pieceSrc } from "@/lib/pieces";

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8000";
const MIN_THINK_MS = 1000; // AI "suy nghĩ" tối thiểu 1 giây cho tự nhiên

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
const INDEXES = [0, 1, 2, 3, 4, 5, 6, 7];

const BOARD_LIGHT = "#eeeed2";
const BOARD_DARK = "#6c9152";

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

type Board = ReturnType<Chess["board"]>;
type Outcome = "win" | "loss" | "draw";

interface ChessBoardProps {
  humanColor: Color;
  simulations: number;
  levelLabel: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tính quân đã bị bắt + chênh lệch vật chất từ thế cờ hiện tại.
// Lưu ý: nếu tốt phong cấp thì "quân bị bắt" hiển thị có thể lệch 1 chút so với
// thực tế (chess.com cũng phải xử lý riêng trường hợp này).
function analyzeMaterial(board: Board) {
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

function findKingSquare(board: Board, color: Color): Square | null {
  for (const row of board) {
    for (const square of row) {
      if (square && square.type === "k" && square.color === color) {
        return square.square;
      }
    }
  }
  return null;
}

interface PlayerBarProps {
  name: string;
  tag: string;
  color: Color;
  captured: PieceSymbol[];
  advantage: number;
  active: boolean;
  thinking: boolean;
}

function PlayerBar({
  name,
  tag,
  color,
  captured,
  advantage,
  active,
  thinking,
}: PlayerBarProps) {
  const opponent: Color = color === "w" ? "b" : "w";

  return (
    <Paper
      withBorder
      radius="md"
      p="xs"
      bg="dark.6"
      style={{
        borderColor: active ? "var(--mantine-color-brand-6)" : undefined,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <Box
            w={36}
            h={36}
            style={{
              background: "#dcdcdc",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pieceSrc(color, "k")} alt="" width={28} height={28} />
          </Box>
          <Stack gap={2}>
            <Group gap={6} wrap="nowrap">
              <Text size="sm" fw={600} lh={1.2}>
                {name}
              </Text>
              <Text size="xs" c="dimmed" lh={1.2}>
                {tag}
              </Text>
            </Group>
            <Group gap={0} wrap="nowrap" h={18}>
              {captured.map((type, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${type}-${index}`}
                  src={pieceSrc(opponent, type)}
                  alt=""
                  width={18}
                  height={18}
                  style={{ marginRight: -6 }}
                />
              ))}
              {advantage > 0 ? (
                <Text size="xs" c="dimmed" ml={10}>
                  +{advantage}
                </Text>
              ) : null}
            </Group>
          </Stack>
        </Group>
        {thinking ? (
          <Badge variant="light" size="sm">
            Đang suy nghĩ…
          </Badge>
        ) : null}
      </Group>
    </Paper>
  );
}

function MoveCell({ san, active }: { san?: string; active: boolean }) {
  return (
    <Text
      size="sm"
      px={6}
      py={2}
      style={{
        borderRadius: 4,
        fontWeight: active ? 700 : 400,
        background: active ? "var(--mantine-color-dark-4)" : undefined,
      }}
    >
      {san ?? ""}
    </Text>
  );
}

export function ChessBoard({
  humanColor,
  simulations,
  levelLabel,
}: ChessBoardProps) {
  // Một đối tượng Chess duy nhất cho cả ván; `version` chỉ dùng để ép render lại
  // mỗi khi thế cờ thay đổi.
  const [game] = useState(() => new Chess());
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [resigned, setResigned] = useState(false);
  const [flipped, setFlipped] = useState(humanColor === "b");

  // Mỗi lần reset/hoàn tác/xin thua, tăng số này để bỏ qua kết quả của yêu cầu
  // AI đang chờ (tránh AI đi nước cũ vào ván mới).
  const requestIdRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  const { data: session } = authClient.useSession();
  const humanName = session?.user.name ?? "Khách";

  // ---- Dữ liệu suy ra từ thế cờ hiện tại ----
  const turn = game.turn();
  const board = game.board();
  const history = game.history({ verbose: true });
  const lastMove: Move | undefined = history[history.length - 1];
  const material = analyzeMaterial(board);
  const isOver = resigned || game.isGameOver();
  const legalTargets = selected
    ? game.moves({ square: selected, verbose: true }).map((move) => move.to)
    : [];
  const checkedKingSquare = game.isCheck() ? findKingSquare(board, turn) : null;
  const canUndo =
    !aiThinking &&
    !resigned &&
    history.some((move) => move.color === humanColor);

  let outcome: Outcome | null = null;
  let statusText = "";
  if (resigned) {
    outcome = "loss";
    statusText = "Bạn đã xin thua.";
  } else if (game.isCheckmate()) {
    const winner: Color = turn === "w" ? "b" : "w";
    outcome = winner === humanColor ? "win" : "loss";
    statusText = `Chiếu bí! ${winner === "w" ? "Trắng" : "Đen"} thắng.`;
  } else if (game.isStalemate()) {
    outcome = "draw";
    statusText = "Hòa do hết nước đi hợp lệ (pat).";
  } else if (game.isInsufficientMaterial()) {
    outcome = "draw";
    statusText = "Hòa do không đủ quân để chiếu bí.";
  } else if (game.isThreefoldRepetition()) {
    outcome = "draw";
    statusText = "Hòa do lặp lại thế cờ 3 lần.";
  } else if (game.isDraw()) {
    outcome = "draw";
    statusText = "Hòa theo luật 50 nước.";
  } else if (aiThinking) {
    statusText = "AI đang suy nghĩ…";
  } else if (game.isCheck()) {
    statusText = turn === humanColor ? "Bạn đang bị chiếu!" : "AI đang bị chiếu.";
  } else {
    statusText = turn === humanColor ? "Đến lượt bạn." : "Đến lượt AI.";
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
        body: JSON.stringify({ fen: game.fen(), simulations }),
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
            : "Lỗi không xác định"
      );
    } finally {
      if (myRequest === requestIdRef.current) setAiThinking(false);
    }
  }

  // ---- Các thao tác của người chơi ----
  function handleSquareClick(square: Square) {
    if (isOver || aiThinking || turn !== humanColor) return;

    if (selected && legalTargets.includes(square)) {
      // MVP: tự động phong Hậu
      const move = game.move({ from: selected, to: square, promotion: "q" });
      setSelected(null);
      setVersion((v) => v + 1);
      if (move && !game.isGameOver()) void requestAiMove();
      // TODO (bước sau): khi ván kết thúc, gọi API lưu ván vào bảng `games`
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

  // Tự cuộn danh sách nước đi xuống cuối khi có nước mới
  useEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [version]);

  // ---- Chuẩn bị dữ liệu hiển thị ----
  const rowOrder = flipped ? [...INDEXES].reverse() : INDEXES;
  const colOrder = flipped ? [...INDEXES].reverse() : INDEXES;
  const topColor: Color = flipped ? "w" : "b";
  const bottomColor: Color = flipped ? "b" : "w";

  const movePairs: { num: number; white?: string; black?: string }[] = [];
  history.forEach((move, index) => {
    if (index % 2 === 0) movePairs.push({ num: index / 2 + 1, white: move.san });
    else movePairs[movePairs.length - 1].black = move.san;
  });
  const lastPly = history.length - 1;

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

  const overlay = (background: string): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    background,
  });

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
                  onClick={() => handleSquareClick(square)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: isOver || aiThinking ? "default" : "pointer",
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

        {renderBar(bottomColor)}
      </Stack>

      {/* ---- Cột thông tin bên phải ---- */}
      <Stack gap="sm" style={{ flex: "1 1 280px", maxWidth: 360, minWidth: 0 }}>
        <Paper withBorder p="md" radius="md" bg="dark.6">
          <Group justify="space-between" mb={6} wrap="nowrap">
            <Text fw={700}>Ván đấu với AI</Text>
            <Badge variant="light">
              {levelLabel} · {simulations} mô phỏng
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {statusText}
          </Text>
        </Paper>

        {aiError ? (
          <Alert color="red" variant="light" title="Không kết nối được AI">
            <Text size="sm" mb="xs">
              {aiError}. Hãy kiểm tra AI service đã chạy chưa (mặc định cổng 8000).
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

        <Paper withBorder radius="md" bg="dark.6">
          <Text size="sm" fw={600} px="md" pt="sm" pb={4}>
            Nước đi
          </Text>
          <ScrollArea h={240} viewportRef={viewportRef} px="md" pb="sm">
            {movePairs.length === 0 ? (
              <Text size="sm" c="dimmed">
                Chưa có nước đi nào.
              </Text>
            ) : (
              <Stack gap={2}>
                {movePairs.map((pair, index) => (
                  <Box
                    key={pair.num}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px 1fr 1fr",
                      gap: 4,
                      alignItems: "center",
                    }}
                  >
                    <Text size="xs" c="dimmed">
                      {pair.num}.
                    </Text>
                    <MoveCell san={pair.white} active={lastPly === index * 2} />
                    <MoveCell
                      san={pair.black}
                      active={lastPly === index * 2 + 1}
                    />
                  </Box>
                ))}
              </Stack>
            )}
          </ScrollArea>
        </Paper>

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
