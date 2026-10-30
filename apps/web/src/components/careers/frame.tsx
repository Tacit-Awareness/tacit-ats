import Link from "next/link";
import "./careers.css";

// The public careers pages' frame (design/careers): the company's name in the
// middle of the top bar, All roles in the corner on a role's page, and the
// footer. Everything under .careers wears careers.css, light only on purpose:
// the page is the company's, not the member's theme.

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
  chev: "m9 18 6-6-6-6",
  file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M9 13h6M9 17h4",
  out: "M7 17 17 7M8 7h9v9",
  check: "m6 12.5 4 4 8-9",
};

export function CareersFrame({
  company,
  boardHref,
  allRoles = false,
  children,
}: {
  company: string;
  boardHref: string | null;
  /** On a role's page: the way back to the board. */
  allRoles?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="careers">
      <header className="top">
        <div className="top-in">
          {allRoles && boardHref ? (
            <nav className="corner" aria-label="Back">
              <Link className="navbtn" href={boardHref}>
                <Ico d={ICON.back} />
                All roles
              </Link>
            </nav>
          ) : null}
          {boardHref ? (
            <Link className="brand" href={boardHref}>
              {company}
            </Link>
          ) : (
            <span className="brand">{company}</span>
          )}
        </div>
      </header>
      <main>{children}</main>
      <footer className="foot">
        <span className="tacit">
          <svg viewBox="0 0 80 80" aria-hidden>
            <path d="M 40 14 H 66 V 40 M 40 66 H 14 V 40" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Hiring with Tacit
        </span>
      </footer>
    </div>
  );
}
