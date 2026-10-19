"use server";

import { redirect } from "next/navigation";
import { requireClient } from "@/lib/client/session";
import type { CalendarError, CalendarNotice } from "./messages";

// Disconnecting is the member's own: client_disconnect_calendar deletes only
// the caller's row, on their own token. Interviews already booked keep their
// events; moving or cancelling one then needs the calendar connected again.
export async function disconnectCalendarAction(): Promise<void> {
  const { db } = await requireClient();
  const { error } = await db.rpc("client_disconnect_calendar");
  const params: { notice?: CalendarNotice; error?: CalendarError } = error ? { error: "failed" } : { notice: "disconnected" };
  if (error) console.error("[client-calendar] disconnect failed:", error.message);
  redirect(`/client/integrations?${new URLSearchParams(params)}`);
}
