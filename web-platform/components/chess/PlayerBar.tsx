import type { ReactNode } from "react";
import type { Color, PieceSymbol } from "chess.js";
import { Badge, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { pieceSrc } from "@/lib/pieces";

interface PlayerBarProps {
  name: string;
  tag: string;
  color: Color;
  captured: PieceSymbol[];
  advantage: number;
  active: boolean;
  thinking: boolean;
  /** Elo, hiện cạnh tên (chỉ ván giữa người với người). */
  rating?: number;
  /** Đồng hồ cờ, đặt bên phải. */
  clock?: ReactNode;
  /** Người chơi đang mất kết nối. */
  offline?: boolean;
}

export function PlayerBar({
  name,
  tag,
  color,
  captured,
  advantage,
  active,
  thinking,
  rating,
  clock,
  offline,
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
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
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
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text size="sm" fw={600} lh={1.2} truncate>
                {name}
              </Text>
              {rating !== undefined ? (
                <Text size="xs" c="dimmed" lh={1.2}>
                  {rating}
                </Text>
              ) : null}
              {tag ? (
                <Text size="xs" c="dimmed" lh={1.2}>
                  {tag}
                </Text>
              ) : null}
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
        <Group gap="xs" wrap="nowrap">
          {offline ? (
            <Badge variant="light" color="yellow" size="sm">
              Mất kết nối
            </Badge>
          ) : null}
          {thinking ? (
            <Badge variant="light" size="sm">
              Đang suy nghĩ…
            </Badge>
          ) : null}
          {clock}
        </Group>
      </Group>
    </Paper>
  );
}
