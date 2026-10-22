import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Glyph, Notice, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ANSWER_PREFIX, DECLINE, EEOC_PREFIX, EEOC_QUESTIONS, HONEYPOT_FIELD, readJobPost, type PublicQuestion } from "@/lib/public/jobs";

// A client's public job post and its application form (packages/db,
// 20261016150000_client_job_posts). Public on purpose: proxy.ts exempts
// jobs/ and api/jobs/, and nothing here reads a session. The only database
// access is lib/public/jobs.ts, on the publishable key with no token, through
// job_post_public. A wrong slug, a draft, a closed post and a post on a job
// that is not open are all the same 404. The form posts to
// /api/jobs/[slug]/apply, which redirects back here with a code; plain HTML,
// no script, the browser's own checks first.

export const dynamic = "force-dynamic";
// An unguessable link is how a post is shared: keep it out of search engines.
export const metadata: Metadata = { title: "Apply", robots: { index: false, follow: false } };

const NOTICES: Record<string, (label: string | null) => string> = {
  required: (label) => (label ? `Please answer: ${label}` : "Please answer every required question."),
  too_long: (label) => (label ? `That answer is too long: ${label}` : "One of your answers is too long."),
  invalid: (label) => (label ? `Please check your answer to: ${label}` : "Please check your answers."),
  busy: () => "Too many applications from here just now. Please try again in an hour.",
  failed: () => "Something went wrong on our side. Please try again.",
};

function Question({ q }: { q: PublicQuestion }) {
  const name = `${ANSWER_PREFIX}${q.id}`;
  const label = (
    <span className="text-[13px] font-medium text-foreground/80">
      {q.label}
      {q.required ? <span className="text-faint"> *</span> : null}
    </span>
  );
  if (q.type === "yes_no") {
    return (
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-2 p-0">{label}</legend>
        <div className="flex gap-6 text-[13px]">
          {["yes", "no"].map((v) => (
            <label key={v} className="flex items-center gap-2 accent-[var(--accent)]">
              <input type="radio" name={name} value={v} required={q.required} />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  let input: React.ReactNode;
  if (q.type === "long_text") {
    input = <Textarea name={name} required={q.required} maxLength={5000} rows={6} />;
  } else if (q.type === "select") {
    input = (
      <select name={name} required={q.required} defaultValue="" className={selectClass}>
        <option value="">Choose…</option>
        {(q.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else {
    const kind = {
      name: { type: "text", maxLength: 200, autoComplete: "name" },
      email: { type: "email", maxLength: 254, autoComplete: "email" },
      phone: { type: "tel", maxLength: 40, autoComplete: "tel" },
      linkedin: { type: "url", maxLength: 300, placeholder: "https://www.linkedin.com/in/…" },
      resume: { type: "url", maxLength: 500, placeholder: "https://…" },
      short_text: { type: "text", maxLength: 300 },
    }[q.type];
    input = <Input name={name} required={q.required} {...kind} />;
  }
  return (
    <label className="grid gap-1.5">
      {label}
      {input}
    </label>
  );
}

export default async function JobPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ applied?: string; error?: string; q?: string }>;
}) {
  const { slug } = await params;
  const post = await readJobPost(slug);
  if (!post) notFound();
  const { applied, error, q } = await searchParams;
  const asked = q ? (post.questions.find((x) => x.id === q)?.label ?? null) : null;
  const notice = error && NOTICES[error] ? NOTICES[error](asked) : null;

  return (
    <main className="mx-auto grid w-full max-w-[680px] content-start gap-4 px-4 py-12 sm:py-16">
      <header className="grid gap-3 pb-1">
        <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
          <Glyph name={post.company} size="md" />
          {post.company}
        </div>
        <div>
          <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-[-0.025em]">{post.title}</h1>
          {post.location ? <p className="mt-1 text-[13.5px] text-muted-foreground">{post.location}</p> : null}
        </div>
      </header>

      {post.description ? (
        <Section title="About the role">
          <div className="text-[14px] leading-[1.7] whitespace-pre-line text-foreground/85">{post.description}</div>
        </Section>
      ) : null}

      {applied ? (
        <Notice className="py-3.5 text-[14px]">
          Thank you. Your application is in, and the team at {post.company} will be in touch.
        </Notice>
      ) : (
        <Section title="Apply" className="gap-4 p-5">
          <form id="apply" method="post" action={`/api/jobs/${slug}/apply`} className="grid gap-4">
            {notice ? <Notice tone="error">{notice}</Notice> : null}
            {post.questions.map((question) => (
              <Question key={question.id} q={question} />
            ))}
            {/* Voluntary EEO self-identification, apart from the application's questions. */}
            <fieldset className="m-0 grid gap-3 rounded-[10px] border border-[color:var(--line)] bg-surface p-4">
              <legend className="float-left mb-1 w-full p-0 text-[13.5px] font-semibold">Voluntary self-identification</legend>
              <p className="clear-both m-0 text-[12.5px] leading-relaxed text-muted-foreground">
                {post.company} invites applicants to self-identify for equal employment opportunity reporting.
                Answering is optional and does not affect your application: the hiring team never sees your
                answers, which are only counted in anonymous totals. Leave any question at &ldquo;I decline to
                self-identify&rdquo;.
              </p>
              {EEOC_QUESTIONS.map((q) => (
                <label key={q.key} className="grid gap-1.5">
                  <span className="text-[13px] font-medium text-foreground/80">{q.label}</span>
                  <select name={`${EEOC_PREFIX}${q.key}`} defaultValue={DECLINE} className={selectClass}>
                    {q.options.map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
            {/* For bots only: hidden from people and from assistive tech. */}
            <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
              <label>
                Website
                <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
              </label>
            </div>
            <Button type="submit" size="lg" className="justify-self-start">
              Submit application
            </Button>
          </form>
        </Section>
      )}
    </main>
  );
}
