"use server";

import { revalidatePath } from "next/cache";
import { parseTarget } from "@/lib/client/home-target-rules";
import { saveHomeTarget } from "@/lib/client/home-targets";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { TargetState } from "./target-messages";

/** Sets or removes one of Home's targets. Answers in place, so the dialog keeps what was typed. */
export async function saveTargetAction(_prev: TargetState, form: FormData): Promise<TargetState> {
  const member = await requireClient();
  const target = parseTarget({ metric: form.get("metric"), value: form.get("value"), unit: form.get("unit"), clear: form.get("clear") });
  if (!target.ok) return { status: "error", error: target.error };
  const saved = await saveHomeTarget(member.db, toolCtx(member), target);
  if (!saved.ok) return { status: "error", error: saved.error };
  if (saved.changed) revalidatePath("/client");
  return { status: "saved" };
}
