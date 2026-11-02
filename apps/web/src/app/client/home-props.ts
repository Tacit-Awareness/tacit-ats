import { clientTools } from "@tacit-ats/core";
import { HIRE_WEEKS, OFFER_PREVIEW, OUTSTANDING_PREVIEW, type HomeRead } from "@/lib/client/home";
import { SOURCE_GROUPS } from "@/lib/client/analytics-metrics";
import { departmentTabs } from "@/lib/client/department-tree";
import { ageBuckets, bottlenecks, feedbackSummary, fmtHours, stageRows, timeRows, workload, HOME_PERIODS, type Bottleneck, type BottleneckKey } from "@/lib/client/home-metrics";
import { isOffTarget, targetField, targetRule, targetWords, type TargetMetric } from "@/lib/client/home-target-rules";
import type { TargetChipProps } from "./home-target";
import type { Bar, BottleneckIcon, HomeViewProps, WaitCard } from "./home-view";

// Home's read (lib/client/home.ts) shaped for home-view.tsx: the period,
// department and job links, each card's words and bars, the bottlenecks' sentences. No reads.

/** People a time-in-stage row lists before "All in Pipeline". */
const STAGE_PREVIEW = 8;
/** Bars the workload card shows, most hours first. */
const LOAD_ROWS = 6;
const STAGE_NAMES: Record<string, string> = { sourced: "Sourced", contacted: "Contacted", screening: "Screening", interviewing: "Interviewing", offer: "Offer" };

const hoursLabel = (h: number) => `${Math.round(h * 10) / 10}h`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each card's name, the target dialog's title. */
const TARGET_CARDS: Record<TargetMetric, string> = {
  new_applications: "New applications",
  review: "Waiting for review",
  schedule: "Waiting to be scheduled",
  feedback: "Typical time to feedback",
  workload: "Interview workload",
};

