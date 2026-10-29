// Sample data. Everyone here is fictional. Times are relative to now so the
// prototype always reads as current.
//
// The model: an applicant is a ticket. Its court is whoever has the next
// move: you (the talent engineer), a team's Grokbots while they find an
// interviewer, one person's Grokbot while it texts, drafts and schedules for
// them, that person while they interview, or the candidate while a Testbench
// is out. Nobody edits tickets here; Grokbots update them from Slack,
// iMessage, Gmail and Claude, and the dashboard shows where everyone stands.

const NOW = Date.now();
const MIN = 60000, HR = 3600000, DAY = 86400000;
const minsAgo = (m) => NOW - m * MIN;
function wdAt(n, h, m = 0) {
  // n working days from today at h:m (weekends skipped)
  const d = new Date(NOW);
  let k = 0;
  while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) k++; }
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

const ORG = { name: "Meridian", initials: "M" };
const ME = "priya";

// Each person works through their own Grokbot. `likes` is what the bots have
// learned about interviewing: from yes/no replies, how fast they answer, and
// what they say afterwards.
const PEOPLE = {
  priya: { name: "Priya Raman", role: "Talent engineer", color: "#3c6e8f" },
  daniel: { name: "Daniel Okafor", role: "CTO", team: "infra", color: "#7a5c3e", likes: "fine", cap: 1, load: 1, focus: ["Architecture", "Founders' round"], ch: "slack", said: "4 of 6 yes" },
  sam: { name: "Sam Whitaker", role: "Staff engineer", team: "infra", color: "#6b7a90", likes: "loves", cap: 3, load: 1, focus: ["Distributed systems", "Debugging"], ch: "imessage", said: "9 of 10 yes" },
  wei: { name: "Wei Zhang", role: "Senior engineer", team: "infra", color: "#4f7a65", likes: "avoids", cap: 1, load: 0, focus: ["Storage", "Go"], ch: "slack", said: "1 of 4 yes", quiet: "Heads-down until the 14th" },
  noor: { name: "Noor Haddad", role: "Engineer", team: "infra", color: "#8a6a3a", likes: "fine", cap: 2, load: 2, focus: ["Networking", "Kubernetes"], ch: "imessage", said: "3 of 5 yes", quiet: "On call through Friday" },
  marcus: { name: "Marcus Bell", role: "Research lead", team: "research", color: "#5b5f99", likes: "fine", cap: 2, load: 1, focus: ["Post-training", "Evals"], ch: "slack", said: "5 of 7 yes" },
  aisha: { name: "Aisha Karim", role: "Research scientist", team: "research", color: "#8a4f6e", likes: "loves", cap: 3, load: 2, focus: ["RL", "Reward models"], ch: "imessage", said: "8 of 8 yes" },
  theo: { name: "Theo Lindqvist", role: "Research engineer", team: "research", color: "#4d6f8c", likes: "avoids", cap: 1, load: 0, focus: ["Infra for training", "JAX"], ch: "slack", said: "1 of 3 yes" },
  lena: { name: "Lena Park", role: "Design lead", team: "product", color: "#9a5a4a", likes: "loves", cap: 2, load: 1, focus: ["Product design", "Portfolio reviews"], ch: "imessage", said: "6 of 7 yes" },
  jonah: { name: "Jonah Reyes", role: "Product engineer", team: "product", color: "#6a7d3c", likes: "fine", cap: 2, load: 0, focus: ["Frontend", "TypeScript"], ch: "slack", said: "3 of 4 yes" },
};

const TEAMS = {
  infra: { name: "Infra", color: "#5e6ad2", members: ["daniel", "sam", "wei", "noor"] },
  research: { name: "Research", color: "#2f8a7e", members: ["marcus", "aisha", "theo"] },
  product: { name: "Product", color: "#c4663a", members: ["lena", "jonah"] },
};

const ROLES = {
  eng: { title: "Founding Engineer, Infra", team: "infra", tb: "Rate limiter under load", tbLen: "3 hours" },
  res: { title: "Research Scientist, Post-training", team: "research", tb: "Find the bug in an eval harness", tbLen: "3 hours" },
  pe: { title: "Product Engineer", team: "product", tb: "Ship a settings flow", tbLen: "2 hours" },
  inf: { title: "Staff Engineer, Inference", team: "infra", tb: "Cut p99 latency on a batching server", tbLen: "3 hours" },
  evals: { title: "Research Engineer, Evals", team: "research", tb: "Find the bug in an eval harness", tbLen: "3 hours" },
  des: { title: "Founding Product Designer", team: "product", tb: "Redesign an onboarding flow", tbLen: "2 hours", status: "paused" },
};

