"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
} from "@mantine/core";
import { SetupCard } from "@/components/SetupCard";
import { ensureSession } from "@/lib/auth-client";
import { ApiError, gameApi, matchApi } from "@/lib/game/api";
import {
  DEFAULT_TIME_CONTROL_ID,
  TIME_CONTROLS,
  getTimeControl,
} from "@/lib/game/timeControls";
import type { MeInfo, OpenChallenge } from "@/lib/game/types";

type ColorChoice = "w" | "b" | "random";

export function Lobby() {
  const router = useRouter();
  const [me, setMe] = useState<MeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- Ghép trận ----
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ waitedMs: 0, windowElo: 0 });

  // ---- Tạo thách đấu ----
  const [tcId, setTcId] = useState<string>(DEFAULT_TIME_CONTROL_ID);
  const [color, setColor] = useState<ColorChoice>("random");
  const [rated, setRated] = useState(true);
  const [isPublic, setIsPublic] = useState(true);

  // ---- Thách đấu đang mở ----
  const [challenges, setChallenges] = useState<OpenChallenge[]>([]);

  const reloadMe = useCallback(async () => {
    try {
      setMe(await gameApi.me());
    } catch {
      // Không tải được thông tin cá nhân thì sảnh vẫn dùng được.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    gameApi
      .me()
      .then((info) => {
        if (!cancelled) setMe(info);
      })
      .catch(() => {
        // Không tải được thông tin cá nhân thì sảnh vẫn dùng được.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Làm mới danh sách thách đấu mỗi 3 giây.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const list = await gameApi.openChallenges();
        if (!cancelled) setChallenges(list);
      } catch {
        // lần sau thử lại
      }
      if (!cancelled) timer = setTimeout(() => void load(), 3000);
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Trong lúc tìm trận: hỏi server mỗi giây (vừa giữ chỗ trong hàng chờ, vừa thử ghép).
  useEffect(() => {
    if (!searchingId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const status = await matchApi.status();
        if (cancelled) return;
        if (status.state === "matched") {
          router.push(`/game/${status.gameId}`);
          return;
        }
        if (status.state === "idle") {
          setSearchingId(null);
          return;
        }
        setProgress({ waitedMs: status.waitedMs, windowElo: status.windowElo });
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Có lỗi xảy ra.");
        setSearchingId(null);
        return;
      }
      timer = setTimeout(() => void tick(), 1000);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [searchingId, router]);

  /** Chạy một thao tác cần tài khoản: tự vào bằng khách nếu chưa có phiên. */
  async function withSession(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      await task();
      void reloadMe();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "already_in_game") {
        const gameId = caught.data?.gameId;
        if (typeof gameId === "string") {
          router.push(`/game/${gameId}`);
          return;
        }
      }
      setError(caught instanceof Error ? caught.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(false);
    }
  }

  const startSearch = (timeControlId: string) =>
    withSession(async () => {
      const status = await matchApi.join(timeControlId);
      if (status.state === "matched") router.push(`/game/${status.gameId}`);
      else setSearchingId(timeControlId);
    });

  async function cancelSearch() {
    setSearchingId(null);
    try {
      await matchApi.leave();
    } catch {
      // Mục chờ tự hết hạn sau vài giây dù không hủy được.
    }
  }

  const createChallenge = () =>
    withSession(async () => {
      const id = await gameApi.create({ timeControlId: tcId, color, rated, isPublic });
      router.push(`/game/${id}`);
    });

  const acceptChallenge = (id: string) =>
    withSession(async () => {
      await gameApi.join(id);
      router.push(`/game/${id}`);
    });

  const searchingTc = searchingId ? getTimeControl(searchingId) : undefined;

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" c="dimmed">
          {me?.user
            ? `${me.user.name}${me.user.isGuest ? " (khách)" : ""}`
            : "Bạn sẽ chơi với tư cách khách"}
        </Text>
        <Badge variant="light" size="lg">
          {me?.rating ?? 1000} Elo
        </Badge>
      </Group>

      {me?.activeGameId ? (
        <Alert color="brand" variant="light" title="Bạn đang có một ván chưa kết thúc">
          <Button component={Link} href={`/game/${me.activeGameId}`} size="xs">
            Quay lại ván cờ
          </Button>
        </Alert>
      ) : me?.waitingGameId ? (
        <Alert color="brand" variant="light" title="Bạn có một thách đấu đang chờ">
          <Button component={Link} href={`/game/${me.waitingGameId}`} size="xs">
            Xem thách đấu
          </Button>
        </Alert>
      ) : null}

      {error ? (
        <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Tabs defaultValue="human" keepMounted={false}>
        <Tabs.List grow mb="md">
          <Tabs.Tab value="human">Chơi với người</Tabs.Tab>
          <Tabs.Tab value="ai">Chơi với AI</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="human">
          <Stack gap="md">
            <Paper withBorder p="lg" radius="md" bg="dark.6">
              <Stack gap="sm">
                <Text fw={600}>Ghép trận nhanh</Text>
                {searchingTc ? (
                  <Stack gap="sm" align="center" py="md">
                    <Loader size="sm" />
                    <Text>
                      Đang tìm đối thủ {searchingTc.label}…{" "}
                      {Math.floor(progress.waitedMs / 1000)} giây
                    </Text>
                    {progress.windowElo > 0 ? (
                      <Text size="xs" c="dimmed">
                        Chênh lệch Elo cho phép: ±{progress.windowElo}
                      </Text>
                    ) : null}
                    <Button variant="default" onClick={() => void cancelSearch()}>
                      Hủy tìm trận
                    </Button>
                  </Stack>
                ) : (
                  <>
                    <Text size="sm" c="dimmed">
                      Ván xếp hạng, tính vào Elo. Hệ thống ghép bạn với người có Elo gần nhất.
                    </Text>
                    <SimpleGrid cols={{ base: 2, xs: 3 }} spacing="xs">
                      {TIME_CONTROLS.map((tc) => (
                        <Button
                          key={tc.id}
                          variant="default"
                          h="auto"
                          py="sm"
                          disabled={busy}
                          onClick={() => void startSearch(tc.id)}
                        >
                          <Stack gap={0} align="center">
                            <Text fw={700} fz="lg" lh={1.2}>
                              {tc.label}
                            </Text>
                            <Text size="xs" c="dimmed" fw={400}>
                              {tc.kind}
                            </Text>
                          </Stack>
                        </Button>
                      ))}
                    </SimpleGrid>
                  </>
                )}
              </Stack>
            </Paper>

            <Paper withBorder p="lg" radius="md" bg="dark.6">
              <Stack gap="sm">
                <Text fw={600}>Tạo thách đấu</Text>
                <Select
                  label="Thể thức"
                  value={tcId}
                  onChange={(value) => value && setTcId(value)}
                  allowDeselect={false}
                  data={TIME_CONTROLS.map((tc) => ({
                    value: tc.id,
                    label: `${tc.label} · ${tc.kind}`,
                  }))}
                />
                <Stack gap={6}>
                  <Text size="sm" fw={500}>
                    Bạn cầm quân
                  </Text>
                  <SegmentedControl
                    fullWidth
                    value={color}
                    onChange={(value) => setColor(value as ColorChoice)}
                    data={[
                      { value: "w", label: "Trắng" },
                      { value: "b", label: "Đen" },
                      { value: "random", label: "Ngẫu nhiên" },
                    ]}
                  />
                </Stack>
                <Switch
                  checked={rated}
                  onChange={(event) => setRated(event.currentTarget.checked)}
                  label="Tính vào Elo"
                  description={rated ? "Ván xếp hạng" : "Ván giao hữu, không đổi Elo"}
                />
                <Switch
                  checked={isPublic}
                  onChange={(event) => setIsPublic(event.currentTarget.checked)}
                  label="Hiện trên sảnh"
                  description={isPublic ? "Ai cũng nhận được" : "Chỉ người có đường dẫn"}
                />
                <Button loading={busy} onClick={() => void createChallenge()}>
                  Tạo thách đấu
                </Button>
              </Stack>
            </Paper>

            <Paper withBorder p="lg" radius="md" bg="dark.6">
              <Stack gap="xs">
                <Text fw={600}>Thách đấu đang mở</Text>
                {challenges.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Chưa có ai đang chờ. Hãy tạo một thách đấu hoặc ghép trận nhanh.
                  </Text>
                ) : (
                  challenges.map((challenge) => (
                    <Group
                      key={challenge.id}
                      justify="space-between"
                      wrap="nowrap"
                      py={4}
                    >
                      <Stack gap={0} style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600} truncate>
                          {challenge.creator.name}{" "}
                          <Text span c="dimmed" fw={400}>
                            {challenge.creator.rating}
                          </Text>
                        </Text>
                        <Text size="xs" c="dimmed">
                          {challenge.timeControl} ·{" "}
                          {challenge.rated ? "Xếp hạng" : "Giao hữu"} · họ cầm{" "}
                          {challenge.creatorSide === "w" ? "Trắng" : "Đen"}
                        </Text>
                      </Stack>
                      <Button
                        size="xs"
                        disabled={busy}
                        onClick={() => void acceptChallenge(challenge.id)}
                      >
                        Chơi
                      </Button>
                    </Group>
                  ))
                )}
              </Stack>
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="ai">
          <SetupCard />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
