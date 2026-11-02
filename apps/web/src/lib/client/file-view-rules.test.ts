import { describe, expect, test } from "vitest";
import type { clientTools } from "@tacit-ats/core";
import { fileHref, fileSize, pickedFileError, previewOf, viewerFiles } from "./file-view-rules";

const file = (over: Partial<clientTools.CandidateFile>): clientTools.CandidateFile => ({
  fileId: "f1", kind: "attachment", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 2048, uploadedBy: "Sam", uploadedAt: "2026-11-01T00:00:00Z", ...over,
});

describe("previewOf", () => {
  test("a PDF and plain text are framed, an image drawn, Word and anything unknown downloaded", () => {
    expect(previewOf("application/pdf")).toBe("pdf");
    expect(previewOf("text/plain; charset=utf-8")).toBe("text");
    expect(previewOf("IMAGE/PNG")).toBe("image");
    expect(previewOf("image/jpeg")).toBe("image");
    expect(previewOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("none");
    expect(previewOf("application/msword")).toBe("none");
    expect(previewOf("text/html")).toBe("none");
    expect(previewOf(null)).toBe("none");
  });
});

test("fileHref: the download, or ?view=1 for one shown in place", () => {
  expect(fileHref("f1")).toBe("/client/files/f1");
  expect(fileHref("f1", true)).toBe("/client/files/f1?view=1");
});

test("fileSize", () => {
  expect(fileSize(null)).toBeNull();
  expect(fileSize(900)).toBe("900 B");
  expect(fileSize(2048)).toBe("2 KB");
  expect(fileSize(3 * 1024 * 1024)).toBe("3.0 MB");
});

describe("viewerFiles", () => {
  test("resumes first, each kind in core's order, newest first", () => {
    const out = viewerFiles(
      [file({ fileId: "a1" }), file({ fileId: "r1", kind: "resume" }), file({ fileId: "a2" }), file({ fileId: "r2", kind: "resume" })],
      () => "1d ago",
    );
    expect(out.map((f) => f.fileId)).toEqual(["r1", "r2", "a1", "a2"]);
    expect(out[0]).toEqual({ fileId: "r1", label: "Resume", filename: "a.pdf", preview: "pdf", sub: "2 KB · Sam · 1d ago" });
  });

  test("an unknown size or uploader is left out of the line", () => {
    expect(viewerFiles([file({ sizeBytes: null, uploadedBy: null })], () => "today")[0].sub).toBe("today");
  });
});

describe("pickedFileError", () => {
  const ext = ["pdf", "docx", "png"];
  test("by extension, any case, then empty, then over the cap", () => {
    expect(pickedFileError({ name: "Resume.PDF", size: 10 }, ext, 100)).toBeNull();
    expect(pickedFileError({ name: "resume.exe", size: 10 }, ext, 100)).toBe("file_type");
    expect(pickedFileError({ name: "resume", size: 10 }, ext, 100)).toBe("file_type");
    expect(pickedFileError({ name: "resume.pdf", size: 0 }, ext, 100)).toBe("file_empty");
    expect(pickedFileError({ name: "resume.pdf", size: 101 }, ext, 100)).toBe("file_big");
    expect(pickedFileError({ name: "resume.pdf", size: 100 }, ext, 100)).toBeNull();
  });
});
