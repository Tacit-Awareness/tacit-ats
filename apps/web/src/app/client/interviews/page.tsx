import { InterviewsContent } from "./interviews-page";

export default async function ClientInterviews({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <InterviewsContent sp={await searchParams} />;
}
