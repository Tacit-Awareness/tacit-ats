import type { CalendarConnection, ClientCalendar } from "../client-tools/calendar.js";

export type GoogleCall = { method: string; url: string; token: string | null; body: unknown };

/**
 * A stand-in for Google's token endpoint and Calendar API, as fetch: each
 * refresh token "rt-<x>" becomes access token "at-<x>" (one listed in
 * `expired` is refused), free/busy answers from `busy` per access token and
 * address (an address not listed for that token is "notFound", like a
 * calendar not shared), and event calls answer `eventStatus` (200 by default).
 */
export function fakeGoogle(opts: {
  /** accessToken -> address -> busy [start, end] ISO pairs. */
  busy?: Record<string, Record<string, Array<[string, string]>>>;
  expired?: string[];
  eventStatus?: number;
} = {}) {
  const calls: GoogleCall[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const token = headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = Object.fromEntries(new URLSearchParams(init.body));
      }
    } else if (init?.body instanceof URLSearchParams) {
      body = Object.fromEntries(init.body);
    }
    calls.push({ method, url, token, body });

    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const rt = (body as { refresh_token?: string }).refresh_token ?? "";
      if (opts.expired?.includes(rt)) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: rt.replace(/^rt-/, "at-") });
    }
    if (url.endsWith("/freeBusy")) {
      const items = (body as { items: Array<{ id: string }> }).items;
      const mine = opts.busy?.[token ?? ""] ?? {};
      const calendars = Object.fromEntries(items.map(({ id }) => [
        id,
        id in mine ? { busy: mine[id].map(([start, end]) => ({ start, end })) } : { errors: [{ reason: "notFound" }] },
      ]));
      return Response.json({ calendars });
    }
    const status = opts.eventStatus ?? 200;
    if (status >= 400) return Response.json({ error: { message: "refused" } }, { status });
    if (method === "DELETE") return new Response(null, { status: 204 });
    const id = (body as { id?: string } | undefined)?.id ?? url.split("/events/")[1]?.split("?")[0] ?? "evt";
    return Response.json({ id, htmlLink: `https://calendar.google.com/event?eid=${id}`, hangoutLink: "https://meet.google.com/abc-defg-hij" });
  }) as typeof fetch;

  const calendarWith = (connections: Record<string, CalendarConnection>): ClientCalendar => ({
    google: { clientId: "cid", clientSecret: "secret", fetch: fetchImpl },
    connections: async (_orgId, ids) => new Map(ids.filter((id) => connections[id]).map((id) => [id, connections[id]])),
    connectUrl: "https://app.test/client/calendar",
  });
  const eventCalls = () => calls.filter((c) => c.url.includes("/events"));
  return { calls, fetchImpl, calendarWith, eventCalls };
}
