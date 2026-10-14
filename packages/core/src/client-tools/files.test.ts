import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { FILE_LINK_SECONDS, FILE_MAX_BYTES, addFile, getFileLink, listFiles, type FileStore } from "./files.js";

/**
 * What the file tools add on top of the person_files policies (pinned against
 * real Postgres in the SQL suite and apps/mcp's client.integration.test.ts):
 * checks on what is uploaded before anything is read, a sentence before a
 * refused write, the row before the bytes, the row taken back when the bytes
 * do not land, and Storage reached only with the row's own path.
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});
const rpcs = (fake: FakeSupabase) => fake.calls.filter((c) => c.op === "rpc").map((c) => c.table);

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

/** A Storage stand-in that records what it was asked. */
function fakeStore(over: Partial<FileStore> = {}) {
  const puts: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];
  const signs: Array<{ path: string; seconds: number; filename: string }> = [];
  const store: FileStore = {
    put: async (path, bytes, contentType) => {
      puts.push({ path, bytes, contentType });
    },
    signedUrl: async (path, seconds, filename) => {
      signs.push({ path, seconds, filename });
      return `https://storage.test/sign/${path}?token=t`;
    },
    ...over,
  };
  return { store, puts, signs };
}

const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64");
const PDF = b64("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const PERSON = "person-1";
const FILE_ROW = {
  id: "file-1", kind: "resume", filename: "ada.pdf", content_type: "application/pdf", size_bytes: 2048,
  uploaded_by_actor_id: "actor-1", created_at: "2026-10-15T00:00:00Z",
};
const upload = (over: Partial<Parameters<typeof addFile>[3]> = {}) => ({
  candidateId: PERSON, kind: "resume" as const, filename: "Ada Lovelace (CV).pdf", contentType: "application/pdf", contentBase64: PDF, ...over,
});

describe("listFiles", () => {
  test("the files the member reads, with who added them", async () => {
    const fake = new FakeSupabase([{ data: [FILE_ROW, { ...FILE_ROW, id: "file-2", uploaded_by_actor_id: null }] }, { data: [{ id: "actor-1", display_name: "Ada Admin" }] }]);
    const files = await listFiles(fake.asDb(), ctx(), { candidateId: PERSON });
    expect(files.map((f) => [f.fileId, f.uploadedBy])).toEqual([["file-1", "Ada Admin"], ["file-2", null]]);
    expect(files[0]).toMatchObject({ kind: "resume", filename: "ada.pdf", contentType: "application/pdf", sizeBytes: 2048 });
    expect(fake.calls[0].filters).toEqual([{ method: "eq", column: "person_id", value: PERSON }]);
  });

  test("no files is an empty list for a candidate the member sees, and not found otherwise", async () => {
    expect(await listFiles(new FakeSupabase([{ data: [] }, { data: { id: PERSON } }]).asDb(), ctx(), { candidateId: PERSON })).toEqual([]);
    expect((await refusal(listFiles(new FakeSupabase([{ data: [] }, { data: null }]).asDb(), ctx(), { candidateId: PERSON }))).code)
      .toBe("not_found");
    // An interviewer's candidates are the ones they interview.
    const limited = new FakeSupabase([{ data: [] }, { data: [{ person_id: "someone-else" }] }]);
    expect((await refusal(listFiles(limited.asDb(), ctx("limited"), { candidateId: PERSON }))).code).toBe("not_found");
    expect(rpcs(limited)).toEqual(["my_interview_candidates"]);
  });
});

describe("getFileLink", () => {
  const ROW = { id: "file-1", org_id: "org-1", person_id: PERSON, kind: "resume", filename: "ada.pdf", storage_path: `org-1/${PERSON}/file-1` };

  test("without Storage it says so, and reads nothing", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(getFileLink(fake.asDb(), ctx(), null, { fileId: "file-1" }))).message).toMatch(/not available/);
    expect(fake.calls).toEqual([]);
  });

  test("a file the member cannot read is not found, and nothing is signed", async () => {
    const { store, signs } = fakeStore();
    const err = await refusal(getFileLink(new FakeSupabase([{ data: null }]).asDb(), ctx(), store, { fileId: "file-1" }));
    expect(err.code).toBe("not_found");
    expect(signs).toEqual([]);
  });

  test("the row's own path is signed for a few minutes, downloading under its name", async () => {
    const { store, signs } = fakeStore();
    const link = await getFileLink(new FakeSupabase([{ data: ROW }]).asDb(), ctx("limited"), store, { fileId: "file-1" }, () => 0);
    expect(signs).toEqual([{ path: `org-1/${PERSON}/file-1`, seconds: FILE_LINK_SECONDS, filename: "ada.pdf" }]);
    expect(FILE_LINK_SECONDS).toBeLessThanOrEqual(600);
    expect(link).toMatchObject({ fileId: "file-1", candidateId: PERSON, kind: "resume", expiresAt: new Date(FILE_LINK_SECONDS * 1000).toISOString() });
    expect(link.url).toContain("token=");
  });

  test("a row whose path is not its own is never signed", async () => {
    const { store, signs } = fakeStore();
    const fake = new FakeSupabase([{ data: { ...ROW, storage_path: `org-2/${PERSON}/file-1` } }]);
    await expect(getFileLink(fake.asDb(), ctx(), store, { fileId: "file-1" })).rejects.toThrow(/not the row's own/);
    expect(signs).toEqual([]);
  });

  test("a row with nothing stored behind it is a sentence", async () => {
    const { store } = fakeStore({ signedUrl: async () => null });
    expect((await refusal(getFileLink(new FakeSupabase([{ data: ROW }]).asDb(), ctx(), store, { fileId: "file-1" }))).message)
      .toMatch(/contents are missing/);
  });
});

