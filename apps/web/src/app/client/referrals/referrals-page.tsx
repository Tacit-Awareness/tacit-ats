import Link from "next/link";
import { clientTools } from "@tacit-ats/core";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { homeSubBase } from "@/lib/client/home-tabs";
import { ago } from "@/lib/client/pipeline-columns";
import { REFERRAL_DEFAULT_DIR, parseReferralPeopleQuery, referralPeople, referralPeopleHref, type ReferralPeopleQuery, type ReferralSort } from "@/lib/client/referral-people";
import { REFERRAL_PAGE_SIZE, REFERRAL_TABS, referralsHref, referrerName, whereTheyAre } from "@/lib/client/referral-table";
import { REFERRALS_SCAN_MAX, RESUME_ACCEPT, readAddForm, readReferrals } from "@/lib/client/referrals";
import { resolveClient } from "@/lib/client/session";
import { topReferrers } from "@/lib/client/top-referrers";
import { Refusal } from "../refusal";
import { REFERRAL_NOTICES, isReferralNotice } from "./messages";
import { ReferralsView, type ReferralColumn } from "./view";

// Referrals (design/tats's #referrals), as a CRM of everyone referred in:
// every application sourced as a referral that the signed-in member can read,
// open and closed, on their own token (lib/client/referrals.ts), one row per
// person (lib/client/referral-people.ts). This page only arranges it: the tab,
// the search, the sort and the page are URL params (`?tab=`, `?q=`, `?sort=` /
// `?dir=`, `?page=`). A row opens the candidate page; "Add referral" opens
// the intake composer, which /client/referrals/new opens on arrival
// (`compose`).

// The CRM's columns for a referral, each sorting as the CRM's do.
const COLUMNS: { key: ReferralSort; label: string }[] = [
  { key: "name", label: "Candidate" },
  { key: "referrer", label: "Referred by" },
  { key: "job", label: "Job" },
  { key: "stage", label: "Where they are" },
  { key: "when", label: "Referred" },
];

/** The page, on its own route or inside Home's tab (`home`), where its links stay in the tab; `compose` opens the composer. */
export async function ReferralsContent({ sp, home = false, compose = false }: { sp: Record<string, string | string[] | undefined>; home?: boolean; compose?: boolean }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel, user } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Referrals" />}>
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

  const base = home ? homeSubBase("referrals") : "/client/referrals";
  const query = parseReferralPeopleQuery(sp);
  const [{ referrals, truncated }, canAdd, form] = await Promise.all([readReferrals(db), db.rpc("can_add_people"), readAddForm(db)]);
  const table = referralPeople(referrals, query);
  const board = topReferrers(referrals);
  const now = Date.now();
  const at = (next: Partial<ReferralPeopleQuery>) => referralPeopleHref({ ...query, page: 1, ...next }, base);
  const notice = Array.isArray(sp.notice) ? sp.notice[0] : sp.notice;
  const first = (table.page - 1) * REFERRAL_PAGE_SIZE + 1;

  const hidden: Record<string, string> = { ...(home ? { sub: "referrals" } : {}) };
  if (query.tab !== "all") hidden.tab = query.tab;
  if (query.sort !== "when") hidden.sort = query.sort;
  if (query.dir !== REFERRAL_DEFAULT_DIR[query.sort]) hidden.dir = query.dir;

  const columns: ReferralColumn[] = COLUMNS.map((c) => {
    const sorted = query.sort === c.key ? query.dir : null;
    // A sorted column's next click flips it; any other column starts at its own default.
    return { ...c, sorted, href: at({ sort: c.key, dir: sorted ? (sorted === "asc" ? "desc" : "asc") : REFERRAL_DEFAULT_DIR[c.key] }) };
  });

  return (
    <ReferralsView
      tabs={REFERRAL_TABS.map((t) => ({ href: at({ tab: t.key }), label: t.label, count: table.counts[t.key].toLocaleString("en-US"), active: query.tab === t.key }))}
      tabLabel={REFERRAL_TABS.find((t) => t.key === query.tab)!.label}
      columns={columns}
      rows={table.rows.map((r) => {
        const where = whereTheyAre(r.stage);
        const referredBy = referrerName(r.referredBy);
        return {
          key: r.applicationId,
          candidateId: r.candidateId,
          href: `/client/candidates/${r.candidateId}`,
          name: r.name?.trim() || "Unnamed",
          referredBy,
          // The column head says "Referred by", so the cell shows the name; the wording it came with is the hover.
          referredByWords: r.referredBy !== referredBy ? r.referredBy : null,
          jobs: r.jobs,
          where: where.label,
          whereTone: where.tone,
          referredAt: r.referredAt,
          referred: ago(r.referredAt, now),
        };
      })}
      referrers={
        board.rows.length
          ? {
              // Searched for as recorded, so the rows that count for them come up; named as the table names them.
              rows: board.rows.map((r) => ({ ...r, name: referrerName(r.name) ?? r.name, href: referralsHref({ tab: "all", q: r.name.slice(0, 100), page: 1 }, base) })),
              more: board.more ? `And ${board.more.toLocaleString("en-US")} more` : null,
            }
          : null
      }
      all={table.everyone.toLocaleString("en-US")}
      range={table.total ? `${first.toLocaleString("en-US")}–${(first + table.rows.length - 1).toLocaleString("en-US")} of ${table.total.toLocaleString("en-US")}` : "0"}
      prev={table.page > 1 ? referralPeopleHref({ ...query, page: table.page - 1 }, base) : null}
      next={table.page < table.pages ? referralPeopleHref({ ...query, page: table.page + 1 }, base) : null}
      search={{ q: query.q, action: home ? "/client" : "/client/referrals", hidden }}
      home={home}
      intake={
        canAdd.data === true || compose
          ? {
              jobs: form.jobs,
              preferJob: null,
              me: user.name || null,
              teammates: form.teammates,
              resumeMaxBytes: clientTools.FILE_MAX_BYTES,
              resumeAccept: RESUME_ACCEPT,
            }
          : null
      }
      compose={compose}
      notice={isReferralNotice(notice) ? REFERRAL_NOTICES[notice] : null}
      note={truncated ? `Counting the first ${REFERRALS_SCAN_MAX.toLocaleString("en-US")} referrals.` : null}
      empty={referrals.length === 0 ? "No referrals yet." : table.total === 0 ? "No referrals match." : null}
    />
  );
}
