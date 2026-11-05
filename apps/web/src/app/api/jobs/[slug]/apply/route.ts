import { storeApplicantResume } from "@/lib/applicant-resume/store";
import { VIA, parseChannel } from "@/lib/public/channel";
import { FORM_MAX_BYTES, RESUME_FIELD, SLUG, answersFromForm, submitApplication } from "@/lib/public/jobs";
import { checkResume } from "@/lib/resume-file";

// The public application form's target (/jobs/[slug]). No session of any
// kind: proxy.ts exempts api/jobs/, and the only write is
// submit_job_application on the publishable key (lib/public/jobs.ts), which
// checks the post is live, every answer, the honeypot and the hourly limits
// itself. Answers with a 303 back to the page and a code, never a message:
// what the database said stays here, and the page owns the wording. The
// channel the page worked out rides on the form's action (`?via=`), so every
// way back keeps it; a wrong or missing one is not recorded, never an error.
//
// The resume is a file (20261108120000_job_post_resume_upload): checked here
// as core's addFile checks one (type, 3 MB, the bytes like their type) before
// anything is sent, its details sent with the answers, and its bytes stored
// with lib/applicant-resume/store.ts at the path the database answered, only
// once it has added the application and the file's row. The one privileged
// write these pages reach, and only from here (src/client-area.test.ts). A
// store that fails removes that row: the application stands, and the page says
// the resume did not upload. Neither the filename nor anything about the file
// rides in a URL or a log.

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!SLUG.test(slug)) return new Response(null, { status: 404 });
  const channel = parseChannel(new URL(request.url).searchParams.get(VIA));
  const back = (query: Record<string, string>) => {
    const url = new URL(`/jobs/${slug}`, request.url);
    url.searchParams.set("tab", "application");
    if (channel && channel !== "direct") url.searchParams.set(VIA, channel);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    if (!query.applied) url.hash = "apply";
    return Response.redirect(url, 303);
  };

  // Past the cap, the file is what made it so: the text answers are at most 100,000 characters.
  if (Number(request.headers.get("content-length") ?? 0) > FORM_MAX_BYTES) return back({ error: "resume_too_big" });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back({ error: "invalid" });
  }
  const { answers, honeypot, eeoc } = answersFromForm(form);
  const resume = await checkResume(form.get(RESUME_FIELD));
  if (resume === "too_big") return back({ error: "resume_too_big" });
  if (resume === "invalid") return back({ error: "resume_invalid" });
  const outcome = await submitApplication(
    slug,
    answers,
    honeypot,
    eeoc,
    channel,
    resume && { filename: resume.filename, contentType: resume.contentType, sizeBytes: resume.bytes.byteLength },
  );
  switch (outcome.status) {
    case "ok":
      if (resume && outcome.resumePath && !(await storeApplicantResume(outcome.resumePath, resume.bytes, resume.contentType))) {
        return back({ applied: "1", resume: "not_saved" });
      }
      return back({ applied: "1" });
    case "not_found":
      // The page answers 404 for it too.
      return back({});
    case "busy":
      return back({ error: "busy" });
    case "invalid":
      return back(outcome.questionId ? { error: outcome.reason, q: outcome.questionId } : { error: outcome.reason });
    default:
      return back({ error: "failed" });
  }
}
