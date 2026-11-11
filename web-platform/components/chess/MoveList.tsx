"use client";

import { useEffect, useRef } from "react";
import { Box, Paper, ScrollArea, Stack, Text } from "@mantine/core";

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

// `sans`: danh sách nước đi dạng SAN theo thứ tự (Trắng, Đen, Trắng, ...).
export function MoveList({ sans }: { sans: string[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);

  // Tự cuộn xuống cuối khi có nước mới (hoặc khi hoàn tác)
  useEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [sans.length]);

  const pairs: { num: number; white?: string; black?: string }[] = [];
  sans.forEach((san, index) => {
    if (index % 2 === 0) pairs.push({ num: index / 2 + 1, white: san });
    else pairs[pairs.length - 1].black = san;
  });
  const lastPly = sans.length - 1;

  return (
    <Paper withBorder radius="md" bg="dark.6">
      <Text size="sm" fw={600} px="md" pt="sm" pb={4}>
        Nước đi
      </Text>
      <ScrollArea h={240} viewportRef={viewportRef} px="md" pb="sm">
        {pairs.length === 0 ? (
          <Text size="sm" c="dimmed">
            Chưa có nước đi nào.
          </Text>
        ) : (
          <Stack gap={2}>
            {pairs.map((pair, index) => (
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
                <MoveCell san={pair.black} active={lastPly === index * 2 + 1} />
              </Box>
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Paper>
  );
}
