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

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await authClient.signUp.email({ name, email, password });

    setLoading(false);
    if (error) {
      setError(error.message ?? "Đăng ký thất bại");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Container size={420} my={40}>
      <Title ta="center" order={2}>
        Tạo tài khoản
      </Title>
      <Paper withBorder shadow="sm" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput
              label="Tên hiển thị"
              required
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <TextInput
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              label="Mật khẩu"
              description="Tối thiểu 8 ký tự"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={loading}>
              Đăng ký
            </Button>
            <Text size="sm" ta="center">
              Đã có tài khoản?{" "}
              <Anchor component={Link} href="/sign-in">
                Đăng nhập
              </Anchor>
            </Text>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
