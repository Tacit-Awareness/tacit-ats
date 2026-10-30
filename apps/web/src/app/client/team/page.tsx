import { redirect } from "next/navigation";

// The team moved to the Interviewers page on 2026-10-30. Kept for old links.
export default function ClientTeam() {
  redirect("/client/interviewers");
}
