import Link from "next/link";
import { clientTools } from "@tacit-ats/core";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { CRM_SCAN_MAX, readCandidates, readStageNames } from "@/lib/client/crm";
import { CRM_PAGE_SIZE, CRM_VIEWS, DEFAULT_DIR, crmHref, crmTable, inJobs, parseCrmQuery, stageLabel, withStageNames, type CrmQuery, type CrmSort } from "@/lib/client/crm-views";
import { departmentScope, departmentTabs } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { ago } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { Refusal } from "../refusal";
import { Icon, type IconName } from "./icons";
import { CrmView, type CrmColumn } from "./view";

// The CRM (design/tats's #crm): every candidate the signed-in member can
// read, on their own token (lib/client/crm.ts), as one table. This page only
// arranges it: the department, the view tab, the search, the sort and the
// page are URL params (`?department=`, `?view=`, `?q=`, `?sort=` / `?dir=`,
// `?page=`), worked out in lib/client/crm-views.ts and, for the department,
// lib/client/department-tree.ts. A row opens the candidate page; the writes
// here are the bulk actions (bulk.tsx, actions.ts), which act row by row.

// design/tats's CRM_COLS, each with its icon; Profile does not sort.
const COLUMNS: { key: CrmSort | "profile"; label: string; icon: IconName }[] = [
  { key: "name", label: "Candidate", icon: "people" },
  { key: "job", label: "Job", icon: "brief" },
  { key: "profile", label: "Profile", icon: "link" },
  { key: "stage", label: "Stage", icon: "flag" },
  { key: "owner", label: "Owner", icon: "users" },
  { key: "last", label: "Last contact", icon: "cal" },
];

/** "in/ada-lovelace" from a LinkedIn profile URL; anything else as typed, without its scheme. */
function profileOf(url: string | null): string | null {
  const u = url?.trim();
  if (!u) return null;
  const m = /linkedin\.com\/(in|pub)\/([^/?#\s]+)/i.exec(u);
  if (m) return `in/${decodeSafe(m[2]!)}`;
  return u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default async function ClientCandidates({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="CRM" icon={<Icon name="db" />} />}>
        <Section>
          <p className="m-0 text-[13px] text-muted-foreground">
            You&apos;re an interviewer here. The people you interview are on your{" "}
            <Link href="/client" className={textLink}>
              home page
            </Link>
            .
          </p>
        </Section>
      </Page>
    );
  }

  const ctx = toolCtx(gate.ctx);
  const parsed = parseCrmQuery(await searchParams);
  const [{ candidates: everyone, truncated }, structure, reasons, tags, pools] = await Promise.all([
    readCandidates(db),
    readDepartments(db),
    clientTools.listRejectionReasons(db, ctx),
    clientTools.listTags(db, ctx),
    clientTools.listPools(db, ctx),
  ]);
  const scope = departmentScope(structure, parsed.department);
  const query: CrmQuery = { ...parsed, department: scope.departmentId };
  const candidates = scope.jobIds ? inJobs(everyone, scope.jobIds) : everyone;
  const table = crmTable(candidates, query);
  const rows = withStageNames(table.rows, await readStageNames(db, ctx, table.rows));
  const now = Date.now();
  const at = (next: Partial<CrmQuery>) => crmHref({ ...query, page: 1, ...next });

  const hidden: Record<string, string> = {};
  if (query.department) hidden.department = query.department;
  if (query.view !== "all") hidden.view = query.view;
  if (query.sort !== "last") hidden.sort = query.sort;
  if (query.dir !== DEFAULT_DIR[query.sort]) hidden.dir = query.dir;

  const first = (table.page - 1) * CRM_PAGE_SIZE + 1;
  const columns: CrmColumn[] = COLUMNS.map((c) => {
    if (c.key === "profile") return { ...c, href: null, sorted: null };
    const sorted = query.sort === c.key ? query.dir : null;
    // A sorted column's next click flips it; any other column starts at its own default.
    return { ...c, sorted, href: at({ sort: c.key, dir: sorted ? (sorted === "asc" ? "desc" : "asc") : DEFAULT_DIR[c.key] }) };
  });

  return (
    <CrmView
      views={CRM_VIEWS.map((v) => ({ href: at({ view: v.key }), label: v.label, count: table.counts[v.key].toLocaleString("en-US"), active: query.view === v.key }))}
      departments={departmentTabs(scope, (department) => at({ department }))}
      viewLabel={CRM_VIEWS.find((v) => v.key === query.view)!.label}
      columns={columns}
      rows={rows.map((r) => ({
        href: `/client/candidates/${r.candidateId}`,
        name: r.name,
        jobs: r.jobs.map((j) => j.title),
        profile: profileOf(r.linkedinUrl),
        stage: r.stageName ?? stageLabel(r.stage),
        stageTone: r.stage === "hired" ? "green" : "grey",
        ownerName: r.ownerName,
        lastTouchAt: r.lastTouchAt,
        lastTouch: ago(r.lastTouchAt, now),
        bulk: { candidateId: r.candidateId, name: r.name, apps: r.openApps },
      }))}
      total={table.total}
      range={table.total ? `${first.toLocaleString("en-US")}–${(first + table.rows.length - 1).toLocaleString("en-US")} of ${table.total.toLocaleString("en-US")}` : "0"}
      prev={table.page > 1 ? crmHref({ ...query, page: table.page - 1 }) : null}
      next={table.page < table.pages ? crmHref({ ...query, page: table.page + 1 }) : null}
      search={{ q: query.q, hidden }}
      note={truncated ? `Counting the first ${CRM_SCAN_MAX.toLocaleString("en-US")} candidates.` : null}
      empty={candidates.length === 0 ? (query.department ? "Nobody in this department's jobs yet." : "Nobody yet.") : table.total === 0 ? "Nobody matches." : null}
      bulk={{
        reasons: reasons.filter((r) => r.kind === "rejected").map((r) => ({ reasonId: r.reasonId, name: r.name })),
        tags: tags.map((t) => t.name),
        pools: pools.map((p) => p.name),
      }}
    />
  );
}
