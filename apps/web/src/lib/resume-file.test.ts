import { describe, expect, test } from "vitest";
import { RESUME_ACCEPT, checkResume } from "./resume-file";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

describe("checkResume", () => {
  test("nothing picked is none, whatever the browser names the empty part", async () => {
    expect(await checkResume(null)).toBeNull();
    expect(await checkResume("a link")).toBeNull();
    expect(await checkResume(new File([], "blob"))).toBeNull();
  });

  test("a PDF that starts like one is taken, its name cleaned to what core takes", async () => {
    const checked = await checkResume(new File([PDF], "../Nia <CV> 2026.PDF"));
    expect(checked).toEqual({ filename: "Nia CV 2026.pdf", contentType: "application/pdf", bytes: PDF });
  });

  test("past 3 MB is too big, before its bytes are read", async () => {
    expect(await checkResume(new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.pdf"))).toBe("too_big");
  });

  test("a type off the list, or bytes that are not what the name says, are refused", async () => {
    expect(await checkResume(new File([PDF], "cv.html"))).toBe("invalid");
    expect(await checkResume(new File([PDF], "cv"))).toBe("invalid");
    expect(await checkResume(new File(["<html>"], "cv.pdf"))).toBe("invalid");
  });

  test("the picker accepts exactly core's extensions", () => {
    expect(RESUME_ACCEPT.split(",").sort()).toEqual([".doc", ".docx", ".jpeg", ".jpg", ".pdf", ".png", ".txt"]);
  });
});
