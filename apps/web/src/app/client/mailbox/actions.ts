"use server";

import { redirect } from "next/navigation";
import { requireClient } from "@/lib/client/session";
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
