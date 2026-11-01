import { redirect } from "next/navigation";

// Integrations are panels on /client/settings now (2026-11-01). Kept so old
// links still land there; its connect and disconnect routes stay under this path.
export default async function ClientIntegrations({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const params = new URLSearchParams({ ...(notice ? { notice } : {}), ...(error ? { error } : {}) });
  redirect(`/client/settings${params.size ? `?${params}` : ""}`);
}
