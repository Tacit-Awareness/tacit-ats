"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// A read that fails with nothing to catch it, a dropped connection most often.
// Nothing about the failure reaches the page. Try again reloads: the boundary's own
// reset only redraws what failed, from the same server answer.
export default function ClientError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("[client] a page failed:", error.digest ?? error.message);
  }, [error]);
  return (
    <div role="alert" className="mx-auto grid max-w-[420px] justify-items-start gap-3 p-8">
      <h1 className="m-0 text-[17px] font-semibold">This page didn&apos;t load</h1>
      <p className="m-0 text-[14px] text-muted-foreground">Nothing you saved is affected. Try again in a moment.</p>
      <Button size="sm" onClick={() => window.location.reload()}>
        Try again
      </Button>
    </div>
  );
}
