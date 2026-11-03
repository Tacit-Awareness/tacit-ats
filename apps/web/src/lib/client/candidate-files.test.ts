import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { addCandidateFile, FILE_ACCEPT, uploadFile, uploadName } from "./candidate-files";

const { addFile } = vi.hoisted(() => ({ addFile: vi.fn() }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, addFile } };
});

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "elevated", source: "dashboard" };
const DB = {} as Db;
const STORE: clientTools.FileStore = { put: vi.fn(), signedUrl: vi.fn() };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

beforeEach(() => {
  addFile.mockReset();
});

test("FILE_ACCEPT is every extension core takes", () => {
  expect(FILE_ACCEPT).toBe(".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg");
});

describe("uploadName", () => {
  test("keeps what core takes, makes the rest spaces, and keeps the extension it was checked by", () => {
    expect(uploadName("Ada Lovelace – CV (2026).PDF", "pdf", "Resume")).toBe("Ada Lovelace CV (2026).pdf");
    expect(uploadName("..hidden.pdf", "pdf", "Resume")).toBe("hidden.pdf");
    expect(uploadName("履歴書.pdf", "pdf", "Resume")).toBe("履歴書.pdf");
  });

  test("a name with nothing left, or no stem, falls back", () => {
    expect(uploadName("💼.png", "png", "Attachment")).toBe("Attachment.png");
    expect(uploadName(".pdf", "pdf", "Resume")).toBe("Resume.pdf");
  });

  test("a long name is cut to fit", () => {
    expect(uploadName(`${"a".repeat(400)}.pdf`, "pdf", "Resume")).toBe(`${"a".repeat(150)}.pdf`);
  });
});

describe("uploadFile", () => {
  test("nothing picked", async () => {
    expect(await uploadFile(null, "Resume")).toBe("file_missing");
    expect(await uploadFile("text", "Resume")).toBe("file_missing");
    expect(await uploadFile(new File([], ""), "Resume")).toBe("file_missing");
    // An untouched input can arrive as a zero-byte File with a name. A picked empty file is the browser's file_empty first.
    for (const name of ["blob", "undefined", "cv.pdf"]) expect(await uploadFile(new File([], name), "Resume")).toBe("file_missing");
  });

  test("a PDF, by its extension and its bytes, base64 for core", async () => {
    expect(await uploadFile(new File([PDF], "cv.pdf"), "Resume")).toEqual({
      filename: "cv.pdf", contentType: "application/pdf", contentBase64: Buffer.from(PDF).toString("base64"),
    });
  });

  test("the type is the extension's, whatever the browser said", async () => {
    expect(await uploadFile(new File([PNG], "shot.png", { type: "application/pdf" }), "Attachment")).toMatchObject({ contentType: "image/png" });
  });

  test("refusals say which rule", async () => {
    expect(await uploadFile(new File([PDF], "cv.html"), "Resume")).toBe("file_type");
    expect(await uploadFile(new File([PNG], "cv.pdf"), "Resume")).toBe("file_mismatch");
    expect(await uploadFile(new File([new Uint8Array(clientTools.FILE_MAX_BYTES + 1)], "cv.pdf"), "Resume")).toBe("file_big");
  });
});

describe("addCandidateFile", () => {
  const FILE = { filename: "cv.pdf", contentType: "application/pdf", contentBase64: "JVBERi0=" };

  test("is core's addFile, as the member, with the store", async () => {
    addFile.mockResolvedValue({ fileId: "file-1", kind: "resume", filename: "cv.pdf", sizeBytes: 5 });
    expect(await addCandidateFile(DB, CTX, { candidateId: "person-1", kind: "resume", file: FILE }, STORE)).toEqual({ ok: true, fileId: "file-1" });
    expect(addFile).toHaveBeenCalledWith(DB, CTX, STORE, { candidateId: "person-1", kind: "resume", ...FILE });
  });

  test.each([
    ["forbidden", "file_forbidden"],
    ["not_found", "file_gone"],
    ["rate_limited", "rate_limited"],
    ["invalid", "failed"],
  ] as const)("core's %s is %s", async (code, error) => {
    addFile.mockRejectedValue(new clientTools.ClientToolError(code, "no"));
    expect(await addCandidateFile(DB, CTX, { candidateId: "person-1", kind: "resume", file: FILE }, STORE)).toEqual({ ok: false, error });
  });

  test("anything else is thrown", async () => {
    addFile.mockRejectedValue(new Error("db down"));
    await expect(addCandidateFile(DB, CTX, { candidateId: "person-1", kind: "attachment", file: FILE }, STORE)).rejects.toThrow("db down");
  });
});
