"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Color, Move, Square } from "chess.js";
import { useClipboard } from "@mantine/hooks";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { ensureSession } from "@/lib/auth-client";
import { ApiError, gameApi } from "@/lib/game/api";
import { MIN_PLIES_FOR_RESULT } from "@/lib/game/constants";
import { describeResult } from "@/lib/game/labels";
import { replay } from "@/lib/game/rules";
import { useGameView } from "@/lib/game/useGameView";
import type { GameView, PlayerInfo } from "@/lib/game/types";
import { findKingSquare } from "@/lib/chess/board";
import { analyzeMaterial } from "@/lib/chess/material";
import { BoardGrid } from "@/components/chess/BoardGrid";
import { MoveList } from "@/components/chess/MoveList";
import { PlayerBar } from "@/components/chess/PlayerBar";
import { ClockDisplay } from "./ClockDisplay";
import { PromotionModal } from "./PromotionModal";

// Các lỗi mà cách xử lý đúng là hỏi lại server để đồng bộ, không cần báo người dùng.
const SYNC_ERRORS = new Set(["game_over", "out_of_sync", "not_your_turn"]);

export function GameRoom({ gameId }: { gameId: string }) {
  const { view, baselinePerf, error, notFound, refresh, acceptView } =
    useGameView(gameId);

  const [selected, setSelected] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flipOverride, setFlipOverride] = useState<boolean | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const clipboard = useClipboard({ timeout: 2000 });
  const lastFlagRef = useRef(0);

  const chess = useMemo(() => {
    if (!view) return null;
    try {
      return replay(view.sans);
    } catch {
      return null;
    }
  }, [view]);

  // Máy khách không tự quyết hết giờ: chỉ nhắc server kiểm tra (tối đa 1 lần/1,5 giây).
  const handleFlag = useCallback(() => {
    const now = performance.now();
    if (now - lastFlagRef.current < 1500) return;
    lastFlagRef.current = now;
    refresh();
  }, [refresh]);

  async function act(task: () => Promise<GameView>) {
    setBusy(true);
    setActionError(null);
    try {
      acceptView(await task());
    } catch (caught) {
      if (caught instanceof ApiError && SYNC_ERRORS.has(caught.code)) {
        refresh();
      } else {
        setActionError(caught instanceof Error ? caught.message : "Có lỗi xảy ra.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <Alert color="red" variant="light" title="Không tìm thấy ván cờ">
        <Text size="sm" mb="xs">
          Đường dẫn có thể sai hoặc ván đã bị xóa.
        </Text>
        <Button component={Link} href="/" size="xs" variant="default">
          Về sảnh
        </Button>
      </Alert>
    );
  }
  if (!view || !chess) {
    return error ? (
      <Alert color="red" variant="light" title="Không tải được ván cờ">
        <Text size="sm">{error}</Text>
      </Alert>
    ) : (
      <Group justify="center" py={80}>
        <Loader size="sm" />
      </Group>
    );
  }

  const side = view.viewer.side;
  const opponentSide: Color | null = side ? (side === "w" ? "b" : "w") : null;
  const opponent: PlayerInfo | null =
    opponentSide === "w" ? view.white : opponentSide === "b" ? view.black : null;

  // ---- Ván chưa bắt đầu ----
  if (view.status === "waiting") {
    const host = view.white ?? view.black;
    const hostSide = view.white ? "Trắng" : "Đen";
    return (
      <Paper withBorder p="lg" radius="md" bg="dark.6" maw={520} mx="auto">
        <Stack gap="md">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={700} fz="lg">
              {view.viewer.isCreator ? "Đang chờ đối thủ" : "Lời thách đấu"}
            </Text>
            <Group gap={6}>
              <Badge variant="light">{view.timeControl.label}</Badge>
              <Badge variant="light" color={view.rated ? "brand" : "gray"}>
                {view.rated ? "Xếp hạng" : "Giao hữu"}
              </Badge>
            </Group>
          </Group>

          {view.viewer.isCreator ? (
            <>
              <Text size="sm" c="dimmed">
                Bạn cầm quân {hostSide}. Gửi đường dẫn này cho bạn bè, hoặc chờ người
                khác nhận thách đấu trên sảnh.
              </Text>
              <Button
                variant="default"
                onClick={() => clipboard.copy(`${window.location.origin}/game/${view.id}`)}
              >
                {clipboard.copied ? "Đã sao chép" : "Sao chép đường dẫn"}
              </Button>
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Ván sẽ bắt đầu ngay khi có người tham gia.
                </Text>
              </Group>
              <Button
                variant="light"
                color="red"
                loading={busy}
                onClick={() => void act(() => gameApi.resign(view.id))}
              >
                Hủy thách đấu
              </Button>
            </>
          ) : (
            <>
              <Text size="sm">
                <b>{host?.name}</b> ({host?.rating} Elo) thách đấu bạn, họ cầm quân{" "}
                {hostSide}.
              </Text>
              {!view.rated ? (
                <Text size="xs" c="dimmed">
                  Ván giao hữu: không tính vào Elo.
                </Text>
              ) : null}
              <Button
                loading={busy}
                onClick={() =>
                  void act(async () => {
                    await ensureSession();
                    return gameApi.join(view.id);
                  })
                }
              >
                Tham gia ván
              </Button>
            </>
          )}
          {actionError ? (
            <Alert color="red" variant="light">
              {actionError}
            </Alert>
          ) : null}
        </Stack>
      </Paper>
    );
  }

  // Thách đấu đã bị hủy trước khi có đối thủ: không có bàn cờ để vẽ.
  if (!view.white || !view.black) {
    const result = describeResult(view);
    return (
      <Alert color="gray" variant="light" title={result?.title ?? "Ván đã hủy"}>
        <Text size="sm" mb="xs">
          {result?.text}
        </Text>
        <Button component={Link} href="/" size="xs">
          Về sảnh
        </Button>
      </Alert>
    );
  }

  // ---- Dữ liệu bàn cờ ----
  const turn = chess.turn();
  const board = chess.board();
  const history = chess.history({ verbose: true });
  const lastMove: Move | undefined = history[history.length - 1];
  const material = analyzeMaterial(board);
  const ongoing = view.status === "ongoing";
  const canMove = ongoing && side !== null && turn === side && !busy;
  const legalMoves = selected ? chess.moves({ square: selected, verbose: true }) : [];
  const legalTargets = legalMoves.map((move) => move.to);
  const checkedKingSquare = chess.isCheck() ? findKingSquare(board, turn) : null;
  const flipped = flipOverride ?? side === "b";
  const result = describeResult(view);

  function handleSquareClick(square: Square) {
    if (!canMove || !side || !chess) return;
    const target = legalMoves.find((move) => move.to === square);
    if (selected && target) {
      if (target.promotion) setPendingPromotion({ from: selected, to: square });
      else void submitMove(selected, square);
      return;
    }
    const piece = chess.get(square);
    setSelected(piece && piece.color === side ? square : null);
  }

  async function submitMove(from: Square, to: Square, promotion?: string) {
    if (!view) return;
    setSelected(null);
    setPendingPromotion(null);
    await act(() =>
      gameApi.move(view.id, { from, to, promotion, expectedPly: view.plyCount }),
    );
  }

  const topColor: Color = flipped ? "w" : "b";
  const bottomColor: Color = flipped ? "b" : "w";

  function renderBar(color: Color) {
    const info = color === "w" ? view!.white : view!.black;
    const clockMs = color === "w" ? view!.clocks.whiteMs : view!.clocks.blackMs;
    return (
      <PlayerBar
        name={info?.name ?? "Đối thủ"}
        tag={side === color ? "Bạn" : info?.isGuest ? "Khách" : ""}
        color={color}
        captured={material.capturedBy[color]}
        advantage={material.advantage[color]}
        active={ongoing && turn === color}
        thinking={false}
        rating={info?.rating}
        offline={view!.presence.offline[color]}
        clock={
          <ClockDisplay
            key={baselinePerf}
            remainingMs={clockMs}
            ticking={view!.clocks.ticking === color}
            baselinePerf={baselinePerf}
            active={ongoing && turn === color}
            onFlag={handleFlag}
          />
        }
      />
    );
  }

  const statusText = result
    ? result.text
    : side === null
      ? `Bạn đang xem ván này${view.delayMs ? ` (trễ ${Math.round(view.delayMs / 1000)} giây so với người chơi)` : ""}.`
      : chess.isCheck()
        ? turn === side
          ? "Bạn đang bị chiếu!"
          : `${opponent?.name ?? "Đối thủ"} đang bị chiếu.`
        : turn === side
          ? "Đến lượt bạn."
          : `Đến lượt ${opponent?.name ?? "đối thủ"}.`;

  const opponentOffline = opponentSide ? view.presence.offline[opponentSide] : false;
  const abandonSeconds = opponentSide
    ? Math.ceil((view.presence.abandonInMs[opponentSide] ?? 0) / 1000)
    : 0;
  const drawOfferedToMe = side !== null && view.drawOfferedBy === opponentSide;
  const drawOfferedByMe = side !== null && view.drawOfferedBy === side;
  const earlyEnd = view.plyCount < MIN_PLIES_FOR_RESULT;

  return (
    <>
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
            clickable={canMove}
            onSquareClick={handleSquareClick}
          />
          {renderBar(bottomColor)}
        </Stack>

        {/* ---- Cột thông tin bên phải ---- */}
        <Stack gap="sm" style={{ flex: "1 1 280px", maxWidth: 360, minWidth: 0 }}>
          <Paper withBorder p="md" radius="md" bg="dark.6">
            <Group justify="space-between" mb={6} wrap="nowrap">
              <Text fw={700}>
                {view.white.name} - {view.black.name}
              </Text>
            </Group>
            <Group gap={6} mb={8}>
              <Badge variant="light">{view.timeControl.label}</Badge>
              <Badge variant="light" color={view.rated ? "brand" : "gray"}>
                {view.rated ? "Xếp hạng" : "Giao hữu"}
              </Badge>
              {side === null ? (
                <Badge variant="light" color="blue">
                  Đang xem
                </Badge>
              ) : null}
            </Group>
            <Text size="sm" c="dimmed">
              {statusText}
            </Text>
          </Paper>

          {opponentOffline && ongoing ? (
            <Alert color="yellow" variant="light" title={`${opponent?.name} mất kết nối`}>
              <Text size="sm">
                Đồng hồ của họ đã dừng. Bạn thắng nếu họ không quay lại sau{" "}
                {abandonSeconds} giây.
              </Text>
            </Alert>
          ) : null}

          {drawOfferedToMe && ongoing ? (
            <Alert color="blue" variant="light" title="Đối thủ xin hòa">
              <Group gap="xs">
                <Button
                  size="xs"
                  loading={busy}
                  onClick={() => void act(() => gameApi.draw(view.id, "accept"))}
                >
                  Đồng ý hòa
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  disabled={busy}
                  onClick={() => void act(() => gameApi.draw(view.id, "decline"))}
                >
                  Từ chối
                </Button>
              </Group>
            </Alert>
          ) : null}

          {result ? (
            <Alert variant="light" color={result.color} title={result.title}>
              <Text size="sm" mb={result.elo ? 4 : "xs"}>
                {result.text}
              </Text>
              {result.elo ? (
                <Text size="sm" fw={600} mb="xs">
                  Elo: {result.elo}
                </Text>
              ) : null}
              <Button component={Link} href="/" size="xs">
                Về sảnh
              </Button>
            </Alert>
          ) : null}

          {actionError ? (
            <Alert color="red" variant="light" withCloseButton onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          ) : null}

          <MoveList sans={view.sans} />

          <SimpleGrid cols={2} spacing="xs">
            {side !== null && ongoing ? (
              <>
                <Button
                  variant="default"
                  disabled={busy || drawOfferedByMe || view.plyCount < 2}
                  onClick={() => void act(() => gameApi.draw(view.id, "offer"))}
                >
                  {drawOfferedByMe ? "Đã xin hòa" : "Xin hòa"}
                </Button>
                <Button
                  variant="light"
                  color="red"
                  disabled={busy}
                  onClick={() => {
                    if (!confirmResign) {
                      setConfirmResign(true);
                      return;
                    }
                    setConfirmResign(false);
                    void act(() => gameApi.resign(view.id));
                  }}
                  onBlur={() => setConfirmResign(false)}
                >
                  {confirmResign ? "Bấm lần nữa" : earlyEnd ? "Hủy ván" : "Xin thua"}
                </Button>
              </>
            ) : null}
            <Button
              variant="default"
              onClick={() => setFlipOverride(!flipped)}
              style={side !== null && ongoing ? undefined : { gridColumn: "1 / -1" }}
            >
              Lật bàn cờ
            </Button>
          </SimpleGrid>

          {side !== null && ongoing && earlyEnd ? (
            <Text size="xs" c="dimmed">
              Ván kết thúc trước {MIN_PLIES_FOR_RESULT} nước đi sẽ bị hủy và không tính Elo.
            </Text>
          ) : null}

          <Anchor component={Link} href="/" size="sm" c="dimmed">
            ← Về sảnh
          </Anchor>
        </Stack>
      </Box>

      <PromotionModal
        opened={pendingPromotion !== null}
        color={side ?? "w"}
        onCancel={() => setPendingPromotion(null)}
        onPick={(piece) =>
          pendingPromotion
            ? void submitMove(pendingPromotion.from, pendingPromotion.to, piece)
            : undefined
        }
      />
    </>
  );
}
