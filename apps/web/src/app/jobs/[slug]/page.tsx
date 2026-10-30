import { Fragment, cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CareersFrame, Ico, ICON } from "@/components/careers/frame";
import { guideSteps } from "@/lib/public/application";
import { readJobPost } from "@/lib/public/jobs";
import { parsePostText } from "@/lib/public/post-text";
import { ApplicationForm, answerField } from "./application-form";
import { ApplicationBar, ApplicationGuide } from "./guide";

// A client's public job post (design/careers's role page): one sheet with
// Overview and Application tabs (packages/db, 20261016150000_client_job_posts).
// Public on purpose: proxy.ts exempts jobs/ and api/jobs/, and nothing here
// reads a session. The only database access is lib/public/jobs.ts, on the
// publishable key with no token, through job_post_page. A wrong slug, a
// draft, a closed post and a post on a job that is not open are all the same
// 404. The form posts to /api/jobs/[slug]/apply, which redirects back here with
// a code; the tabs are links and the form is plain HTML, so all of it works
// with no script, and the checklist only reads the form.

const post = cache(readJobPost);

export const dynamic = "force-dynamic";

// An unguessable link is how a post is shared: keep it out of search engines.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const read = await post((await params).slug);
  return { title: read ? `${read.title} at ${read.company}` : "Apply", robots: { index: false, follow: false } };
}

const NOTICES: Record<string, (label: string | null) => string> = {
  required: (label) => (label ? `Please answer: ${label}` : "Please answer every required question."),
  too_long: (label) => (label ? `That answer is too long: ${label}` : "One of your answers is too long."),
  invalid: (label) => (label ? `Please check your answer to: ${label}` : "Please check your answers."),
  busy: () => "Too many applications from here just now. Please try again in an hour.",
  failed: () => "Something went wrong on our side. Please try again.",
};

export default async function JobPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; applied?: string; error?: string; q?: string }>;
}) {
  const { slug } = await params;
  const read = await post(slug);
  if (!read) notFound();
  const { tab, applied, error, q } = await searchParams;
  const application = tab === "application" || Boolean(applied || error);
  const asked = q ? (read.questions.find((x) => x.id === q)?.label ?? null) : null;
  const notice = error && NOTICES[error] ? NOTICES[error](asked) : null;
  const boardHref = read.orgSlug ? `/careers/${read.orgSlug}` : null;
  const steps = guideSteps(read.questions, answerField);
  const facts = [
    ["Location", read.location],
    ["Department", read.department],
  ].filter((f): f is [string, string] => Boolean(f[1]));
  const filling = application && !applied;
  const side = filling || facts.length > 0;

  return (
    <CareersFrame company={read.company} boardHref={boardHref} allRoles>
      <div className={`wrap role${filling ? " has-mbar" : ""}`}>
        <div className="sheet">
          <h1 className="h1">{read.title}</h1>
          <div className={`role-grid${side ? "" : " solo"}`}>
            {side ? (
              <aside className={`side${filling ? " is-app" : ""}`}>
                {filling ? (
                  <ApplicationGuide steps={steps} />
                ) : (
                  <dl className="facts">
                    {facts.map(([term, value]) => (
                      <div key={term}>
                        <dt>{term}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </aside>
            ) : null}
            <div>
              <nav className="tabbar" aria-label={read.title}>
                <Link href={`/jobs/${slug}`} aria-current={application ? undefined : "page"}>
                  Overview
                </Link>
                <Link href={`/jobs/${slug}?tab=application`} aria-current={application ? "page" : undefined}>
                  Application
                </Link>
              </nav>
              <section className="panel">
                {applied ? (
                  <div className="form">
                    <div className="sent" role="status">
                      <span className="big-ok">
                        <Ico d={ICON.check} />
                      </span>
                      <h2>Application sent</h2>
                      <p>Thank you. Your application is in, and the team at {read.company} will be in touch.</p>
                      {boardHref ? (
                        <Link className="btn light" href={boardHref}>
                          Open roles
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : application ? (
                  <ApplicationForm slug={slug} company={read.company} questions={read.questions} notice={notice} />
                ) : (
                  <>
                    {read.description ? (
                      <div className="desc">
                        {parsePostText(read.description).map((b, i) =>
                          b.kind === "text" ? (
                            <p key={i}>{b.text}</p>
                          ) : (
                            <Fragment key={i}>
                              {b.heading ? <h3>{b.heading}</h3> : null}
                              <ul>
                                {b.lines.map((line, n) => (
                                  <li key={n}>{line}</li>
                                ))}
                              </ul>
                            </Fragment>
                          ),
                        )}
                      </div>
                    ) : null}
                    <Link className="btn dark wide" href={`/jobs/${slug}?tab=application`}>
                      Apply for this role
                    </Link>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
      {filling ? <ApplicationBar steps={steps} /> : null}
    </CareersFrame>
  );
}
