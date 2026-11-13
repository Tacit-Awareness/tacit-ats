import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The reader's buttons (design/tats's `.kb-bar`), for the client bars and the
// server's Done reader alike: a plain file, because a server component gets no
// values out of a `"use client"` one. They are Testbench's `.btn` (ui/button.tsx):
// the one thing that deals with an issue is black, the rest raised white, and a
// confirmed rejection is red. A key's hint sits inside its button, as page.tsx's Kbd.

export const button = "gap-2";
export const primary = buttonVariants();
export const plain = buttonVariants({ variant: "outline" });
export const ghost = buttonVariants({ variant: "ghost" });
export const danger = cn(buttonVariants(), "bg-[color:var(--red)] text-[color:var(--paper)] hover:bg-[color:var(--red)] hover:brightness-110");
