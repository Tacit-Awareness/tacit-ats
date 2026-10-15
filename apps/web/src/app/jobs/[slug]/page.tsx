import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ANSWER_PREFIX, HONEYPOT_FIELD, readJobPost, type PublicQuestion } from "@/lib/public/jobs";

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

const field =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/60";

function Question({ q }: { q: PublicQuestion }) {
  const name = `${ANSWER_PREFIX}${q.id}`;
  const label = (
    <span className="text-sm font-medium">
      {q.label}
      {q.required ? <span className="text-muted-foreground"> *</span> : null}
    </span>
  );
  if (q.type === "yes_no") {
    return (
      <fieldset className="space-y-2">
        <legend>{label}</legend>
        <div className="flex gap-6 text-sm">
          {["yes", "no"].map((v) => (
            <label key={v} className="flex items-center gap-2">
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
    input = <textarea name={name} required={q.required} maxLength={5000} rows={6} className={field} />;
  } else if (q.type === "select") {
    input = (
      <select name={name} required={q.required} defaultValue="" className={`${field} h-9 py-1`}>
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
    input = <input name={name} required={q.required} className={`${field} h-9 py-1`} {...kind} />;
  }
  return (
    <label className="block space-y-1.5">
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
    <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-12">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">{post.company}</p>
        <h1 className="text-2xl font-medium">{post.title}</h1>
        {post.location ? <p className="text-sm text-muted-foreground">{post.location}</p> : null}
      </header>

      {post.description ? <div className="whitespace-pre-line text-[15px] leading-relaxed">{post.description}</div> : null}

      {applied ? (
        <p role="status" className="rounded-lg border border-border bg-card px-4 py-3 text-[15px]">
          Thank you. Your application is in, and the team at {post.company} will be in touch.
        </p>
      ) : (
        <form
          id="apply"
          method="post"
          action={`/api/jobs/${slug}/apply`}
          className="space-y-5 rounded-lg border border-border bg-card p-5"
        >
          <h2 className="text-lg font-medium">Apply</h2>
          {notice ? (
            <p role="alert" className="text-sm text-destructive">
              {notice}
            </p>
          ) : null}
          {post.questions.map((question) => (
            <Question key={question.id} q={question} />
          ))}
          {/* For bots only: hidden from people and from assistive tech. */}
          <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label>
              Website
              <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
            </label>
          </div>
          <button
            type="submit"
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Submit application
          </button>
        </form>
      )}
    </main>
  );
}
