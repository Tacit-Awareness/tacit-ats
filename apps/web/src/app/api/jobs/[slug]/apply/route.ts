import { VIA, parseChannel } from "@/lib/public/channel";
import { FORM_MAX_BYTES, SLUG, answersFromForm, submitApplication } from "@/lib/public/jobs";

// The public application form's target (/jobs/[slug]). No session of any
// kind: proxy.ts exempts api/jobs/, and the only write is
// submit_job_application on the publishable key (lib/public/jobs.ts), which
// checks the post is live, every answer, the honeypot and the hourly limits
// itself. Answers with a 303 back to the page and a code, never a message:
// what the database said stays here, and the page owns the wording. The
// channel the page worked out rides on the form's action (`?via=`), so every
// way back keeps it; a wrong or missing one is not recorded, never an error.

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

  if (Number(request.headers.get("content-length") ?? 0) > FORM_MAX_BYTES) return back({ error: "too_long" });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back({ error: "invalid" });
  }
  const { answers, honeypot, eeoc } = answersFromForm(form);
  const outcome = await submitApplication(slug, answers, honeypot, eeoc, channel);
  switch (outcome.status) {
    case "ok":
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
