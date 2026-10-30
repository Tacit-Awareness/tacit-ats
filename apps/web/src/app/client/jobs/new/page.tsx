import { redirect } from "next/navigation";
import { toolCtx } from "@/lib/client/candidate";
import { newRoleDraft } from "@/lib/client/posting-draft";
import { departmentChoices } from "@/lib/client/postings";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { PostingEditor } from "../editor";

// "Add a role" (design/tats's #jobs~new): the posting editor with nothing in
// it. Making a job is an admin's (clientTools.createJob), so anyone else goes
// back to the list. `?department=` is the band whose + was clicked.

export default async function NewRole({ searchParams }: { searchParams: Promise<{ department?: string | string[] }> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  if (gate.ctx.accessLevel !== "admin") redirect("/client/jobs");

  const departments = await departmentChoices(gate.ctx.db, toolCtx(gate.ctx), null);
  const { department } = await searchParams;
  const picked = departments.find((d) => d.id === department)?.id ?? null;

  return (
    <PostingEditor
      job={{ id: null, title: "New role", status: "open" }}
      post={null}
      initial={newRoleDraft(picked)}
      departments={departments}
      postTabs={[]}
      link={null}
      tab="overview"
      notice={null}
    />
  );
}
