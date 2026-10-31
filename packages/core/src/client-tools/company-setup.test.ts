import type { Db } from "@tacit/db";
import { describe, expect, test, vi } from "vitest";

import { readAllPages, seesCompanySetup } from "./company-setup.js";
import { ClientToolError } from "./context.js";
import { INTERVIEW_TYPE_NAME_MAX, cleanTypeName } from "./interview-types.js";
import { MEMBER_TITLE_MAX, cleanTitle } from "./interviewer-profiles.js";

const refused = (run: () => unknown) => {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(ClientToolError);
    return (err as ClientToolError).code;
  }
  throw new Error("not refused");
};

describe("cleanTypeName", () => {
  test("is one trimmed line, inner space collapsed", () => {
    expect(cleanTypeName("  System \n  design\t")).toBe("System design");
  });

  test("refuses nothing, too long, stray characters and half a surrogate pair", () => {
    for (const bad of ["   ", "x".repeat(INTERVIEW_TYPE_NAME_MAX + 1), "a\u0000b", "a\u0085b", "a\ud83d"]) expect(refused(() => cleanTypeName(bad))).toBe("invalid");
  });

  test("counts characters, not UTF-16 units, as the column does", () => {
    expect(cleanTypeName("😀".repeat(INTERVIEW_TYPE_NAME_MAX))).toHaveLength(INTERVIEW_TYPE_NAME_MAX * 2);
  });
});

describe("cleanTitle", () => {
  test("empty means not said", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle(null)).toBeNull();
    expect(cleanTitle("   ")).toBeNull();
  });

  test("trims what the column's btrim would leave a row refused for", () => {
    expect(cleanTitle("​Staff engineer ")).toBe("Staff engineer");
  });

  test("refuses too long, a second line and half a surrogate pair", () => {
    for (const bad of ["x".repeat(MEMBER_TITLE_MAX + 1), "a\nb", "a\ud83db"]) expect(refused(() => cleanTitle(bad))).toBe("invalid");
  });
});

describe("seesCompanySetup", () => {
  const db = (answer: boolean) => ({ rpc: vi.fn(async () => ({ data: answer, error: null })) }) as unknown as Db;

  test("the level settles an admin and an interviewer without asking", async () => {
    const asked = db(false);
    expect(await seesCompanySetup(asked, { accessLevel: "admin" })).toBe(true);
    expect(await seesCompanySetup(asked, { accessLevel: "limited" })).toBe(false);
    expect(asked.rpc).not.toHaveBeenCalled();
  });

  test("the elevated level does not: an external recruiter is elevated too", async () => {
    expect(await seesCompanySetup(db(true), { accessLevel: "elevated" })).toBe(true);
    expect(await seesCompanySetup(db(false), { accessLevel: "elevated" })).toBe(false);
  });

  test("a database failure is not a no", async () => {
    const broken = { rpc: async () => ({ data: null, error: { message: "down" } }) } as unknown as Db;
    await expect(seesCompanySetup(broken, { accessLevel: "elevated" })).rejects.toThrow("down");
  });
});

describe("readAllPages", () => {
  test("reads until a short page, whatever one request brings back", async () => {
    const page = vi.fn(async (from: number) => ({ data: Array.from({ length: from < 2000 ? 1000 : 3 }, (_, n) => from + n), error: null }));
    expect(await readAllPages(page)).toHaveLength(2003);
    expect(page).toHaveBeenCalledTimes(3);
  });

  test("a page that fails fails the read", async () => {
    await expect(readAllPages(async () => ({ data: null, error: { message: "down" } }))).rejects.toThrow("down");
  });
});
