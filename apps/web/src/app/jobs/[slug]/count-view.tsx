"use client";

import { useEffect } from "react";

// One view of the post, a beacon on the way in, so a crawler or a link preview
// that runs no script is not a reader. Sends nothing but the post it is on: no
// cookie, storage or id of any kind of ours, so views are page loads and not
// people. Nothing depends on it; a browser with no scripts simply isn't counted.

export function CountView({ slug }: { slug: string }) {
  useEffect(() => {
    navigator.sendBeacon?.(`/api/jobs/${slug}/view`);
  }, [slug]);
  return null;
}
