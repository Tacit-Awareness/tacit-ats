import { clientTools } from "@tacit-ats/core";
import { OUTSTANDING_PREVIEW, type HomeRead } from "@/lib/client/home";
import { departmentTabs } from "@/lib/client/department-tree";
import { ageBuckets, bottlenecks, feedbackSummary, fmtHours, stageRows, workload, HOME_PERIODS, type Bottleneck, type BottleneckKey } from "@/lib/client/home-metrics";
import { PIPELINE_COLUMNS } from "@/lib/client/pipeline-columns";
import type { Bar, BottleneckIcon, HomeViewProps, WaitCard } from "./home-view";

// Home's read (lib/client/home.ts) shaped for home-view.tsx: the period,
// department and job links, each card's words and bars, the bottlenecks' sentences. No reads.

/** People a time-in-stage row lists before "All in Pipeline". */
const STAGE_PREVIEW = 8;
const SHORT: Record<string, string> = { new: "New", screening: "Screen", scheduling: "Sched", booked: "Booked", decide: "Call", offer: "Offer" };
const STAGE_NAMES: Record<string, string> = { sourced: "Sourced", contacted: "Contacted", screening: "Screening", interviewing: "Interviewing", offer: "Offer" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each bottleneck's tile and the page that clears it (design/tats's "Decide in Inbox", here the Pipeline's own columns). */
const BOTTLENECK_GO: Record<BottleneckKey, { icon: BottleneckIcon; label: string }> = {
  review: { icon: "ticket", label: "Screen in Pipeline" },
  schedule: { icon: "cal", label: "Schedule in Pipeline" },
  decide: { icon: "flag", label: "Decide in Pipeline" },
  feedback: { icon: "quote", label: "Open Interviews" },
  stalled: { icon: "clock", label: "Open Pipeline" },
};

function bottleneckWords(b: Bottleneck, days: number, allJobs: boolean): { what: string; why: string } {
  const oldest = b.oldestHours === null ? "" : fmtHours(b.oldestHours);
  switch (b.key) {
    case "review":
      return { what: `${plural(b.n, "candidate")} not yet screened`, why: `Oldest ${oldest}` };
    case "schedule":
      return { what: `${plural(b.n, "candidate")} waiting to be scheduled`, why: `Oldest ${oldest}` };
    case "decide":
      return { what: `${plural(b.n, "candidate")} waiting on your call`, why: `Oldest ${oldest} since their last interview` };
    case "feedback":
      return { what: `${plural(b.n, "piece")} of interviewer feedback outstanding`, why: `From interviews that ended in the last ${days} days${allJobs ? ", on every job you manage" : ""}` };
    case "stalled":
      return { what: `${plural(b.n, "candidate")} stalled`, why: `Untouched for a while or overdue · oldest touch ${oldest} ago` };
  }
}

export function overviewProps(read: HomeRead, days: number, now: number): HomeViewProps {
  const job = read.jobId;
  const department = read.departmentId;
  // interviewerActivity has no job filter: with a job or a department picked, its numbers still cover every job they manage.
  const allJobs = job !== null || department !== null;
  const href = (next: { days?: number; department?: string | null; job?: string | null }) => {
    const params = new URLSearchParams();
    const d = next.days ?? days;
    const dep = next.department === undefined ? department : next.department;
    const j = next.job === undefined ? job : next.job;
    if (d !== HOME_PERIODS[0]) params.set("days", String(d));
    if (dep) params.set("department", dep);
    if (j) params.set("job", j);
    const qs = params.toString();
    return `/client${qs ? `?${qs}` : ""}`;
  };
  const pipeline = (all?: string) => {
    const params = new URLSearchParams();
    if (department) params.set("department", department);
    if (job) params.set("job", job);
    if (all) params.set("all", all);
    const qs = params.toString();
    return `/client/pipeline${qs ? `?${qs}` : ""}`;
  };

  const rows = stageRows(read.waiting);
  const waitCard = (column: "new" | "scheduling"): WaitCard => {
    const row = rows.find((r) => r.key === column)!;
    return {
      typical: row.medianHours === null ? null : fmtHours(row.medianHours),
      waiting: row.people.length,
      oldest: row.longestHours === null ? null : fmtHours(row.longestHours),
      buckets: ageBuckets(row.people.map((p) => p.hours)).map((b) => ({
        n: b.n,
        label: b.label,
        title: `${b.n} waiting ${b.label}`,
      })),
    };
  };

  const fb = read.feedback ? feedbackSummary(read.feedback) : null;
  const load = workload(read.interviews, days, now);
  const weekly = days > 7;
  const bars: Bar[] = read.applications.bins.map((b) => ({
    n: b.n,
    label: b.toDaysAgo === 0 ? "now" : weekly ? `${b.toDaysAgo / 7}w` : `${b.toDaysAgo}d`,
    title: b.toDaysAgo === 0 ? `${b.n} in the last ${weekly ? "week" : "day"}` : `${b.n} from ${b.fromDaysAgo} to ${b.toDaysAgo} days ago`,
  }));

  const menu = (label: string, options: { href: string; label: string; active: boolean }[]) => {
    const picked = options.find((o) => o.active) ?? options[0];
    return { label, value: picked.label, on: picked !== options[0], options };
  };
  const departments = departmentTabs({ options: read.departments, departmentId: department, jobIds: null }, (d) => href({ department: d, job: null }));
  // The prototype's period, team and role chips; an org with no departments gets no department chip, one with no open job no job chip.
  const filters = [
    {
      ...menu(
        "Period",
        HOME_PERIODS.map((d) => ({ href: href({ days: d }), label: `Last ${d} days`, active: d === days })),
      ),
      on: days !== HOME_PERIODS[0],
    },
    ...(departments.length ? [menu("Department", departments)] : []),
    ...(read.jobs.length
      ? [menu("Job", [{ href: href({ job: null }), label: "All jobs", active: !job }, ...read.jobs.map((j) => ({ href: href({ job: j.id }), label: j.title, active: job === j.id }))])]
      : []),
  ];

  return {
    title: "Recruiting Overview",
    days,
    filters,
    pipelineHref: pipeline(),
    newApps: { value: read.applications.current, change: read.applications.change, bars },
    inProcess: {
      value: read.waiting.length,
      bars: rows.map((r) => ({ n: r.people.length, label: SHORT[r.key], title: `${r.people.length} in ${r.label}` })),
    },
    review: waitCard("new"),
    schedule: waitCard("scheduling"),
    feedback: fb && {
      onTimeShare: fb.onTimeShare,
      filed: fb.filed,
      onTime: fb.onTime,
      outstanding: fb.outstanding,
      onTimeHours: clientTools.FEEDBACK_ON_TIME_HOURS,
      allJobs,
      interviewers: fb.interviewers.slice(0, 7).map((x) => ({
        id: x.userId,
        name: x.name ?? "Unknown",
        median: x.medianHoursToFeedback === null ? null : fmtHours(x.medianHoursToFeedback),
        medianHours: x.medianHoursToFeedback,
        out: x.notFiled,
      })),
    },
    workload: {
      hours: `${Math.round(load.hours)}h`,
      interviews: load.interviews,
      held: load.held,
      booked: load.booked,
      people: load.byInterviewer.slice(0, 6).map((x) => ({
        id: x.id,
        name: read.names[x.id] ?? "Unknown",
        hours: x.hours,
        label: `${Math.round(x.hours * 10) / 10}h`,
      })),
    },
    bottlenecks: bottlenecks(read.waiting, fb ? fb.outstanding : null, now).map((b) => ({
      key: b.key,
      ...bottleneckWords(b, days, allJobs),
      ...BOTTLENECK_GO[b.key],
      href: b.key === "feedback" ? "/client/interviews" : pipeline(b.key === "review" ? "new" : b.key === "schedule" ? "scheduling" : b.key === "decide" ? "decide" : undefined),
    })),
    outstanding: fb && {
      total: fb.outstanding,
      rows: read.outstanding.map((o) => ({
        id: `${o.interviewId}:${o.interviewerId}`,
        interviewer: o.interviewerName ?? "Unknown",
        line: [o.candidateName ?? "A candidate", o.jobTitle].filter(Boolean).join(" · "),
        wait: fmtHours(Math.max(0, now - Date.parse(o.endsAt)) / 3_600_000),
        href: `/client/interviews?i=${o.interviewId}`,
      })),
      more: fb.outstanding > OUTSTANDING_PREVIEW ? { href: "/client/interviews", label: `All ${fb.outstanding} in Interviews` } : null,
    },
    stages: rows.map((r) => ({
      key: r.key,
      label: PIPELINE_COLUMNS.find((c) => c.key === r.key)!.label,
      n: r.people.length,
      segments: r.segments,
      typical: r.medianHours === null ? null : fmtHours(r.medianHours),
      longest: r.longestHours === null ? null : fmtHours(r.longestHours),
      people: r.people.slice(0, STAGE_PREVIEW).map((x) => ({
        id: x.applicationId,
        name: x.personName,
        line: x.roleTitle,
        wait: fmtHours(x.hours),
        href: `/client/candidates/${x.personId}`,
      })),
      more: r.people.length > STAGE_PREVIEW ? { href: pipeline(r.key), label: `All ${r.people.length} in Pipeline` } : null,
    })),
    active: read.waiting.length,
    stays: read.stays.map((s) => ({ label: STAGE_NAMES[s.stage] ?? s.stage, avgDays: s.avgDays, stays: s.stays })),
    truncated: read.truncated,
  };
}
