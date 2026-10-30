// Tacit Test Co's mock hiring team, jobs and applicants, after design/tats's
// Meridian (src/data.js). Everyone here is fictional: emails are @example.com
// and LinkedIn handles start with "example-", so nothing reaches a real person.
// Times are hours before the seed runs, so a fresh seed always reads as current.

/** The hiring team. Actors with no sign-in: they own, interview and file feedback. */
export const TEAM = {
  priya: { name: "Priya Raman", title: "Talent engineer", access: "elevated" },
  daniel: { name: "Daniel Okafor", title: "CTO", access: "elevated" },
  sam: { name: "Sam Whitaker", title: "Staff engineer", access: "limited" },
  wei: { name: "Wei Zhang", title: "Senior engineer", access: "limited" },
  noor: { name: "Noor Haddad", title: "Engineer", access: "limited" },
  marcus: { name: "Marcus Bell", title: "Research lead", access: "elevated" },
  aisha: { name: "Aisha Karim", title: "Research scientist", access: "limited" },
  theo: { name: "Theo Lindqvist", title: "Research engineer", access: "limited" },
  lena: { name: "Lena Park", title: "Design lead", access: "elevated" },
  jonah: { name: "Jonah Reyes", title: "Product engineer", access: "limited" },
};

export const DEPARTMENTS = { infra: "Infra", research: "Research", product: "Product" };

const ENG_STEPS = ["Recruiter screen", "Technical deep dive", "Systems design", "Founders' round"];
const RES_STEPS = ["Recruiter screen", "Research talk", "Coding", "Team fit"];
const PE_STEPS = ["Recruiter screen", "Product build", "Design review", "Founders' round"];

/** Jobs, each with its department, hiring team and interview plan. `post` is its job board post's status. */
export const JOBS = {
  eng: {
    title: "Founding Engineer, Infra", dept: "infra", location: "San Francisco", seniority: "senior", status: "open", post: "live",
    payMin: 190000, payMax: 240000, steps: ENG_STEPS,
    team: { hiring_manager: ["daniel"], recruiter: ["priya"], interviewer: ["sam", "wei", "noor"] },
    description: "Own the systems everything else runs on: queues, storage, deploys and the rate limiter in front of it all. You'll be the third engineer on infra and set how we build it.",
  },
  inf: {
    title: "Staff Engineer, Inference", dept: "infra", location: "San Francisco or remote (US)", seniority: "staff", status: "open", post: "live",
    payMin: 230000, payMax: 290000, steps: ENG_STEPS,
    team: { hiring_manager: ["daniel"], recruiter: ["priya"], interviewer: ["sam", "noor"] },
    description: "Make our models fast and cheap to serve: batching, KV-cache management, kernels where they matter. You'll own p99 latency end to end.",
  },
  res: {
    title: "Research Scientist, Post-training", dept: "research", location: "San Francisco or London", seniority: "senior", status: "open", post: "live",
    payMin: 220000, payMax: 300000, steps: RES_STEPS,
    team: { hiring_manager: ["marcus"], recruiter: ["priya"], interviewer: ["aisha", "theo"] },
    description: "Run post-training research from idea to shipped model: reward modelling, RL from feedback, and the evals that tell us whether it worked.",
  },
  evals: {
    title: "Research Engineer, Evals", dept: "research", location: "San Francisco or London", seniority: "mid", status: "open", post: "live",
    payMin: 170000, payMax: 230000, steps: RES_STEPS,
    team: { hiring_manager: ["marcus"], recruiter: ["priya"], interviewer: ["aisha", "theo"] },
    description: "Build the eval harnesses the research team trusts: fast, reproducible, hard to fool. Find the bug before it finds a paper.",
  },
  pe: {
    title: "Product Engineer", dept: "product", location: "Remote (US or Europe)", seniority: "mid", status: "open", post: "live",
    payMin: 160000, payMax: 210000, steps: PE_STEPS,
    team: { hiring_manager: ["lena"], recruiter: ["priya"], interviewer: ["jonah"] },
    description: "Ship the product people touch every day, from the first sketch to the last empty state. TypeScript, React, and taste.",
  },
  des: {
    title: "Founding Product Designer", dept: "product", location: "San Francisco", seniority: "senior", status: "paused", post: "closed",
    payMin: 170000, payMax: 220000, steps: ["Recruiter screen", "Portfolio review", "Design exercise", "Founders' round"],
    team: { hiring_manager: ["lena"], recruiter: ["priya"], interviewer: ["jonah"] },
    description: "Our first designer: own the product's look, feel and flow, and the system behind it.",
  },
};

