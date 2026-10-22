import Link from "next/link";
import { Empty, Glyph, Page, PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";

// Every job the signed-in member can see, read with their own token: an admin
// sees the org's jobs (not confidential ones), the hiring team the jobs they
// have access on, an interviewer the jobs they interview for.

export default async function ClientJobs() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { db, accessLevel } = gate.ctx;
  const showCounts = accessLevel !== "limited";
  const { data: roles, error } = await db
    .from("roles")
    .select("id, title, status, location, applications(count)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (
    <Page>
      <PageHeader title="Jobs" subtitle="Every job you can see, newest first." />
      <Section title="All jobs" count={roles.length} flush>
        {roles.length === 0 ? (
          <Empty className="px-4 py-3">{accessLevel === "admin" ? "No jobs yet." : "You haven't been added to a job yet."}</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Job</TableHead>
                <TableHead>Location</TableHead>
                {showCounts ? <TableHead className="text-right">In pipeline</TableHead> : null}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <TableRow key={role.id} className="relative">
                  <TableCell>
                    <Link href={`/client/jobs/${role.id}`} className="flex items-center gap-2.5 font-medium text-foreground after:absolute after:inset-0">
                      <Glyph name={role.title} />
                      {role.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{role.location ?? "—"}</TableCell>
                  {showCounts ? <TableCell className="text-right font-mono">{role.applications[0]?.count ?? 0}</TableCell> : null}
                  <TableCell>
                    <StatusBadge status={role.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
