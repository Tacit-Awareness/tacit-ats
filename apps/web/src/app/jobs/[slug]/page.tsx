import type { Metadata } from "next";
import { notFound } from "next/navigation";
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

const field = "field w-full px-[11px] py-2 text-[14.5px]";

function Question({ q }: { q: PublicQuestion }) {
  const name = `${ANSWER_PREFIX}${q.id}`;
  const label = (
    <span className="text-[13px] font-medium text-text">
      {q.label}
      {q.required ? <span className="text-muted-foreground"> *</span> : null}
    </span>
  );
  if (q.type === "yes_no") {
    return (
      <fieldset className="space-y-2.5">
        <legend>{label}</legend>
        <div className="flex gap-6 text-[14.5px]">
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
    input = <textarea name={name} required={q.required} maxLength={5000} rows={6} className={`${field} leading-[1.65]`} />;
  } else if (q.type === "select") {
    input = (
      <select name={name} required={q.required} defaultValue="" className={`${field} h-[38px] py-1`}>
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
    input = <input name={name} required={q.required} className={`${field} h-[38px] py-1`} {...kind} />;
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
    <main className="mx-auto w-full max-w-2xl space-y-9 px-5 py-14 sm:py-20">
      <header className="space-y-2.5">
        <p className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">{post.company}</p>
        <h1 className="text-[34px] leading-[1.12] tracking-[-0.01em] sm:text-[40px]">{post.title}</h1>
        {post.location ? <p className="text-[15.5px] text-muted-foreground">{post.location}</p> : null}
      </header>

      {post.description ? (
        <div className="whitespace-pre-line border-t border-dashed border-[#dcdcd8] pt-8 text-[16px] leading-[1.75] text-text">
          {post.description}
        </div>
      ) : null}

      {applied ? (
        <p role="status" className="notice notice-success px-5 py-4 text-[15.5px]">
          Thank you. Your application is in, and the team at {post.company} will be in touch.
        </p>
      ) : (
        <form
          id="apply"
          method="post"
          action={`/api/jobs/${slug}/apply`}
          className="glass space-y-6 p-6 sm:p-8"
        >
          <h2 className="text-[24px] leading-[1.3]">Apply</h2>
          {notice ? (
            <p role="alert" className="notice notice-error">
              {notice}
            </p>
          ) : null}
          {post.questions.map((question) => (
            <Question key={question.id} q={question} />
          ))}
          {/* Voluntary EEO self-identification, apart from the application's questions. */}
          <fieldset className="space-y-4 rounded-[14px] bg-[rgb(250_250_249/0.85)] p-5 shadow-[inset_0_0_0_1px_rgb(24_24_27/0.07)]">
            <legend className="float-left mb-1 w-full font-heading text-[17px] font-medium">Voluntary self-identification</legend>
            <p className="clear-both text-[14px] leading-[1.6] text-muted-foreground">
              {post.company} invites applicants to self-identify for equal employment opportunity reporting.
              Answering is optional and does not affect your application: the hiring team never sees your
              answers, which are only counted in anonymous totals. Leave any question at &ldquo;I decline to
              self-identify&rdquo;.
            </p>
            {EEOC_QUESTIONS.map((q) => (
              <label key={q.key} className="block space-y-1.5">
                <span className="text-[13px] font-medium text-text">{q.label}</span>
                <select name={`${EEOC_PREFIX}${q.key}`} defaultValue={DECLINE} className={`${field} h-[38px] py-1`}>
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
          <button
            type="submit"
            className="rounded-full bg-dark px-5 py-2.5 text-[15px] leading-5 font-medium text-[#fafafa] shadow-[0_0_0_1px_var(--dark)] transition-colors duration-150 hover:bg-[color:var(--dark-hover)]"
          >
            Submit application
          </button>
        </form>
      )}
    </main>
  );
}
