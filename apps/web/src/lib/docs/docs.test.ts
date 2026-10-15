import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { rankPages } from "@/components/docs/docs-search";
import { CLIENT_SITE, docHref, docSections, findDocPage, headingId, type DocPage } from ".";

/**
 * The docs describe the client connector, which lives in another app, so
 * nothing would notice them drifting apart. These tests read its source and
 * hold the tool reference page to exactly the tools registered there.
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

});

describe("the client site", () => {
  test("slugs are unique", () => {
    for (const site of [CLIENT_SITE]) {
      const slugs = site.pages.map((p) => p.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  test("every link between pages lands on a page of the site", () => {
    for (const site of [CLIENT_SITE]) {
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
    for (const page of CLIENT_SITE.pages) {
      const ids = docSections(page).map(headingId);
      expect(new Set(ids).size, page.slug).toBe(ids.length);
    }
  });
});

describe("findDocPage", () => {
  test("no slug is the site's first page", () => {
    expect(findDocPage(CLIENT_SITE, [])?.slug).toBe("connect");
  });

  test("a staff-only page is not found on the client site", () => {
    expect(findDocPage(CLIENT_SITE, ["operations"])).toBeNull();
  });

  test("nested or unknown slugs are not found", () => {
    expect(findDocPage(CLIENT_SITE, ["connect", "more"])).toBeNull();
    expect(findDocPage(CLIENT_SITE, ["nope"])).toBeNull();
  });
});

describe("docHref", () => {
  test("rewrites page links to the site they are shown on", () => {
    expect(docHref(CLIENT_SITE, "/docs/files")).toBe("/client/docs/files");
    expect(docHref(CLIENT_SITE, "/docs/access#feedback-visibility")).toBe("/client/docs/access#feedback-visibility");
  });

  test("leaves other links alone", () => {
    expect(docHref(CLIENT_SITE, "https://claude.ai")).toBe("https://claude.ai");
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
