import { ExternalLink } from "lucide-react";

// Listings & Asks' Careers Page button: opens the company's public careers
// page (/careers/<org>) in a new tab, as applicants see it. The address is the
// link's own, so it can still be copied from the browser's link menu.

export function CareersLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener"
      title={url}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 whitespace-nowrap text-ink transition hover:bg-hover"
    >
      Careers Page <ExternalLink size={13} className="text-mute" />
    </a>
  );
}
