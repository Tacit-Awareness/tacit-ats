import type { ReactNode } from "react"

/*
 * The offer letter, clause by clause, after the company's own form (a California employee offer
 * letter). Each blank in the form is a field: filled from the offer, the candidate, the job and the
 * company where the app knows it, and shown as an empty slot where it does not. A clause's wording
 * can be rewritten; the rewrite replaces the form's text for that offer only.
 */

export type LetterCtx = {
  company: string
  state: string
  date: string
  name: string
  first: string
  address?: string
  title: string
  supervisor?: string
  duties?: string
  salary?: string
  period: "year" | "month" | "hour"
  benefits: boolean
  grant: "option" | "purchase" | "none"
  shares?: string
  plan?: string
  expires?: string
  start?: string
}
export type Clause = { key: string; head?: string; text: string; sub?: boolean }

/* A field in the text: its value if there is one, else its name as an empty slot */
const f = (label: string, value?: string) => `⟦${value?.trim() ?? ""}|${label}⟧`
const FIELD = /⟦([^|⟧]*)\|([^⟧]*)⟧/g

/* The fields a letter still has empty, by name */
export const blanks = (clauses: Clause[]) => [...new Set(clauses.flatMap((c) => [...c.text.matchAll(FIELD)].filter((m) => !m[1]).map((m) => m[2])))]
/* A clause as plain words, to rewrite */
export const plain = (text: string) => text.replace(FIELD, (_, v: string, label: string) => v || `[${label}]`)

/* A clause as it reads on the page: filled fields in the letter's ink, empty ones as a slot */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(FIELD)) {
    out.push(text.slice(last, m.index))
    out.push(
      m[1] ? (
        <span key={m.index} className="font-semibold text-black">
          {m[1]}
        </span>
      ) : (
        <span key={m.index} className="rounded bg-[#fff3c4] px-1.5 text-[#7a5b00]">
          {m[2]}
        </span>
      )
    )
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return <>{out}</>
}

