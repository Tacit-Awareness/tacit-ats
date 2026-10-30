import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CareersFrame } from "@/components/careers/frame";
import { readJobBoard } from "@/lib/public/jobs";
import { Roles } from "./roles";

// A client's public careers page (design/careers's board): its live posts by
// team. Public on purpose: proxy.ts runs only under /client, and the only
// database access is lib/public/jobs.ts as anon. An org that is not a client
// and one with no live post are the same 404. Kept out of search engines, as
// the posts are, until a company asks to be found.

const board = cache(readJobBoard);

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ org: string }> }): Promise<Metadata> {
  const read = await board((await params).org);
  return { title: read ? `Careers at ${read.company}` : "Careers", robots: { index: false, follow: false } };
}

export default async function CareersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const read = await board(org);
  if (!read) notFound();
  return (
    <CareersFrame company={read.company} boardHref={`/careers/${org}`}>
      <div className="wrap">
        <section className="board">
          <h1 className="h1">Careers at {read.company}</h1>
          <Roles roles={read.roles} />
        </section>
      </div>
    </CareersFrame>
  );
}
