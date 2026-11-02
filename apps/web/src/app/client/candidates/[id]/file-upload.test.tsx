import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { requireClient, addFile, revalidatePath, webFileStore } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  addFile: vi.fn(),
  revalidatePath: vi.fn(),
  webFileStore: vi.fn(),
}));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@/lib/client/file-store", () => ({ webFileStore }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, addFile } };
});

import { clientTools } from "@tacit-ats/core";
import type { ViewerFile } from "@/lib/client/file-view-rules";
import { FileViewer } from "../../files/viewer";
import { addFileAction } from "./actions";
import { FileUpload } from "./file-upload";

const CANDIDATE = "c1c00000-0000-4000-8000-000000000001";
const DB = { db: true };
const member = { db: DB, actorId: "actor-1", accessLevel: "elevated", org: { id: "org-1" } };
const STORE = { put: vi.fn(), signedUrl: vi.fn() };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const SECRET = "Ada private-salary-history.pdf";

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.resetAllMocks();
  requireClient.mockResolvedValue(member);
  webFileStore.mockReturnValue(STORE);
  addFile.mockResolvedValue({ fileId: "file-1", kind: "resume", filename: SECRET, sizeBytes: PDF.length });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addFileAction", () => {
  test("nobody signed in stops before anything is read or written", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(addFileAction({ added: 0 }, form({ candidateId: CANDIDATE, kind: "resume", file: new File([PDF], "cv.pdf") }))).rejects.toThrow("unauthenticated");
    expect(addFile).not.toHaveBeenCalled();
  });

  test("adds it as the member, with the download store, and redraws the pages that show files", async () => {
    expect(await addFileAction({ added: 2 }, form({ candidateId: CANDIDATE, kind: "resume", file: new File([PDF], SECRET) }))).toEqual({ added: 3 });
    expect(addFile).toHaveBeenCalledWith(DB, { actorId: "actor-1", orgId: "org-1", accessLevel: "elevated", source: "dashboard" }, STORE, {
      candidateId: CANDIDATE, kind: "resume", filename: SECRET, contentType: "application/pdf", contentBase64: Buffer.from(PDF).toString("base64"),
    });
    expect(webFileStore).toHaveBeenCalledWith();
    expect(revalidatePath).toHaveBeenCalledWith(`/client/candidates/${CANDIDATE}`);
    expect(revalidatePath).toHaveBeenCalledWith("/client/applicants");
  });

  test("a kind it doesn't know is an attachment", async () => {
    await addFileAction({ added: 0 }, form({ candidateId: CANDIDATE, kind: "secret", file: new File([PDF], "cv.pdf") }));
    expect(addFile).toHaveBeenCalledWith(DB, expect.anything(), STORE, expect.objectContaining({ kind: "attachment" }));
  });

  test("a bad id or a bad file is refused before core is asked", async () => {
    expect(await addFileAction({ added: 1 }, form({ candidateId: "nope", file: new File([PDF], "cv.pdf") }))).toEqual({ added: 1, error: "file_gone" });
    expect(await addFileAction({ added: 1 }, form({ candidateId: CANDIDATE, file: new File([PDF], "cv.exe") }))).toEqual({ added: 1, error: "file_type" });
    expect(await addFileAction({ added: 1 }, form({ candidateId: CANDIDATE, file: new File([PDF], "cv.png") }))).toEqual({ added: 1, error: "file_mismatch" });
    expect(await addFileAction({ added: 1 }, form({ candidateId: CANDIDATE }))).toEqual({ added: 1, error: "file_missing" });
    expect(addFile).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("core's refusal is the form's answer", async () => {
    addFile.mockRejectedValue(new clientTools.ClientToolError("forbidden", "no"));
    expect(await addFileAction({ added: 0 }, form({ candidateId: CANDIDATE, file: new File([PDF], "cv.pdf") }))).toEqual({ added: 0, error: "file_forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a failure is logged without the filename", async () => {
    addFile.mockRejectedValue(new Error("org-files: upload org-1/person-1/file-1: down"));
    expect(await addFileAction({ added: 0 }, form({ candidateId: CANDIDATE, file: new File([PDF], SECRET) }))).toEqual({ added: 0, error: "failed" });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("salary");
  });
});

describe("FileUpload", () => {
  test("the picker takes core's types, and the box says the rules", () => {
    const html = renderToStaticMarkup(<FileUpload candidateId={CANDIDATE} accept=".pdf,.png" extensions={["pdf", "png"]} maxBytes={3 * 1024 * 1024} />);
    expect(html).toContain('accept=".pdf,.png"');
    expect(html).toContain(`value="${CANDIDATE}"`);
    expect(html).toContain("up to 3 MB");
    expect(html).toContain("Add file");
  });
});

describe("FileViewer", () => {
  const f = (over: Partial<ViewerFile>): ViewerFile => ({ fileId: "f1", label: "Resume", filename: "cv.pdf", preview: "pdf", sub: "2 KB", ...over });

  test("a PDF in a frame through ?view=1, unsandboxed so the browser's viewer runs, and its download", () => {
    const html = renderToStaticMarkup(<FileViewer files={[f({})]} />);
    expect(html).toContain('<iframe src="/client/files/f1?view=1"');
    expect(html).not.toContain("sandbox");
    expect(html).toContain('href="/client/files/f1"');
    // One file needs no rail.
    expect(html).not.toContain("<nav");
  });

  test("plain text is sandboxed, an image is an image", () => {
    expect(renderToStaticMarkup(<FileViewer files={[f({ preview: "text", filename: "n.txt" })]} />)).toContain('sandbox=""');
    const img = renderToStaticMarkup(<FileViewer files={[f({ preview: "image", filename: "p.png" })]} />);
    expect(img).toContain('<img src="/client/files/f1?view=1"');
    expect(img).not.toContain("<iframe");
  });

  test("Word is a download only, and several files get the rail, the first one open", () => {
    const html = renderToStaticMarkup(<FileViewer files={[f({ fileId: "w1", preview: "none", filename: "cv.docx" }), f({ fileId: "f2", label: "Attachment" })]} />);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("don&#x27;t open in the browser");
    expect(html).toContain('href="/client/files/w1"');
    expect(html).toContain("<nav");
    expect(html).toContain('aria-current="true"');
  });

  test("no files, nothing", () => {
    expect(renderToStaticMarkup(<FileViewer files={[]} />)).toBe("");
  });
});
