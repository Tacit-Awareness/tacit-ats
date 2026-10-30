import { recordJobPostView } from "@/lib/public/jobs";

// The public post's page view (/jobs/[slug], its count-view.tsx). No session of
// any kind, like the form's route: the only write is record_job_post_view on
// the publishable key (lib/public/jobs.ts), which counts a live post, ignores
// anything else and holds the per-post limits. Nothing about the caller is
// read: no address, Referer, user agent or cookie. Every call gets the same
// empty answer, so this is no way to probe a slug.

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  await recordJobPostView(slug);
  return new Response(null, { status: 204 });
}
