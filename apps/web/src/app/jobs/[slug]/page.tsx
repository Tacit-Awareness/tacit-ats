import { Fragment, cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CareersFrame, Ico, ICON } from "@/components/careers/frame";
import { Segmented, StatusGlyph } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { formNotice, guideSteps, questionLabel } from "@/lib/public/application";
import { stripMarks } from "@/lib/inline-marks";
import { landingChannel, withVia } from "@/lib/public/channel";
import { readJobPost, readOrgBrand } from "@/lib/public/jobs";
import { parsePostText } from "@/lib/public/post-text";
import { ApplicationForm, answerField } from "./application-form";
import { CountView } from "./count-view";
import { ApplicationBar, ApplicationGuide } from "./guide";

// A client's public job post (design/careers's role page, drawn as Testbench's
// applicant screens): the title, where and which team, then Overview and
// Application tabs over one white card (packages/db, 20261016150000_client_job_posts).
// Public on purpose: proxy.ts exempts jobs/ and api/jobs/, and nothing here
// reads a session. The only database access is lib/public/jobs.ts, on the
// publishable key with no token, through job_post_page. A wrong slug, a
// draft, a closed post and a post on a job that is not open are all the same
// 404. The form posts to /api/jobs/[slug]/apply, which redirects back here with
// a code; the tabs are links and the form is plain HTML, so all of it works
// with no script, and the checklist only reads the form. The one thing that
// takes a script is counting the view (count-view.tsx), which no crawler or
// link preview runs. Where the reader came from is worked out here and rides
// in the links (lib/public/channel.ts).

const post = cache(readJobPost);

export const dynamic = "force-dynamic";

// An unguessable link is how a post is shared: keep it out of search engines.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const read = await post((await params).slug);
  return { title: read ? `${read.title} at ${read.company}` : "Apply", robots: { index: false, follow: false } };
}

export default async function JobPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const read = await post(slug);
  if (!read) notFound();
  const brand = await readOrgBrand(read.orgSlug);
  const query = await searchParams;
  const { tab, applied, error, q, resume } = query as { tab?: string; applied?: string; error?: string; q?: string; resume?: string };
  const h = await headers();
  const channel = landingChannel(query, h.get("referer"), h.get("x-forwarded-host") ?? h.get("host"));
  const application = tab === "application" || Boolean(applied || error);
  const askedQuestion = q ? read.questions.find((x) => x.id === q) : undefined;
  const asked = askedQuestion ? stripMarks(questionLabel(askedQuestion)) : null;
  const notice = formNotice(error, asked);
  const boardHref = read.orgSlug ? withVia(`/careers/${read.orgSlug}`, channel) : null;
  const steps = guideSteps(read.questions, answerField);
  const facts = [
    ["Location", read.location, ICON.pin],
    ["Department", read.department, ICON.team],
  ].filter((f): f is [string, string, string] => Boolean(f[1]));
  const filling = application && !applied;

  return (
    <CareersFrame company={read.company} brand={brand} boardHref={boardHref} allRoles>
      {/* The form's redirect back is the same visit, so it counts no view. Always mounted, so the tabs count nothing, from there either. */}
      <CountView slug={slug} returning={Boolean(applied || error)} />
      <div className={`role${filling ? " has-mbar" : ""}`}>
        <header className="role-head">
          <h1 className="h1">{read.title}</h1>
          {facts.length > 0 ? (
            // Where and which team, read at a glance: the term is the hover title and what a screen reader says.
            <dl className="facts">
              {facts.map(([term, value, icon]) => (
                <div key={term} title={term}>
                  <dt className="sr-only">{term}</dt>
                  <dd>
                    <Ico d={icon} />
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <Segmented
            label={read.title}
            items={[
              { href: withVia(`/jobs/${slug}`, channel), label: "Overview", active: !application },
              { href: withVia(`/jobs/${slug}?tab=application`, channel), label: "Application", active: application },
            ]}
          />
        </header>
        <section className="panel">
          {applied ? (
            <div className="card">
              <div className="sent" role="status">
                <StatusGlyph kind="done" className="size-[22px]" />
                <h2>Application sent</h2>
                <p>Thank you. Your application is in, and the team at {read.company} will be in touch.</p>
                {resume === "not_saved" ? (
                  <p className="warn" role="alert">
                    Your resume didn&rsquo;t upload, but the rest of your application went through. {read.company} can still see your answers.
                  </p>
                ) : null}
                {boardHref ? (
                  <Link className={buttonVariants({ variant: "outline", className: "mt-3" })} href={boardHref}>
                    Open roles
                  </Link>
                ) : null}
              </div>
            </div>
          ) : application ? (
            <ApplicationForm slug={slug} company={read.company} questions={read.questions} notice={notice} channel={channel} />
          ) : (
            <div className="card">
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
              <div className="card-foot">
                <Link className="cta" href={withVia(`/jobs/${slug}?tab=application`, channel)}>
                  Apply for this role
                </Link>
              </div>
            </div>
          )}
        </section>
        {filling ? (
          <aside className="rail">
            <ApplicationGuide steps={steps} />
          </aside>
        ) : null}
      </div>
      {filling ? <ApplicationBar steps={steps} /> : null}
    </CareersFrame>
  );
}
