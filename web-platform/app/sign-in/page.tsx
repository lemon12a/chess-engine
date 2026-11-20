"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Anchor,
  Button,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await authClient.signIn.email({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message ?? "Đăng nhập thất bại");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Container size={420} my={40}>
      <Title ta="center" order={2}>
        Đăng nhập
      </Title>
      <Paper withBorder shadow="sm" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              label="Mật khẩu"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={loading}>
              Đăng nhập
            </Button>
            <Text size="sm" ta="center">
              Chưa có tài khoản?{" "}
              <Anchor component={Link} href="/sign-up">
                Đăng ký
              </Anchor>
            </Text>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
