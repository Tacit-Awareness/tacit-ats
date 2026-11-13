import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { docGroups, docHref, docSections, headingId, type DocPage, type DocsSite } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { DocsSearch } from "./docs-search";

// The connector docs, as tacit-internal's /docs draws them: groups of pages on
// the left, the page in the middle, its sections on the right. A server
// component: the Markdown is rendered here and only the search box ships JS.
// It reads nothing but the page data it is handed, so the client area can use
// it (src/client-area.test.ts walks these imports).
//
// In Testbench's language: the nav and "On this page" are quiet lists on the
// box's surface, the page you are on raised white as the sidebar's; the page
// itself is one white card for reading, its prose and tables in Mona Sans,
// code and anything you type in Geist Mono, code and notes in recessed wells.
// A page's group and summary are on its title's hover, not over and under it.

const textOf = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : isValidElement<{ children?: ReactNode }>(node)
        ? textOf(node.props.children)
        : "";

const LANGUAGES: Record<string, string> = { sh: "Shell", bash: "Shell", json: "JSON", text: "URL" };

function codeLanguage(node: ReactNode): string {
  const child = Array.isArray(node) ? node.find(isValidElement) : node;
  const cls = isValidElement<{ className?: string }>(child) ? child.props.className : undefined;
  const lang = cls?.replace("language-", "") ?? "";
  return LANGUAGES[lang] ?? (lang || "Code");
}

/** A recessed well inside the reading card: code, a note, a table. */
const well = "rounded-[10px] bg-[color:var(--soft)] shadow-[inset_0_0_0_1px_var(--line)]";

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={back ? "M13 8H3M7 4L3 8l4 4" : "M3 8h10M9 4l4 4-4 4"} />
    </svg>
  );
}

