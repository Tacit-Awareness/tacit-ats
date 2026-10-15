/**
 * One page of the connector documentation. `body` is Markdown (GFM tables
 * and fenced code). Links to other pages are written `/docs/<slug>`; the page
 * renderer rewrites them to wherever the docs are mounted (`/docs` for staff,
 * `/client/docs` for a client org's members).
 */
export type DocPage = {
  slug: string;
  title: string;
  /** The sidebar group the page is listed under. */
  category: string;
  /** One sentence under the title, and what search matches first. */
  description: string;
  body: string;
};
