"use client";

import { useEffect, useRef } from "react";
import { Box, Paper, ScrollArea, Stack, Text } from "@mantine/core";

function MoveCell({
  san,
  active,
  onClick,
}: {
  san?: string;
  active: boolean;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick && san);
  return (
    <Text
      size="sm"
      px={6}
      py={2}
      data-active={active || undefined}
      role={clickable ? "button" : undefined}
      onClick={clickable ? onClick : undefined}
      style={{
        borderRadius: 4,
        fontWeight: active ? 700 : 400,
        background: active ? "var(--mantine-color-dark-4)" : undefined,
        cursor: clickable ? "pointer" : undefined,
      }}
    >
      {san ?? ""}
    </Text>
  );
}

interface MoveListProps {
  /** Danh sách nước đi dạng SAN theo thứ tự (Trắng, Đen, Trắng, ...). */
  sans: string[];
  /** Số nửa nước đang hiển thị trên bàn cờ (0..sans.length). Mặc định: nước cuối cùng. */
  activePly?: number;
  /** Có hàm này thì mỗi nước bấm được; nhận số nửa nước muốn xem (1..sans.length). */
  onSelect?: (ply: number) => void;
}

export function MoveList({ sans, activePly, onSelect }: MoveListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const shownPly = activePly ?? sans.length;

  // Giữ nước đang xem trong tầm nhìn (khi có nước mới, hoàn tác hoặc bấm ◀ ▶).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const cell = viewport.querySelector<HTMLElement>('[data-active="true"]');
    if (!cell) {
      viewport.scrollTop = 0;
      return;
    }
    const cellBox = cell.getBoundingClientRect();
    const viewBox = viewport.getBoundingClientRect();
    if (cellBox.top < viewBox.top)
      viewport.scrollTop -= viewBox.top - cellBox.top;
    else if (cellBox.bottom > viewBox.bottom)
      viewport.scrollTop += cellBox.bottom - viewBox.bottom;
  }, [shownPly, sans.length]);

  const pairs: { num: number; white?: string; black?: string }[] = [];
  sans.forEach((san, index) => {
    if (index % 2 === 0) pairs.push({ num: index / 2 + 1, white: san });
    else pairs[pairs.length - 1].black = san;
  });
  const activeIndex = shownPly - 1;

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
                <MoveCell
                  san={pair.white}
                  active={activeIndex === index * 2}
                  onClick={onSelect ? () => onSelect(index * 2 + 1) : undefined}
                />
                <MoveCell
                  san={pair.black}
                  active={activeIndex === index * 2 + 1}
                  onClick={onSelect ? () => onSelect(index * 2 + 2) : undefined}
                />
              </Box>
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Paper>
  );
}
