"use client";

import { Link2 } from "lucide-react";
import { showToast } from "@/components/toasts";

// Listings & Asks' Careers Page button (design/tacit-tickets's Asks): copies the
// company's public careers page address, as the prototype's does.

export function CareersLink({ url }: { url: string }) {
  return (
    <button
      type="button"
      title={url}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(url)
          .then(() => showToast({ text: "Careers page link copied" }))
          .catch(() => showToast({ text: "Couldn't copy the link. It's in this button's hover." }));
      }}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 whitespace-nowrap text-ink transition hover:bg-hover"
    >
      <Link2 size={13} className="text-mute" /> Careers Page
    </button>
  );
}
