"use server";

import { redirect } from "next/navigation";
import { requireClient } from "@/lib/client/session";
import type { IntegrationError, IntegrationNotice } from "./messages";

// Connecting Granola is a route pair (granola/connect, granola/callback), since
// it leaves for Granola's sign-in and comes back. Disconnecting is the
// member's own: client_disconnect_granola deletes only the caller's row, on
// their own token.
export async function disconnectGranolaAction(): Promise<void> {
  const { db } = await requireClient();
  const { error } = await db.rpc("client_disconnect_granola");
  const params: { notice?: IntegrationNotice; error?: IntegrationError } = error
    ? { error: "failed" }
    : { notice: "granola_disconnected" };
  if (error) console.error("[client-granola] disconnect failed:", error.message);
  redirect(`/client/integrations?${new URLSearchParams(params)}`);
}
