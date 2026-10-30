"use client";

import { useViews } from "@/components/app-shell/shell-memory";
import { viewById } from "@/lib/saved-views";

/**
 * The saved view's name in the crumb, which only this browser knows. A link
 * from a teammate, or a browser that kept nothing, reads what the URL's
 * filters say instead, and the board is the same either way.
 */
export function ViewName({ id, fallback }: { id: string | null; fallback: string }) {
  const { state } = useViews();
  return <>{viewById(state, id)?.name ?? fallback}</>;
}
