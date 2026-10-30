import { notFound } from "next/navigation";
import { toolCtx } from "@/lib/client/candidate";
import { leadPost } from "@/lib/client/posting-groups";
import { readPosting } from "@/lib/client/postings";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../../refusal";
import { publicOrigin } from "../../origin";
import { PostingView } from "./view";

// One job's post (design/tats's posting editor, #jobs~<role>), read with the
// signed-in member's own token through the client connector's list_job_posts
// (lib/client/postings.ts). The lead post shows unless `?post=` picks another
// of the job's posts; `?tab=application` shows its form. A job the member
// cannot see is a 404, the same as no such job. Read-only: writing a post
// needs an audit source for the web app (see apps/web/CLAUDE.md).

export default async function ClientJobPost({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { id } = await params;
  const read = await readPosting(gate.ctx.db, toolCtx(gate.ctx), id);
  if (!read) notFound();

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const post = read.posts.find((p) => p.postId === one(sp.post)) ?? leadPost(read.posts);
  const tab = one(sp.tab) === "application" ? "application" : "overview";
  const href = (next: { post?: string; tab?: "overview" | "application" }) => {
    const params = new URLSearchParams();
    const p = next.post ?? post?.postId;
    const t = next.tab ?? tab;
    if (p && p !== leadPost(read.posts)?.postId) params.set("post", p);
    if (t === "application") params.set("tab", t);
    const qs = params.toString();
    return `/client/jobs/${id}/post${qs ? `?${qs}` : ""}`;
  };
  const base = await publicOrigin();

  return (
    <PostingView
      job={read.job}
      post={post}
      postTabs={read.posts.map((p) => ({
        href: href({ post: p.postId }),
        label: p.title,
        count: p.status,
        active: p.postId === post?.postId,
      }))}
      tab={tab}
      tabHref={(t) => href({ tab: t })}
      link={post?.accepting ? { path: `/jobs/${post.slug}`, url: `${base}/jobs/${post.slug}` } : null}
      connectorNote={gate.ctx.accessLevel !== "limited"}
    />
  );
}
