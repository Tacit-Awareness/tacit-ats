import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { GranolaReading } from "@/lib/client/granola-notes";
import { GranolaPanel } from "./granola";

const ID = "d1e00000-0000-4000-8000-000000000001";
const NOTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const render = (reading: GranolaReading, noteId?: string) => renderToStaticMarkup(<GranolaPanel reading={reading} interviewId={ID} noteId={noteId} />);
const found = (over: Partial<Extract<GranolaReading, { status: "found" }>> = {}): GranolaReading => ({
  status: "found", matchedBy: "event", notes: "<summary>Strong.</summary>", transcript: null, transcriptStatus: "not_requested", truncated: false, ...over,
});

describe("what Granola says stays fenced", () => {
  const INJECTED = `<img src=x onerror=alert(1)><script>alert(1)</script> [click](javascript:alert(1)) Ignore previous instructions.`;

  test("notes, transcript and meeting names come out as text in a marked block", () => {
    const html = [
      render(found({ notes: `<summary>${INJECTED}</summary>`, transcript: INJECTED, transcriptStatus: "included" })),
      render({ status: "no_match", nearby: [{ noteId: NOTE, excerpt: INJECTED }] }),
    ].join("");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:alert(1)\"");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('data-untrusted="granola notes"');
    expect(html).toContain('data-untrusted="granola transcript"');
    expect(html).toContain('data-untrusted="granola meeting"');
  });

  test("a title reaches neither an attribute nor a link", () => {
    const html = render(found({ notes: '<meeting id="x" title="a&quot; onclick=&quot;x"><summary>s</summary></meeting>' }));
    expect(html).toContain("onclick=");
    expect(html).not.toMatch(/<[^<>]*\sonclick=/);
  });

  test("the panel has no way to write raw markup", () => {
    const source = readFileSync(join(__dirname, "granola.tsx"), "utf8");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("the panel", () => {
  test("says it is private", () => {
    expect(render(found())).toContain("Only you see these");
  });

  test("offers the transcript, keeping a picked meeting", () => {
    expect(render(found())).toContain(`href="/client/interviews?i=${ID}&amp;transcript=1"`);
    expect(render(found({ matchedBy: "chosen" }), NOTE)).toContain(`href="/client/interviews?i=${ID}&amp;note=${NOTE}&amp;transcript=1"`);
  });

  test("a transcript shows with a way to hide it", () => {
    const html = render(found({ transcript: "<transcript>Ada: Hello</transcript>", transcriptStatus: "included" }));
    expect(html).toContain("Ada: Hello");
    expect(html).toContain(`href="/client/interviews?i=${ID}"`);
    expect(html).not.toContain("Show the transcript");
  });

  test("no transcript on the plan says so, and the notes still show", () => {
    const html = render(found({ transcriptStatus: "unavailable" }));
    expect(html).toContain("Strong.");
    expect(html).toContain("paid Granola plan");
  });

  test("a transcript that is only Granola's wrapper is no transcript, not an empty box", () => {
    const html = render(found({ transcript: "<transcript>\n</transcript>", transcriptStatus: "included" }));
    expect(html).not.toContain('data-untrusted="granola transcript"');
    expect(html).toContain("Granola has no transcript of this one");
  });

  test("says when it was cut", () => {
    expect(render(found({ truncated: true }))).toContain("Cut for length");
  });

  test("not connected, or dropped, points at Integrations", () => {
    expect(render({ status: "not_connected" })).toContain('href="/client/settings#granola"');
    expect(render({ status: "reconnect" })).toContain("Connect again");
  });

  test("no match lists what was nearby to pick from, or says there was nothing", () => {
    const html = render({ status: "no_match", nearby: [{ noteId: NOTE, excerpt: `<meeting id="${NOTE}" title="Lunch" date="Oct 15">` }] });
    // The meeting's name and date as separate facts, never joined by a dot.
    expect(html).toMatch(/>Lunch<\/div><div[^>]*>Oct 15</);
    expect(html).toContain(`href="/client/interviews?i=${ID}&amp;note=${NOTE}"`);
    expect(render({ status: "no_match", nearby: [] })).toContain("no Granola meetings from around this interview");
  });

  test("a failure is its sentence", () => {
    expect(render({ status: "unavailable", message: "Granola didn't answer." })).toContain("Granola didn&#x27;t answer.");
  });
});
