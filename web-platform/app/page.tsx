import { Container, Stack, Title } from "@mantine/core";
import { ChessBoard } from "@/components/ChessBoard";

export default function HomePage() {
  return (
    <Container size="sm" py={40}>
      <Stack align="center" gap="xl">
        <Title order={1}>♟️ Cờ Vua Online</Title>
        <ChessBoard />
      </Stack>
    </Container>
  );
}