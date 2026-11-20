"use client";

import { useEffect, useState } from "react";
import { Box, Text } from "@mantine/core";
import { formatClock } from "@/lib/game/timeControls";

interface ClockDisplayProps {
  /** Thời gian còn lại do server tính tại thời điểm `baselinePerf`. */
  remainingMs: number;
  ticking: boolean;
  baselinePerf: number;
  /** Đến lượt bên này (để làm nổi bật). */
  active: boolean;
  /** Gọi khi đồng hồ hiển thị về 0, để hỏi server xác nhận. Máy khách không tự quyết thua. */
  onFlag: () => void;
}

// Cha dùng `key={baselinePerf}` để dựng lại component mỗi khi có số liệu mới từ server.
export function ClockDisplay({
  remainingMs,
  ticking,
  baselinePerf,
  active,
  onFlag,
}: ClockDisplayProps) {
  const [nowPerf, setNowPerf] = useState(baselinePerf);

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNowPerf(performance.now()), 100);
    return () => clearInterval(timer);
  }, [ticking]);

  const shown = ticking
    ? Math.max(0, remainingMs - (nowPerf - baselinePerf))
    : remainingMs;
  const flagged = ticking && shown <= 0;

  useEffect(() => {
    if (flagged) onFlag();
  }, [flagged, onFlag]);

  const low = shown < 10_000;
  return (
    <Box
      px="sm"
      py={4}
      style={{
        minWidth: 92,
        textAlign: "center",
        borderRadius: 8,
        background: "var(--mantine-color-dark-8)",
        border: `2px solid ${
          ticking && low
            ? "var(--mantine-color-red-6)"
            : active
              ? "var(--mantine-color-brand-6)"
              : "var(--mantine-color-dark-4)"
        }`,
      }}
    >
      <Text
        ff="monospace"
        fw={700}
        fz={24}
        lh={1.2}
        c={ticking && low ? "red.4" : active ? "dark.0" : "dark.2"}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatClock(shown)}
      </Text>
    </Box>
  );
}
