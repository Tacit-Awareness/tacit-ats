import type { Db } from "@tacit/db";

// The stamp the Pipeline and the Inbox poll (lib/live-refresh.ts): the newest
// application event and the most recently changed application the member can
// read, on their OWN client, so a change they may not see never moves it. Core's
// pipeline appends an event with every change and stamps `updated_at`, so
// between them a move, an owner, a next step or a new applicant all move the
// stamp. Ids and a time only, all of them rows the member reads anyway. A
// failed read is null: no answer, and the page stays as drawn.

export async function readLiveStamp(db: Db): Promise<string | null> {
  const [event, app] = await Promise.all([
    db.from("application_events").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("applications").select("id, updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (event.error || app.error) {
    console.error("live stamp:", (event.error ?? app.error)?.message ?? "read failed");
    return null;
  }
  return [event.data?.id ?? "-", app.data?.id ?? "-", app.data?.updated_at ?? "-"].join(":");
}
