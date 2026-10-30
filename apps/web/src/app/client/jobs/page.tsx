import { toolCtx } from "@/lib/client/candidate";
import { groupPostings, liveCount, postState } from "@/lib/client/posting-groups";
import { readPostings } from "@/lib/client/postings";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { publicOrigin } from "./origin";
import { JobPostingsView, type PostingGroupProps } from "./view";

// Job Postings (design/tats's #jobs): every job the signed-in member can see,
// read with their own token (lib/client/postings.ts), as the careers page
// shows it: by department, each with its lead post's state, how many applied
// and the public link. An admin sees the org's jobs (not confidential ones),
// the hiring team the jobs they have access on, an interviewer the jobs they
// interview for, in one list with no counts and no departments. Read-only:
// posts are written through the client connector until the web app has an
// audit source of its own.

export default async function ClientJobs() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { db, accessLevel, org } = gate.ctx;
  const read = await readPostings(db, toolCtx(gate.ctx));
  const groups = groupPostings(read, { grouped: accessLevel !== "limited" });
  const base = await publicOrigin();

  const props: PostingGroupProps[] = groups.map((g) => ({
    key: g.key,
    name: g.name,
    rows: g.postings.map((p) => ({
      jobId: p.job.id,
      title: p.job.title,
      location: p.job.location,
      jobStatus: p.job.status === "open" ? null : p.job.status,
      post: postState(p),
      link: p.post?.accepting ? { path: `/jobs/${p.post.slug}`, url: `${base}/jobs/${p.post.slug}` } : null,
      applied: p.applied,
      inPipeline: p.job.inPipeline,
      morePosts: Math.max(0, p.posts - 1),
    })),
  }));

  return (
    <JobPostingsView
      orgName={org.name}
      careersPath={liveCount(groups) > 0 ? `/careers/${org.slug}` : null}
      total={read.jobs.length}
      live={liveCount(groups)}
      groups={props}
      empty={accessLevel === "admin" ? "No jobs yet." : "You haven't been added to a job yet."}
      connectorNote={accessLevel !== "limited"}
    />
  );
}
