export interface Level {
  id: string;
  label: string;
  /** Chỉ dùng nội bộ để gọi AI service, KHÔNG hiển thị trên giao diện. */
  simulations: number;
  /** Elo ước tính. Điền vào khi đã đo được, giao diện sẽ tự hiện. */
  elo?: number;
}

export const LEVELS: readonly Level[] = [
  { id: "1", label: "Dễ", simulations: 10 },
  { id: "2", label: "Vừa", simulations: 40 },
  { id: "3", label: "Khó", simulations: 100 },
  { id: "4", label: "Rất khó", simulations: 200 },
];

export const DEFAULT_LEVEL_ID = "2";

export function getLevel(id?: string): Level {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[1];
}

// Toàn bộ tham số gửi kèm yêu cầu /ai-move nằm ở đây. Khi hợp đồng API của mô
// hình thay đổi (bỏ simulations, dùng elo...), chỉ cần sửa đúng hàm này.
export function getAiParams(levelId?: string) {
  const { simulations } = getLevel(levelId);
  return { simulations };
}