export function buildLetter(c: LetterCtx): Clause[] {
  const opt = c.grant === "option"
  const award = opt ? "option" : "restricted stock purchase award"
  const agreement = opt ? "stock option" : "restricted stock purchase"
  return [
    { key: "intro", text: `${f("Company name", c.company)}, a ${f("State", c.state)} corporation (the “Company”), is pleased to offer you employment with the Company on the terms described below.` },
    {
      key: "position",
      head: "Position",
      text: `You will start in a full-time position as ${f("Title", c.title)} and you will initially report to the Company’s ${f("Supervisor’s title", c.supervisor)}. Your primary duties will be ${f("Primary duties", c.duties)}. By signing this letter, you confirm with the Company that you are under no contractual or other legal obligations that would prohibit you from performing your duties with the Company.`,
    },
    {
      key: "pay",
      head: "Compensation and Employee Benefits",
      text: `You will be paid a starting ${c.period === "hour" ? "wage" : "salary"} at the rate of ${f("Salary", c.salary)} per ${c.period}, payable on the Company’s regular payroll dates.${c.benefits ? " As a regular employee of the Company you will be eligible to participate in a number of Company-sponsored benefits, which are described in the employee benefit summary that I have enclosed with this letter." : ""}`,
    },
    ...(c.grant === "none"
      ? []
      : [
          {
            key: "equity",
            head: "Equity Grant",
            text: `Subject to the approval of the Company’s Board of Directors, you will be granted ${opt ? "an option" : "a right"} to purchase ${f("Shares", c.shares)} shares of the Company’s common stock. The ${opt ? "option" : "purchase right"} will be subject to the terms and conditions applicable to ${opt ? "options" : "restricted stock purchase awards"} granted under the Company’s ${f("Stock plan", c.plan)}, as described in that plan and the applicable ${agreement} agreement, which you will be required to sign. You will vest in 25% of the shares on the 12-month anniversary of your vesting commencement date and 1/48th of the total shares will vest in monthly installments thereafter during continuous service, as described in the applicable ${agreement} agreement. The ${opt ? "exercise" : "purchase"} price per share will be equal to the fair market value per share on the date the ${award} is granted, as determined by the Company’s Board of Directors in good faith. There is no guarantee that the Internal Revenue Service will agree with this value. You should consult with your own tax advisor concerning the tax risks associated with accepting ${opt ? "an option" : "a right"} to purchase the Company’s common stock. Although management of the Company will recommend to the Company’s Board of Directors that you be granted the ${award} on the terms set forth herein, by execution of this letter, you acknowledge that you have no right to receive the ${award}, or any right to have the ${award} subject to the specific terms set forth herein, unless the grant is approved by the Company’s Board of Directors.`,
          },
        ]),
    { key: "ciiaa", head: "Confidential Information and Invention Assignment Agreement", text: "Like all Company employees, you will be required, as a condition of your employment with the Company, to sign the Company’s enclosed standard Confidential Information and Invention Assignment Agreement." },
    {
      key: "atwill",
      head: "Employment Relationship",
      text: "Employment with the Company is for no specific period of time. Your employment with the Company will be “at will,” meaning that either you or the Company may terminate your employment at any time and for any reason, with or without cause. Any contrary representations which may have been made to you are superseded by this offer. This is the full and complete agreement between you and the Company on this term. Although your job duties, title, compensation and benefits, as well as the Company’s personnel policies and procedures, may change from time to time, the “at will” nature of your employment may only be changed in an express written agreement signed by you and the Company’s Chief Executive Officer.",
    },
    { key: "outside", head: "Outside Activities", text: "While you render services to the Company, you agree that you will not engage in any other employment, consulting or other business activity without the written consent of the Company." },
    { key: "taxes", head: "Taxes, Withholding and Required Deductions", text: "All forms of compensation referred to in this letter are subject to all applicable taxes, withholding and any other deductions required by applicable law." },
    { key: "law", head: "Governing Law", sub: true, text: "The validity, interpretation, construction and performance of this letter, and all acts and transactions pursuant hereto and the rights and obligations of the parties hereto shall be governed, construed and interpreted in accordance with the laws of California, without giving effect to principles of conflicts of law." },
    { key: "entire", head: "Entire Agreement", sub: true, text: "This letter sets forth the entire agreement and understanding of the parties relating to the subject matter herein and supersedes all prior or contemporaneous discussions, understandings and agreements, whether oral or written, between them relating to the subject matter hereof." },
    { key: "counterparts", head: "Counterparts", sub: true, text: "This letter may be executed in any number of counterparts, each of which when so executed and delivered shall be deemed an original, and all of which together shall constitute one and the same agreement. Execution of a facsimile copy will have the same force and effect as execution of an original, and a facsimile signature will be deemed an original and valid signature." },
    {
      key: "electronic",
      head: "Electronic Delivery",
      sub: true,
      text: "The Company may, in its sole discretion, decide to deliver any documents or notices related to this Agreement, securities of the Company or any of its affiliates or any other matter, including documents and/or notices required to be delivered to you by applicable securities law or any other law or the Company’s Certificate of Incorporation or Bylaws by email or any other electronic means. You hereby consent to (i) conduct business electronically (ii) receive such documents and notices by such electronic delivery and (iii) sign documents electronically and agree to participate through an on-line or electronic system established and maintained by the Company or a third party designated by the Company.",
    },
    {
      key: "accept",
      text: `If you wish to accept this offer, please sign and date both the enclosed duplicate original of this letter and the enclosed Confidential Information and Invention Assignment Agreement and return them to me. As required, by law, your employment with the Company is also contingent upon your providing legal proof of your identity and authorization to work in the United States. This offer, if not accepted, will expire at the close of business on ${f("Offer expires", c.expires)}.`,
    },
    { key: "join", text: `We look forward to having you join us no later than ${f("Start date", c.start)}.` },
  ]
}
