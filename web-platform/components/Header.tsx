"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Container, Group, Text } from "@mantine/core";
import { authClient } from "@/auth-client";

export function Header() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  async function handleSignOut() {
    await authClient.signOut();
    router.refresh();
  }

  return (
    <Container size="md" py="sm">
      <Group justify="space-between">
        <Text
          component={Link}
          href="/"
          fw={700}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          ♟️ Cờ Vua Online
        </Text>

        {isPending ? null : session ? (
          <Group gap="sm">
            <Text size="sm">Xin chào, {session.user.name}</Text>
            <Button variant="default" size="xs" onClick={handleSignOut}>
              Đăng xuất
            </Button>
          </Group>
        ) : (
          <Group gap="xs">
            <Button
              component={Link}
              href="/sign-in"
              variant="default"
              size="xs"
            >
              Đăng nhập
            </Button>
            <Button component={Link} href="/sign-up" size="xs">
              Đăng ký
            </Button>
          </Group>
        )}
      </Group>
    </Container>
  );
}
