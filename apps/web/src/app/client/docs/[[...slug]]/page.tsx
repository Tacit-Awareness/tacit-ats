import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsView } from "@/components/docs/docs-view";
import { CLIENT_SITE, findDocPage } from "@/lib/docs";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";

// The tATS documentation, for a signed-in member of a client org. The
// pages are static, but a refused sign-in still gets the same refusal as
// every other client page rather than a page about a workspace it cannot use.

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findDocPage(CLIENT_SITE, (await params).slug);
  return { title: page ? `${page.title} · Tacit` : "Tacit" };
}

export default async function ClientDocsPage({ params }: Props) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const page = findDocPage(CLIENT_SITE, (await params).slug);
  if (!page) notFound();
  return <DocsView site={CLIENT_SITE} page={page} />;
}
