"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SkyPage } from "./refusal";

// A read that fails with nothing to catch it, a dropped connection most often.
// Nothing about the failure reaches the page. Try again reloads: the boundary's own
// reset only redraws what failed, from the same server answer. Drawn as the other
// pages outside the shell (SkyPage); under the sidebar, as its title and card only.
export default function ClientError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("[client] a page failed:", error.digest ?? error.message);
  }, [error]);
  return (
    <SkyPage role="alert" title="This page didn't load">
      <p>Nothing you saved is affected. Try again in a moment.</p>
      <Button size="lg" className="w-full" onClick={() => window.location.reload()}>
        Try again
      </Button>
    </SkyPage>
  );
}