// Careers page traffic per post: daily views around `base`, live from `since` days ago until `until`,
// `rate` of views apply, `mix` says where applicants come from, `spikes` are days a post got shared.
const POST_TRAFFIC = {
  eng: { base: 95, growth: 0.7, since: 180, rate: 0.024, spikes: [12, 61], mix: { Referral: 0.14, Tacit: 0.12, Careers: 0.42, LinkedIn: 0.2, HN: 0.12 } },
  res: { base: 70, growth: 0.9, since: 180, rate: 0.028, spikes: [33], mix: { Referral: 0.12, Tacit: 0.2, Careers: 0.38, LinkedIn: 0.18, HN: 0.12 } },
  pe: { base: 48, growth: 0.3, since: 160, rate: 0.032, spikes: [4], mix: { Referral: 0.1, Tacit: 0.08, Careers: 0.5, LinkedIn: 0.26, HN: 0.06 } },
  inf: { base: 40, growth: 1.2, since: 40, rate: 0.02, spikes: [18], mix: { Referral: 0.16, Tacit: 0.14, Careers: 0.34, LinkedIn: 0.16, HN: 0.2 } },
  evals: { base: 30, growth: 1, since: 22, rate: 0.026, spikes: [], mix: { Referral: 0.1, Tacit: 0.22, Careers: 0.4, LinkedIn: 0.2, HN: 0.08 } },
  des: { base: 34, growth: 0, since: 150, until: 38, rate: 0.03, spikes: [], mix: { Referral: 0.12, Tacit: 0.06, Careers: 0.5, LinkedIn: 0.28, HN: 0.04 } },
};

// How the orchestrator picks an interviewer when a team is assigned.
const POLICY = [
  { k: "want", name: "Wants to interview", d: "Based on their past replies to interview requests" },
  { k: "room", name: "Has room this week", d: "Weekly limit minus interviews already booked" },
  { k: "match", name: "Knows the area", d: "Focus areas matched to the role" },
  { k: "fair", name: "Spreads the load", d: "Rotates first rounds across the team" },
];

// Linear-style priority and labels.
const PRIORITIES = [
  { v: 0, name: "No priority" },
  { v: 1, name: "Urgent" },
  { v: 2, name: "High" },
  { v: 3, name: "Medium" },
  { v: 4, name: "Low" },
];
const LABELS = {
  "Competing offer": "#e5484d",
  "Top Testbench": "#2c8a4f",
  "Relocating": "#8f9198",
  "Referral": "#5e6ad2",
  "Tacit": "#1f2023",
};

// States. `court` says whose move it is.
const STATES = {
  new: { name: "New", court: "you", tone: "new" },
  testbench: { name: "Testbench out", court: "candidate", tone: "wait" },
  routing: { name: "Finding interviewer", court: "team", tone: "bot" },
  asked: { name: "Asked interviewer", court: "bot", tone: "bot" },
  scheduling: { name: "Scheduling", court: "bot", tone: "bot" },
  scheduled: { name: "Interview booked", court: "person", tone: "iv" },
  debrief: { name: "Getting the read", court: "bot", tone: "bot" },
  judgment: { name: "Your call", court: "you", tone: "you" },
  passed: { name: "Passed", court: null, tone: "closed" },
  rejected: { name: "Rejected", court: null, tone: "closed" },
  offer: { name: "Offer", court: null, tone: "done" },
};

// Testbench results (the coding environment sent as a take-home).
const TB = (score, pass, time, pct, r, note) => ({ state: "done", score, pass, time, pct, rubric: { Correctness: r[0], Design: r[1], Testing: r[2], Communication: r[3] }, note });

