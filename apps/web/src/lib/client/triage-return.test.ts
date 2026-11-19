import { afterEach, expect, test, vi } from "vitest";

const referer = vi.hoisted(() => ({ value: null as string | null, throws: false }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (referer.throws) throw new Error("outside a request");
    return new Headers(referer.value ? { referer: referer.value } : {});
  },
}));

import { postedFromTriage } from "./triage-return";

afterEach(() => {
  referer.value = null;
  referer.throws = false;
});

test("a post from Triage goes back there, whatever its query", async () => {
  referer.value = "https://ats.example.com/client/triage?a=123&department=d";
  expect(await postedFromTriage()).toBe(true);
});

test("a post from anywhere else, or with no Referer, goes where it always went", async () => {
  referer.value = "https://ats.example.com/client/inbox?i=x";
  expect(await postedFromTriage()).toBe(false);
  referer.value = "https://ats.example.com/client/triage/elsewhere";
  expect(await postedFromTriage()).toBe(false);
  referer.value = null;
  expect(await postedFromTriage()).toBe(false);
  referer.value = "not a url";
  expect(await postedFromTriage()).toBe(false);
});

test("called outside a request, as a test calls an action, it is not Triage", async () => {
  referer.throws = true;
  expect(await postedFromTriage()).toBe(false);
});
