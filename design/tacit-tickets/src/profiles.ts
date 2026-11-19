import type { Person, Role } from "./data"

/*
 * What get_candidate, list_files and get_feedback return for one person: headline, location,
 * tags, the profile summary, their files, and each interviewer's filed feedback with its
 * scorecard ratings.
 */
export type Recommendation = "strong_yes" | "yes" | "no" | "strong_no"
export const REC_LABEL: Record<Recommendation, string> = { strong_yes: "Strong Yes", yes: "Yes", no: "No", strong_no: "Strong No" }

export type Feedback = {
  step: string
  who: string
  date: string
  recommendation: Recommendation
  notes: string
  /* one rating (1 to 4) per scorecard attribute, in the scorecard's order; 0 = not rated */
  ratings: number[]
}
export type Profile = { headline: string; location: string; tags: string[]; summary: string; files: string[]; feedback: Feedback[] }

export const PROFILES: Record<string, Profile> = {
  rohan: {
    headline: "Staff Engineer, Storage at Lattice Cloud", location: "San Francisco", tags: ["Postgres", "Referred by Luca"],
    summary: "Owns the Postgres fleet at Lattice Cloud, about 400 clusters, and cut failover from 90 seconds to 8. Before that rebuilt the ingest path at Brightwave and led on-call for the ledger service at Nimbus Pay.",
    files: ["Rohan Dalal resume.pdf"],
    feedback: [{ step: "Recruiter Screen", who: "nick", date: "Nov 12", recommendation: "strong_yes", notes: "pretty cool tbh. explained the failover work without me asking, super clear. move him on", ratings: [4, 3, 4, 0] }],
  },
  noah: {
    headline: "Senior Engineer, Databases at Northbeam", location: "Toronto", tags: ["Postgres"],
    summary: "Migrated 2 TB off a single primary with no downtime at Northbeam. Earlier worked on query performance for a reporting product at Cedar Health.",
    files: ["Noah Kim CV.pdf"],
    feedback: [{ step: "Recruiter Screen", who: "nick", date: "Nov 13", recommendation: "yes", notes: "noah's solid. calm, specific, real war stories", ratings: [3, 3, 3, 0] }],
  },
  maya: {
    headline: "Solutions Engineer at Orbit Data", location: "New York", tags: ["Enterprise"],
    summary: "Embedded with six enterprise customers at Orbit Data and shipped inside their stacks. Built the integrations SDK at Kestrel.",
    files: ["Maya Chen resume.pdf"],
    feedback: [
      { step: "Recruiter Screen", who: "nick", date: "Nov 3", recommendation: "yes", notes: "good energy, knows customers. want eng to check depth", ratings: [3, 4, 0, 3] },
      { step: "Round 2", who: "luca", date: "Nov 6", recommendation: "yes", notes: "solid. a bit slow on the debugging part but got there on her own", ratings: [3, 3, 2, 3] },
      { step: "Round 3", who: "kevin", date: "Nov 10", recommendation: "strong_yes", notes: "maya was great!! handled the angry-cto roleplay better than i would. lets do an onsite w ben", ratings: [4, 4, 3, 4] },
    ],
  },
  sofia: {
    headline: "Product Designer at Fathom Labs", location: "Austin", tags: ["Design engineer"],
    summary: "Designed and built the query editor front end at Fathom Labs. Earlier made dense internal tools for logistics clients at Studio Meridian.",
    files: ["Sofia Reyes resume.pdf", "Portfolio.pdf"],
    feedback: [
      { step: "Recruiter Screen", who: "nick", date: "Nov 9", recommendation: "yes", notes: "sharp, portfolio is real product not dribbble shots", ratings: [3, 3, 0] },
      { step: "Round 2", who: "luca", date: "Nov 16", recommendation: "strong_yes", notes: "sofia was great. she shipped the PR during the call lol. move her along", ratings: [4, 4, 3] },
    ],
  },
  arjun: {
    headline: "Backend Engineer at Tidepool Systems", location: "Seattle", tags: [],
    summary: "Runs the queueing layer for a logistics API at Tidepool Systems. Earlier worked on payments reconciliation at Halcyon.",
    files: ["Arjun Mehta resume.pdf"], feedback: [],
  },
  daniel: {
    headline: "Full-Stack Engineer at Parcelry", location: "Chicago", tags: [],
    summary: "Builds customer dashboards and onboarding flows at Parcelry. Started on internal admin tools at Greenline.",
    files: ["Daniel Okafor resume.pdf"],
    feedback: [
      { step: "Recruiter Screen", who: "nick", date: "Nov 5", recommendation: "yes", notes: "likeable, good with people. not sure on the technical side", ratings: [2, 3, 0, 2] },
      { step: "Round 2", who: "kevin", date: "Nov 11", recommendation: "no", notes: "ehh not sure hes strong enough for a live one. needed a spec for everything. send the take home instead", ratings: [2, 3, 2, 1] },
    ],
  },
  lena: {
    headline: "Design Engineer at Quanta", location: "Berlin", tags: ["Design engineer", "Referred by Ben"],
    summary: "Owns the design system at Quanta and ships it in code. Earlier did motion and prototyping for data products at Neue Form.",
    files: ["Lena Fischer CV.pdf", "Portfolio.pdf"],
    feedback: [
      { step: "Round 2", who: "luca", date: "Nov 4", recommendation: "strong_yes", notes: "best design eng ive interviewed. her code is cleaner than mine", ratings: [4, 4, 4] },
      { step: "Round 3", who: "kevin", date: "Nov 9", recommendation: "yes", notes: "strong. quiet at first, opens up once shes sketching", ratings: [3, 4, 3] },
      { step: "Onsite", who: "ben", date: "Nov 14", recommendation: "strong_yes", notes: "yes. make the offer", ratings: [4, 4, 4] },
    ],
  },
  tom: {
    headline: "DevOps Engineer at Altamont", location: "Denver", tags: [],
    summary: "Maintains CI pipelines and deploy tooling at Altamont.",
    files: ["Tom Becker resume.pdf"],
    feedback: [{ step: "Recruiter Screen", who: "nick", date: "Nov 13", recommendation: "no", notes: "mid. hasnt really owned anything in prod. maybe later if we have time", ratings: [1, 2, 2, 0] }],
  },
  a5: { headline: "Customer Engineer at Halyard", location: "Miami", tags: ["Referred by Ben"], summary: "Led technical onboarding for about 30 enterprise accounts at Halyard, writing the integration code herself. Earlier a support engineer at Brisk.", files: ["Lucia Ortiz resume.pdf"], feedback: [] },
  a6: { headline: "Design Engineer at Plotline", location: "Portland", tags: ["Referred by Kevin"], summary: "Built and maintains Plotline's charting library and the design system around it.", files: ["Theo Marsh resume.pdf", "Portfolio.pdf"], feedback: [] },
  a7: { headline: "Site Reliability Engineer at Kvitto", location: "Stockholm", tags: [], summary: "Four years on call for the payments database tier at Kvitto. Wrote the team's incident runbooks.", files: ["Hugo Lindberg CV.pdf"], feedback: [] },
  a1: { headline: "Database Engineer at Ledgerline", location: "Boston", tags: ["Referred by Luca"], summary: "Sole owner of Postgres at a 40-person fintech. Earlier built billing and usage metering at Mosaic.", files: ["Priya Raman resume.pdf"], feedback: [] },
  a2: { headline: "Software Engineer at Fieldkit", location: "Remote", tags: ["Testbench top 3%"], summary: "Does customer integrations at Fieldkit and is on calls weekly.", files: ["Jonas Weber CV.pdf"], feedback: [] },
  a3: { headline: "Product Designer at Tessellate", location: "London", tags: [], summary: "Shipped a data tool end to end at Tessellate, design and front end.", files: ["Amara Nwosu resume.pdf", "Portfolio.pdf"], feedback: [] },
  a4: { headline: "Systems Engineer at Hikari DB", location: "Tokyo", tags: ["Open source"], summary: "Core maintainer of an open source storage engine.", files: ["Kenji Sato resume.pdf"], feedback: [] },
}

/* Seeded candidates without a written profile get a plain one built from their role */
export function profileOf(person: Person, role: Role): Profile {
  return PROFILES[person.id] ?? {
    headline: role.title, location: "Remote", tags: [],
    summary: `Currently working as a ${role.title.toLowerCase()} on a small team, and was the first hire in the role at a previous company.`,
    files: [`${person.name} resume.pdf`],
    feedback: person.stage > 2 ? [{ step: "Recruiter Screen", who: "nick", date: "Nov 11", recommendation: "yes", notes: "solid, clear communicator. worth a second round", ratings: role.scorecard.map(() => 3) }] : [],
  }
}

/* Where a file opens from. In tATS this is the signed link get_file_link returns; here, the demo PDFs. */
const RESUMES = new Set(["rohan", "noah", "maya", "sofia", "arjun", "daniel", "lena", "tom", "a1", "a2", "a3", "a4", "a5", "a6", "a7"])
export function fileUrl(personId: string, name: string, index: number): string | null {
  if (name === "Portfolio.pdf") return "/resumes/portfolio.pdf"
  return index === 0 && RESUMES.has(personId) ? `/resumes/${personId}.pdf` : null
}
