import Link from "next/link";
import type { PublicBrand } from "@/lib/public/jobs";
import "./careers.css";

// The public careers pages' frame, drawn as Testbench's applicant screens: the
// day sky (the body paints it) with the page in one rounded box on top of it, a
// slim top row in the box with the company's name, and "Hiring with Tacit" at
// the box's foot. Everything under .careers wears careers.css and follows the
// system theme through the tokens. The page is the company's, so its accent,
// when it has one, is the colour of the apply buttons (--solid); without one
// they are Testbench's black.

export function Ico({ d }: { d: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const ICON = {
  back: "M19 12H5M11 18l-6-6 6-6",
  search: "M11 11m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M20 20l-4.3-4.3",
  down: "m7 10 5 5 5-5",
  file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M9 13h6M9 17h4",
  out: "M7 17 17 7M8 7h9v9",
  check: "m6 12.5 4 4 8-9",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4",
  team: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M16 5.3a3 3 0 0 1 0 5.4M18.2 14.2c1.3.8 2.1 2.4 2.3 4.8",
  // The command key, drawn: Geist Mono has no ⌘ of its own, and a fallback font's is too small.
  cmd: "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3",
};

export function CareersFrame({
  company,
  brand,
  boardHref,
  allRoles = false,
  children,
}: {
  company: string;
  brand: PublicBrand | null;
  boardHref: string | null;
  /** On a role's page: the way back to the board. */
  allRoles?: boolean;
  children: React.ReactNode;
}) {
  const name = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a stored public file, not a page asset */}
      {brand?.logoUrl ? <img className="brand-logo" src={brand.logoUrl} alt="" /> : null}
      <span className="brand-name">{company}</span>
    </>
  );
  // The brand's hover is the brand a shade deeper, so a company colour never turns Testbench's black under the pointer.
  const accent = brand?.colors
    ? ({
        "--solid": brand.colors.solid,
        "--on-solid": brand.colors.onSolid,
        "--solid-hover": `color-mix(in oklab, ${brand.colors.solid} 86%, black)`,
      } as React.CSSProperties)
    : undefined;
  return (
    <div className="careers" style={accent}>
      <div className="cbox">
        <header className="top">
          {boardHref ? (
            <Link className="brand" href={boardHref}>
              {name}
            </Link>
          ) : (
            <span className="brand">{name}</span>
          )}
        </header>
        <main>
          {allRoles && boardHref ? (
            <nav className="wrap back" aria-label="Back">
              <Link className="backlink" href={boardHref}>
                <Ico d={ICON.back} />
                All roles
              </Link>
            </nav>
          ) : null}
          {children}
        </main>
        <footer className="foot">
          <span className="tacit">
            <svg viewBox="0 0 80 80" aria-hidden>
              <path d="M 40 14 H 66 V 40 M 40 66 H 14 V 40" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Hiring with Tacit
          </span>
        </footer>
      </div>
    </div>
  );
}
