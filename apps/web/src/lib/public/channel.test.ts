import { describe, expect, test } from "vitest";
import { landingChannel, parseChannel, withVia } from "./channel";

const OWN = "ats.tacitawareness.com";
const from = (referrer: string | null) => landingChannel({}, referrer, OWN);

describe("parseChannel", () => {
  test("takes the database's four values and nothing else", () => {
    for (const c of ["linkedin", "hackernews", "direct", "other"]) expect(parseChannel(c)).toBe(c);
    for (const raw of ["", "LinkedIn", "x".repeat(5000), "toString", null, undefined, 1, ["linkedin"]]) expect(parseChannel(raw)).toBeNull();
  });
});

describe("the Referer", () => {
  test("names LinkedIn however it arrives", () => {
    for (const r of ["https://www.linkedin.com/", "https://linkedin.com/feed/", "https://uk.linkedin.com/jobs", "https://lnkd.in/abc", "android-app://com.linkedin.android/", "HTTPS://WWW.LINKEDIN.COM/"]) {
      expect(from(r)).toBe("linkedin");
    }
  });

  test("names Hacker News, and not the rest of ycombinator.com", () => {
    expect(from("https://news.ycombinator.com/item?id=1")).toBe("hackernews");
    expect(from("https://hn.algolia.com/?q=tacit")).toBe("hackernews");
    expect(from("https://www.ycombinator.com/companies")).toBe("other");
  });

  test("any other site is other, a lookalike included", () => {
    for (const r of ["https://www.google.com/", "https://t.co/abc", "https://notlinkedin.com/", "https://linkedin.com.evil.test/", "https://evil.test/linkedin.com", "https://news.ycombinator.com.evil.test/"]) {
      expect(from(r)).toBe("other");
    }
  });

  test("none, an unreadable one and this app's own are direct", () => {
    for (const r of [null, "", "not a url", "about:blank", `https://${OWN}/careers/acme`, `https://${OWN.toUpperCase()}/jobs/x`]) expect(from(r)).toBe("direct");
    expect(landingChannel({}, "http://localhost:3100/careers/acme", "localhost:3100")).toBe("direct");
    expect(landingChannel({}, "https://www.linkedin.com/", null)).toBe("linkedin");
  });
});

describe("a tag on the link", () => {
  test("wins over the Referer, whichever of the three names it", () => {
    expect(landingChannel({ utm_source: "linkedin" }, "https://t.co/x", OWN)).toBe("linkedin");
    expect(landingChannel({ ref: "hn" }, null, OWN)).toBe("hackernews");
    expect(landingChannel({ source: " Hacker News " }, null, OWN)).toBe("hackernews");
    expect(landingChannel({ utm_source: "newsletter" }, null, OWN)).toBe("other");
  });

  test("an empty one is no tag, and a repeated one reads its first", () => {
    expect(landingChannel({ utm_source: " " }, "https://www.linkedin.com/", OWN)).toBe("linkedin");
    expect(landingChannel({ ref: ["hn", "linkedin"] }, null, OWN)).toBe("hackernews");
  });
});

describe("via", () => {
  test("a carried channel beats everything, so own-host tab clicks keep it", () => {
    expect(landingChannel({ via: "linkedin" }, `https://${OWN}/jobs/x`, OWN)).toBe("linkedin");
    expect(landingChannel({ via: "direct", utm_source: "hn" }, "https://t.co/x", OWN)).toBe("direct");
  });

  test("a wrong one is ignored, not an error", () => {
    expect(landingChannel({ via: "<script>" }, "https://www.linkedin.com/", OWN)).toBe("linkedin");
    expect(landingChannel({ via: ["nope", "hackernews"] }, null, OWN)).toBe("direct");
  });

  test("rides on a link, and a direct one leaves it clean", () => {
    expect(withVia("/jobs/abc", "direct")).toBe("/jobs/abc");
    expect(withVia("/jobs/abc", "linkedin")).toBe("/jobs/abc?via=linkedin");
    expect(withVia("/jobs/abc?tab=application", "other")).toBe("/jobs/abc?tab=application&via=other");
  });
});
