"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { gameApi } from "@/lib/game/api";
import type { LiveGameSummary } from "@/lib/game/types";

type Player = LiveGameSummary["white"];

function PlayerLine({ player, fallback }: { player: Player; fallback: string }) {
  return (
    <Text size="sm" fw={600} truncate>
      {player?.name ?? fallback}{" "}
      <Text span c="dimmed" fw={400}>
        {player?.rating}
      </Text>
    </Text>
  );
}

export function WatchList() {
  const [games, setGames] = useState<LiveGameSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const list = await gameApi.live();
        if (!cancelled) setGames(list);
      } catch {
        // lần sau thử lại
      }
      if (!cancelled) timer = setTimeout(() => void load(), 5000);
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (games === null) {
    return (
      <Text size="sm" c="dimmed">
        Đang tải…
      </Text>
    );
  }
  if (games.length === 0) {
    return (
      <Paper withBorder p="lg" radius="md" bg="dark.6">
        <Text size="sm" c="dimmed">
          Hiện chưa có ván nào đang diễn ra. Ván mới sẽ hiện ở đây ngay khi bắt đầu.
        </Text>
      </Paper>
    );
  }
  return (
    <Stack gap="xs">
      {games.map((game) => (
        <Paper key={game.id} withBorder p="sm" radius="md" bg="dark.6">
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <PlayerLine player={game.white} fallback="Trắng" />
              <PlayerLine player={game.black} fallback="Đen" />
              <Group gap={6}>
                <Badge variant="light" size="sm">
                  {game.timeControl}
                </Badge>
                <Badge variant="light" size="sm" color={game.rated ? "brand" : "gray"}>
                  {game.rated ? "Xếp hạng" : "Giao hữu"}
                </Badge>
                <Text size="xs" c="dimmed">
                  {Math.ceil(game.plyCount / 2)} nước
                </Text>
              </Group>
            </Stack>
            <Button component={Link} href={`/game/${game.id}`} size="xs" variant="light">
              Xem
            </Button>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
