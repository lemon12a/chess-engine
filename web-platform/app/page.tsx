import { Button, Container, Stack, Title, Text } from "@mantine/core";

export default function HomePage() {
  return (
    <Container size="sm" py={80}>
      <Stack align="center" gap="md">
        <Title order={1}>♟️ Cờ Vua Online</Title>
        <Text c="dimmed">
          Nếu nút bên dưới có màu, bo góc, đổ bóng nhẹ khi hover — Mantine đã
          hoạt động đúng.
        </Text>
        <Button>Test Mantine Button</Button>
      </Stack>
    </Container>
  );
}