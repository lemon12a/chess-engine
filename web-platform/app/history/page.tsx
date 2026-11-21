import { Container, Stack, Text, Title } from "@mantine/core";
import { HistoryList } from "@/components/history/HistoryList";

export default function HistoryPage() {
  return (
    <Container size="sm" py={40}>
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={1}>Lịch sử ván đấu</Title>
          <Text c="dimmed" size="sm">
            Mọi ván bạn đã chơi, với AI hay với người. Bấm vào một ván để xem lại từng
            nước đi.
          </Text>
        </Stack>
        <HistoryList />
      </Stack>
    </Container>
  );
}
