import { Container, Stack, Text, Title } from "@mantine/core";
import { WatchList } from "@/components/watch/WatchList";

export default function WatchPage() {
  return (
    <Container size="sm" py={40}>
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={1}>Xem trực tiếp</Title>
          <Text c="dimmed" size="sm">
            Các ván đang diễn ra, xếp theo Elo trung bình. Hình ảnh trễ vài giây so
            với người chơi để không ai nhờ khán giả mách nước.
          </Text>
        </Stack>
        <WatchList />
      </Stack>
    </Container>
  );
}
