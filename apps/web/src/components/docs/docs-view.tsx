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
      <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
        <p className="text-[15px] font-[550]">{site.title}</p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{site.intro}</p>
        <div className="mt-4">
          <DocsSearch basePath={site.basePath} pages={searchable} />
        </div>
        <nav aria-label="Documentation" className="mt-5 space-y-5">
          {groups.map((group) => (
            <section key={group.category}>
              <h2 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                {group.category}
              </h2>
              <ul className="space-y-0.5">
                {group.pages.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`${site.basePath}/${p.slug}`}
                      aria-current={p.slug === page.slug ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-2.5 py-1.5 text-[14px] transition-colors",
                        p.slug === page.slug
                          ? "bg-primary-soft font-medium text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
        <header className="border-b border-border pb-6">
          <p className="text-xs font-medium text-primary">{page.category}</p>
          <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.01em]">{page.title}</h1>
          <p className="mt-2 text-[16px] text-muted-foreground">{page.description}</p>
        </header>

        <div className="docs-body pt-2 text-[15px] leading-[1.7]">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              h2: ({ children }) => (
                <h2 id={headingId(textOf(children))} className="mt-10 scroll-mt-20 text-[20px] font-[550] tracking-[-0.01em]">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 id={headingId(textOf(children))} className="mt-7 scroll-mt-20 text-[16px] font-[550]">
                  {children}
                </h3>
              ),
              p: ({ children }) => <p className="mt-4">{children}</p>,
              ul: ({ children }) => <ul className="mt-4 list-disc space-y-1.5 pl-5 marker:text-muted-foreground">{children}</ul>,
              ol: ({ children }) => <ol className="mt-4 list-decimal space-y-1.5 pl-5 marker:text-muted-foreground">{children}</ol>,
              blockquote: ({ children }) => (
                <blockquote className="mt-4 rounded-md border-l-2 border-primary bg-primary-soft px-4 py-0.5 text-foreground [&>p]:my-2.5">
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => {
                const to = href ? docHref(site, href) : "";
                const external = to.startsWith("https://") || to.startsWith("http://");
                const cls = "font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary";
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
                  <code className="rounded bg-[color:var(--soft)] px-1 py-0.5 font-mono text-[0.86em]">{children}</code>
                ),
              pre: ({ children }) => (
                <div className="mt-4 overflow-hidden rounded-lg border border-[color:var(--line)] bg-card">
                  <div className="flex items-center justify-between border-b border-border px-3 py-1">
                    <span className="text-xs text-muted-foreground">{codeLanguage(children)}</span>
                    <CopyButton value={textOf(children).replace(/\n$/, "")} label="Copy" />
                  </div>
                  <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed">{children}</pre>
                </div>
              ),
              table: ({ children }) => (
                <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--line)] bg-card">
                  <table className="w-full border-collapse text-left text-[14px]">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border-b border-border bg-[color:var(--soft)] px-3 py-2 align-bottom font-medium">{children}</th>
              ),
              td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
            }}
          >
            {page.body}
          </Markdown>
        </div>

        <footer className="mt-12 grid grid-cols-2 gap-4 border-t border-border pt-6">
          {previous ? (
            <Link href={`${site.basePath}/${previous.slug}`} className="rounded-lg border border-[color:var(--line)] bg-card px-4 py-3 hover:border-[color:var(--hairline)]">
              <span className="block text-xs text-muted-foreground">← Previous</span>
              <span className="text-[15px] font-medium">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`${site.basePath}/${next.slug}`} className="rounded-lg border border-[color:var(--line)] bg-card px-4 py-3 text-right hover:border-[color:var(--hairline)]">
              <span className="block text-xs text-muted-foreground">Next →</span>
              <span className="text-[15px] font-medium">{next.title}</span>
            </Link>
          ) : null}
        </footer>
      </article>

      {sections.length > 0 ? (
        <nav aria-label="On this page" className="hidden xl:sticky xl:top-20 xl:block xl:self-start">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">On this page</p>
          <ul className="space-y-1.5 border-l border-border">
            {sections.map((title) => (
              <li key={title}>
                <a href={`#${headingId(title)}`} className="-ml-px block border-l border-transparent pl-3 text-[13px] text-muted-foreground hover:border-foreground hover:text-foreground">
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
