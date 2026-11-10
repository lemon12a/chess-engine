import { Container } from "@mantine/core";
import { ChessBoard } from "@/components/ChessBoard";
import { getLevel } from "@/lib/levels";

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ color?: string; level?: string }>;
}) {
  const { color, level } = await searchParams;
  const humanColor = color === "b" ? "b" : "w";
  const selectedLevel = getLevel(level);

  return (
    <Container size="lg" py="lg">
      {/* key: đổi màu/mức độ trên URL thì tạo lại bàn cờ từ đầu */}
      <ChessBoard
        key={`${humanColor}-${selectedLevel.id}`}
        humanColor={humanColor}
        simulations={selectedLevel.simulations}
        levelLabel={selectedLevel.label}
      />
    </Container>
  );
}
