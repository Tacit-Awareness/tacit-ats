import { CLIENT_DOCS } from "./client-pages";
import { STAFF_DOCS, STAFF_OVERVIEW } from "./staff-pages";
import type { DocPage } from "./types";

export type { DocPage } from "./types";
export { CLIENT_CONNECTOR_URL } from "./client-pages";
export { STAFF_CONNECTOR_URL } from "./staff-pages";

/**
 * One mounted copy of the docs: the pages it shows, in reading order (the
 * sidebar groups and the previous / next links follow it), and the path it is
 * served under. The first page is what the bare path shows.
 */
export type DocsSite = {
  basePath: string;
  title: string;
  intro: string;
  pages: DocPage[];
};

const staffOnly = (category: string) => STAFF_DOCS.filter((p) => p.category === category);

/** /docs: everything, the client pages grouped together in the middle. */
export const STAFF_SITE: DocsSite = {
  basePath: "/docs",
  title: "Connector docs",
  intro: "Using Tacit from Claude: the Tacit connector, the client connector, and how both are run.",
  pages: [
    STAFF_OVERVIEW,
    ...staffOnly("Tacit connector"),
    ...CLIENT_DOCS.map((p) => ({ ...p, category: "Client connector" })),
    ...staffOnly("Other servers"),
    ...staffOnly("Administration"),
  ],
};

/** /client/docs: the client connector only. */
export const CLIENT_SITE: DocsSite = {
  basePath: "/client/docs",
  title: "Tacit in Claude",
  intro: "Work your company's hiring in Claude with the Tacit connector.",
  pages: CLIENT_DOCS,
};

/** The page a slug names, or the site's first page for no slug; null when there is none. */
export function findDocPage(site: DocsSite, slug: string[] | undefined): DocPage | null {
  if (!slug || slug.length === 0) return site.pages[0] ?? null;
  if (slug.length > 1) return null;
  return site.pages.find((p) => p.slug === slug[0]) ?? null;
}

/** Categories in the order their first page appears. */
export function docGroups(site: DocsSite): { category: string; pages: DocPage[] }[] {
  const groups: { category: string; pages: DocPage[] }[] = [];
  for (const page of site.pages) {
    const group = groups.find((g) => g.category === page.category);
    if (group) group.pages.push(page);
    else groups.push({ category: page.category, pages: [page] });
  }
  return groups;
}

/** The page's `## ` headings, for the "On this page" list. */
export function docSections(page: DocPage): string[] {
  return [...page.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
}

/** The anchor id a heading gets; the renderer and the section list share it. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Where a link in a page body goes on this site. Bodies link to each other as
 * `/docs/<slug>`, which becomes `<basePath>/<slug>`; anything else is left as
 * written.
 */
export function docHref(site: DocsSite, href: string): string {
  const m = /^\/docs\/([a-z0-9-]+)(#.*)?$/.exec(href);
  return m ? `${site.basePath}/${m[1]}${m[2] ?? ""}` : href;
}
