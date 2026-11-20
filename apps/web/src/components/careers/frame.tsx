import Link from "next/link";
import type { PublicBrand } from "@/lib/public/jobs";
import "./careers.css";

// The public careers pages' frame (design/careers, the Polymr prototype): a
// near-white page, the company's logo and name in the middle of the top bar,
// "All roles" in its left corner on a role's page, and "Hiring with Tacit" at
// the foot under a hairline. Everything under .careers wears careers.css. The
// page is the company's, so its accent, when it has one, colours its name in
// the board's title (--brand) and the apply buttons (--solid); without one the
// name is a warm grey and the buttons near-black.

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
  right: "m9 18 6-6-6-6",
  file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M9 13h6M9 17h4",
  folder: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  folderOpen:
    "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  out: "M7 17 17 7M8 7h9v9",
  check: "m6 12.5 4 4 8-9",
  alert: "M12 8v5M12 16.5v.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  // The command key, drawn, so it is the same size in every font.
  cmd: "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3",
};

const PAGE: [number, number, number] = [0xfc, 0xfb, 0xf8];

function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The accent as text on the page: an accent is tuned as a button's fill, and a
 * light one (a yellow, a pale cyan) is hard to read as a title, so it is taken
 * darker, a step at a time, until it reads at 3:1 (large text). A colour that is
 * not #rrggbb is used as it is.
 */
export function readableOnPage(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const page = luminance(PAGE);
  let rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < 20 && (page + 0.05) / (luminance(rgb) + 0.05) < 3; i++) rgb = rgb.map((c) => c * 0.92);
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** The company's colours on the page: its name in the title and the apply buttons. */
function accentStyle(brand: PublicBrand | null): React.CSSProperties | undefined {
  if (!brand?.colors) return undefined;
  const { solid, onSolid } = brand.colors;
  // The hover is the brand a shade deeper, so a company colour never turns black under the pointer.
  return {
    "--brand": readableOnPage(solid),
    "--solid": solid,
    "--on-solid": onSolid,
    "--solid-hover": `color-mix(in oklab, ${solid} 86%, black)`,
  } as React.CSSProperties;
}

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
  return (
    <div className="careers" style={accentStyle(brand)}>
      <header className="top">
        {allRoles && boardHref ? (
          <nav className="corner" aria-label="Back">
            <Link className="navbtn" href={boardHref}>
              <Ico d={ICON.back} />
              <span className="navbtn-text">All roles</span>
            </Link>
          </nav>
        ) : null}
        {boardHref ? (
          <Link className="brand" href={boardHref} aria-label={`${company} open roles`}>
            {name}
          </Link>
        ) : (
          <span className="brand">{name}</span>
        )}
      </header>
      <main>{children}</main>
      <footer className="foot">
        <div className="wrap foot-in">
          <span className="tacit">
            <svg viewBox="0 0 80 80" aria-hidden>
              <path d="M 40 14 H 66 V 40 M 40 66 H 14 V 40" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Hiring with Tacit
          </span>
        </div>
      </footer>
    </div>
  );
}
