import { CareersFrame } from "@/components/careers/frame";

// A post that is closed, unpublished or never existed: the applicant's sky and
// box, as every other public page, instead of the framework's bare 404. The
// slug may belong to no company, so the frame names Tacit and offers no way on:
// the only other door here is the staff sign-in, which is not for applicants.
export default function JobNotFound() {
  return (
    <CareersFrame company="Tacit" brand={null} boardHref={null}>
      <div className="wrap grid justify-items-start gap-3 py-20">
        <h1 className="m-0 font-sans text-[32px] leading-[1.15] font-semibold tracking-[-0.02em]">This role isn&apos;t open</h1>
        <p className="m-0 max-w-[52ch] text-[14px] leading-[22px] text-muted-foreground">It may have been filled or taken down, so this link no longer leads to a job post.</p>
      </div>
    </CareersFrame>
  );
}
