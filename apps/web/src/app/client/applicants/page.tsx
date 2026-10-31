import { ApplicantsContent } from "./tickets";

export default async function ClientApplicants({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ApplicantsContent sp={await searchParams} />;
}
