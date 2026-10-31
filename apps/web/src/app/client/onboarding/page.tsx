import { redirect } from "next/navigation";

// Onboarding starts at its first step. Nothing sends anyone here: Home stays where a member lands.
export default function ClientOnboarding() {
  redirect("/client/onboarding/people");
}