/** Each bottleneck's tile and the page that clears it (design/tats's "Decide in Inbox", here the Pipeline's own columns). */
const BOTTLENECK_GO: Record<BottleneckKey, { icon: BottleneckIcon; label: string }> = {
  review: { icon: "ticket", label: "Screen in Pipeline" },
  schedule: { icon: "cal", label: "Schedule in Pipeline" },
  decide: { icon: "flag", label: "Decide in Pipeline" },
  feedback: { icon: "quote", label: "Open Interview Judgement" },
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

export function overviewProps(read: HomeRead, days: number, now: number, canEditTargets: boolean): HomeViewProps {
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

  /**
   * A card's target chip, or null when there is nothing to show: no target and
   * nobody here to set one, or the targets could not be read, when "Set a
   * target" might be offering to replace one that is there.
   */
  const target = (metric: TargetMetric, value: number | null): TargetChipProps | null => {
    if (read.targets === null) return null;
    const set = read.targets[metric] ?? null;
    if (set === null && !canEditTargets) return null;
    const rule = targetRule(metric);
    return {
      metric,
      card: TARGET_CARDS[metric],
      label: rule.label,
      shown: set === null ? null : targetWords(metric, set),
      off: isOffTarget(metric, value, set),
      offNote: rule.flag === "below" ? "Below target" : "Over target",
      sub: rule.sub,
      kind: rule.kind,
      field: targetField(metric, set),
      canEdit: canEditTargets,
    };
  };

  const rows = stageRows(read.waiting);
  const stages = timeRows(read.waiting, read.stages);
  const waitCard = (column: "new" | "scheduling", metric: "review" | "schedule"): WaitCard => {
    const row = rows.find((r) => r.key === column)!;
    const set = read.targets?.[metric];
    return {
      typical: row.medianHours === null ? null : fmtHours(row.medianHours),
      waiting: row.people.length,
      oldest: row.longestHours === null ? null : fmtHours(row.longestHours),
      // Past the target the bars read red, as design/tats; with none set, the two oldest buckets (3 days and over).
      buckets: ageBuckets(row.people.map((p) => p.hours)).map((b, i) => ({
        n: b.n,
        label: b.label,
        title: `${b.n} waiting ${b.label}`,
        late: set === undefined ? i >= 3 : b.lo >= set,
      })),
      target: target(metric, row.medianHours),
    };
  };

  const fb = read.feedback ? feedbackSummary(read.feedback) : null;
  const load = workload(read.interviews, days, now);
  // By department, or by person for a company with none on these jobs: one "No department" bar would say nothing.
  const byTeam = load.byTeam.some((t) => t.name !== null);
  const weekly = days > 7;
  const bars: Bar[] = read.applications.bins.map((b) => ({
    n: b.n,
    label: b.toDaysAgo === 0 ? "now" : weekly ? `${b.toDaysAgo / 7}w` : `${b.toDaysAgo}d`,
    title: b.toDaysAgo === 0 ? `${b.n} in the last ${weekly ? "week" : "day"}` : `${b.n} from ${b.fromDaysAgo} to ${b.toDaysAgo} days ago`,
  }));

  const half = read.daily.length / 2;
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const lastHires = read.hires.slice(HIRE_WEEKS);

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
    newApps: { value: read.applications.current, change: read.applications.change, bars, target: target("new_applications", read.applications.current) },
    trend: { current: read.daily.slice(half), previous: read.daily.slice(0, half), total: total(read.daily.slice(half)), before: total(read.daily.slice(0, half)) },
    hires: { weeks: lastHires, total: total(lastHires), before: total(read.hires.slice(0, HIRE_WEEKS)) },
    sources: SOURCE_GROUPS.filter((g) => read.sources[g.key] > 0).map((g) => ({ label: g.label, n: read.sources[g.key] })),
    offers: {
      total: read.offers.length,
      rows: read.offers.slice(0, OFFER_PREVIEW).map((o) => ({
        id: o.requestId,
        candidate: o.candidateName ?? "A candidate",
        line: [o.jobTitle, o.requestedBy ? `from ${o.requestedBy}` : null].filter(Boolean).join(" · "),
        requestedBy: o.requestedBy,
        wait: fmtHours(Math.max(0, now - Date.parse(o.requestedAt)) / 3_600_000),
        href: `/client/inbox?i=appr-${o.requestId}`,
      })),
      more: read.offers.length > OFFER_PREVIEW ? { href: "/client/inbox", label: `All ${read.offers.length} in the Inbox` } : null,
    },
    inProcess: {
      value: read.waiting.length,
      parts: stages.map((r) => ({ label: r.label, n: r.people.length })),
      byProcess: read.stages !== null,
    },
    review: waitCard("new", "review"),
    schedule: waitCard("scheduling", "schedule"),
    feedback: fb && {
      onTimeShare: fb.onTimeShare,
      filed: fb.filed,
      onTime: fb.onTime,
      outstanding: fb.outstanding,
      onTimeHours: clientTools.FEEDBACK_ON_TIME_HOURS,
      typical: read.feedbackMedianHours === null ? null : fmtHours(read.feedbackMedianHours),
      target: target("feedback", read.feedbackMedianHours),
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
      target: target("workload", load.hours),
      byTeam,
      rows: byTeam
        ? load.byTeam.slice(0, LOAD_ROWS).map((t) => ({ id: t.name ?? "none", name: t.name ?? "No department", hours: t.hours, label: hoursLabel(t.hours) }))
        : load.byInterviewer.slice(0, LOAD_ROWS).map((x) => ({ id: x.id, name: read.names[x.id] ?? "Unknown", hours: x.hours, label: hoursLabel(x.hours) })),
    },
    bottlenecks: bottlenecks(read.waiting, fb ? fb.outstanding : null, now, {
      ...read.targets,
      oldestFeedbackHours: read.outstanding[0] ? (now - Date.parse(read.outstanding[0].endsAt)) / 3_600_000 : null,
    }).map((b) => ({
      key: b.key,
      over: b.overTarget,
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
      more: fb.outstanding > OUTSTANDING_PREVIEW ? { href: "/client/interviews", label: `All ${fb.outstanding} in Interview Judgement` } : null,
    },
    editStages: canEditTargets ? "/client/onboarding/process" : null,
    stages: stages.map((r) => ({
      key: r.key,
      label: r.label,
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
      more: r.people.length > STAGE_PREVIEW ? { href: pipeline(r.column ?? undefined), label: `All ${r.people.length} in Pipeline` } : null,
    })),
    active: read.waiting.length,
    efficiency: read.efficiency && {
      closed: read.efficiency.closed,
      hires: read.efficiency.hires,
      rounds: read.efficiency.rounds.map((r) => ({ label: r.label, share: r.rate, value: `${Math.round(r.rate * 100)}%`, title: `${r.to} of ${r.from} went on` })),
      perHire: read.efficiency.interviewsPerHire === null ? "—" : read.efficiency.interviewsPerHire.toFixed(1),
      hoursPerHire: read.efficiency.hoursPerHire === null ? "—" : `${read.efficiency.hoursPerHire.toFixed(1)}h`,
    },
    stays: read.stays.map((s) => ({ label: STAGE_NAMES[s.stage] ?? s.stage, avgDays: s.avgDays, stays: s.stays })),
    truncated: read.truncated,
  };
}
