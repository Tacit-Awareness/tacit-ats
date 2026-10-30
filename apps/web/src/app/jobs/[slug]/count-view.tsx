"use client";

import { useEffect } from "react";

// One view of the post, a beacon on the way in, so a crawler or a link preview
// that runs no script is not a reader. Sends nothing but the post it is on: no
// cookie, storage or id of any kind of ours, so views are page loads and not
// people. Nothing depends on it; a browser with no scripts simply isn't counted.
// `returning` is the form's redirect back, the same visit: read when this
// mounts and on purpose not a dependency, so a tab away from it is no new view.

export function CountView({ slug, returning }: { slug: string; returning: boolean }) {
  useEffect(() => {
    if (!returning) navigator.sendBeacon?.(`/api/jobs/${slug}/view`);
  }, [slug]);
  return null;
}
