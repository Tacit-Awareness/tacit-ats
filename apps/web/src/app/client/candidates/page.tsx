import Link from "next/link";
import { Page, PageHeader, Section, textLink } from "@/components/page";
import { CRM_SCAN_MAX, readCandidates } from "@/lib/client/crm";
import { CRM_PAGE_SIZE, CRM_VIEWS, DEFAULT_DIR, crmHref, crmTable, parseCrmQuery, stageLabel, type CrmQuery, type CrmSort } from "@/lib/client/crm-views";
import { ago } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { CrmView, type CrmColumn } from "./view";

// The CRM (design/tats's #crm): every candidate the signed-in member can
// read, on their own token (lib/client/crm.ts), as one table. This page only
// arranges it: the view tab, the search, the sort and the page are URL params
// (`?view=`, `?q=`, `?sort=` / `?dir=`, `?page=`), worked out in
// lib/client/crm-views.ts. Read-only: a row opens the candidate page.

const COLUMNS: { key: CrmSort; label: string }[] = [
  { key: "name", label: "Candidate" },
  { key: "job", label: "Job" },
  { key: "stage", label: "Stage" },
  { key: "owner", label: "Owner" },
  { key: "last", label: "Last touch" },
];

export default async function ClientCandidates({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page>
        <PageHeader title="CRM" />
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

  const query = parseCrmQuery(await searchParams);
  const { candidates, truncated } = await readCandidates(db);
  const table = crmTable(candidates, query);
  const now = Date.now();
  const at = (next: Partial<CrmQuery>) => crmHref({ ...query, page: 1, ...next });

  const hidden: Record<string, string> = {};
  if (query.view !== "all") hidden.view = query.view;
  if (query.sort !== "last") hidden.sort = query.sort;
  if (query.dir !== DEFAULT_DIR[query.sort]) hidden.dir = query.dir;

  const first = (table.page - 1) * CRM_PAGE_SIZE + 1;
  const columns: CrmColumn[] = COLUMNS.map((c) => {
    const sorted = query.sort === c.key ? query.dir : null;
    // A sorted column's next click flips it; any other column starts at its own default.
    return { ...c, sorted, href: at({ sort: c.key, dir: sorted ? (sorted === "asc" ? "desc" : "asc") : DEFAULT_DIR[c.key] }) };
  });

  return (
    <CrmView
      views={CRM_VIEWS.map((v) => ({ href: at({ view: v.key }), label: v.label, count: table.counts[v.key].toLocaleString("en-US"), active: query.view === v.key }))}
      viewLabel={CRM_VIEWS.find((v) => v.key === query.view)!.label}
      columns={columns}
      rows={table.rows.map((r) => ({
        href: `/client/candidates/${r.candidateId}`,
        name: r.name,
        headline: r.headline,
        jobs: r.jobs.map((j) => j.title),
        stage: stageLabel(r.stage),
        stageTone: r.stage === "hired" ? "green" : "grey",
        ownerName: r.ownerName,
        lastTouch: ago(r.lastTouchAt, now),
        lastTouchTitle: r.lastTouchAt.slice(0, 10),
      }))}
      total={table.total}
      range={table.total ? `${first.toLocaleString("en-US")}–${(first + table.rows.length - 1).toLocaleString("en-US")} of ${table.total.toLocaleString("en-US")}` : "0"}
      prev={table.page > 1 ? crmHref({ ...query, page: table.page - 1 }) : null}
      next={table.page < table.pages ? crmHref({ ...query, page: table.page + 1 }) : null}
      search={{ q: query.q, hidden }}
      note={truncated ? `Counting the first ${CRM_SCAN_MAX.toLocaleString("en-US")} candidates.` : null}
      empty={candidates.length === 0 ? "Nobody yet." : table.total === 0 ? "Nobody matches." : null}
    />
  );
}
