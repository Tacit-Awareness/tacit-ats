import { toolCtx } from "@/lib/client/candidate";
import { groupPostings, liveCount, postState } from "@/lib/client/posting-groups";
import { readPostings } from "@/lib/client/postings";
import { departmentAndBelow, departmentScope } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { publicOrigin } from "./origin";
import { JobPostingsView, type PostingGroupProps } from "./view";

// Listings & Asks (design/tacit-tickets's Asks; Job Postings, design/tats's #jobs,
// until 2026-11-19): every job the signed-in member can see,
// read with their own token (lib/client/postings.ts), as the careers page
// shows it: by department, each with its lead post's state, how many applied
// and the public link. An admin sees the org's jobs (not confidential ones),
// the hiring team the jobs they have access on, an interviewer the jobs they
// interview for, in one list with no counts and no departments. Rows open the
// posting; an admin also gets "Add A Role" (new/page.tsx). `?department=` is a
// team from the sidebar: its band and those inside it.

export default async function ClientJobs({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { db, accessLevel, org } = gate.ctx;
  const [read, structure, sp] = await Promise.all([readPostings(db, toolCtx(gate.ctx)), readDepartments(db), searchParams]);
  const all = groupPostings(read, { grouped: accessLevel !== "limited" });
  // A team from the sidebar (`?department=`): its band and those of the departments inside it.
  const raw = Array.isArray(sp.department) ? sp.department[0] : sp.department;
  const scope = departmentScope(structure, raw);
  const inTeam = scope.departmentId ? departmentAndBelow(structure.departments, scope.departmentId) : null;
  const groups = inTeam ? all.filter((g) => inTeam.has(g.key)) : all;
  const team = scope.departmentId ? (scope.options.find((o) => o.id === scope.departmentId)?.name ?? null) : null;
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
      careersUrl={liveCount(all) > 0 ? `${base}/careers/${org.slug}` : null}
      team={team}
      total={read.jobs.length}
      live={liveCount(groups)}
      groups={props}
      empty={accessLevel === "admin" ? "No jobs yet." : "You haven't been added to a job yet."}
      canAdd={accessLevel === "admin"}
    />
  );
}
