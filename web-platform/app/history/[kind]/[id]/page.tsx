import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Container } from "@mantine/core";
import { ReplayView } from "@/components/history/ReplayView";
import { auth } from "@/lib/auth";
import { getReplay } from "@/lib/game/history";

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (kind !== "ai" && kind !== "pvp") notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  const data = await getReplay(kind, id, session?.user.id ?? null);
  if (!data) notFound();

  return (
    <Container size="lg" py={24}>
      <ReplayView data={data} />
    </Container>
  );
}
