import { clientTools } from "@tacit-ats/core";
import { NextResponse } from "next/server";
import { webFileStore } from "@/lib/client/file-store";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";

// A candidate's file: core's getFileLink reads the row on the member's own
// token, which is the permission check, then this sends them to a link that
// lasts five minutes. Made on the click, so a page left open never holds a dead one.
// `?view=1` is the file viewer's (files/viewer.tsx): a link the browser shows
// in place instead of saving, still on Storage's origin.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await resolveClient();
  if (gate.status !== "ok" || !UUID.test(id)) return new NextResponse("Not found", { status: 404 });
  const inline = new URL(request.url).searchParams.get("view") === "1";
  try {
    const link = await clientTools.getFileLink(gate.ctx.db, toolCtx(gate.ctx), webFileStore({ inline }), { fileId: id });
    return NextResponse.redirect(link.url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof clientTools.ClientToolError && err.code === "not_found") return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