describe("addFile", () => {
  test("without Storage it says so, and reads nothing", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(addFile(fake.asDb(), ctx(), null, upload()))).message).toMatch(/not available/);
    expect(fake.calls).toEqual([]);
  });

  test("what is uploaded is checked before anything is read", async () => {
    const { store, puts } = fakeStore();
    const fake = new FakeSupabase();
    const tooBig = new Uint8Array(FILE_MAX_BYTES + 1);
    tooBig.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    for (const [over, message] of [
      [{ contentType: "text/html" }, /takes PDF/],
      [{ contentType: "application/x-msdownload", filename: "cv.exe" }, /takes PDF/],
      [{ filename: "../../etc/passwd.pdf" }, /letters, digits/],
      [{ filename: "<script>.pdf" }, /letters, digits/],
      [{ filename: ".pdf" }, /letters, digits/],
      [{ filename: "cv.docx" }, /ends in \.pdf/],
      [{ filename: `${"a".repeat(201)}.pdf` }, /1 to 200/],
      [{ contentBase64: "data:application/pdf;base64,JVBERi0=" }, /standard base64/],
      [{ contentBase64: "%%%%" }, /standard base64/],
      [{ contentBase64: "   " }, /empty/],
      [{ contentBase64: b64(tooBig) }, /at most 3 MB/],
      [{ contentBase64: b64("<html>not a pdf</html>") }, /not a PDF file/],
      [{ contentType: "image/png", filename: "a.png", contentBase64: b64("\xff\xd8\xff jpeg really") }, /not a PNG file/],
      [{ contentType: "text/plain", filename: "a.txt", contentBase64: b64(new Uint8Array([0x68, 0x00, 0x69])) }, /not a plain text file/],
      [{ kind: "photo" as never }, /resume or attachment/],
    ] as const) {
      const err = await refusal(addFile(fake.asDb(), ctx(), store, upload(over)));
      expect(err.code).toBe("invalid");
      expect(err.message).toMatch(message);
    }
    expect(fake.calls).toEqual([]);
    expect(puts).toEqual([]);
  });

  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(addFile(fake.asDb(), ctx("limited"), fakeStore().store, upload()))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("someone who may not edit the candidate is told so, or that there is no such candidate, and nothing is claimed", async () => {
    const seen = new FakeSupabase([{ data: false }, { data: { id: PERSON } }]);
    expect((await refusal(addFile(seen.asDb(), ctx("elevated"), fakeStore().store, upload()))).code).toBe("forbidden");
    expect(rpcs(seen)).toEqual(["can_edit_person"]);
    const unseen = new FakeSupabase([{ data: false }, { data: null }]);
    expect((await refusal(addFile(unseen.asDb(), ctx("elevated"), fakeStore().store, upload()))).code).toBe("not_found");
  });

  test("the row lands first, with its own id and path and no read-back, then the bytes, and the audit row keeps no filename", async () => {
    const { store, puts } = fakeStore();
    const fake = new FakeSupabase([{ data: true }, { data: "audit-1" }, { data: null }, { data: null }]);
    const r = await addFile(fake.asDb(), ctx("elevated"), store, upload({ filename: "  Ada   Lovelace (CV).PDF ", contentType: "Application/PDF; charset=binary" }));
    expect(r).toMatchObject({ kind: "resume", filename: "Ada Lovelace (CV).PDF" });
    expect(rpcs(fake)).toEqual(["can_edit_person", "client_claim_write", "client_finish_write"]);
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert).toMatchObject({
      table: "person_files",
      args: {
        id: r.fileId, person_id: PERSON, kind: "resume", storage_path: `org-1/${PERSON}/${r.fileId}`,
        filename: "Ada Lovelace (CV).PDF", content_type: "application/pdf", size_bytes: r.sizeBytes,
      },
    });
    expect(insert?.terminal).toBe("await");
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toBe(`org-1/${PERSON}/${r.fileId}`);
    expect(puts[0].contentType).toBe("application/pdf");
    expect(Buffer.from(puts[0].bytes).toString("base64")).toBe(PDF);
    const finish = fake.calls.find((c) => c.table === "client_finish_write");
    expect(finish?.args).toMatchObject({ p_entity_id: r.fileId, p_keep: true, p_after: { candidate_id: PERSON, kind: "resume", content_type: "application/pdf" } });
    expect(JSON.stringify(finish?.args)).not.toContain("Lovelace");
  });

  test("the database refusing the row stores nothing", async () => {
    const { store, puts } = fakeStore();
    const fake = new FakeSupabase([{ data: true }, { data: "audit-1" }, { error: { code: "42501", message: "row-level security" } }, { data: null }]);
    expect((await refusal(addFile(fake.asDb(), ctx(), store, upload()))).code).toBe("forbidden");
    expect(puts).toEqual([]);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });

  test("bytes that do not land take the row back, as the member, and give the claim back", async () => {
    const { store } = fakeStore({ put: async () => { throw new Error("storage down"); } });
    const fake = new FakeSupabase([{ data: true }, { data: "audit-1" }, { data: null }, { data: [{ id: "x" }] }, { data: null }]);
    const errSpy = console.error;
    console.error = () => {};
    try {
      expect((await refusal(addFile(fake.asDb(), ctx(), store, upload()))).message).toMatch(/could not be stored, so nothing was saved/);
    } finally {
      console.error = errSpy;
    }
    const insert = fake.calls.find((c) => c.op === "insert");
    const undo = fake.calls.find((c) => c.op === "delete");
    expect(undo).toMatchObject({ table: "person_files", filters: [{ method: "eq", column: "id", value: (insert?.args as { id: string }).id }] });
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });

  test("a row that cannot be taken back is a failure, not a sentence, and its claim stays open", async () => {
    const { store } = fakeStore({ put: async () => { throw new Error("storage down"); } });
    const fake = new FakeSupabase([{ data: true }, { data: "audit-1" }, { data: null }, { data: [] }]);
    const err = await addFile(fake.asDb(), ctx(), store, upload()).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ClientToolError);
    expect(rpcs(fake)).not.toContain("client_finish_write");
  });
});