/** The job board form every post asks (built-ins plus five of the company's own questions). */
export const START_OPTIONS = ["Immediately", "Within a month", "1 to 3 months", "More than 3 months"];
export const QUESTIONS = [
  { id: "name", type: "name", label: "Full name", required: true },
  { id: "email", type: "email", label: "Email", required: true },
  { id: "phone", type: "phone", label: "Phone", required: false },
  { id: "linkedin", type: "linkedin", label: "LinkedIn profile", required: false },
  { id: "resume", type: "resume", label: "Link to your resume", required: false },
  { id: "q_location", type: "short_text", label: "Where are you based?", required: true },
  { id: "q_current", type: "short_text", label: "Current role and company", required: false },
  { id: "q_whyus", type: "long_text", label: "Why Tacit Test Co? A few lines is plenty.", required: true },
  { id: "q_usauth", type: "yes_no", label: "Are you authorized to work in the United States?", required: true },
  { id: "q_start", type: "select", label: "When could you start?", required: false, options: START_OPTIONS },
];

/*
 * Applicants. `at` is when they applied or were added and `touch` their last
 * activity, in hours ago. `path` is the stages they moved through after the
 * first, ending at their current one. `interviews` are past rounds only:
 * `ago` hours since it started, `by` who ran it, `fb` their feedback (rating 1 to 4; absent
 * means not filed yet). Upcoming interviews are left out on purpose: the
 * company's bot is real and would be reminded of each one.
 * `cover` (job board only) is the "Why Tacit Test Co?" answer.
 */
