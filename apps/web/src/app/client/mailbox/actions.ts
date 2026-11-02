"use server";

import { clientTools } from "@tacit-ats/core";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/client/session";
import { tacitDelegation } from "@/lib/google-delegation";
import type { MailboxError, MailboxNotice } from "./messages";

// Disconnecting is the member's own: client_disconnect_mailbox deletes only
// the caller's row, on their own token. Email already sent stays sent; replies
// to it are no longer read, and new email goes out from Tacit's address.
export async function disconnectMailboxAction(): Promise<void> {
  const { db } = await requireClient();
  const { error } = await db.rpc("client_disconnect_mailbox");
  const params: { notice?: MailboxNotice; error?: MailboxError } = error ? { error: "mailbox_failed" } : { notice: "mailbox_disconnected" };
  if (error) console.error("[client-mailbox] disconnect failed:", error.message);
  redirect(`/client/settings?${new URLSearchParams(params)}`);
}

/** Everything the Workspace is used for: Gmail (core's mailbox.ts) and Calendar (calendar.ts). */
const WORKSPACE_SCOPES = [
  clientTools.GMAIL_SEND_SCOPE, clientTools.GMAIL_READ_SCOPE, clientTools.CALENDAR_EVENTS_SCOPE, clientTools.CALENDAR_FREEBUSY_SCOPE,
];

const back = (params: { notice?: MailboxNotice; error?: MailboxError }): never => redirect(`/client/settings?${new URLSearchParams(params)}#gmail`);

/**
 * An admin verifies their company's Google Workspace, Ashby's way: Tacit asks
 * Google for a token AS the admin with both Gmail scopes and both Calendar
 * scopes, which Google grants only once the domain's admin has delegated all
 * four to Tacit's service account, then reads the admin's own mailbox profile
 * and their own busy times for the next hour (never what is on the calendar). Then client_connect_workspace,
 * on the admin's own token, stores the domain: only an admin's, and only their
 * own address's (the database checks both again).
 */
export async function verifyWorkspaceAction(): Promise<void> {
  const { db, accessLevel, user } = await requireClient();
  if (accessLevel !== "admin") back({ error: "workspace_not_admin" });
  const delegation = tacitDelegation();
  if (!delegation) back({ error: "workspace_not_set_up" });
  const email = user.email?.trim().toLowerCase();
  const domain = clientTools.domainOf(email);
  if (!email || !domain) back({ error: "workspace_no_domain" });
  try {
    const token = await clientTools.delegatedAccessToken(delegation!, email!, WORKSPACE_SCOPES);
    const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${token}` } });
    if (!profile.ok) throw new Error(`gmail profile: ${profile.status}`);
    const now = Date.now();
    const busy = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ timeMin: new Date(now).toISOString(), timeMax: new Date(now + 3_600_000).toISOString(), items: [{ id: "primary" }] }),
    });
    if (!busy.ok) throw new Error(`calendar freeBusy: ${busy.status}`);
  } catch (err) {
    // Google's status only; the admin's address stays out of the log.
    console.error("[client-workspace] verify refused:", err instanceof Error ? err.message.replace(/\S+@\S+/g, "<address>").slice(0, 200) : "failed");
    back({ error: "workspace_refused" });
  }
  const { error } = await db.rpc("client_connect_workspace", { p_domain: domain! });
  if (error) {
    console.error("[client-workspace] storing failed:", error.message);
    back({ error: "mailbox_failed" });
  }
  back({ notice: "workspace_connected" });
}

export async function disconnectWorkspaceAction(): Promise<void> {
  const { db } = await requireClient();
  const { error } = await db.rpc("client_disconnect_workspace");
  if (error) console.error("[client-workspace] disconnect failed:", error.message);
  back(error ? { error: error.code === "42501" ? "workspace_not_admin" : "mailbox_failed" } : { notice: "workspace_disconnected" });
}

/** The member's own sync switch, client_set_mailbox_sync on their own token. */
export async function setMailboxSyncAction(formData: FormData): Promise<void> {
  const { db } = await requireClient();
  const on = formData.get("on") === "1";
  const { error } = await db.rpc("client_set_mailbox_sync", { p_on: on });
  if (error) console.error("[client-mailbox] sync switch failed:", error.message);
  back(error ? { error: "mailbox_failed" } : { notice: on ? "sync_on" : "sync_off" });
}