const APPLICANTS = [
  // ---- your court: judgments
  { id: "APP-118", pri: 1, labels: ["Competing offer"], name: "Maya Chen", hl: "Infra engineer at Stripe", role: "eng", src: "Applied", loc: "San Francisco", yrs: 7,
    links: ["github.com/mayachen", "maya.dev"], state: "judgment", team: "infra", iv: "sam", when: minsAgo(140),
    sum: ["Built Stripe's idempotency layer for payment retries", "Led a Postgres-to-sharded-MySQL migration with no downtime", "Writes clearly: two well-read posts on queueing"],
    exp: [["Stripe", "Infra engineer", "2021 – now"], ["Segment", "Backend engineer", "2018 – 2021"]],
    tb: TB(91, "19 of 20", "2h 41m", 96, [5, 5, 3, 5], "Clean token bucket with a sliding-window fallback; skipped one race test."),
    read: { verdict: "Strong yes", senti: 0.82, by: "sam", notes: ["Best systems-design answer this quarter", "Debugged the failing shard live without hints", "Light on tests; said so herself"], quote: "Hire. She'd raise the bar on the infra team." } },
  { id: "APP-109", pri: 3, name: "Arjun Mehta", hl: "Senior engineer at Databricks", role: "eng", src: "Referral · Noor", loc: "Seattle", yrs: 9,
    links: ["github.com/arjunm"], state: "judgment", team: "infra", iv: "noor", when: minsAgo(55),
    sum: ["Owns Spark shuffle reliability at Databricks", "Cut p99 job latency 38% with adaptive spilling", "Mentors four engineers"],
    exp: [["Databricks", "Senior engineer", "2019 – now"], ["Twitter", "Engineer", "2015 – 2019"]],
    tb: TB(78, "16 of 20", "2h 58m", 74, [4, 4, 3, 4], "Correct under load; struggled with burst handling until the end."),
    read: { verdict: "Mixed", senti: 0.41, by: "noor", notes: ["Strong on distributed systems fundamentals", "Slow to commit to a design; talked through three", "Wants a manager track soon"], quote: "Good engineer, not sure he wants a founding role." } },
  { id: "APP-104", pri: 2, labels: ["Relocating"], name: "Elena Petrova", hl: "Research engineer at Anthropic", role: "res", src: "Tacit", loc: "London", yrs: 5,
    links: ["arxiv.org/a/petrova_e", "github.com/epetrova"], state: "judgment", team: "research", iv: "aisha", when: minsAgo(300),
    sum: ["Co-author on two RLHF papers", "Built a reward-model eval suite used across teams", "Shipped a 3x faster rollout sampler"],
    exp: [["Anthropic", "Research engineer", "2022 – now"], ["DeepMind", "Research intern", "2021"]],
    tb: TB(88, "7 of 8 bugs", "2h 20m", 92, [5, 4, 4, 5], "Found the label leak and the off-by-one in the scorer; missed a seed issue."),
    read: { verdict: "Yes", senti: 0.71, by: "aisha", notes: ["Sharp on reward hacking", "Could go deeper on scaling laws", "Great collaborator energy"], quote: "Yes. I'd want Marcus to push on research taste." } },

  // ---- your court: new (triage queue)
  { id: "APP-131", pri: 2, note: "Hi Meridian team,\n\nI run the rate-limiting fleet at Cloudflare's edge, and I've been reading your infra posts for a while. I'd like to work somewhere infra decisions take a week, not a quarter. I took the Testbench yesterday and enjoyed the burst-handling part more than I expected.\n\nResume attached. Happy to talk whenever suits you.\n\nLin", name: "Lin Zhou", hl: "SRE at Cloudflare", role: "eng", src: "Applied", loc: "Austin", yrs: 6, links: ["github.com/linzhou"], state: "new", when: minsAgo(25),
    sum: ["Runs Cloudflare's edge rate-limiting fleet", "On-call lead for a 400-node cluster", "Rust and Go"], exp: [["Cloudflare", "SRE", "2020 – now"], ["Fastly", "Systems engineer", "2018 – 2020"]],
    tb: TB(84, "18 of 20", "2h 12m", 88, [5, 4, 4, 3], "Fast and correct; terse write-up.") },
  { id: "APP-130", pri: 3, note: "Hello,\n\nI spent four years building low-latency inference for trading models at Jane Street and have been teaching myself RL on the side. I'd like to move into post-training research properly, and your team's eval work is the reason I'm applying here rather than somewhere bigger.\n\nPavel", name: "Pavel Sokolov", hl: "Research engineer, ex-Jane Street", role: "res", src: "Tacit", loc: "New York", yrs: 4, links: ["github.com/psokolov"], state: "new", when: minsAgo(70),
    sum: ["Built low-latency inference for trading models", "Kaggle grandmaster", "Self-taught RL on the side"], exp: [["Jane Street", "Research engineer", "2021 – 2025"]], tb: null },
  { id: "APP-129", pri: 2, labels: ["Top Testbench"], note: "Hi there,\n\nI built the deploy-preview comments at Vercel and maintain a CLI a few thousand people use. I care a lot about the last 10% of product polish, and Meridian's product feels like it was built by people who do too.\n\nI did the Testbench over the weekend. The settings flow was fun.\n\nKwame", name: "Kwame Asante", hl: "Platform engineer at Vercel", role: "pe", src: "Applied", loc: "Remote", yrs: 5, links: ["github.com/kasante", "kwame.design"], state: "new", when: minsAgo(95),
    sum: ["Built Vercel's deploy-preview comments", "Strong frontend and DX taste", "Open source: 3k-star CLI"], exp: [["Vercel", "Platform engineer", "2022 – now"], ["Shopify", "Frontend engineer", "2019 – 2022"]],
    tb: TB(93, "All checks", "1h 48m", 97, [5, 5, 5, 4], "Polished flow, real empty states, good tests.") },
  { id: "APP-127", pri: 0, note: "Hi,\n\nI wrote Modal's GPU scheduler backfill and before that was early at a startup that got acquired. Three years in, but I've owned real systems end to end. Would love to be considered for the infra role.\n\nSofia", name: "Sofia Alvarez", hl: "Infrastructure engineer at Modal", role: "eng", src: "Applied", loc: "San Francisco", yrs: 3, links: ["github.com/salvarez"], state: "new", when: minsAgo(160),
    sum: ["Wrote Modal's GPU scheduler backfill", "Previously at a seed-stage startup (acquired)", "Strong systems fundamentals for 3 years"], exp: [["Modal", "Infra engineer", "2023 – now"], ["Hex", "Engineer", "2021 – 2023"]], tb: null },
  { id: "APP-126", pri: 3, labels: ["Relocating"], note: "Hello Meridian,\n\nSam and I worked together years ago and he suggested I reach out. I'm a core contributor to Temporal's history service and designed its multi-region replication. I'd be relocating from Lisbon.\n\nInes", name: "Ines Duarte", hl: "Distributed systems at Temporal", role: "eng", src: "Referral · Sam", loc: "Lisbon", yrs: 8, links: ["github.com/iduarte"], state: "new", when: minsAgo(220),
    sum: ["Core contributor to Temporal's history service", "Designed multi-region replication", "Speaks at Strange Loop"], exp: [["Temporal", "Staff engineer", "2020 – now"], ["Uber", "Engineer", "2016 – 2020"]],
    tb: TB(72, "15 of 20", "3h 00m", 61, [4, 4, 2, 3], "Ran out of time; the design notes were the best part.") },
  { id: "APP-125", pri: 0, note: "Hi,\n\nI maintain TRL's PPO trainer at Hugging Face and wrote the DPO tutorial a lot of people learn from. I'm looking for a smaller research team where I can run my own experiments, not only support other people's.\n\nHannah", name: "Hannah Novak", hl: "ML engineer at Hugging Face", role: "res", src: "Applied", loc: "Paris", yrs: 4, links: ["huggingface.co/hnovak"], state: "new", when: minsAgo(300),
    sum: ["Maintains TRL's PPO trainer", "Wrote the DPO tutorial most people learn from", "Strong open-source track record"], exp: [["Hugging Face", "ML engineer", "2022 – now"]], tb: null },

  // ---- with Grokbots
  { id: "APP-122", pri: 2, name: "Grace Liu", hl: "Founding engineer at a YC startup", role: "eng", src: "Tacit", loc: "San Francisco", yrs: 6, links: ["github.com/graceliu"], state: "scheduling", team: "infra", iv: "sam", when: minsAgo(18),
    sum: ["First engineer at a devtools startup to Series A", "Built their job queue and billing", "Wants a bigger infra problem"], exp: [["Stealth (YC W22)", "Founding engineer", "2022 – now"]],
    tb: TB(86, "18 of 20", "2h 30m", 90, [4, 5, 4, 4], "Solid, pragmatic, good write-up.") },
  { id: "APP-121", pri: 2, name: "Mei Tanaka", hl: "Research scientist at Google", role: "res", src: "Applied", loc: "Tokyo", yrs: 6, links: ["scholar.google.com/mtanaka"], state: "routing", team: "research", when: minsAgo(4),
    sum: ["Works on reward modelling for Gemini", "NeurIPS oral 2024", "Wants a smaller team"], exp: [["Google DeepMind", "Research scientist", "2020 – now"]],
    tb: TB(81, "6 of 8 bugs", "2h 50m", 82, [4, 4, 4, 4], "Methodical; caught the leakage quickly.") },
  { id: "APP-120", pri: 3, name: "Rachel Kim", hl: "Senior engineer at Plaid", role: "pe", src: "Applied", loc: "New York", yrs: 7, links: ["github.com/rkim"], state: "asked", team: "product", iv: "lena", when: minsAgo(9),
    sum: ["Led Plaid Link's redesign", "Bridges design and engineering", "Wants zero-to-one work"], exp: [["Plaid", "Senior engineer", "2019 – now"]],
    tb: TB(89, "All checks", "1h 55m", 93, [5, 4, 4, 5], "Thoughtful UI states; strong write-up.") },
  { id: "APP-117", pri: 3, name: "Tom Becker", hl: "Engineer at Ramp", role: "eng", src: "Applied", loc: "New York", yrs: 4, links: ["github.com/tbecker"], state: "debrief", team: "infra", iv: "daniel", when: minsAgo(1560), nudged: true,
    sum: ["Built Ramp's ledger reconciliation", "Fast shipper", "Some infra, mostly product"], exp: [["Ramp", "Engineer", "2021 – now"]],
    tb: TB(80, "17 of 20", "2h 35m", 79, [4, 4, 4, 3], "Correct; a little over-engineered.") },

  // ---- interviews booked
  { id: "APP-115", pri: 1, labels: ["Competing offer", "Top Testbench"], name: "Camille Laurent", hl: "Product designer-engineer at Linear", role: "pe", src: "Referral · Lena", loc: "Remote", yrs: 6, links: ["camille.studio"], state: "scheduled", team: "product", iv: "lena", when: minsAgo(600), at: wdAt(1, 15),
    sum: ["Designs and builds", "Shipped Linear's triage view", "Strong systems thinking for UI"], exp: [["Linear", "Designer-engineer", "2021 – now"]],
    tb: TB(95, "All checks", "1h 40m", 99, [5, 5, 4, 5], "The best submission we've had.") },
  { id: "APP-112", pri: 3, name: "Diego Ramos", hl: "Research engineer at Meta FAIR", role: "res", src: "Tacit", loc: "Menlo Park", yrs: 5, links: ["github.com/dramos"], state: "scheduled", team: "research", iv: "marcus", when: minsAgo(900), at: wdAt(2, 11),
    sum: ["Built FAIR's eval dashboard", "Strong on infra for research", "Two first-author workshop papers"], exp: [["Meta FAIR", "Research engineer", "2021 – now"]],
    tb: TB(83, "7 of 8 bugs", "2h 44m", 86, [4, 4, 5, 3], "Great tests, terse explanation.") },

  // ---- Testbench out
  { id: "APP-124", pri: 0, labels: ["Relocating"], name: "Ana Souza", hl: "Backend engineer at Nubank", role: "eng", src: "Tacit", loc: "São Paulo", yrs: 5, links: ["github.com/asouza"], state: "testbench", when: minsAgo(1300), tbSent: minsAgo(1300),
    sum: ["Clojure and Kafka at scale", "Built Nubank's fraud stream", "Moving to SF"], exp: [["Nubank", "Backend engineer", "2020 – now"]], tb: { state: "running", progress: 0.6 } },
  { id: "APP-123", pri: 4, name: "Ben Ortiz", hl: "ML engineer at Scale", role: "res", src: "Applied", loc: "San Francisco", yrs: 3, links: ["github.com/bortiz"], state: "testbench", when: minsAgo(2900), tbSent: minsAgo(2900),
    sum: ["Data pipelines for RLHF vendors", "Strong Python", "Wants research"], exp: [["Scale AI", "ML engineer", "2022 – now"]], tb: { state: "sent" } },

  // ---- closed
  { id: "APP-101", pri: 2, name: "Laura Fischer", hl: "Engineer at Datadog", role: "eng", src: "Applied", loc: "Boston", yrs: 6, links: [], state: "offer", team: "infra", iv: "sam", when: minsAgo(4000),
    sum: ["Owns Datadog's metrics ingest"], exp: [["Datadog", "Engineer", "2019 – now"]], tb: TB(90, "19 of 20", "2h 20m", 95, [5, 4, 5, 4], "") },
  { id: "APP-099", pri: 0, name: "Omar Siddiqui", hl: "Engineer at Figma", role: "pe", src: "Applied", loc: "Remote", yrs: 4, links: [], state: "rejected", team: "product", iv: "jonah", when: minsAgo(5200),
    sum: ["Figma plugins team"], exp: [["Figma", "Engineer", "2021 – now"]], tb: TB(68, "Most checks", "2h 00m", 48, [3, 3, 3, 4], "") },
  { id: "APP-097", pri: 4, name: "Kate Morrow", hl: "New grad, CMU", role: "res", src: "Applied", loc: "Pittsburgh", yrs: 0, links: [], state: "passed", when: minsAgo(6000),
    sum: ["Strong coursework"], exp: [], tb: null },
];
