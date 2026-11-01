import { redirect } from "next/navigation";

// Calendar lives on /client/settings now, beside Granola.
// Kept so old links, and the client connector's "connect it at" sentence, still land there.
export default async function ClientCalendar({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const params = new URLSearchParams({ ...(notice ? { notice } : {}), ...(error ? { error } : {}) });
  redirect(`/client/settings${params.size ? `?${params}` : ""}`);
}
