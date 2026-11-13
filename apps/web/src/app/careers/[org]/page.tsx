import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CareersFrame } from "@/components/careers/frame";
import { landingChannel, withVia } from "@/lib/public/channel";
import { readJobBoard, readOrgBrand } from "@/lib/public/jobs";
import { Roles } from "./roles";

// A client's public careers page (design/careers's board): its live posts by
// team. Public on purpose: proxy.ts runs only under /client, and the only
// database access is lib/public/jobs.ts as anon. An org that is not a client
// and one with no live post are the same 404. Kept out of search engines, as
// the posts are, until a company asks to be found. Someone who lands here from
// LinkedIn is still from LinkedIn on the post, so its links carry the channel
// (lib/public/channel.ts).

const board = cache(readJobBoard);

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ org: string }> }): Promise<Metadata> {
  const read = await board((await params).org);
  return { title: read ? `Careers at ${read.company}` : "Careers", robots: { index: false, follow: false } };
}

export default async function CareersPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org } = await params;
  const [read, brand] = await Promise.all([board(org), readOrgBrand(org)]);
  if (!read) notFound();
  const h = await headers();
  const channel = landingChannel(await searchParams, h.get("referer"), h.get("x-forwarded-host") ?? h.get("host"));
  return (
    <CareersFrame company={read.company} brand={brand} boardHref={withVia(`/careers/${org}`, channel)}>
      <section className="wrap board">
        <h1 className="h1">Careers at {read.company}</h1>
        <Roles roles={read.roles} channel={channel} />
      </section>
    </CareersFrame>
  );
}