export function DocsView({ site, page }: { site: DocsSite; page: DocPage }) {
  const groups = docGroups(site);
  const sections = docSections(page);
  const index = site.pages.findIndex((p) => p.slug === page.slug);
  const previous = index > 0 ? site.pages[index - 1] : undefined;
  const next = site.pages[index + 1];
  const searchable = site.pages.map(({ slug, title, description, body }) => ({ slug, title, description, body }));

  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-6 min-[1024px]:grid-cols-[210px_minmax(0,1fr)] min-[1280px]:grid-cols-[210px_minmax(0,1fr)_170px] min-[1440px]:gap-7">
      <aside className="min-[1024px]:sticky min-[1024px]:top-7 min-[1024px]:max-h-[calc(100dvh-8rem)] min-[1024px]:-mx-1 min-[1024px]:self-start min-[1024px]:overflow-y-auto min-[1024px]:px-1 min-[1024px]:pt-0.5 min-[1024px]:pb-4 min-[1024px]:[scrollbar-width:none]">
        <p className="m-0 px-2.5 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]" title={site.intro}>
          {site.title}
          <span className="sr-only">. {site.intro}</span>
        </p>
        <div className="mt-3">
          <DocsSearch basePath={site.basePath} pages={searchable} />
        </div>
        <nav aria-label="Documentation" className="mt-5 grid gap-4">
          {groups.map((group) => (
            <section key={group.category}>
              <h2 className="m-0 mb-1 px-2.5 font-mono text-[12px] leading-[18px] font-medium tracking-normal text-faint">{group.category}</h2>
              <ul className="m-0 grid list-none gap-px p-0">
                {group.pages.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`${site.basePath}/${p.slug}`}
                      aria-current={p.slug === page.slug ? "page" : undefined}
                      title={p.description}
                      className={cn(
                        "flex min-h-[30px] items-center rounded-[8px] px-2.5 py-[5px] font-sans text-[13.5px] leading-[18px] transition-colors",
                        p.slug === page.slug
                          ? "bg-[color:var(--pick)] font-medium text-[color:var(--pick-ink)] shadow-[var(--pick-shadow)]"
                          : "text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground",
                      )}
                    >
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 rounded-[14px] bg-card px-6 pt-8 pb-6 shadow-[var(--shadow)] min-[640px]:px-8 min-[640px]:pt-9 min-[640px]:pb-8 min-[1440px]:px-10">
        <header>
          <h1 className="m-0 font-sans text-[30px] leading-[36px] font-semibold tracking-[-0.025em]" title={`${page.category}: ${page.description}`}>
            {page.title}
          </h1>
          <p className="sr-only">{page.description}</p>
        </header>

        <div className="docs-body max-w-[68ch] font-sans text-[15px] leading-6 text-[color:var(--muted-text)]">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              h2: ({ children }) => (
                <h2 id={headingId(textOf(children))} className="mt-10 mb-0 scroll-mt-6 text-[20px] leading-7 font-semibold tracking-[-0.015em] text-foreground">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 id={headingId(textOf(children))} className="mt-7 mb-0 scroll-mt-6 text-[16px] leading-6 font-semibold tracking-[-0.01em] text-foreground">
                  {children}
                </h3>
              ),
              p: ({ children }) => <p className="mt-4 mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              ul: ({ children }) => <ul className="mt-4 mb-0 list-disc space-y-1.5 pl-5 marker:text-[color:var(--ink-4)]">{children}</ul>,
              ol: ({ children }) => <ol className="mt-4 mb-0 list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-[13px] marker:text-faint">{children}</ol>,
              blockquote: ({ children }) => (
                <blockquote className={cn("mx-0 mt-4 mb-0 px-4 py-px text-foreground [&>p]:my-3", well)}>
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => {
                const to = href ? docHref(site, href) : "";
                const external = to.startsWith("https://") || to.startsWith("http://");
                const cls = "text-[color:var(--accent)] underline decoration-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] underline-offset-[3px] transition-colors hover:decoration-[color:var(--accent)]";
                return external ? (
                  <a href={to} target="_blank" rel="noopener noreferrer" className={cls}>
                    {children}
                  </a>
                ) : (
                  <Link href={to} className={cls}>
                    {children}
                  </Link>
                );
              },
              code: ({ className, children }) =>
                className ? (
                  <code className={className}>{children}</code>
                ) : (
                  <code className="rounded-[4px] bg-[color:var(--soft-strong)] px-[5px] py-px font-mono text-[13px] text-foreground">{children}</code>
                ),
              pre: ({ children }) => (
                <div className={cn("mt-4 overflow-hidden", well)}>
                  <div className="flex h-9 items-center justify-between border-b border-[color:var(--line)] pr-1 pl-4">
                    <span className="font-mono text-[12px] text-faint">{codeLanguage(children)}</span>
                    <CopyButton value={textOf(children).replace(/\n$/, "")} label="Copy" className="rounded-[7px] hover:bg-[color:var(--hover)]" />
                  </div>
                  <pre className="m-0 overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-5 text-foreground">{children}</pre>
                </div>
              ),
              table: ({ children }) => (
                <div className="mt-4 overflow-x-auto rounded-[10px] shadow-[inset_0_0_0_1px_var(--line)]">
                  {/* a table of four or more columns keeps readable cells and scrolls sideways in a narrow window, rather than stacking a word a line */}
                  <table className="w-full border-collapse text-left text-[14px] leading-[21px] [&:has(th:nth-child(4))]:min-w-[34rem]">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="h-10 border-b border-[color:var(--line)] px-3.5 align-middle font-mono text-[12px] font-normal text-faint">{children}</th>
              ),
              td: ({ children }) => (
                <td className="border-b border-[color:var(--line)] px-3.5 py-3 align-top text-muted-foreground [tr:last-child>&]:border-b-0">{children}</td>
              ),
            }}
          >
            {page.body}
          </Markdown>
        </div>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--line)] pt-5">
          {previous ? (
            <Link
              href={`${site.basePath}/${previous.slug}`}
              title="Previous page"
              aria-label={`Previous: ${previous.title}`}
              className={buttonVariants({ variant: "outline", className: "max-w-full justify-start" })}
            >
              <Arrow back />
              <span className="truncate">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`${site.basePath}/${next.slug}`}
              title="Next page"
              aria-label={`Next: ${next.title}`}
              className={buttonVariants({ variant: "outline", className: "ml-auto max-w-full justify-end" })}
            >
              <span className="truncate">{next.title}</span>
              <Arrow />
            </Link>
          ) : null}
        </footer>
      </article>

      {sections.length > 0 ? (
        <nav aria-label="On this page" className="hidden min-[1280px]:sticky min-[1280px]:top-7 min-[1280px]:block min-[1280px]:self-start">
          <p className="m-0 mb-2 pl-3 font-mono text-[12px] leading-[18px] font-medium text-faint">On this page</p>
          <ul className="m-0 grid list-none border-l border-[color:var(--line-strong)] p-0">
            {sections.map((title) => (
              <li key={title}>
                <a
                  href={`#${headingId(title)}`}
                  className="-ml-px block border-l border-transparent py-1 pl-3 font-sans text-[13px] leading-[18px] text-muted-foreground transition-colors hover:border-[color:var(--ink)] hover:text-foreground"
                >
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
