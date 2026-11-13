import { CareersFrame } from "@/components/careers/frame";

// A careers address that names no company with a board: the applicant's sky and
// box rather than the framework's bare 404, and no way on (the only other door
// here is the staff sign-in, which is not for applicants).
export default function CareersNotFound() {
  return (
    <CareersFrame company="Tacit" brand={null} boardHref={null}>
      <div className="wrap grid justify-items-start gap-3 py-20">
        <h1 className="m-0 font-sans text-[32px] leading-[1.15] font-semibold tracking-[-0.02em]">No careers page here</h1>
        <p className="m-0 max-w-[52ch] text-[14px] leading-[22px] text-muted-foreground">Check the link with the company that shared it.</p>
      </div>
    </CareersFrame>
  );
}
