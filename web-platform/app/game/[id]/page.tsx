import { Container } from "@mantine/core";
import { GameRoom } from "@/components/game/GameRoom";

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Container size="lg" py="lg">
      {/* key: đổi ván trên URL thì dựng lại toàn bộ trạng thái */}
      <GameRoom key={id} gameId={id} />
    </Container>
  );
}
