import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { rankPages } from "@/components/docs/docs-search";
import { CLIENT_SITE, STAFF_SITE, docHref, docSections, findDocPage, headingId, type DocPage } from ".";

/**
 * The docs describe two MCP servers that live in another app, so nothing
 * would notice them drifting apart. These tests read the servers' source and
 * hold each tool reference page to exactly the tools registered there.
 */
const MCP_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../../mcp/src");

function registeredTools(file: string): string[] {
  const src = readFileSync(join(MCP_SRC, file), "utf8");
  return [...src.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]!).sort();
}

/** The tools named in the first column of a page's tables. */
function referencedTools(page: DocPage): string[] {
  return [...page.body.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]!).sort();
}

const linksOf = (page: DocPage) => [...page.body.matchAll(/\]\((\/docs\/[^)\s]*)\)/g)].map((m) => m[1]!);

describe("tool references match the servers", () => {
  test("the client tool reference lists exactly the client connector's tools", () => {
    const tools = registeredTools("client/server.ts");
    expect(tools.length).toBeGreaterThan(30);
    expect(referencedTools(findDocPage(CLIENT_SITE, ["client-tools"])!)).toEqual(tools);
  });

  test("the Tacit connector reference lists exactly the staff connector's tools", () => {
    const tools = registeredTools("connector/server.ts");
    expect(tools.length).toBeGreaterThan(30);
    expect(referencedTools(findDocPage(STAFF_SITE, ["connector-tools"])!)).toEqual(tools);
  });

  test("the overview's tool counts are the real ones", () => {
    const overview = findDocPage(STAFF_SITE, ["overview"])!.body;
    expect(overview).toContain(`${registeredTools("connector/server.ts").length} tools over Tacit's org`);
    expect(overview).toContain(`${registeredTools("client/server.ts").length} tools over their own company`);
  });
});

describe("the two sites", () => {
  test("slugs are unique within each site", () => {
    for (const site of [STAFF_SITE, CLIENT_SITE]) {
      const slugs = site.pages.map((p) => p.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  test("staff see every client page", () => {
    const staff = new Set(STAFF_SITE.pages.map((p) => p.slug));
    for (const p of CLIENT_SITE.pages) expect(staff.has(p.slug)).toBe(true);
  });

  test("every link between pages lands on a page of the same site", () => {
    for (const site of [STAFF_SITE, CLIENT_SITE]) {
      const slugs = new Set(site.pages.map((p) => p.slug));
      for (const page of site.pages) {
        for (const link of linksOf(page)) {
          const slug = /^\/docs\/([a-z0-9-]+)/.exec(link)?.[1];
          expect(slug && slugs.has(slug), `${site.basePath}/${page.slug} links to ${link}`).toBe(true);
        }
      }
    }
  });

  test("a client page never links outside the docs, where a client cannot follow", () => {
    for (const page of CLIENT_SITE.pages) {
      const local = [...page.body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]!);
      for (const href of local) expect(href.startsWith("/docs/"), `${page.slug} links to ${href}`).toBe(true);
    }
  });

  test("headings on a page have distinct anchors", () => {
    for (const page of STAFF_SITE.pages) {
      const ids = docSections(page).map(headingId);
      expect(new Set(ids).size, page.slug).toBe(ids.length);
    }
  });
});

describe("findDocPage", () => {
  test("no slug is the site's first page", () => {
    expect(findDocPage(STAFF_SITE, undefined)?.slug).toBe("overview");
    expect(findDocPage(CLIENT_SITE, [])?.slug).toBe("connect");
  });

  test("a staff-only page is not found on the client site", () => {
    expect(findDocPage(STAFF_SITE, ["operations"])).not.toBeNull();
    expect(findDocPage(CLIENT_SITE, ["operations"])).toBeNull();
  });

  test("nested or unknown slugs are not found", () => {
    expect(findDocPage(CLIENT_SITE, ["connect", "more"])).toBeNull();
    expect(findDocPage(CLIENT_SITE, ["nope"])).toBeNull();
  });
});

describe("docHref", () => {
  test("rewrites page links to the site they are shown on", () => {
    expect(docHref(STAFF_SITE, "/docs/files")).toBe("/docs/files");
    expect(docHref(CLIENT_SITE, "/docs/files")).toBe("/client/docs/files");
    expect(docHref(CLIENT_SITE, "/docs/access#feedback-visibility")).toBe("/client/docs/access#feedback-visibility");
  });

  test("leaves other links alone", () => {
    expect(docHref(CLIENT_SITE, "https://claude.ai")).toBe("https://claude.ai");
    expect(docHref(STAFF_SITE, "/orgs")).toBe("/orgs");
  });
});

describe("rankPages", () => {
  test("a title match outranks a body match", () => {
    const found = rankPages(CLIENT_SITE.pages, "offers");
    expect(found[0]?.slug).toBe("offers");
  });

  test("an empty query finds nothing", () => {
    expect(rankPages(CLIENT_SITE.pages, "  ")).toEqual([]);
  });
});
