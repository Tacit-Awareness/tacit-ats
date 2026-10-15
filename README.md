# tacit-ats

Tacit's client-facing ATS: the `/client` portal and the `/api/client` MCP connector for client companies. Shares a database with [Tacit-Awareness](https://github.com/Tacit-Awareness/Tacit-Awareness), which owns the schema; see `CLAUDE.md`.

## Architecture

```mermaid
flowchart TD
    applicant["Applicant<br/><small>anon, no session</small>"]
    browser["Member, browser<br/><small>WorkOS AuthKit</small>"]
    claude["Member, Claude<br/><small>OAuth + MCP</small>"]

    web["<b>apps/web</b><br/><small>/client pages, /jobs/[slug]</small>"]
    mcp["<b>apps/mcp</b><br/><small>/api/client, 90 tools</small>"]
    core["<b>@tacit-ats/core</b><br/><small>client-auth, clientTools</small>"]

    subgraph ta["Owned by Tacit-Awareness"]
        vendor["<b>vendor/</b> @tacit/core, @tacit/db<br/><small>pipeline, types, pinned in vendor/SOURCE</small>"]
        db[("<b>Supabase tacit</b><br/><small>RLS on the member's token</small>")]
    end

    applicant --> web
    browser --> web
    claude --> mcp
    web --> core
    mcp --> core
    core --> vendor
    vendor --> db
    mcp -. "service role: bind, audit, files" .-> db
```

Every read and write runs on the member's own token, so RLS decides what they see. The dashed edge is the only exception: three modules in `apps/mcp` (`client/bind.ts`, `client/audit.ts`, `client/files.ts`) use the service role, and `apps/web` has the same exception in `lib/client/bind.ts` for first sign-in.

```bash
pnpm install
pnpm test
```
