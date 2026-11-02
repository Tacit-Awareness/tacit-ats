import { notFound } from "next/navigation";
import { toolCtx } from "@/lib/client/candidate";
import { readJobSettings } from "@/lib/client/job-settings";
import { draftFromPost } from "@/lib/client/posting-draft";
import { leadPost } from "@/lib/client/posting-groups";
import { readPosting, readPostingEditing } from "@/lib/client/postings";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../../refusal";
import { PostingEditor } from "../../editor";
import { isPostingNotice } from "../../messages";
import { publicOrigin } from "../../origin";
import { PostingView } from "./view";

// One job's post (design/tats's posting editor, #jobs~<role>), read with the
// signed-in member's own token through the client connector's list_job_posts
// (lib/client/postings.ts). The lead post shows unless `?post=` picks another
// of the job's posts; `?tab=application` shows its form. A job the member
// cannot see is a 404, the same as no such job. Whoever may manage the job
// edits it in place (../../editor.tsx), with the job's own title, status and
// openings beside it (../../job-settings.tsx); everyone else reads it.

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
  const ctx = toolCtx(gate.ctx);
  const read = await readPosting(gate.ctx.db, ctx, id);
  if (!read) notFound();

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const lead = leadPost(read.posts);
  const post = read.posts.find((p) => p.postId === one(sp.post)) ?? lead;
  const tab = one(sp.tab) === "application" ? "application" : "overview";
  const href = (next: { post?: string; tab?: "overview" | "application" }) => {
    const params = new URLSearchParams();
    const p = next.post ?? post?.postId;
    const t = next.tab ?? tab;
    if (p && p !== lead?.postId) params.set("post", p);
    if (t === "application") params.set("tab", t);
    const qs = params.toString();
    return `/client/jobs/${id}/post${qs ? `?${qs}` : ""}`;
  };
  const base = await publicOrigin();
  const postTabs = read.posts.map((p) => ({
    href: href({ post: p.postId }),
    label: p.title,
    count: p.status,
    active: p.postId === post?.postId,
  }));
  const link = post?.accepting ? { path: `/jobs/${post.slug}`, url: `${base}/jobs/${post.slug}` } : null;

  const editing = await readPostingEditing(gate.ctx.db, ctx, read.job);
  if (!editing) {
    return <PostingView job={read.job} post={post} postTabs={postTabs} tab={tab} tabHref={(t) => href({ tab: t })} link={link} />;
  }
  const notice = one(sp.notice);
  const settings = await readJobSettings(gate.ctx.db, ctx, read.job);
  return (
    <PostingEditor
      // A save keeps the same post, so what was typed survives its refresh; picking another post starts over.
      key={`${id}:${one(sp.post)}`}
      job={read.job}
      post={post}
      initial={draftFromPost({ job: read.job, departmentId: read.job.departmentId, steps: editing.steps, post })}
      departments={editing.departments}
      postTabs={postTabs}
      link={link}
      tab={tab}
      notice={isPostingNotice(notice) ? notice : null}
      settings={settings}
    />
  );
}
