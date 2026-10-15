import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/copy-button";
import { docGroups, docHref, docSections, headingId, type DocPage, type DocsSite } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { DocsSearch } from "./docs-search";

// The connector docs, laid out like Tacit Testbench's /docs: groups of pages on
// the left, the page in the middle, its sections on the right. A server
// component: the Markdown is rendered here and only the search box ships JS.
// It reads nothing but the page data it is handed, so the client area can use
// it (src/client-area.test.ts walks these imports).

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

export function DocsView({ site, page }: { site: DocsSite; page: DocPage }) {
  const groups = docGroups(site);
  const sections = docSections(page);
  const index = site.pages.findIndex((p) => p.slug === page.slug);
  const previous = index > 0 ? site.pages[index - 1] : undefined;
  const next = site.pages[index + 1];
  const searchable = site.pages.map(({ slug, title, description, body }) => ({ slug, title, description, body }));

  return (
    <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_180px]">
      <aside className="lg:sticky lg:top-24 lg:-mx-2.5 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:px-2.5 lg:pb-1">
        <p className="font-heading text-[22px] leading-tight font-medium">{site.title}</p>
        <p className="mt-2 text-[14.5px] leading-[1.6] text-text">{site.intro}</p>
        <div className="mt-4">
          <DocsSearch basePath={site.basePath} pages={searchable} />
        </div>
        <nav aria-label="Documentation" className="mt-6 space-y-5 border-t border-dashed border-[#dcdcd8] pt-5">
          {groups.map((group) => (
            <section key={group.category}>
              <h2 className="mb-2 font-mono text-[11.5px] font-normal uppercase tracking-[0.06em] text-muted-foreground">
                {group.category}
              </h2>
              <ul className="space-y-0.5">
                {group.pages.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`${site.basePath}/${p.slug}`}
                      aria-current={p.slug === page.slug ? "page" : undefined}
                      className={cn(
                        "-mx-2.5 block rounded-[10px] px-2.5 py-[7px] text-[15px] transition-[color,box-shadow] duration-150",
                        p.slug === page.slug
                          ? "bg-card font-medium text-foreground shadow-[var(--bubble)]"
                          : "text-text hover:text-foreground",
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

      <article className="min-w-0 max-w-3xl">
        <header className="border-b border-dashed border-[#dcdcd8] pb-7">
          <p className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">{page.category}</p>
          <h1 className="mt-2.5 text-[36px] leading-[1.12] tracking-[-0.01em]">{page.title}</h1>
          <p className="mt-3 text-[16.5px] leading-[1.6] text-muted-foreground">{page.description}</p>
        </header>

        <div className="docs-body pt-2 text-[16px] leading-[1.75] text-text">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              h2: ({ children }) => (
                <h2 id={headingId(textOf(children))} className="mt-12 scroll-mt-24 text-[24px] leading-[1.3] text-foreground">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 id={headingId(textOf(children))} className="mt-8 scroll-mt-24 text-[19px] leading-[1.35] text-foreground">
                  {children}
                </h3>
              ),
              p: ({ children }) => <p className="mt-4">{children}</p>,
              ul: ({ children }) => <ul className="mt-4 list-disc space-y-1.5 pl-5 marker:text-[#c4c4c8]">{children}</ul>,
              ol: ({ children }) => <ol className="mt-4 list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-[12px] marker:text-faint">{children}</ol>,
              blockquote: ({ children }) => (
                <blockquote className="mt-4 rounded-[14px] bg-[color:var(--callout)] px-[18px] py-1 text-text [&>p]:my-2.5">
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => {
                const to = href ? docHref(site, href) : "";
                const external = to.startsWith("https://") || to.startsWith("http://");
                const cls = "inline-link";
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
                  <code className="rounded-[6px] bg-[#f1f1ef] px-1.5 py-0.5 font-mono text-[0.84em] text-foreground shadow-[inset_0_0_0_1px_rgb(24_24_27/0.05)]">{children}</code>
                ),
              pre: ({ children }) => (
                <div className="mt-4 overflow-hidden rounded-2xl bg-[#fafaf9] shadow-[0_0_0_1px_rgb(24_24_27/0.07),inset_0_1px_0_#fff]">
                  <div className="flex items-center justify-between border-b border-dashed border-[#dcdcd8] py-1.5 pr-2 pl-4">
                    <span className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">{codeLanguage(children)}</span>
                    <CopyButton value={textOf(children).replace(/\n$/, "")} label="Copy" />
                  </div>
                  <pre className="overflow-x-auto px-[18px] py-4 font-mono text-[13.5px] leading-[1.7] text-[#27272a]">{children}</pre>
                </div>
              ),
              table: ({ children }) => (
                <div className="glass mt-4 overflow-x-auto rounded-2xl">
                  <table className="w-full border-collapse text-left text-[15px] leading-[1.55]">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border-b border-dashed border-[#dcdcd8] bg-[rgb(250_250_249/0.7)] px-4 py-3 align-bottom font-mono text-[11.5px] font-normal uppercase tracking-[0.06em] text-muted-foreground">{children}</th>
              ),
              td: ({ children }) => <td className="border-t border-dashed border-[#dcdcd8] px-4 py-3 align-top">{children}</td>,
            }}
          >
            {page.body}
          </Markdown>
        </div>

        <footer className="mt-14 grid grid-cols-2 gap-3.5 border-t border-dashed border-[#dcdcd8] pt-7">
          {previous ? (
            <Link href={`${site.basePath}/${previous.slug}`} className="rounded-2xl bg-card/80 px-[18px] py-4 shadow-[var(--bubble)] transition-shadow duration-150 hover:shadow-[var(--bubble-hover)]">
              <span className="block font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">← Previous</span>
              <span className="mt-1.5 block font-heading text-[17px] font-medium">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`${site.basePath}/${next.slug}`} className="rounded-2xl bg-card/80 px-[18px] py-4 text-right shadow-[var(--bubble)] transition-shadow duration-150 hover:shadow-[var(--bubble-hover)]">
              <span className="block font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">Next →</span>
              <span className="mt-1.5 block font-heading text-[17px] font-medium">{next.title}</span>
            </Link>
          ) : null}
        </footer>
      </article>

      {sections.length > 0 ? (
        <nav aria-label="On this page" className="hidden xl:sticky xl:top-24 xl:block xl:self-start">
          <p className="mb-2.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">On this page</p>
          <ul className="space-y-1.5 border-l border-dashed border-[#dcdcd8]">
            {sections.map((title) => (
              <li key={title}>
                <a href={`#${headingId(title)}`} className="-ml-px block border-l border-transparent pl-3 text-[14px] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
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
