import { Container, Stack, Title } from "@mantine/core";
import { Lobby } from "@/components/lobby/Lobby";

export default function HomePage() {
  return (
    <Container size="xs" py={40}>
      <Stack gap="lg">
        <Title order={1} ta="center">
          Chơi cờ vua
        </Title>
        <Lobby />
      </Stack>
    </Container>
  );
}
