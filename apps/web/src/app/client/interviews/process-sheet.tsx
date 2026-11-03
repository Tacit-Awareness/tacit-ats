"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Empty } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ProcessRead } from "@/lib/client/process";
import { readProcessAction } from "../onboarding/process/actions";
import { ProcessEditor } from "../onboarding/process/editor";
import "../onboarding/onboarding.css";

// design/tats's openFlow: Edit the process opens Onboarding's own editor in a
// sheet over the reader, so an admin changes it without leaving the interview.
// The process is read when the sheet opens, not with every interview. Closing
// with something unsaved asks first; closing after a save refreshes the page,
// whose way through is drawn from the process.

type Loaded = { read: ProcessRead; canEdit: boolean } | "refused" | "failed" | null;

export function ProcessSheet({ href }: { href: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="flex-none" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Edit the process
      </Button>
      {open ? <Sheet href={href} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Sheet({ href, onClose }: { href: string; onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<Loaded>(null);
  const dirty = useRef(false);
  const onDirty = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    readProcessAction()
      .then((r) => live && setLoaded(r ?? "refused"))
      .catch(() => live && setLoaded("failed"));
    return () => {
      live = false;
    };
  }, []);

  const close = () => {
    if (dirty.current && !window.confirm("Close without saving? What you changed here will be lost.")) return;
    onClose();
    // A save may have changed the way through this interview's reader draws.
    router.refresh();
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Interview process"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="proc-sheet m-auto h-[calc(100dvh-48px)] max-h-none w-[min(1280px,calc(100vw-48px))] max-w-none overflow-auto border border-[color:var(--line-strong)] bg-[color:var(--paper)] p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)] max-md:h-dvh max-md:w-screen"
    >
      <div className="grid gap-3 p-4 md:px-6">
        <header className="flex flex-wrap items-center gap-3">
          <div className="grid min-w-0 flex-1">
            <h2 className="m-0 text-[15px] font-medium">Interview process</h2>
            <p className="m-0 text-[13px] text-muted-foreground">How candidates move from applying to an offer. Each job keeps its own plan: this changes one only when you apply it.</p>
          </div>
          <Link href={href} className={buttonVariants({ size: "sm", variant: "ghost" })}>
            Open in Onboarding
          </Link>
          <Button size="sm" variant="outline" onClick={close} title="Close (Esc)">
            Close
          </Button>
        </header>
        {loaded === null ? <Empty className="my-0">Loading the process…</Empty> : null}
        {loaded === "refused" ? <Empty className="my-0">The interview process isn&apos;t yours to open.</Empty> : null}
        {loaded === "failed" ? <Empty className="my-0">The process couldn&apos;t be read. Try again, or open it in Onboarding.</Empty> : null}
        {typeof loaded === "object" && loaded ? <ProcessEditor read={loaded.read} canEdit={loaded.canEdit} onDirty={onDirty} /> : null}
      </div>
    </dialog>
  );
}
