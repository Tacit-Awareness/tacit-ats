import Link from "next/link";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { homeSubBase } from "@/lib/client/home-tabs";
import { ago } from "@/lib/client/pipeline-columns";
import { REFERRAL_PAGE_SIZE, REFERRAL_TABS, inTab, parseReferralQuery, referralTable, referralsHref, whereTheyAre, type ReferralQuery } from "@/lib/client/referral-table";
import { REFERRALS_SCAN_MAX, readReferrals } from "@/lib/client/referrals";
import { resolveClient } from "@/lib/client/session";
import { topReferrers } from "@/lib/client/top-referrers";
import { Refusal } from "../refusal";
import { REFERRAL_NOTICES, isReferralNotice } from "./messages";
import { ReferralsView } from "./view";

// Referrals (design/tats's #referrals): every application sourced as a
// referral that the signed-in member can read, open and closed, on their own
// token (lib/client/referrals.ts). This page only arranges it: the tab, the
// search and the page are URL params (`?tab=`, `?q=`, `?page=`), worked out in
// lib/client/referral-table.ts. A row opens the candidate page; adding one is
// /client/referrals/new.

/** The page, on its own route or inside Home's tab (`home`), where its links stay in the tab. */
export async function ReferralsContent({ sp, home = false }: { sp: Record<string, string | string[] | undefined>; home?: boolean }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;

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
  const query = parseReferralQuery(sp);
  const [{ referrals, truncated }, canAdd] = await Promise.all([readReferrals(db), db.rpc("can_add_people")]);
  const table = referralTable(referrals, query);
  const board = topReferrers(referrals);
  const now = Date.now();
  const at = (next: Partial<ReferralQuery>) => referralsHref({ ...query, page: 1, ...next }, base);
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
          whereTone: where.tone === "green" ? "green" : inTab(r.stage, "active") ? "sel" : "grey",
          referred: ago(r.referredAt, now),
          referredTitle: r.referredAt.slice(0, 10),
        };
      })}
      referrers={
        board.rows.length
          ? {
              rows: board.rows.map((r) => ({ ...r, href: referralsHref({ tab: "all", q: r.name.slice(0, 100), page: 1 }, base) })),
              more: board.more ? `And ${board.more.toLocaleString("en-US")} more` : null,
            }
          : null
      }
      all={referrals.length.toLocaleString("en-US")}
      range={table.total ? `${first.toLocaleString("en-US")}–${(first + table.rows.length - 1).toLocaleString("en-US")} of ${table.total.toLocaleString("en-US")}` : "0"}
      prev={table.page > 1 ? referralsHref({ ...query, page: table.page - 1 }, base) : null}
      next={table.page < table.pages ? referralsHref({ ...query, page: table.page + 1 }, base) : null}
      search={{ q: query.q, action: home ? "/client" : "/client/referrals", hidden: { ...(home ? { sub: "referrals" } : {}), ...(query.tab !== "all" ? { tab: query.tab } : {}) } }}
      home={home}
      canAdd={canAdd.data === true}
      notice={isReferralNotice(notice) ? REFERRAL_NOTICES[notice] : null}
      note={truncated ? `Counting the first ${REFERRALS_SCAN_MAX.toLocaleString("en-US")} referrals.` : null}
      empty={referrals.length === 0 ? "No referrals yet." : table.total === 0 ? "No referrals match." : null}
    />
  );
}
