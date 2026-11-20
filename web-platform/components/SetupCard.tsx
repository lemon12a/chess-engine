"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { DEFAULT_LEVEL_ID, LEVELS, getLevel } from "@/lib/levels";
import { pieceSrc } from "@/lib/pieces";

type ColorChoice = "w" | "b" | "random";

function ColorLabel({ src, text }: { src?: string; text: string }) {
  return (
    <Group gap={6} justify="center" wrap="nowrap">
      {src ? (
        <span
          style={{
            display: "inline-flex",
            background: "#dcdcdc",
            borderRadius: 6,
            padding: 1,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" width={20} height={20} />
        </span>
      ) : null}
      <span>{text}</span>
    </Group>
  );
}

export function SetupCard() {
  const router = useRouter();
  const [colorChoice, setColorChoice] = useState<ColorChoice>("w");
  const [levelId, setLevelId] = useState<string>(DEFAULT_LEVEL_ID);
  const level = getLevel(levelId);

  function handleStart() {
    // "Ngẫu nhiên" được chốt thành màu cụ thể ngay lúc bấm, để tải lại trang
    // /play không bị đổi bên.
    const color =
      colorChoice === "random"
        ? Math.random() < 0.5
          ? "w"
          : "b"
        : colorChoice;
    router.push(`/play?color=${color}&level=${level.id}`);
  }

  return (
    <Paper withBorder p="lg" radius="md" bg="dark.6">
      <Stack gap="lg">
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Bạn cầm quân
          </Text>
          <SegmentedControl
            fullWidth
            value={colorChoice}
            onChange={(value) => setColorChoice(value as ColorChoice)}
            data={[
              {
                value: "w",
                label: <ColorLabel src={pieceSrc("w", "k")} text="Trắng" />,
              },
              {
                value: "b",
                label: <ColorLabel src={pieceSrc("b", "k")} text="Đen" />,
              },
              { value: "random", label: <ColorLabel text="Ngẫu nhiên" /> },
            ]}
          />
        </Stack>

        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Độ khó
          </Text>
          <SegmentedControl
            fullWidth
            value={levelId}
            onChange={setLevelId}
            data={LEVELS.map((item) => ({ value: item.id, label: item.label }))}
          />
          {level.elo ? (
            <Text size="xs" c="dimmed">
              Sức mạnh ước tính: ~{level.elo} Elo
            </Text>
          ) : null}
        </Stack>

        <Button size="md" onClick={handleStart}>
          Bắt đầu ván cờ
        </Button>
      </Stack>
    </Paper>
  );
}
