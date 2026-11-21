"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { historyApi } from "@/lib/game/api";
import type { HistoryFilter, HistoryItem } from "@/lib/game/historyTypes";
import {
  OUTCOME_COLOR,
  OUTCOME_LABEL,
  REASON_LABEL,
  formatPlayedAt,
  moveCount,
  signed,
} from "@/lib/game/historyLabels";

function HistoryRow({ item }: { item: HistoryItem }) {
  const details = [
    item.kind === "ai" ? `AI · ${item.levelLabel}` : "Người chơi",
    item.timeControl,
    item.rated === null ? null : item.rated ? "Xếp hạng" : "Giao hữu",
    `${moveCount(item.plyCount)} nước`,
  ].filter(Boolean);
  const reason = item.reason && item.outcome !== "unfinished" ? REASON_LABEL[item.reason] : null;
  const elo =
    item.ratingBefore !== null && item.ratingAfter !== null
      ? `${item.ratingAfter} (${signed(item.ratingAfter - item.ratingBefore)})`
      : null;

  return (
    <Paper
      component={Link}
      href={`/history/${item.kind}/${item.id}`}
      withBorder
      radius="md"
      p="sm"
      bg="dark.6"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Badge
            color={OUTCOME_COLOR[item.outcome]}
            variant="light"
            w={84}
            style={{ flexShrink: 0 }}
          >
            {OUTCOME_LABEL[item.outcome]}
          </Badge>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>
              {item.myColor === "w" ? "Trắng" : "Đen"} · vs {item.opponent.name}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {details.join(" · ")}
              {reason ? ` · ${reason}` : ""}
            </Text>
          </Stack>
        </Group>
        <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
          {elo ? (
            <Text size="sm" fw={600}>
              {elo}
            </Text>
          ) : null}
          <Text size="xs" c="dimmed">
            {formatPlayedAt(item.endedAt)}
          </Text>
        </Stack>
      </Group>
    </Paper>
  );
}

export function HistoryList() {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (nextFilter: HistoryFilter, offset: number) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await historyApi.list(nextFilter, offset, controller.signal);
      if (controller.signal.aborted) return;
      setItems((previous) => (offset === 0 ? page.items : [...previous, ...page.items]));
      setHasMore(page.hasMore);
      setIsGuest(page.isGuest);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Có lỗi xảy ra.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // setTimeout: tránh gọi setState đồng bộ trong effect (giống ChessBoard).
    const timer = setTimeout(() => void load(filter, 0), 0);
    return () => {
      clearTimeout(timer);
      controllerRef.current?.abort();
    };
  }, [filter, load]);

  return (
    <Stack gap="md">
      {isGuest ? (
        <Alert color="yellow" variant="light" title="Bạn đang chơi với tư cách khách">
          <Text size="sm">
            Lịch sử này gắn với tài khoản khách trên trình duyệt này.{" "}
            <Anchor component={Link} href="/sign-up" size="sm">
              Đăng ký
            </Anchor>{" "}
            để giữ lại các ván đã chơi và xem được trên mọi thiết bị.
          </Text>
        </Alert>
      ) : null}

      <SegmentedControl
        fullWidth
        value={filter}
        onChange={(value) => setFilter(value as HistoryFilter)}
        data={[
          { value: "all", label: "Tất cả" },
          { value: "ai", label: "Với AI" },
          { value: "pvp", label: "Với người" },
        ]}
      />

      {error ? (
        <Alert color="red" variant="light" title="Không tải được lịch sử">
          <Text size="sm" mb="xs">
            {error}
          </Text>
          <Button size="xs" variant="default" onClick={() => void load(filter, 0)}>
            Thử lại
          </Button>
        </Alert>
      ) : null}

      {items.length === 0 && !loading && !error ? (
        <Paper withBorder radius="md" p="lg" bg="dark.6">
          <Text size="sm" c="dimmed" ta="center" mb="sm">
            Chưa có ván nào trong mục này. Chơi một ván để nó xuất hiện ở đây.
          </Text>
          <Group justify="center">
            <Button component={Link} href="/" size="xs">
              Chơi ngay
            </Button>
          </Group>
        </Paper>
      ) : null}

      <Stack gap="xs">
        {items.map((item) => (
          <HistoryRow key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </Stack>

      {loading ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : hasMore ? (
        <Button variant="default" onClick={() => void load(filter, items.length)}>
          Tải thêm
        </Button>
      ) : null}
    </Stack>
  );
}
