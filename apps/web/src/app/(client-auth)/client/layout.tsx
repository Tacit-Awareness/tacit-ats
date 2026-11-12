import { notFound } from "next/navigation";
import { clientAuthProvider } from "@/lib/client/config";

// Supabase Auth's own pages. Outside app/client so the client layout, which
// resolves a member, never runs on the page that signs one in; inside /client
// so the proxy still sees them. Not there with WorkOS signing members in.
export const dynamic = "force-dynamic";

export default function ClientAuthLayout({ children }: { children: React.ReactNode }) {
  if (clientAuthProvider() !== "supabase") notFound();
  return children;
}
