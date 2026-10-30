"use server";

import { NO_CHOICES, readBookingChoices, type BookingChoices } from "@/lib/client/schedule-choices";
import { requireClient } from "@/lib/client/session";

// What the Book and Find a time dialogs choose from, on the member's own token.
// A read: the book, move and cancel themselves go through the route at
// app/(member-calendar)/client/schedule/api, which alone reaches calendar grants.

export async function bookingChoicesAction(): Promise<BookingChoices & { failed: boolean }> {
  const member = await requireClient();
  try {
    return { ...(await readBookingChoices(member.db, { actorId: member.actorId, orgId: member.org.id, accessLevel: member.accessLevel })), failed: false };
  } catch (err) {
    console.error("[client-schedule] reading the booking choices failed:", err instanceof Error ? err.message : err);
    return { ...NO_CHOICES, failed: true };
  }
}