export const APPLICANTS = [
  // ---- Applicant Tickets: job board, not routed yet
  { k: "lin-zhou", name: "Lin Zhou", title: "SRE", company: "Cloudflare", loc: "Austin, TX", job: "eng", source: "job_board", at: 0.4, phone: "+1 512 555 0131", start: "Within a month", usAuth: true,
    cover: "I run the rate-limiting fleet at Cloudflare's edge, and I've been reading your infra posts for a while. I'd like to work somewhere infra decisions take a week, not a quarter. Rust and Go, on-call lead for a 400-node cluster." },
  { k: "kwame-asante", name: "Kwame Asante", title: "Platform engineer", company: "Vercel", loc: "Remote (Toronto)", job: "pe", source: "job_board", at: 1.6, start: "1 to 3 months", usAuth: false,
    cover: "I built the deploy-preview comments at Vercel and maintain a CLI a few thousand people use. I care a lot about the last 10% of product polish, and your product feels like it was built by people who do too." },
  { k: "pavel-sokolov", name: "Pavel Sokolov", title: "Research engineer", company: "ex-Jane Street", loc: "New York, NY", job: "res", source: "job_board", at: 1.2, phone: "+1 646 555 0188", start: "Immediately", usAuth: true,
    cover: "I spent four years building low-latency inference for trading models at Jane Street and have been teaching myself RL on the side. I'd like to move into post-training research properly, and your team's eval work is the reason I'm applying here rather than somewhere bigger." },
  { k: "rohan-iyer", name: "Rohan Iyer", title: "Inference engineer", company: "Together AI", loc: "San Francisco, CA", job: "inf", source: "job_board", at: 3, phone: "+1 415 555 0102", start: "Within a month", usAuth: true,
    cover: "I wrote most of Together's speculative-decoding path and cut our p99 by a third on Llama-class models. I want to own the whole serving stack rather than one corner of it." },
  { k: "hannah-novak", name: "Hannah Novak", title: "ML engineer", company: "Hugging Face", loc: "Paris, France", job: "res", source: "job_board", at: 5, start: "1 to 3 months", usAuth: false,
    cover: "I maintain TRL's PPO trainer at Hugging Face and wrote the DPO tutorial a lot of people learn from. I'm looking for a smaller research team where I can run my own experiments, not only support other people's." },
  { k: "julia-weber", name: "Julia Weber", title: "ML engineer", company: "Aleph Alpha", loc: "Berlin, Germany", job: "evals", source: "job_board", at: 9, phone: "+49 30 5550 1942", start: "More than 3 months", usAuth: false,
    cover: "I built Aleph Alpha's German-language eval suite and found two benchmark contamination issues before they shipped. Evals are the part of ML I'd happily do forever." },
  { k: "tyler-brooks", name: "Tyler Brooks", title: "Frontend engineer", company: "Notion", loc: "San Francisco, CA", job: "pe", source: "job_board", at: 20, phone: "+1 415 555 0177", start: "Within a month", usAuth: true,
    cover: "Four years on Notion's editor: tables, comments and the slash menu. I want to work on a smaller team where I ship a feature in a week, end to end." },
  { k: "priyanka-shah", name: "Priyanka Shah", title: "Backend engineer", company: "Robinhood", loc: "Menlo Park, CA", job: "eng", source: "job_board", at: 28, phone: "+1 650 555 0164", start: "1 to 3 months", usAuth: true,
    cover: "I own the order-routing service at Robinhood, which has to be right and fast on the busiest market days. Looking for a founding role where I can set the infra culture." },
  { k: "chen-wu", name: "Chen Wu", title: "GPU kernel engineer", company: "NVIDIA", loc: "Santa Clara, CA", job: "inf", source: "job_board", at: 44, start: "1 to 3 months", usAuth: true,
    cover: "I write attention kernels for TensorRT-LLM. I'd like to be closer to a product and see the latency I save show up for real users." },
  { k: "amara-okeke", name: "Amara Okeke", title: "Data scientist", company: "Spotify", loc: "London, UK", job: "evals", source: "job_board", at: 52, phone: "+44 20 5550 0123", start: "Within a month", usAuth: false,
    cover: "I design A/B tests and offline metrics for Spotify's recommendations. I've been reading about LLM evals and think the same rigor is badly needed there." },
  { k: "jake-morrison", name: "Jake Morrison", title: "Full-stack engineer", company: "Lendwise", loc: "Chicago, IL", job: "pe", source: "job_board", at: 70, start: "Immediately", usAuth: true,
    cover: "Full-stack at a lending startup for two years. I'm a fast learner and excited about your mission." },
  { k: "sara-lindgren", name: "Sara Lindgren", title: "Platform engineer", company: "Klarna", loc: "Stockholm, Sweden", job: "eng", source: "job_board", at: 96, start: "More than 3 months", usAuth: false,
    cover: "I run Klarna's internal Kubernetes platform for 600 engineers. Happy to relocate to San Francisco for the right team." },

  // ---- New: sourced or referred, on a list but not in process yet
  { k: "sofia-alvarez", name: "Sofia Alvarez", title: "Infrastructure engineer", company: "Modal", loc: "San Francisco, CA", job: "eng", source: "referral", detail: "Backchannel from Daniel", at: 2.7, owner: "priya",
    summary: "Wrote Modal's GPU scheduler backfill. Early at a seed-stage startup that was acquired. Strong systems fundamentals for three years in.",
    next: { action: "Intro call to gauge interest", due: 1, owner: "priya" } },
  { k: "ines-duarte", name: "Ines Duarte", title: "Staff engineer", company: "Temporal", loc: "Lisbon, Portugal", job: "eng", source: "referral", detail: "Referred by Sam Whitaker", at: 3.7, owner: "priya",
    summary: "Core contributor to Temporal's history service; designed its multi-region replication. Speaks at Strange Loop. Would relocate from Lisbon." },
  { k: "ana-souza", name: "Ana Souza", title: "Backend engineer", company: "Nubank", loc: "São Paulo, Brazil", job: "eng", source: "agency", detail: "Tacit", at: 30, touch: 22, path: ["contacted"], owner: "priya",
    summary: "Clojure and Kafka at scale; built Nubank's fraud stream. Moving to San Francisco." },
  { k: "ben-ortiz", name: "Ben Ortiz", title: "ML engineer", company: "Scale AI", loc: "San Francisco, CA", job: "res", source: "sourced", detail: "LinkedIn", at: 70, touch: 48, path: ["contacted"], owner: "priya",
    summary: "Data pipelines for RLHF vendors. Strong Python. Wants to move into research." },
  { k: "nadia-rahman", name: "Nadia Rahman", title: "Systems engineer", company: "Fly.io", loc: "Denver, CO", job: "inf", source: "sourced", detail: "GitHub", at: 260, touch: 200, path: ["contacted"], owner: "priya",
    summary: "Maintains Fly's Firecracker orchestration. Wrote a widely-read post on tail latency.",
    next: { action: "Follow up: no reply to first email", due: -3, owner: "priya" } },

  // ---- Screening
  { k: "mei-tanaka", name: "Mei Tanaka", title: "Research scientist", company: "Google DeepMind", loc: "Tokyo, Japan", job: "res", source: "job_board", at: 110, touch: 40, path: ["screening"], owner: "priya", start: "1 to 3 months", usAuth: false,
    cover: "I work on reward modelling for Gemini and had a NeurIPS oral last year. I want a smaller team where research goes into the product in weeks.",
    summary: "Reward modelling for Gemini. NeurIPS 2024 oral. Wants a smaller team.",
    next: { action: "Book the research talk", due: 2, owner: "priya" } },
  { k: "rachel-kim", name: "Rachel Kim", title: "Senior engineer", company: "Plaid", loc: "New York, NY", job: "pe", source: "job_board", at: 75, touch: 30, path: ["screening"], owner: "priya", phone: "+1 917 555 0120", start: "Within a month", usAuth: true,
    cover: "I led the redesign of Plaid Link and spend half my time with designers. I'm looking for zero-to-one work again.",
    summary: "Led Plaid Link's redesign. Bridges design and engineering. Wants zero-to-one work." },
  { k: "ethan-clarke", name: "Ethan Clarke", title: "Research engineer", company: "Cohere", loc: "London, UK", job: "evals", source: "referral", detail: "Referred by Aisha Karim", at: 90, touch: 26, path: ["screening"], owner: "priya",
    summary: "Built Cohere's multilingual eval harness. Contributor to lm-evaluation-harness." },
  { k: "lucas-martin", name: "Lucas Martin", title: "Performance engineer", company: "Cerebras", loc: "Sunnyvale, CA", job: "inf", source: "agency", detail: "Tacit", at: 120, touch: 60, path: ["screening"], owner: "ryan",
    summary: "Compiler and runtime performance on wafer-scale hardware. Previously at Graphcore." },
  { k: "mira-kowalski", name: "Mira Kowalski", title: "Product designer", company: "Figma", loc: "San Francisco, CA", job: "des", source: "job_board", at: 900, touch: 860, path: ["screening"], owner: "priya", start: "1 to 3 months", usAuth: true,
    cover: "Five years designing FigJam. I'd love to be a company's first designer and build the system from scratch.",
    summary: "Designs FigJam's canvas tools. Strong systems thinking." },

  // ---- Interviewing, nobody booked yet
  { k: "grace-liu", name: "Grace Liu", title: "Founding engineer", company: "a YC W22 devtools startup", loc: "San Francisco, CA", job: "eng", source: "agency", detail: "Tacit", at: 96, touch: 6, path: ["screening", "interviewing"], owner: "priya",
    summary: "First engineer at a devtools startup to Series A. Built their job queue and billing. Wants a bigger infra problem.",
    next: { action: "Find a slot with Sam for the technical", due: 0, owner: "priya" } },
  { k: "oliver-grant", name: "Oliver Grant", title: "Software engineer", company: "Linear", loc: "Remote (Lisbon)", job: "pe", source: "job_board", at: 140, touch: 20, path: ["screening", "interviewing"], owner: "priya", start: "Within a month", usAuth: false,
    cover: "I work on Linear's sync engine and the keyboard model. I want to build a product from much earlier on.",
    summary: "Linear's sync engine and keyboard model." },
  { k: "yuki-sato", name: "Yuki Sato", title: "Research engineer", company: "Sakana AI", loc: "Tokyo, Japan", job: "evals", source: "sourced", detail: "arXiv", at: 200, touch: 50, path: ["contacted", "screening", "interviewing"], owner: "priya",
    summary: "Model-merging evals at Sakana. Two first-author workshop papers." },

  // ---- Interviewing, rounds held: the team's call
  { k: "maya-chen", name: "Maya Chen", title: "Infra engineer", company: "Stripe", loc: "San Francisco, CA", job: "eng", source: "job_board", at: 260, touch: 46, path: ["screening", "interviewing"], owner: "priya", phone: "+1 415 555 0118", start: "1 to 3 months", usAuth: true,
    cover: "I built Stripe's idempotency layer for payment retries and led a zero-downtime move from Postgres to sharded MySQL. I'd like to be early somewhere and own infra end to end.",
    summary: "Built Stripe's idempotency layer for payment retries. Led a Postgres-to-sharded-MySQL migration with no downtime. Two well-read posts on queueing.",
    next: { action: "Decide: Founders' round or offer (she has a competing offer)", due: 1, owner: "daniel" },
    interviews: [
      { step: "Recruiter screen", ago: 190, by: "priya", fb: { rec: "yes", rating: 4, notes: "Clear on why she wants to leave Stripe: wants to own a system end to end. Has a competing offer from a later-stage company, decision in two weeks." } },
      { step: "Technical deep dive", ago: 50, by: "sam", fb: { rec: "strong_yes", rating: 4, notes: "Best systems-design answer this quarter. Debugged the failing shard live without hints. Light on tests and said so herself. Hire: she'd raise the bar on the infra team." } },
    ] },
  { k: "arjun-mehta", name: "Arjun Mehta", title: "Senior engineer", company: "Databricks", loc: "Seattle, WA", job: "eng", source: "referral", detail: "Referred by Noor Haddad", at: 300, touch: 28, path: ["screening", "interviewing"], owner: "priya",
    summary: "Owns Spark shuffle reliability at Databricks. Cut p99 job latency 38% with adaptive spilling. Mentors four engineers.",
    interviews: [
      { step: "Technical deep dive", ago: 75, by: "noor", fb: { rec: "yes", rating: 3, notes: "Strong on distributed-systems fundamentals. Correct under load; struggled with burst handling until the end." } },
      { step: "Systems design", ago: 30, by: "wei", fb: { rec: "no", rating: 2, notes: "Slow to commit to a design; talked through three. Wants a manager track soon. Good engineer, not sure he wants a founding role." } },
    ] },
  { k: "elena-petrova", name: "Elena Petrova", title: "Research engineer", company: "Anthropic", loc: "London, UK", job: "res", source: "agency", detail: "Tacit", at: 340, touch: 100, path: ["screening", "interviewing"], owner: "priya",
    summary: "Co-author on two RLHF papers. Built a reward-model eval suite used across teams. Shipped a 3x faster rollout sampler. Relocating.",
    interviews: [
      { step: "Research talk", ago: 120, by: "aisha", fb: { rec: "yes", rating: 4, notes: "Sharp on reward hacking. Could go deeper on scaling laws. Great collaborator energy. Yes; I'd want Marcus to push on research taste." } },
    ] },
  { k: "tom-becker", name: "Tom Becker", title: "Engineer", company: "Ramp", loc: "New York, NY", job: "eng", source: "job_board", at: 180, touch: 26, path: ["screening", "interviewing"], owner: "priya", start: "Within a month", usAuth: true,
    cover: "I built Ramp's ledger reconciliation and ship fast. Some infra, mostly product, and I want to go deeper on infra.",
    summary: "Built Ramp's ledger reconciliation. Fast shipper. Some infra, mostly product.",
    next: { action: "Chase Daniel's feedback", due: -1, owner: "priya" },
    interviews: [{ step: "Technical deep dive", ago: 27, by: "daniel" }] },
  { k: "camille-laurent", name: "Camille Laurent", title: "Designer-engineer", company: "Linear", loc: "Remote (Paris)", job: "pe", source: "referral", detail: "Referred by Lena Park", at: 230, touch: 44, path: ["screening", "interviewing"], owner: "priya",
    summary: "Designs and builds. Shipped Linear's triage view. Strong systems thinking for UI. Competing offer.",
    next: { action: "Book the Founders' round this week", due: 2, owner: "priya" },
    interviews: [
      { step: "Recruiter screen", ago: 160, by: "priya", fb: { rec: "yes", rating: 4, notes: "Wants to own a surface end to end. Has an offer from a Series B; timing matters." } },
      { step: "Product build", ago: 48, by: "lena", fb: { rec: "strong_yes", rating: 4, notes: "The best product build we've had. Real empty states, sensible tests, and she questioned the brief in the right places." } },
    ] },
  { k: "diego-ramos", name: "Diego Ramos", title: "Research engineer", company: "Meta FAIR", loc: "Menlo Park, CA", job: "res", source: "agency", detail: "Tacit", at: 210, touch: 36, path: ["screening", "interviewing"], owner: "priya",
    summary: "Built FAIR's eval dashboard. Strong on infra for research. Two first-author workshop papers.",
    interviews: [
      { step: "Coding", ago: 38, by: "theo", fb: { rec: "yes", rating: 4, notes: "Great tests, terse explanation. Found the label leak in the harness in twenty minutes." } },
    ] },
  { k: "fatima-zahra", name: "Fatima Zahra", title: "Staff engineer", company: "Anyscale", loc: "San Francisco, CA", job: "inf", source: "referral", detail: "Referred by Daniel Okafor", at: 280, touch: 22, path: ["screening", "interviewing"], owner: "ryan",
    summary: "Led Ray Serve's autoscaler. Knows continuous batching inside out.",
    interviews: [
      { step: "Systems design", ago: 98, by: "sam", fb: { rec: "yes", rating: 4, notes: "Designed a batching server with a sensible admission policy, unprompted. Wanted more time on the failure modes." } },
      { step: "Founders' round", ago: 23, by: "daniel" },
    ] },

  // ---- Offer
  { k: "laura-fischer", name: "Laura Fischer", title: "Engineer", company: "Datadog", loc: "Boston, MA", job: "eng", source: "job_board", at: 720, touch: 30, path: ["screening", "interviewing", "offer"], owner: "priya", start: "1 to 3 months", usAuth: true,
    cover: "I own Datadog's metrics ingest. I'd like to build infra at a company small enough that I know every service.",
    summary: "Owns Datadog's metrics ingest pipeline.",
    next: { action: "Offer call: walk through equity", due: 1, owner: "daniel" },
    interviews: [
      { step: "Recruiter screen", ago: 600, by: "priya", fb: { rec: "yes", rating: 4, notes: "Thoughtful, specific about what she wants. Relocating is fine." } },
      { step: "Technical deep dive", ago: 450, by: "sam", fb: { rec: "strong_yes", rating: 4, notes: "Clean token bucket with a sliding-window fallback. Fast and correct." } },
      { step: "Founders' round", ago: 200, by: "daniel", fb: { rec: "strong_yes", rating: 4, notes: "Yes. Asked the best questions about how we decide things." } },
    ] },
  { k: "hiro-nakamura", name: "Hiro Nakamura", title: "Research scientist", company: "Preferred Networks", loc: "Tokyo, Japan", job: "res", source: "referral", detail: "Referred by Marcus Bell", at: 800, touch: 70, path: ["screening", "interviewing", "offer"], owner: "priya",
    summary: "RL for robotics at PFN. Moving into language-model post-training.",
    interviews: [
      { step: "Research talk", ago: 500, by: "aisha", fb: { rec: "yes", rating: 4, notes: "Clear talk, honest about what didn't work." } },
      { step: "Team fit", ago: 300, by: "marcus", fb: { rec: "yes", rating: 4, notes: "Would push the team on rigor. Yes." } },
    ] },

  // ---- Hired
  { k: "isabel-cruz", name: "Isabel Cruz", title: "Product engineer", company: "Retool", loc: "Remote (Mexico City)", job: "pe", source: "job_board", at: 1400, touch: 960, path: ["screening", "interviewing", "offer", "hired"], owner: "priya", start: "Within a month", usAuth: false,
    cover: "I build Retool's table component and care a lot about details nobody notices until they're wrong.",
    summary: "Built Retool's table component.",
    interviews: [
      { step: "Product build", ago: 1250, by: "jonah", fb: { rec: "strong_yes", rating: 4, notes: "Polished, fast, and her write-up explained every trade-off." } },
      { step: "Founders' round", ago: 1100, by: "lena", fb: { rec: "yes", rating: 4, notes: "Yes." } },
    ] },
  { k: "sven-olsen", name: "Sven Olsen", title: "Infrastructure engineer", company: "Spotify", loc: "San Francisco, CA", job: "eng", source: "referral", detail: "Referred by Wei Zhang", at: 1800, touch: 1440, path: ["screening", "interviewing", "offer", "hired"], owner: "priya",
    summary: "Ran Spotify's event-delivery pipeline.",
    interviews: [
      { step: "Technical deep dive", ago: 1650, by: "wei", fb: { rec: "strong_yes", rating: 4, notes: "Exactly the depth we need on queues." } },
      { step: "Founders' round", ago: 1550, by: "daniel", fb: { rec: "yes", rating: 4, notes: "Yes." } },
    ] },

  // ---- Rejected and withdrew
  { k: "omar-siddiqui", name: "Omar Siddiqui", title: "Engineer", company: "Figma", loc: "Remote (Austin)", job: "pe", source: "job_board", at: 500, touch: 300, path: ["screening", "interviewing", "rejected"], reason: "Skills or experience", owner: "priya", start: "Within a month", usAuth: true,
    cover: "I work on Figma's plugins team and want to own a whole product surface.",
    interviews: [{ step: "Product build", ago: 330, by: "jonah", fb: { rec: "no", rating: 2, notes: "Worked, but most checks only; the edge cases were left for later." } }] },
  { k: "kate-morrow", name: "Kate Morrow", title: "New grad", company: "Carnegie Mellon", loc: "Pittsburgh, PA", job: "res", source: "job_board", at: 400, touch: 380, path: ["rejected"], reason: "Not the right level", owner: "priya", start: "More than 3 months", usAuth: true,
    cover: "Graduating in May with a focus on RL. I'd love to learn from your team." },
  { k: "derek-hale", name: "Derek Hale", title: "Backend engineer", company: "Shopify", loc: "Ottawa, Canada", job: "eng", source: "job_board", at: 340, touch: 320, path: ["rejected"], reason: "Location", owner: "priya", start: "1 to 3 months", usAuth: false,
    cover: "Backend at Shopify for five years. Remote only, please." },
  { k: "lily-tran", name: "Lily Tran", title: "ML engineer", company: "Uber", loc: "San Francisco, CA", job: "evals", source: "sourced", detail: "LinkedIn", at: 450, touch: 250, path: ["contacted", "screening", "rejected"], reason: "Compensation", owner: "priya" },
  { k: "victor-aguilar", name: "Victor Aguilar", title: "Senior engineer", company: "Snowflake", loc: "San Mateo, CA", job: "inf", source: "job_board", at: 380, touch: 150, path: ["screening", "interviewing", "rejected"], reason: "Skills or experience", owner: "ryan", start: "Within a month", usAuth: true,
    cover: "I've scaled Snowflake's query scheduler and want to work on inference.",
    interviews: [{ step: "Technical deep dive", ago: 170, by: "noor", fb: { rec: "strong_no", rating: 1, notes: "Couldn't get the batching server past the first test; little GPU background." } }] },
  { k: "noah-bennett", name: "Noah Bennett", title: "Engineer", company: "Coinbase", loc: "New York, NY", job: "eng", source: "agency", detail: "Tacit", at: 620, touch: 410, path: ["screening", "interviewing", "withdrawn"], reason: "Accepted another offer", owner: "priya",
    interviews: [{ step: "Technical deep dive", ago: 450, by: "sam", fb: { rec: "yes", rating: 4, notes: "Solid and pragmatic." } }] },
  { k: "zoe-adams", name: "Zoe Adams", title: "Senior product designer", company: "Airbnb", loc: "San Francisco, CA", job: "des", source: "referral", detail: "Referred by Lena Park", at: 1000, touch: 900, path: ["screening", "withdrawn"], reason: "Timing", owner: "priya" },
];
