import { Container, Stack, Text, Title } from "@mantine/core";
import { SetupCard } from "@/components/SetupCard";

export default function HomePage() {
  return (
    <Container size="xs" py={60}>
      <Stack gap="lg">
        <Stack gap={4} align="center">
          <Title order={1} ta="center">
            Chơi cờ vua với AI
          </Title>
          {/* <Text c="dimmed" ta="center" size="sm">
            Đối thủ là mô hình tự học bằng self-play (kiểu AlphaZero) do chính
            bạn huấn luyện.
          </Text> */}
        </Stack>
        <SetupCard />
      </Stack>
    </Container>
  );
}
