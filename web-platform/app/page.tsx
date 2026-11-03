import { Container, Stack } from "@mantine/core";
import { ChessBoard } from "@/components/ChessBoard";

export default function HomePage() {
  return (
    <Container size="sm" py={40}>
      <Stack align="center" gap="xl">
        <ChessBoard />
      </Stack>
    </Container>
  );
}
