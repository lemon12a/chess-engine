"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Avatar,
  Box,
  Burger,
  Button,
  Container,
  Divider,
  Drawer,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { authClient } from "@/lib/auth-client";

type NavItem = { label: string; href: string; soon?: boolean };

// Mục có `soon: true` chưa có trang thật. Làm xong trang nào thì xoá `soon` ở mục đó.
const NAV_ITEMS: NavItem[] = [
  { label: "Chơi", href: "/" },
  { label: "Xem trực tiếp", href: "/watch", soon: true },
  { label: "Lịch sử ván đấu", href: "/history", soon: true },
  { label: "Mô hình AI", href: "/model", soon: true },
];

function renderNavItems(
  pathname: string,
  options: { onNavigate?: () => void; fullWidth?: boolean } = {},
) {
  const { onNavigate, fullWidth } = options;
  const justify = fullWidth ? "flex-start" : "center";

  return NAV_ITEMS.map((item) => {
    if (item.soon) {
      return (
        <Tooltip key={item.href} label="Sắp có" position="bottom">
          <Button
            component="span"
            size="sm"
            variant="subtle"
            color="gray"
            fullWidth={fullWidth}
            justify={justify}
            aria-disabled="true"
            style={{ opacity: 0.45, cursor: "not-allowed" }}
          >
            {item.label}
          </Button>
        </Tooltip>
      );
    }

    const active =
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

    return (
      <Button
        key={item.href}
        component={Link}
        href={item.href}
        onClick={onNavigate}
        size="sm"
        variant={active ? "light" : "subtle"}
        color={active ? "brand" : "gray"}
        fullWidth={fullWidth}
        justify={justify}
      >
        {item.label}
      </Button>
    );
  });
}

function Brand() {
  return (
    <UnstyledButton component={Link} href="/" aria-label="Trang chủ">
      <Group gap={8} wrap="nowrap">
        {/* Logo dùng quân Mã bộ cburnett. Đổi đường dẫn nếu bạn dùng bộ quân khác */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pieces/cburnett/wN.svg" alt="" width={32} height={32} />
        <Text fw={800} fz={20} lh={1}>
          Cờ Vua Online
        </Text>
      </Group>
    </UnstyledButton>
  );
}

function UserMenu({
  name,
  onSignOut,
}: {
  name: string;
  onSignOut: () => void;
}) {
  return (
    <Menu position="bottom-end" width={200} shadow="md">
      <Menu.Target>
        <UnstyledButton aria-label="Menu tài khoản">
          <Group gap="xs" wrap="nowrap">
            <Avatar color="brand" radius="xl" size={34}>
              {name.charAt(0).toUpperCase()}
            </Avatar>
            <Text size="sm" fw={500}>
              {name}
            </Text>
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Tài khoản</Menu.Label>
        <Menu.Item disabled>Hồ sơ (sắp có)</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" onClick={onSignOut}>
          Đăng xuất
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const [drawerOpened, { toggle, close }] = useDisclosure(false);

  async function handleSignOut() {
    await authClient.signOut();
    close();
    router.refresh();
  }

  return (
    <>
      <Box
        component="header"
        bg="dark.8"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          borderBottom: "1px solid var(--mantine-color-dark-4)",
        }}
      >
        <Container size="lg" h={60}>
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="md" wrap="nowrap">
              <Burger
                opened={drawerOpened}
                onClick={toggle}
                hiddenFrom="sm"
                size="sm"
                aria-label="Mở menu"
              />
              <Brand />
              <Group gap={4} wrap="nowrap" visibleFrom="sm" ml="md">
                {renderNavItems(pathname)}
              </Group>
            </Group>

            <Group gap="xs" wrap="nowrap" visibleFrom="sm">
              {isPending ? null : session ? (
                <UserMenu name={session.user.name} onSignOut={handleSignOut} />
              ) : (
                <>
                  <Button
                    component={Link}
                    href="/sign-in"
                    size="sm"
                    variant="default"
                  >
                    Đăng nhập
                  </Button>
                  <Button component={Link} href="/sign-up" size="sm">
                    Đăng ký
                  </Button>
                </>
              )}
            </Group>
          </Group>
        </Container>
      </Box>

      {/* Menu cho màn hình nhỏ */}
      <Drawer
        opened={drawerOpened}
        onClose={close}
        size="xs"
        padding="md"
        title="Menu"
      >
        <Stack gap={4}>
          {renderNavItems(pathname, { onNavigate: close, fullWidth: true })}
          <Divider my="sm" />
          {isPending ? null : session ? (
            <>
              <Text size="sm" c="dimmed">
                Đang đăng nhập: {session.user.name}
              </Text>
              <Button variant="default" onClick={handleSignOut} fullWidth>
                Đăng xuất
              </Button>
            </>
          ) : (
            <>
              <Button
                component={Link}
                href="/sign-in"
                variant="default"
                onClick={close}
                fullWidth
              >
                Đăng nhập
              </Button>
              <Button
                component={Link}
                href="/sign-up"
                onClick={close}
                fullWidth
              >
                Đăng ký
              </Button>
            </>
          )}
        </Stack>
      </Drawer>
    </>
  );
}
