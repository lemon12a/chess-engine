// "Độ mạnh" của AI = số lần mô phỏng MCTS mỗi nước đi.
// Số càng cao thì AI tìm kiếm càng sâu nhưng suy nghĩ càng lâu.
export const LEVELS = [
  { id: "1", label: "Nhanh", simulations: 10 },
  { id: "2", label: "Vừa", simulations: 40 },
  { id: "3", label: "Sâu", simulations: 100 },
  { id: "4", label: "Rất sâu", simulations: 200 },
] as const;

export const DEFAULT_LEVEL_ID = "2";

export function getLevel(id?: string) {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[1];
}
