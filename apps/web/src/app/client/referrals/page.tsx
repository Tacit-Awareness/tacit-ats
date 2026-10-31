import { ReferralsContent } from "./referrals-page";

export default async function ClientReferrals({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReferralsContent sp={await searchParams} />;
}
