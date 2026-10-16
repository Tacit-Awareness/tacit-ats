"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/client/session";
import type { SettingsError, SettingsNotice } from "./messages";

// Tacit's access to this org's jobs. Every write is on the signed-in member's
// own token: client_set_tacit_submissions and client_remove_tacit_submitter
// refuse anyone but an admin, and roles' update policy decides open_to_tacit
// (whoever manages the job). Nothing from the form names an org.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ["open_jobs", "chosen_jobs", "off"] as const;

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

const back = (params: { notice?: SettingsNotice; error?: SettingsError }): never =>
  redirect(`/client/settings?${new URLSearchParams(params)}`);

const codeFor = (err: { code?: string; message: string }, what: string): SettingsError => {
  if (err.code === "42501") return "not_admin";
  if (err.code === "22023") return "not_found";
  console.error(`[client-settings] ${what} failed:`, err.message);
  return "failed";
};

export async function setTacitModeAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const mode = str(form, "mode");
  if (!MODES.includes(mode as (typeof MODES)[number])) return back({ error: "failed" });
  const { error } = await db.rpc("client_set_tacit_submissions", { p_mode: mode });
  if (error) return back({ error: codeFor(error, "setting the mode") });
  revalidatePath("/client/settings");
  return back({ notice: "mode_saved" });
}

export async function setJobOpenToTacitAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const roleId = str(form, "roleId");
  if (!UUID.test(roleId)) return back({ error: "not_found" });
  const { data, error } = await db
    .from("roles")
    .update({ open_to_tacit: str(form, "open") === "true" })
    .eq("id", roleId)
    .select("id");
  if (error) return back({ error: codeFor(error, "a job's access") });
  // RLS filters a job the member may not manage out of the update: nothing comes back.
  if (!data?.length) return back({ error: "not_admin" });
  revalidatePath("/client/settings");
  return back({ notice: "job_saved" });
}

export async function removeSubmitterAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const actorId = str(form, "actorId");
  if (!UUID.test(actorId)) return back({ error: "not_found" });
  const { error } = await db.rpc("client_remove_tacit_submitter", { p_actor: actorId });
  if (error) return back({ error: codeFor(error, "removing a submitter") });
  revalidatePath("/client/settings");
  return back({ notice: "removed" });
}
