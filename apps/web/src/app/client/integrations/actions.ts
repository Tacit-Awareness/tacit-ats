"use server";

import { redirect } from "next/navigation";
import { checkGranolaKey, cleanGranolaKey } from "@/lib/client/granola";
import { requireClient } from "@/lib/client/session";
import type { IntegrationError, IntegrationNotice } from "./messages";

// Connecting Granola is the member's own: the key is checked against Granola
// first, then stored by client_connect_granola on their own token, which
// writes only the caller's row. Nothing reads the key back to the page.

const back = (params: { notice?: IntegrationNotice; error?: IntegrationError }): never =>
  redirect(`/client/integrations?${new URLSearchParams(params)}`);

export async function connectGranolaAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const raw = form.get("apiKey");
  const key = typeof raw === "string" ? cleanGranolaKey(raw) : null;
  if (!key) back({ error: "granola_malformed" });

  const check = await checkGranolaKey(key!);
  if (!check.ok) back({ error: `granola_${check.error}` });

  const { error } = await db.rpc("client_connect_granola", {
    p_api_key: key!,
    p_account_email: (check.ok && check.accountEmail) || "",
  });
  if (error) {
    console.error("[client-granola] connect failed:", error.message);
    back({ error: "failed" });
  }
  back({ notice: "granola_connected" });
}

export async function disconnectGranolaAction(): Promise<void> {
  const { db } = await requireClient();
  const { error } = await db.rpc("client_disconnect_granola");
  if (error) {
    console.error("[client-granola] disconnect failed:", error.message);
    back({ error: "failed" });
  }
  back({ notice: "granola_disconnected" });
}
