import { ReferralsContent } from "../referrals-page";

// "Add referral" as a link of its own: the Referrals list with the intake
// composer open on it (applicants/intake-composer.tsx), as the list's own "Add
// referral" opens it. Closing it leaves the list at /client/referrals; adding
// someone goes there too, saying so. An interviewer gets the list's own answer.

export default async function ClientAddReferral() {
  return <ReferralsContent sp={{}} compose />;
}
