import { redirect } from "next/navigation";
import { toolCtx } from "@/lib/client/candidate";
import { newRoleDraft } from "@/lib/client/posting-draft";
import { departmentChoices } from "@/lib/client/postings";
import { readDrawnProcess } from "@/lib/client/process";
import { processStages, stepSeeds } from "@/lib/client/process-stages";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { PostingEditor } from "../editor";

// "Add a role" (design/tats's #jobs~new): the posting editor with nothing in
// it. Making a job is an admin's (clientTools.createJob), so anyone else goes
// back to the list. `?department=` is the band whose + was clicked. The hiring
// steps start from the company's process, each department's way through going to
// the page so the editor can follow a change of department.

export default async function NewRole({ searchParams }: { searchParams: Promise<{ department?: string | string[] }> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  if (gate.ctx.accessLevel !== "admin") redirect("/client/jobs");

  const [departments, drawn] = await Promise.all([departmentChoices(gate.ctx.db, toolCtx(gate.ctx), null), readDrawnProcess(gate.ctx.db, toolCtx(gate.ctx))]);
  const seeds = drawn ? stepSeeds(processStages(drawn.graph, drawn.lookup.departments)) : null;
  const { department } = await searchParams;
  const picked = departments.find((d) => d.id === department)?.id ?? null;

  return (
    <PostingEditor
      job={{ id: null, title: "New role", status: "open" }}
      post={null}
      initial={newRoleDraft(picked, seeds)}
      seeds={seeds}
      departments={departments}
      postTabs={[]}
      link={null}
      tab="overview"
      notice={null}
    />
  );
}
