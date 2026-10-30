import Link from "next/link";
import { Page, PageHeader, Section, textLink } from "@/components/page";
import { ago } from "@/lib/client/pipeline-columns";
import { REFERRAL_PAGE_SIZE, REFERRAL_TABS, parseReferralQuery, referralTable, referralsHref, whereTheyAre, type ReferralQuery } from "@/lib/client/referral-table";
import { REFERRALS_SCAN_MAX, readReferrals } from "@/lib/client/referrals";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { REFERRAL_NOTICES, isReferralNotice } from "./messages";
import { ReferralsView } from "./view";

// Referrals (design/tats's #referrals): every application sourced as a
// referral that the signed-in member can read, open and closed, on their own
// token (lib/client/referrals.ts). This page only arranges it: the tab, the
// search and the page are URL params (`?tab=`, `?q=`, `?page=`), worked out in
// lib/client/referral-table.ts. A row opens the candidate page; adding one is
// /client/referrals/new.

export default async function ClientReferrals({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page>
        <PageHeader title="Referrals" />
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

  const sp = await searchParams;
  const query = parseReferralQuery(sp);
  const [{ referrals, truncated }, canAdd] = await Promise.all([readReferrals(db), db.rpc("can_add_people")]);
  const table = referralTable(referrals, query);
  const now = Date.now();
  const at = (next: Partial<ReferralQuery>) => referralsHref({ ...query, page: 1, ...next });
  const notice = Array.isArray(sp.notice) ? sp.notice[0] : sp.notice;
  const first = (table.page - 1) * REFERRAL_PAGE_SIZE + 1;

  return (
    <ReferralsView
      tabs={REFERRAL_TABS.map((t) => ({ href: at({ tab: t.key }), label: t.label, count: table.counts[t.key].toLocaleString("en-US"), active: query.tab === t.key }))}
      tabLabel={REFERRAL_TABS.find((t) => t.key === query.tab)!.label}
      rows={table.rows.map((r) => {
        const where = whereTheyAre(r.stage);
        return {
          key: r.applicationId,
          href: `/client/candidates/${r.candidateId}`,
          name: r.name?.trim() || "Unnamed",
          referredBy: r.referredBy,
          job: r.jobTitle ?? "Untitled job",
          where: where.label,
          whereTone: where.tone,
          referred: ago(r.referredAt, now),
          referredTitle: r.referredAt.slice(0, 10),
        };
      })}
      total={table.total}
      range={table.total ? `${first.toLocaleString("en-US")}–${(first + table.rows.length - 1).toLocaleString("en-US")} of ${table.total.toLocaleString("en-US")}` : "0"}
      prev={table.page > 1 ? referralsHref({ ...query, page: table.page - 1 }) : null}
      next={table.page < table.pages ? referralsHref({ ...query, page: table.page + 1 }) : null}
      search={{ q: query.q, hidden: query.tab !== "all" ? { tab: query.tab } : {} }}
      canAdd={canAdd.data === true}
      notice={isReferralNotice(notice) ? REFERRAL_NOTICES[notice] : null}
      note={truncated ? `Counting the first ${REFERRALS_SCAN_MAX.toLocaleString("en-US")} referrals.` : null}
      empty={referrals.length === 0 ? "No referrals yet." : table.total === 0 ? "No referrals match." : null}
    />
  );
}
