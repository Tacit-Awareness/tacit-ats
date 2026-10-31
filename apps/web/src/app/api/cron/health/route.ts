// GET /api/cron/health -- every five minutes. Answers whether the Supabase
// project's planes the app depends on respond in time. On 2026-10-30 the
// project's auth service (GoTrue) hung for over an hour: anonymous REST kept
// answering, so a generic uptime check stayed green while every signed-in
// page waited forever. The probes here name the planes that incident hid
// behind: auth itself, and an authenticated REST read, not just the edge.
//
// CRON_SECRET authenticates Vercel's cron (and an external monitor, which can
// send the same Authorization header). Any failed probe posts one message to
// ALERT_WEBHOOK_URL (a Slack incoming webhook: {"text": ...}); without it the
// failure still lands in the deploy's logs. The route always answers 200
// with the report -- a 5xx would invite the platform's retries.

const TIMEOUT_MS = 8_000;

type Check = { ok: boolean; ms: number; detail?: string };

async function probe(url: string, init: RequestInit = {}): Promise<Check> {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    // Any HTTP answer means the plane is alive; only a hang or a refused
    // connection is a failure. auth/v1/health answers 401 to a bare GET.
    return { ok: true, ms: Date.now() - started, detail: `http ${res.status}` };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, detail: err instanceof Error ? err.message : String(err) };
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function alert(text: string): Promise<void> {
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) {
    console.error(`[cron] health: ALERT_WEBHOOK_URL unset; would alert: ${text}`);
    return;
  }
  await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => console.error("[cron] health: alert post failed", err));
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response(null, { status: 401 });
  const supabase = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabase || !key) {
    await alert(`Tacit ATS health check cannot run: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY unset.`);
    return Response.json({ status: "misconfigured" });
  }
  const base = supabase.replace(/\/+$/, "");
  const checks = {
    // The 2026-10-30 outage lived here: GoTrue hanging stalls every JWT
    // verification, which is every member read and write.
    auth: await probe(`${base}/auth/v1/health`),
    rest: await probe(`${base}/rest/v1/`, { headers: { apikey: key } }),
  };
  const failed = Object.entries(checks).filter(([, c]) => !c.ok).map(([name]) => name);
  if (failed.length > 0) {
    const detail = failed.map((name) => `${name}: ${checks[name as keyof typeof checks].detail}`).join(", ");
    await alert(`🚨 Tacit ATS: Supabase ${failed.join(" + ")} not answering (${detail}). Sign-ins and every authed page are down. Runbook: docs/supabase-outage-runbook.md`);
  }
  return Response.json({ status: failed.length === 0 ? "ok" : "down", checks });
}
