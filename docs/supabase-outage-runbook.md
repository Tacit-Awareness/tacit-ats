# Supabase outage runbook

**Symptom:** sign-in completes, then every page hangs forever; the connector
answers 504. Meanwhile `https://ats.tacitawareness.com` looks "up" -- it is;
the authenticated data plane is not.

**Confirm (10 seconds):**

```sh
curl -s -o /dev/null --max-time 10 -w "%{http_code} %{time_total}s\n" \
  https://qlqebxtjzcotiwgdnukj.supabase.co/auth/v1/health

curl -s -o /dev/null --max-time 10 -w "%{http_code} %{time_total}s\n" \
  -H "apikey: <SUPABASE_PUBLISHABLE_KEY>" \
  https://qlqebxtjzcotiwgdnukj.supabase.co/rest/v1/
```

- `auth/v1/health` hangs or times out while anonymous REST answers fast →
  **auth plane is wedged** (the 2026-10-30 incident: GoTrue hung; PostgREST
  waited on token verification for every authed request).
- Both hang → wider project/platform outage.
- A generic uptime check on `/` stays green through all of this -- that is
  why `/api/cron/health` exists.

**Fix:** Supabase dashboard → project `tacit` → Settings → Infrastructure →
Restart project. Clears lock pileups and bounces GoTrue. Service returns in
~1 minute; PostgREST schema cache warms over the next few.

**If it recurs:** the 2026-10-30 cause was a `supabase_storage_admin` writer
retry-storming `INSERT` into `storage.objects`
(`ontology/v1/leases/ontology-snapshot.json`, bucket `network-graph`),
colliding on `idx_objects_current_version`, with the resulting lock pileup
starving `pgbouncer.get_auth`. That writer is Supabase-internal -- nothing
in either repo creates it. Collect Postgres logs (dashboard → Logs) and open
a Supabase support ticket; a restart is the recovery, not the fix.

**Surgical option (avoid a restart):** SQL editor →

```sql
SELECT pid, usename, state, wait_event, now() - query_start AS dur, left(query, 80)
FROM pg_stat_activity
WHERE state <> 'idle' AND pid <> pg_backend_pid()
ORDER BY dur DESC;

SELECT pg_terminate_backend(<oldest non-idle pid>);
```
