"use client";

import type { Color, PieceSymbol } from "chess.js";
import { Group, Modal, UnstyledButton } from "@mantine/core";
import { pieceSrc } from "@/lib/pieces";

const CHOICES: { type: PieceSymbol; label: string }[] = [
  { type: "q", label: "Hậu" },
  { type: "r", label: "Xe" },
  { type: "b", label: "Tượng" },
  { type: "n", label: "Mã" },
];

interface PromotionModalProps {
  opened: boolean;
  color: Color;
  onPick: (piece: "q" | "r" | "b" | "n") => void;
  onCancel: () => void;
}

export function PromotionModal({ opened, color, onPick, onCancel }: PromotionModalProps) {
  return (
    <Modal opened={opened} onClose={onCancel} title="Phong cấp thành" centered size="sm">
      <Group justify="center" gap="sm">
        {CHOICES.map((choice) => (
          <UnstyledButton
            key={choice.type}
            aria-label={choice.label}
            title={choice.label}
            onClick={() => onPick(choice.type as "q" | "r" | "b" | "n")}
            style={{
              background: "#dcdcdc",
              borderRadius: 10,
              padding: 6,
              lineHeight: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pieceSrc(color, choice.type)} alt={choice.label} width={64} height={64} />
          </UnstyledButton>
        ))}
      </Group>
    </Modal>
  );
}
