"use server";

import { redirect } from "next/navigation";
import { verifyCompanyBot } from "@/lib/client/bot";
import { requireClient } from "@/lib/client/session";
import type { BotError, BotNotice } from "./messages";

// The company's own bot (agent_destinations): set, rotate, turn on or off and
// remove go through the admin-only definer functions on the member's own
// token (tacit-internal's packages/db, 20261028120000_notify_per_company),
// which refuse anyone else and audit every change. Verify sends the signed
// challenge (lib/client/bot.ts). The secret comes back from set and rotate,
// once, as this action's result for the page to show; it never rides in a URL.

/** `secret` only when Tacit made it; `saved` when the bot's own key was kept, which is never shown back. */
export type SecretResult = { secret?: string; saved?: boolean; error?: BotError };

function botError(error: { code?: string; message: string }): BotError {
  if (error.code === "42501") return "bot_not_admin";
  if (error.code === "22023") return /key/i.test(error.message) ? "bot_bad_key" : "bot_bad_url";
  if (error.code === "P0002") return "bot_missing";
  console.error("[client-bot] failed:", error.message);
  return "bot_failed";
}

export async function setBotAction(_prev: SecretResult, form: FormData): Promise<SecretResult> {
  const { db } = await requireClient();
  const url = String(form.get("url") ?? "").trim();
  // The bot's own key, when its platform issues one (a Grok routine's webhook key); empty = Tacit makes one.
  const key = String(form.get("key") ?? "").trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password) return { error: "bot_bad_url" };
  const { data, error } = await db.rpc("client_set_agent_destination", key ? { p_url: url, p_key: key } : { p_url: url });
  if (error) return { error: botError(error) };
  return data ? { secret: data } : { saved: true };
}

export async function rotateBotSecretAction(_prev: SecretResult): Promise<SecretResult> {
  const { db } = await requireClient();
  const { data, error } = await db.rpc("client_rotate_agent_secret");
  if (error) return { error: botError(error) };
  return { secret: data };
}

function back(params: { notice?: BotNotice; error?: BotError }): never {
  redirect(`/client/integrations?${new URLSearchParams(params)}#bot`);
}

export async function verifyBotAction(): Promise<void> {
  const { db, org } = await requireClient();
  let result;
  try {
    result = await verifyCompanyBot({ db, orgId: org.id });
  } catch (err) {
    console.error("[client-bot] verify failed:", err);
    back({ error: "bot_failed" });
  }
  if (result.ok) back({ notice: "bot_verified" });
  back({
    error: result.reason === "no_destination" ? "bot_missing"
      : result.reason === "bad_url" ? "bot_bad_url"
        : result.reason === "wrong_answer" ? "bot_wrong_answer" : "bot_unreachable",
  });
}

export async function enableBotAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const enabled = form.get("enabled") === "true";
  const { data, error } = await db.rpc("client_enable_agent_destination", { p_enabled: enabled });
  if (error) back({ error: botError(error) });
  if (!data) back({ error: "bot_missing" });
  back({ notice: enabled ? "bot_on" : "bot_off" });
}

export async function removeBotAction(): Promise<void> {
  const { db } = await requireClient();
  const { error } = await db.rpc("client_remove_agent_destination");
  if (error) back({ error: botError(error) });
  back({ notice: "bot_removed" });
}
