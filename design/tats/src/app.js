// tATS for engineers: applicants are tickets, and every ticket sits in
// someone's court. You triage (Superhuman-style), assign a team like you'd
// assign a ticket, and the team's Grokbots take it from there: they pick the
// interviewer, text them, draft the invite in their Gmail, book it, and come
// back with the interviewer's read. You only see it again when it's your call.
// Plain DOM: render() redraws from `state`; clicks route through data-act.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const A = Object.fromEntries(APPLICANTS.map((a) => [a.id, a]));
const first = (id) => PEOPLE[id].name.split(" ")[0];
const first2 = (a) => a.name.split(" ")[0];
const isOpen = (a) => !!STATES[a.state].court;
const stripTags = (h) => h.replace(/<[^>]+>/g, "");

const state = {
  route: { name: "inbox" },
  team: "all",
  closedOpen: false,
  focus: null,
  lastList: [],
  tq: 0,
};
try { const t = localStorage.getItem("tats-theme"); if (t) document.documentElement.dataset.theme = t; } catch {}

/* ---------------- formatting ---------------- */
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDay = (ms) => { const d = new Date(ms); return `${WD[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtTime(ms) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}
const fmtWhen = (ms) => { const d = new Date(ms); return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}, ${fmtTime(ms)}`; };
function ago(ms) {
  const m = Math.max(0, (Date.now() - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

/* ---------------- icons ---------------- */
const P = {
  court: "M8 2.5v11M5 13.5h6M3 5.5h10M4.5 5.5 2.5 10a2 2 0 0 0 4 0Zm7 0-2 4.5a2 2 0 0 0 4 0Z",
  triage: "M2.5 4.5h11M2.5 8h7M2.5 11.5h4M11.5 9.5l2 2-2 2",
  people: "M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M3 13.5c.5-2.5 2.5-3.8 5-3.8s4.5 1.3 5 3.8",
  bot: "M4 6.5h8a1.5 1.5 0 0 1 1.5 1.5v3.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 4 6.5ZM8 6.5V4M8 3.2h.01M6 9.7h.01M10 9.7h.01",
  search: "M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5l3 3",
  chevR: "M6 3.5 10.5 8 6 12.5",
  chevL: "M10 3.5 5.5 8 10 12.5",
  check: "M3.5 8.5 6.5 11.5 12.5 4.5",
  x: "M4 4l8 8M12 4l-8 8",
  file: "M4 2.5h5.5L12 5v8.5H4ZM9.5 2.5V5H12",
  list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5",
  board: "M2.5 3h3v10h-3ZM6.5 3h3v6.5h-3ZM10.5 3h3v8.5h-3Z",
  sliders: "M3 5h6M11 5h2M3 11h2M7 11h6M9 3.5v3M5 9.5v3",
  plus: "M8 3v10M3 8h10",
  route: "M4 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM4 10.5V8a2 2 0 0 1 2-2h4a2 2 0 0 0 2-2",
  compose: "M9.5 3.5h-6v9h9v-6M7 9l.4-2L12.5 2l1.5 1.5L9 8.6Z",
  grid: "M2.5 2.5h4.5v4.5H2.5ZM9 2.5h4.5v4.5H9ZM2.5 9h4.5v4.5H2.5ZM9 9h4.5v4.5H9Z",
  home: "M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5Z",
  db: "M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2ZM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2",
  chevU: "M4 10l4-4 4 4",
  mic: "M8 2.5a2 2 0 0 0-2 2v3.5a2 2 0 0 0 4 0V4.5a2 2 0 0 0-2-2ZM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5",
  gear: "M12.61 6.05 L14.22 6.48 L14.22 9.52 L12.61 9.95 L12.63 9.88 L13.47 11.32 L11.32 13.47 L9.88 12.63 L9.95 12.61 L9.52 14.22 L6.48 14.22 L6.05 12.61 L6.12 12.63 L4.68 13.47 L2.53 11.32 L3.37 9.88 L3.39 9.95 L1.78 9.52 L1.78 6.48 L3.39 6.05 L3.37 6.12 L2.53 4.68 L4.68 2.53 L6.12 3.37 L6.05 3.39 L6.48 1.78 L9.52 1.78 L9.95 3.39 L9.88 3.37 L11.32 2.53 L13.47 4.68 L12.63 6.12Z M10.2 8a2.2 2.2 0 1 1-4.4 0a2.2 2.2 0 1 1 4.4 0Z",
  alert: "M8 2.5 14 13H2ZM8 6.5v3M8 11.3h.01",
  help: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM6.3 6.2a1.8 1.8 0 0 1 3.4.8c0 1.2-1.7 1.5-1.7 2.5M8 11.3h.01",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  tack: "M9.8 2.5 13.5 6.2 11.6 7.1 9.6 9.1l.4 3-1 1L3.9 8l1-1 3 .4 2-2ZM6.4 10.6 2.5 14.5",
  sidebar: "M2.5 3h11v10h-11ZM6.5 3v10",
  layers: "M8 2.5 14 5.5 8 8.5 2 5.5ZM2 8.5l6 3 6-3M2 11.5l6 3 6-3",
  arrowUp: "M8 13V3M4 7l4-4 4 4",
  chevD: "M4 6l4 4 4-4",
  lineC: "M2.5 11.5 6 7l3 2.5 4.5-5",
  download: "M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10",
  folder: "M2 4h4.2l1.3 1.5H14v7H2Z",
  arrowUR: "M5 11l6-6M6.5 5H11v4.5",
  chart: "M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5",
  minus: "M3.5 8h9",
  expand: "M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9",
  shrink: "M13.5 2.5 9.5 6.5M9.5 3v3.5H13M2.5 13.5l4-4M6.5 13V9.5H3",
  inbox: "M2.5 9 4.4 3.5h7.2L13.5 9v3.5h-11ZM2.5 9h3l1 1.5h3l1-1.5h3",
  filter: "M2.5 4.5h11M4.5 8h7M6.5 11.5h3",
  dots: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  quote: "M3.5 8.5h3v4h-3ZM3.5 8.5c0-2.5 1-4 3-4.5M9.5 8.5h3v4h-3ZM9.5 8.5c0-2.5 1-4 3-4.5",
  todo: "M2.5 4.2 3.8 5.5 6 3.2M8.5 4.5h5M2.5 9.7l1.3 1.3L6 8.7M8.5 10h5",
  ticket: "M2.5 5a1.5 1.5 0 0 0 0 3v3.5h11V8a1.5 1.5 0 0 1 0-3V2.5h-11ZM6.5 2.5v9",
  users: "M6 7.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M11 3.2a2.2 2.2 0 0 1 0 4.1M12.6 9.8c1 .6 1.6 1.7 1.8 3.2",
  brief: "M2.5 5.5h11v7.5h-11ZM6 5.5V3.5h4v2M2.5 8.5h11",
  mail: "M2.5 4h11v8.5h-11ZM2.5 4.5 8 9l5.5-4.5",
  tv: "M2.5 3.5h11v7.5h-11ZM5.5 13.5h5",
  cal: "M3 4h10v9H3ZM3 7h10M6 2.5v3M10 2.5v3",
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 5v3.2l2 1.3",
  flag: "M3.5 14V2.8M3.5 3h8l-1.6 3 1.6 3h-8",
  keyboard: "M2 4.5h12v7H2ZM4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6",
  arrowR: "M3 8h10M9 4l4 4-4 4",
  arrowL: "M13 8H3M7 4 3 8l4 4",
  code: "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5",
  link: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7",
  play: "M5 3.5v9l7-4.5Z",
  pin: "M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14ZM8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
};
const ico = (name, cls = "ico") => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true"><path d="${P[name]}"/></svg>`;
const SPARK = `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .8 6 4l3.2 1L6 6 5 9.2 4 6 .8 5 4 4Z"/></svg>`;
const CH = {
  slack: `<svg viewBox="0 0 16 16"><rect x="6.6" y="2" width="2.2" height="6" rx="1.1" fill="#36c5f0"/><rect x="8" y="6.6" width="6" height="2.2" rx="1.1" fill="#2eb67d"/><rect x="7.2" y="8" width="2.2" height="6" rx="1.1" fill="#ecb22e"/><rect x="2" y="7.2" width="6" height="2.2" rx="1.1" fill="#e01e5a"/></svg>`,
  imessage: `<svg viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="#34c759"/><path d="M8 4.2c-2.4 0-4.2 1.4-4.2 3.2 0 1 .6 1.9 1.5 2.5l-.4 1.6 1.8-.9c.4.1.8.1 1.3.1 2.4 0 4.2-1.4 4.2-3.3S10.4 4.2 8 4.2Z" fill="#fff"/></svg>`,
  gmail: `<svg viewBox="0 0 16 16"><path d="M2 5v7h2.4V7.6L8 10.2l3.6-2.6V12H14V5l-1.4-1L8 7.3 3.4 4Z" fill="#ea4335"/></svg>`,
  cal: `<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="2" fill="#4285f4"/><rect x="3.5" y="5.5" width="9" height="6.5" rx="1" fill="#fff"/></svg>`,
  granola: `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3" fill="#24261f"/><path d="M10.6 6.2A2.8 2.8 0 1 0 10.8 9H8.4" stroke="#d4e86a" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`,
  claude: `<svg viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="#d97757"/><path d="M8 4v8M4.5 6l7 4M11.5 6l-7 4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  testbench: `<span class="tb-mark"><span class="mark"></span></span>`,
};
const CH_NAME = { slack: "Slack", imessage: "iMessage", gmail: "Gmail", cal: "Calendar", granola: "Granola", claude: "Claude", testbench: "Testbench" };

/* ---------------- avatars, court ---------------- */
const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const personAv = (id, size = "") => `<span class="av ${size}" style="background:${PEOPLE[id].color}" data-hc="p:${id}" aria-label="${esc(PEOPLE[id].name)}">${initials(PEOPLE[id].name)}</span>`;
// A Grokbot is its person's avatar with a spark badge: it acts as them.
// Every Grokbot wears the Grokbot picture; whose it is shows in the text beside it.
const botAv = (id, size = "") => `<span class="bot ${size}" data-hc="p:${id}" aria-label="${esc(first(id))}'s Grokbot" title="${esc(first(id))}'s Grokbot"><span class="av grok ${size}"></span></span>`;
// Applicants have no photos, so they get no picture placeholder: their name carries the row.
const candAv = () => "";
const teamDot = (k) => `<i class="tdot" style="background:${TEAMS[k].color}"></i>`;
const teamKey = (k) => `<span class="team-key" style="background:${TEAMS[k].color}">${TEAMS[k].name[0]}</span>`;
function court(a) {
  const c = STATES[a.state].court;
  if (c === "you") return { av: personAv(ME), label: "You" };
  if (c === "team") return { av: `<span class="stackav">${TEAMS[a.team].members.slice(0, 3).map((m) => botAv(m)).join("")}</span>`, label: `${TEAMS[a.team].name} Grokbots` };
  if (c === "bot") return { av: botAv(a.iv), label: `${first(a.iv)}'s Grokbot` };
  if (c === "person") return { av: personAv(a.iv), label: first(a.iv) };
  if (c === "candidate") return { av: candAv(a), label: first2(a) };
  return { av: "", label: "" };
}
const possessive = (s) => `${s}'s`;
// What's happening right now, in a few words.
function doing(a) {
  const iv = a.iv && first(a.iv);
  return {
    new: a.tb && a.tb.state === "done" ? `Testbench ${tbScore(a)}` : "New",
    testbench: a.tb && a.tb.state === "running" ? "Working on Testbench" : "Testbench not started",
    routing: "Finding an interviewer",
    asked: `Texted ${iv}`,
    scheduling: `Invite drafted in ${iv}'s Gmail`,
    scheduled: a.at ? `${WD[new Date(a.at).getDay()]} ${fmtTime(a.at)} with ${iv}` : `Booked with ${iv}`,
    debrief: `Getting ${iv}'s read`,
    judgment: a.read ? `${first(a.read.by)}: ${a.read.verdict}` : "Your call",
    passed: "Passed",
    rejected: "Rejected",
    offer: "Offer",
  }[a.state];
}
function stIcon(s) {
  const tone = STATES[s].tone;
  if (tone === "you") return `<svg class="st" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--accent)" stroke-width="1.5"/><circle cx="7" cy="7" r="2.6" fill="var(--accent)"/></svg>`;
  if (tone === "new") return `<svg class="st" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--st-1)" stroke-width="1.5"/></svg>`;
  if (tone === "wait") return `<svg class="st" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--st-1)" stroke-width="1.5" stroke-dasharray="1.4 1.53"/></svg>`;
  if (tone === "bot") return `<svg class="st spin" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--line-strong)" stroke-width="1.5"/><path d="M7 1.4A5.6 5.6 0 0 1 12.6 7" fill="none" stroke="var(--st-3)" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  if (tone === "iv") return `<svg class="st" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--st-4)" stroke-width="1.5"/><path d="M7 7L7 4A3 3 0 0 1 9.6 8.5Z" fill="var(--st-4)"/></svg>`;
  if (tone === "done") return `<svg class="st" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.5" fill="var(--done)"/><path d="M4.4 7.2 6.2 9l3.4-3.8" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<svg class="st" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.5" fill="var(--closed)"/><path d="M5 5l4 4M9 5l-4 4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}
// Testbench scores read as "84/100" everywhere, so nobody has to know what the number means.
const tbScore = (a) => `${a.tb.score}/100`;
const verdictCls = (v) => (/yes/i.test(v) ? "yes" : /no/i.test(v) ? "no" : "mixed");

// The two times a Grokbot offers, picked from the interviewer's free slots.
const SLOT_SETS = [[[1, 10], [2, 16]], [[2, 13, 30], [3, 11]], [[1, 11], [3, 14]], [[2, 9, 30], [4, 10]]];
function slotsFor(a) {
  const set = SLOT_SETS[a.id.charCodeAt(a.id.length - 1) % SLOT_SETS.length];
  a.slotTimes = set.map(([d, h, m = 0]) => wdAt(d, h, m));
  return a.slotTimes.map((t) => `${WD[new Date(t).getDay()]} ${fmtTime(t)}`);
}

/* ---------------- the trace: what every Grokbot did, in order ---------------- */
// actor: "me" | "orch" | "cand" | "tb" | a person id | "bot:<id>"
const TRACE = {};
// Every recruiting action a Grokbot takes is a run: one task on one applicant,
// with its steps, its status, who it's waiting on and, for picks, the reasoning.
const RUNS = [];
let runSeq = 400;
function startRun(a, kind, bot, at, ch, extra = {}) {
  const r = { id: `R-${++runSeq}`, kind, bot, a: a.id, start: at, end: null, status: "running", steps: [], ch, ...extra };
  RUNS.push(r);
  return r;
}
function endRun(r, at, status = "done", extra = {}) { Object.assign(r, { end: at, status, ...extra }); }
const waitOn = (r, who) => Object.assign(r, { status: "waiting", on: who });
function ev(a, at, actor, html, extra = {}) {
  const e = { at, actor, html, ...extra };
  (TRACE[a.id] ||= []).push(e);
  if (extra.run) extra.run.steps.push(e);
  return e;
}
const nm = (id) => `<b>${esc(first(id))}</b>`;
const likesText = (p) => (p.likes === "loves" ? "likes interviewing" : p.likes === "avoids" ? "would rather not" : "fine either way");
// Interview types the company runs, and who runs which. 1 = prioritize them for it (they scale it best).
const IV_TYPES = ["Technical screen", "Systems design", "GPU performance deep dive", "Research deep dive", "FDE customer scenario", "Product and design", "Final with the CTO"];
const ROLE_IV = { eng: "Systems design", inf: "GPU performance deep dive", res: "Research deep dive", evals: "Research deep dive", pe: "FDE customer scenario", des: "Product and design" };
const SKILL_SUGGEST = ["GPU performance", "CUDA", "Inference", "Distributed systems", "Storage", "Networking", "Kubernetes", "Post-training", "Evals", "RL", "FDE", "Customer-facing", "Frontend", "Product design", "Systems design", "Hiring bar"];
const RUNS_DEFAULT = { daniel: { "Final with the CTO": 1, "Systems design": 0 }, sam: { "Technical screen": 1, "Systems design": 0 }, wei: { "GPU performance deep dive": 1, "Technical screen": 0 }, noor: { "Technical screen": 0, "Systems design": 0 },
  marcus: { "Research deep dive": 1 }, aisha: { "Research deep dive": 0, "Technical screen": 0 }, theo: { "Research deep dive": 0, "GPU performance deep dive": 0 }, lena: { "Product and design": 1 }, jonah: { "FDE customer scenario": 1, "Product and design": 0 } };
Object.entries(PEOPLE).forEach(([id, p]) => { if (!p.team) return; p.runs ||= RUNS_DEFAULT[id] || {}; p.bot ||= "on"; });
PEOPLE.wei.focus = ["GPU performance", "CUDA", "Storage"];
PEOPLE.jonah.focus = ["FDE", "Customer-facing", "Frontend"];
// Theo trains models on the infra team's clusters: one person, two teams.
if (!TEAMS.infra.members.includes("theo")) TEAMS.infra.members.push("theo");
const teamsOf = (id) => Object.keys(TEAMS).filter((k) => TEAMS[k].members.includes(id));
// The orchestrator's pick: wants it, has room, knows the area, spreads the load.
// Each reply keeps its score parts so the run can show why.
function pickInterviewer(tk, role, exclude = []) {
  const replies = [];
  let best = null, bestScore = -1;
  const on = (k) => !POLICY.find((p) => p.k === k).off;
  for (const id of TEAMS[tk].members) {
    const p = PEOPLE[id];
    const no = (text) => replies.push({ id, ok: false, text });
    if (exclude.includes(id)) { no(`${first(id)} already met them`); continue; }
    if (p.bot && p.bot !== "on") { no(`${possessive(first(id))} Grokbot isn't connected yet`); continue; }
    if (p.quiet) { no(`${first(id)}: ${p.quiet.toLowerCase()}`); continue; }
    if (on("room") && p.load >= p.cap) { no(`${first(id)} is full this week (${p.load} of ${p.cap})`); continue; }
    if (on("want") && p.likes === "avoids") { no(`${first(id)} would rather not right now (${p.said} lately)`); continue; }
    const parts = {
      want: on("want") ? (p.likes === "loves" ? 1 : 0.6) : 0,
      room: on("room") ? (p.cap - p.load) / p.cap : 0,
      match: on("match") && ROLES[role].team === tk ? 0.3 : 0,
      fair: on("fair") && id === "daniel" ? -0.4 : 0,
      // Runs this kind of interview; more if they're prioritized for it.
      fit: p.runs && ROLE_IV[role] in p.runs ? (p.runs[ROLE_IV[role]] ? 0.5 : 0.25) : 0,
    };
    const score = parts.want + parts.room + parts.match + parts.fair + parts.fit;
    replies.push({ id, ok: true, text: `${first(id)} has room (${p.load} of ${p.cap} this week), ${likesText(p)}`, parts, score });
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return { best, replies };
}
function why(id) {
  const p = PEOPLE[id];
  return [p.likes === "loves" ? "wants interviews" : "said yes before", p.load === 0 ? "free this week" : "lightest load", /^[A-Z]{2}/.test(p.focus[0]) ? p.focus[0] : p.focus[0].toLowerCase()].join(", ");
}
const askText = (a, round) => `Round ${round} with ${a.name} (${ROLES[a.role].title}) this week? Reply Y or N`;
const chOf = (id) => (PEOPLE[id].ch === "slack" ? "slack" : "imessage");
// Seed each applicant's history, and its runs, up to its current state.
function seed(a) {
  let t = a.when - 9 * DAY;
  const step = (m) => (t += m * MIN);
  const src = a.src.startsWith("Referral") ? `Referred by ${a.src.split("· ")[1]}` : a.src.startsWith("Backchannel") ? `Vouched for by ${a.src.split("· ")[1]}` : a.src === "Tacit" ? "Sent by Tacit" : "Applied";
  ev(a, step(0), "orch", `${src} for ${esc(ROLES[a.role].title)}`);
  if (a.tb && a.tb.state === "done") {
    const r = startRun(a, "Send the Testbench", ME, step(40), "testbench");
    ev(a, r.start, `bot:${ME}`, `Sent the Testbench: ${esc(ROLES[a.role].tb)}`, { ch: "testbench", run: r });
    const e = ev(a, step(1500), "tb", `Finished in ${a.tb.time}. Scored <b>${a.tb.score}</b>, better than ${a.tb.pct}% of applicants`, { ch: "testbench", run: r });
    endRun(r, e.at);
  }
  if (a.state === "testbench") {
    const r = startRun(a, "Send the Testbench", ME, a.tbSent, "testbench");
    ev(a, a.tbSent, `bot:${ME}`, `Sent the Testbench: ${esc(ROLES[a.role].tb)}`, { ch: "testbench", run: r });
    if (a.tb.state === "running") ev(a, a.tbSent + 20 * HR, "tb", "Started the Testbench", { ch: "testbench", run: r });
    waitOn(r, "cand");
    return;
  }
  if (a.state === "passed") {
    ev(a, a.when - 30 * MIN, "me", "Passed");
    const r = startRun(a, "Send a kind no", ME, a.when - 29 * MIN, "gmail");
    ev(a, a.when, `bot:${ME}`, "Sent a kind no from priya@meridian.com", { ch: "gmail", run: r });
    endRun(r, a.when);
    return;
  }
  const order = ["routing", "asked", "scheduling", "scheduled", "debrief", "judgment", "rejected", "offer"];
  const k = order.indexOf(a.state);
  if (k < 0) return;
  t = a.when - (k + 1) * 50 * MIN - (k >= 3 ? 2 * DAY : 0);
  const team = TEAMS[a.team];
  ev(a, step(0), "me", `Assigned to ${teamDot(a.team)}<b>${team.name}</b>`);
  const pick = startRun(a, "Find an interviewer", `team:${a.team}`, step(1), null);
  ev(a, pick.start, "orch", `Asked ${team.members.length} Grokbots on ${team.name} who should take the first round`, { run: pick });
  const { replies } = pickInterviewer(a.team, a.role);
  pick.scores = replies;
  replies.forEach((r) => ev(a, step(1), `bot:${r.id}`, esc(r.text), { muted: !r.ok, run: pick }));
  if (k === 0) return;
  const pe = ev(a, step(1), "orch", `Picked ${nm(a.iv)}: ${esc(why(a.iv))}`, { run: pick });
  endRun(pick, pe.at, "done", { chose: a.iv });
  const ask = startRun(a, `Ask ${first(a.iv)} to interview`, a.iv, step(1), chOf(a.iv));
  ev(a, ask.start, `bot:${a.iv}`, `Texted ${nm(a.iv)}`, { ch: chOf(a.iv), quote: askText(a, 1), run: ask });
  if (k === 1) { waitOn(ask, a.iv); return; }
  const y = ev(a, step(6), a.iv, "Y", { ch: chOf(a.iv), bubble: true, run: ask });
  endRun(ask, y.at);
  const sch = startRun(a, "Schedule the interview", a.iv, step(2), "gmail");
  if (k === 2) a.slots = slotsFor(a);
  ev(a, sch.start, `bot:${a.iv}`, `Drafted the invite in ${nm(a.iv)}'s Gmail`, { ch: "gmail", draft: true, run: sch });
  if (k === 2) { waitOn(sch, a.iv); return; }
  ev(a, step(20), a.iv, "Sent the invite", { ch: "gmail", run: sch });
  const when = a.at || new Date(a.when - 26 * HR).setHours(14, 0, 0, 0);
  const pk = ev(a, step(240), `bot:${a.iv}`, `${esc(first2(a))} picked ${esc(fmtWhen(when))}. On both calendars`, { ch: "cal", run: sch });
  endRun(sch, pk.at);
  if (k === 3) return;
  ev(a, a.when - 70 * MIN, "orch", "Interview done · 52 min", { ch: "granola" });
  const rd = startRun(a, "Get the read", a.iv, a.when - 60 * MIN, "slack");
  ev(a, rd.start, `bot:${a.iv}`, `Asked ${nm(a.iv)} for their read`, { ch: "slack", run: rd });
  if (k === 4) {
    if (a.nudged) ev(a, rd.start + 24 * HR, `bot:${a.iv}`, `No reply in a day. Nudged ${nm(a.iv)} in Slack`, { ch: "slack", run: rd });
    waitOn(rd, a.iv);
    return;
  }
  const r = a.read || { verdict: "Yes", senti: 0.6, quote: "Solid. Yes.", by: a.iv };
  ev(a, a.when - 20 * MIN, a.iv, esc(r.quote), { ch: "slack", bubble: true, run: rd });
  const re = ev(a, a.when - 18 * MIN, `bot:${a.iv}`, `Read: <b>${esc(r.verdict)}</b> · sentiment ${r.senti.toFixed(2)}, from ${esc(first(a.iv))}'s reply`, { run: rd });
  endRun(rd, re.at);
  ev(a, a.when, "orch", "Back with you");
  if (a.state === "rejected") {
    ev(a, a.when + 10 * MIN, "me", "Rejected");
    const rr = startRun(a, "Send the rejection", a.iv, a.when + 11 * MIN, "gmail");
    const s = ev(a, a.when + 12 * MIN, `bot:${a.iv}`, `Sent the note from ${esc(first(a.iv).toLowerCase())}@meridian.com, in ${esc(first(a.iv))}'s voice`, { ch: "gmail", run: rr });
    endRun(rr, s.at);
  }
  if (a.state === "offer") {
    ev(a, a.when + 10 * MIN, "me", "Moved to offer");
    const ro = startRun(a, "Draft the offer", ME, a.when + 11 * MIN, "gmail");
    const s = ev(a, a.when + 30 * MIN, `bot:${ME}`, "Drafted the offer for your review", { ch: "gmail", run: ro });
    endRun(ro, s.at);
  }
}
APPLICANTS.forEach(seed);
// One failure, so the page shows what a broken run looks like.
{
  const a = A["APP-112"];
  const r = startRun(a, "Send the interview brief", "marcus", NOW - 50 * MIN, "slack");
  ev(a, r.start, "bot:marcus", `Wrote a one-page brief on ${esc(first2(a))} for ${nm("marcus")}`, { run: r });
  ev(a, r.start + 40000, "bot:marcus", "Couldn't post it to Slack", { ch: "slack", run: r, err: true });
  endRun(r, r.start + 40000, "failed", { error: "Slack access for Marcus's Grokbot expired", fix: "Retry sends the brief by email instead. Marcus can reconnect Slack from their Grokbot." });
}
const lastEv = (a) => (TRACE[a.id] || []).at(-1);
const runsOf = (a) => RUNS.filter((r) => r.a === a.id);

/* ---------------- live orchestration (simulated) ---------------- */
const SPEED = 1100;
const timers = {};
function later(a, ms, fn) { (timers[a.id] ||= []).push(setTimeout(() => { fn(); touch(a); }, ms)); }
function cancel(a) { (timers[a.id] || []).forEach(clearTimeout); timers[a.id] = []; }
function touch(a) {
  a.when = Date.now();
  const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest("textarea, input");
  if (menu || modal || palette || typing) renderSide();
  else render();
}
function now(a, actor, html, extra) { return ev(a, Date.now(), actor, html, extra); }
function assign(a, tk, round = 1, chosen = null) {
  cancel(a);
  const exclude = round > 1 && a.iv ? [a.iv] : [];
  a.team = tk; a.state = "routing"; a.iv = null; a.read = null; a.at = null; a.round = round;
  const team = TEAMS[tk];
  now(a, "me", `${round > 1 ? `Round ${round}: sent to` : "Assigned to"} ${teamDot(tk)}<b>${team.name}</b>`);
  const res = pickInterviewer(tk, a.role, exclude), replies = res.replies;
  const best = chosen && TEAMS[tk].members.includes(chosen) ? chosen : res.best;
  const pick = startRun(a, "Find an interviewer", `team:${tk}`, Date.now(), null, { scores: replies });
  touch(a);
  let t = SPEED;
  later(a, t, () => now(a, "orch", `Asked ${team.members.length} Grokbots on ${team.name} who should take this round`, { run: pick }));
  replies.forEach((r) => later(a, (t += SPEED * 0.8), () => now(a, `bot:${r.id}`, esc(r.text), { muted: !r.ok, run: pick })));
  if (!best) {
    later(a, (t += SPEED), () => { a.state = "judgment"; const e = now(a, "orch", `Nobody on ${team.name} can take it this week. Back with you`, { run: pick }); endRun(pick, e.at); });
    return;
  }
  book(a, best, round, t + SPEED, pick);
}
// From the pick to a booked interview.
function book(a, best, round, t, pick) {
  const R = {};
  later(a, t, () => {
    a.iv = best; a.state = "asked"; PEOPLE[best].load++;
    const e = now(a, "orch", `Picked ${nm(best)}: ${esc(why(best))}`, { run: pick });
    if (pick) endRun(pick, e.at, "done", { chose: best });
  });
  later(a, (t += SPEED), () => {
    R.ask = startRun(a, `Ask ${first(best)} to interview`, best, Date.now(), chOf(best));
    now(a, `bot:${best}`, `Texted ${nm(best)}`, { ch: chOf(best), quote: askText(a, round), run: R.ask });
    waitOn(R.ask, best);
  });
  later(a, (t += SPEED * 2.4), () => { a.state = "scheduling"; const e = now(a, best, "Y", { ch: chOf(best), bubble: true, run: R.ask }); endRun(R.ask, e.at); });
  later(a, (t += SPEED), () => {
    a.slots = slotsFor(a);
    R.sch = startRun(a, "Schedule the interview", best, Date.now(), "gmail");
    now(a, `bot:${best}`, `Drafted the invite in ${nm(best)}'s Gmail`, { ch: "gmail", draft: true, run: R.sch });
    waitOn(R.sch, best);
  });
  later(a, (t += SPEED * 2.4), () => { R.sch.status = "running"; now(a, best, "Sent the invite", { ch: "gmail", run: R.sch }); });
  later(a, (t += SPEED * 2), () => {
    a.state = "scheduled"; a.at = (a.slotTimes || [wdAt(2, 14)])[0];
    const e = now(a, `bot:${best}`, `${esc(first2(a))} picked ${esc(fmtWhen(a.at))}. On both calendars`, { ch: "cal", run: R.sch });
    endRun(R.sch, e.at);
    toast(`${a.name} is booked with ${PEOPLE[best].name}`, { open: a.id });
  });
}
const READS = [
  { verdict: "Strong yes", senti: 0.84, notes: ["Clear, fast problem solving", "Asked the right questions about scale", "Would work well with the team"], quote: "Strong yes. Let's not lose this one." },
  { verdict: "Yes", senti: 0.66, notes: ["Solid fundamentals", "A bit quiet on trade-offs", "Good culture add"], quote: "Yes, with a deeper systems round next." },
];
function runInterview(a) {
  cancel(a);
  const iv = a.iv;
  a.state = "debrief";
  now(a, "orch", "Interview done · 48 min", { ch: "granola" });
  const rd = startRun(a, "Get the read", iv, Date.now(), "slack");
  touch(a);
  later(a, SPEED, () => { now(a, `bot:${iv}`, `Asked ${nm(iv)} for their read`, { ch: "slack", run: rd }); waitOn(rd, iv); });
  finishRead(a, rd, SPEED * 3.2);
}
// The interviewer replies, the Grokbot writes up the read, and it's your call.
function finishRead(a, rd, t) {
  const iv = a.iv;
  const r = { ...READS[a.id.charCodeAt(a.id.length - 1) % 2], by: iv };
  later(a, t, () => { rd.status = "running"; now(a, iv, esc(r.quote), { ch: "slack", bubble: true, run: rd }); });
  later(a, t + SPEED, () => now(a, `bot:${iv}`, `Read: <b>${r.verdict}</b> · sentiment ${r.senti.toFixed(2)}, from ${esc(first(iv))}'s reply`, { run: rd }));
  later(a, t + SPEED * 2, () => {
    endRun(rd, Date.now());
    a.read = r; a.state = "judgment"; PEOPLE[iv].load = Math.max(0, PEOPLE[iv].load - 1);
    now(a, "orch", "Back with you");
    toast(`Your call: ${a.name}. ${first(iv)} says ${r.verdict.toLowerCase()}`, { open: a.id });
  });
}
function reject(a) {
  cancel(a);
  const by = a.iv || ME;
  a.state = "rejected";
  now(a, "me", "Rejected");
  const rr = startRun(a, "Send the rejection", by, Date.now(), "gmail");
  touch(a);
  later(a, SPEED, () => now(a, `bot:${by}`, `Drafted the note in ${nm(by)}'s voice`, { ch: "gmail", run: rr }));
  later(a, SPEED * 2.2, () => { const e = now(a, `bot:${by}`, `Sent from ${esc(first(by).toLowerCase())}@meridian.com. ${esc(first2(a))} hears back today`, { ch: "gmail", run: rr }); endRun(rr, e.at); });
}
function offer(a) {
  cancel(a);
  a.state = "offer";
  now(a, "me", "Moved to offer");
  const ro = startRun(a, "Draft the offer", ME, Date.now(), "gmail");
  touch(a);
  later(a, SPEED, () => { const e = now(a, `bot:${ME}`, "Drafted the offer in your Gmail for review", { ch: "gmail", run: ro }); endRun(ro, e.at); });
}
function pass(a) {
  cancel(a);
  const prev = a.state, n = TRACE[a.id].length, rn = RUNS.length;
  a.state = "passed";
  now(a, "me", "Passed");
  const r = startRun(a, "Send a kind no", ME, Date.now(), "gmail");
  later(a, SPEED * 3, () => { const e = now(a, `bot:${ME}`, "Sent a kind no from priya@meridian.com", { ch: "gmail", run: r }); endRun(r, e.at); });
  return () => { cancel(a); a.state = prev; TRACE[a.id].length = n; RUNS.length = rn; touch(a); };
}
function sendTB(a) {
  cancel(a);
  const prev = a.state, n = TRACE[a.id].length, rn = RUNS.length;
  a.state = "testbench"; a.tb = { state: "sent" }; a.tbSent = Date.now();
  const r = startRun(a, "Send the Testbench", ME, Date.now(), "testbench");
  now(a, `bot:${ME}`, `Sent the Testbench: ${esc(ROLES[a.role].tb)} (${ROLES[a.role].tbLen})`, { ch: "testbench", run: r });
  waitOn(r, "cand");
  return () => { cancel(a); a.state = prev; a.tb = null; TRACE[a.id].length = n; RUNS.length = rn; touch(a); };
}
// Fixing a run from the Grokbots page.
function retryRun(r) {
  const a = A[r.a];
  Object.assign(r, { status: "running", error: null, fix: null, end: null });
  now(a, `bot:${r.bot}`, "Retrying by email instead", { ch: "gmail", run: r });
  touch(a);
  later(a, SPEED * 2, () => { const e = now(a, `bot:${r.bot}`, `Sent the brief to ${esc(first(r.bot).toLowerCase())}@meridian.com`, { ch: "gmail", run: r }); endRun(r, e.at); toast(`The brief for ${a.name} went out by email`); });
}
function nudgeRun(r) {
  const a = A[r.a];
  const lead = TEAMS[PEOPLE[r.bot].team].members[0];
  now(a, `bot:${r.bot}`, `Nudged ${nm(r.bot)} again${lead !== r.bot ? ` and copied ${nm(lead)}` : ""}`, { ch: "slack", run: r });
  r.nudges = (r.nudges || 0) + 1;
  r.start = Date.now() - 60000;
  touch(a);
  finishRead(a, r, SPEED * 3);
}

/* ---------------- sidebar ---------------- */
// New applicants, grouped by the team they applied to; within a team, warmest source first, then newest.
const queue = () => {
  const teams = Object.keys(TEAMS);
  return APPLICANTS.filter((a) => a.state === "new").sort((x, y) => teams.indexOf(ROLES[x.role].team) - teams.indexOf(ROLES[y.role].team) || SRC_KINDS[srcKind(x.src)][0] - SRC_KINDS[srcKind(y.src)][0] || y.when - x.when);
};
/* ---------------- your court ---------------- */
const senti = (v) => `<span class="senti" title="Sentiment ${v.toFixed(2)}"><i style="width:${Math.round(v * 100)}%"></i></span>`;
function liveFeed(n = 7) {
  return APPLICANTS.flatMap((a) => (TRACE[a.id] || []).map((e) => ({ a, e })))
    .filter(({ e }) => e.actor.startsWith("bot:") || e.actor === "orch")
    .sort((x, y) => y.e.at - x.e.at).slice(0, n)
    .map(({ a, e }) => `<a class="lrow feedrow" href="#t~${a.id}">${actorAv(e.actor, a)}<span class="grow"><b>${actorName(e.actor, a)} <span class="ft">${stripTags(e.html)}</span></b><span>${esc(a.name)} · ${esc(a.id)}</span></span>${e.ch ? `<span class="chico">${CH[e.ch]}</span>` : ""}<span class="time">${ago(e.at)}</span></a>`).join("");
}
/* ---------------- shared pieces: Testbench, profile, priority, labels ---------------- */
function tbPanel(a, compact) {
  const role = ROLES[a.role];
  if (!a.tb) return `<div class="tb ${compact ? "compact" : ""}"><div class="tb-head">${CH.testbench}<b>Testbench</b><span class="faint trunc">Not sent</span></div>
    <p class="tb-empty"><b>${esc(role.tb)}</b> is a ${role.tbLen} take-home in a real coding environment. The result becomes the first screen.</p></div>`;
  if (a.tb.state !== "done") return `<div class="tb ${compact ? "compact" : ""}"><div class="tb-head">${CH.testbench}<b>Testbench</b><span class="faint trunc">${esc(role.tb)}</span></div>
    <div class="tb-wait"><span>${a.tb.state === "running" ? "Working on it" : "Sent, not started"}</span><span class="faint">sent ${ago(a.tbSent)} ago</span></div>
    <div class="tb-prog"><i style="width:${Math.round((a.tb.progress || 0) * 100)}%"></i></div></div>`;
  const t = a.tb;
  return `<div class="tb ${compact ? "compact" : ""}"><div class="tb-head">${CH.testbench}<b>Testbench</b><span class="faint trunc">${esc(role.tb)}</span></div>
    <div class="tb-row"><div class="tb-score"><b>${t.score}<small>/100</small></b><span><span>Better than ${t.pct}% of applicants</span><span class="faint">${esc(t.pass)} · ${esc(t.time)}</span></span></div>
    <div class="rubric">${Object.entries(t.rubric).map(([k, v]) => `<div><span>${k}</span><span class="rbar" title="${v} of 5"><i style="width:${v * 20}%"></i></span></div>`).join("")}</div></div>
    ${t.note ? `<p class="tb-note">${esc(t.note)}</p>` : ""}
    <button class="tlink" data-act="replay">${ico("play")}Replay the session</button></div>`;
}
function profile(a) {
  return `<ul class="sum">${a.sum.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    ${a.exp.length ? `<div class="exp">${a.exp.map(([co, ti, yr]) => `<div><b>${esc(co)}</b><span>${esc(ti)}</span><span class="faint">${esc(yr)}</span></div>`).join("")}</div>` : ""}
    ${a.links.length ? `<div class="links">${a.links.map((l) => `<a href="#" data-act="noop">${ico("link")}${esc(l)}</a>`).join("")}</div>` : ""}`;
}
// Where an applicant came from, warmest first: a referral, a backchannel (someone on the team vouched), Tacit, then cold.
const SRC_KINDS = { ref: [0, "Referral"], back: [1, "Backchannel"], tacit: [2, "Tacit"], cold: [3, "Cold"] };
const srcKind = (s) => (s.startsWith("Referral") ? "ref" : s.startsWith("Backchannel") ? "back" : s === "Tacit" ? "tacit" : "cold");
const srcText = (s) => ({ ref: `Referred by ${s.split("· ")[1]}`, back: `Vouched for by ${s.split("· ")[1]}`, tacit: "Sent by Tacit", cold: "Applied cold" })[srcKind(s)];
// Analytics and CRM filters count a backchannel with referrals: both are warm intros.
const srcTag = (a) => ({ ref: "Referral", back: "Referral", tacit: "Tacit", cold: "Cold" })[srcKind(a.src)];
const srcLong = (a) => srcText(a.src);
// Days since they applied: how long this person has been waiting on us.
/* ---------------- scale: hundreds of active applicants, thousands of past applications ---------------- */
// Generated the same way on every load. Active ones live in Pipeline only (the Inbox, Tickets and
// Interviews keep the hand-written applicants). Past applications are records, one per closed application.
function rng(n) { return () => { n = (n + 0x6d2b79f5) | 0; let t = Math.imul(n ^ (n >>> 15), 1 | n); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = rng(49);
const pickOne = (xs) => xs[Math.floor(rnd() * xs.length)];
const weighted = (pairs) => { let x = rnd() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { if ((x -= w) < 0) return v; } return pairs[0][0]; };
const FIRSTS = ["Ava", "Noah", "Mia", "Leo", "Zoe", "Eli", "Ivy", "Owen", "Lila", "Kai", "Nora", "Ezra", "Ruby", "Finn", "Maya", "Jude", "Isla", "Theo", "Ada", "Milo", "Hana", "Ravi", "Sofia", "Tariq", "Yuki", "Amara", "Diego", "Priyanka", "Lucas", "Mei", "Omar", "Freya", "Arash", "Chen", "Nina", "Sami", "Elif", "Jonas", "Leila", "Mateo", "Anya", "Bilal", "Clara", "Dev", "Esme", "Felix", "Gia", "Hugo", "Inez", "Jae", "Kofi", "Lin", "Marta", "Nikhil", "Oona", "Pavel", "Quinn", "Rosa", "Sven", "Tess"];
const LASTS = ["Abara", "Becker", "Castillo", "Dang", "Eklund", "Farouk", "Garcia", "Hoang", "Iyer", "Jensen", "Kowalski", "Lindgren", "Moreau", "Nakamura", "Okoro", "Petrov", "Quiroga", "Rahman", "Silva", "Tanaka", "Ueda", "Varga", "Weber", "Xu", "Yilmaz", "Zhou", "Adeyemi", "Brennan", "Chowdhury", "Delgado", "Esposito", "Fischer", "Grant", "Haddad", "Ibrahim", "Joshi", "Kim", "Lopez", "Mendes", "Novak", "Ortega", "Park", "Rossi", "Sato", "Tran", "Usman", "Volkov", "Wong", "Yamada", "Zielinski"];
const COS = ["Stripe", "Datadog", "Cloudflare", "Snowflake", "Databricks", "Vercel", "Figma", "Notion", "Ramp", "Plaid", "Airbnb", "Uber", "Shopify", "Twilio", "MongoDB", "Confluent", "HashiCorp", "GitLab", "Robinhood", "Instacart", "a seed-stage startup", "a Series B startup", "Google", "Meta", "Amazon", "Microsoft", "Apple", "Netflix", "Spotify", "Dropbox"];
const HL_ROLE = { eng: ["Infrastructure engineer", "SRE", "Backend engineer", "Platform engineer"], inf: ["Systems engineer", "Performance engineer", "ML infra engineer"], res: ["Research scientist", "ML researcher", "Research engineer"], evals: ["ML engineer", "Research engineer", "Data scientist"], pe: ["Product engineer", "Full-stack engineer", "Frontend engineer"], des: ["Product designer", "Design engineer"] };
const CITIES = ["San Francisco", "New York", "Seattle", "Austin", "Remote", "London", "Toronto", "Boston", "Berlin", "Los Angeles"];
const ROLE_KEYS = Object.keys(ROLES);
const roleOf = () => weighted([["eng", 26], ["res", 22], ["pe", 20], ["inf", 14], ["evals", 12], ["des", 6]]);
const srcOf = (role) => weighted([["Applied", 55], ["Tacit", 25], [`Referral · ${first(pickOne(TEAMS[ROLES[role].team].members))}`, 20]]);
const usedNames = new Set(APPLICANTS.map((a) => a.name));
function personName() { for (let i = 0; i < 20; i++) { const n = `${pickOne(FIRSTS)} ${pickOne(LASTS)}`; if (!usedNames.has(n) || i === 19) { usedNames.add(n); return n; } } }
const BULK = [];
for (let i = 0; i < 264; i++) {
  const role = roleOf(), team = ROLES[role].team, st = weighted([["testbench", 22], ["routing", 6], ["asked", 10], ["scheduling", 12], ["scheduled", 22], ["debrief", 8], ["judgment", 10]]);
  const iv = pickOne(TEAMS[team].members), when = NOW - Math.floor(rnd() * { testbench: 2.5, routing: 2, asked: 2, scheduling: 3, scheduled: 9, debrief: 4, judgment: 5 }[st] * DAY) - HR;
  const score = 55 + Math.floor(rnd() * 44);
  const a = { id: `APP-${2001 + i}`, bulk: true, pri: weighted([[0, 3], [1, 1], [2, 3], [3, 4], [4, 2]]), name: personName(), hl: `${pickOne(HL_ROLE[role])} at ${pickOne(COS)}`, role, src: srcOf(role), loc: pickOne(CITIES), yrs: 1 + Math.floor(rnd() * 12), links: [], state: st, when, sum: [], exp: [],
    labels: rnd() < 0.08 ? ["Competing offer"] : rnd() < 0.08 ? ["Relocating"] : [] };
  if (st === "testbench") { a.tbSent = when; a.tb = { state: rnd() < 0.5 ? "running" : "sent", progress: 0.4 }; }
  else { a.team = team; a.iv = iv; a.tb = TB(score, "", "2h 30m", Math.min(99, score), [4, 4, 4, 4], ""); if (score >= 90) a.labels = [...a.labels, "Top Testbench"]; }
  if (st === "scheduled") a.at = NOW + Math.floor(1 + rnd() * 8) * DAY + (9 + Math.floor(rnd() * 8)) * HR - new Date(NOW).getHours() * HR;
  if (st === "scheduling") a.slots = ["Thu 10:00 AM", "Fri 2:00 PM"];
  if (st === "judgment") { const v = weighted([["Yes", 4], ["Mixed", 3], ["No", 2]]); a.read = { verdict: v, senti: v === "Yes" ? 0.7 : v === "Mixed" ? 0.4 : 0.15, by: iv, notes: [], quote: v === "Yes" ? "Strong. Yes." : v === "Mixed" ? "Good, not sure about the fit." : "Not this time." }; }
  BULK.push(a);
  A[a.id] = a;
  // Applied some days before reaching this stage: further along, longer ago.
  const [lo, hi] = { testbench: [0.1, 1.2], routing: [0.5, 3], asked: [1, 4], scheduling: [1.5, 5], scheduled: [3, 8], debrief: [5, 10], judgment: [6, 12] }[st];
  ev(a, when - (lo + ((i * 37) % 100) / 100 * (hi - lo)) * DAY, "orch", `${esc(srcLong(a))} for ${esc(ROLES[role].title)}`);
  ev(a, when, "orch", esc(STATES[st].name));
}
// Every closed application, newest first. `a` links one we have a ticket for.
const OUTCOMES = [["Rejected", 44, "Applied"], ["Passed at Testbench", 20, "Testbench"], ["Rejected after interview", 16, "Round 1"], ["Withdrew", 10, "Round 1"], ["Hired", 4, "Offer"], ["Offer declined", 2, "Offer"], ["Not now", 4, "Round 2"]];
const HISTORY = [];
for (let i = 0; i < 2412; i++) {
  const role = roleOf(), team = ROLES[role].team, o = weighted(OUTCOMES.map((x) => [x, x[1]]));
  const closed = NOW - Math.floor(14 + rnd() * 1050) * DAY, applied = closed - Math.floor(5 + rnd() * 40) * DAY;
  HISTORY.push({ id: `H-${10000 + i}`, name: personName(), hl: `${pickOne(HL_ROLE[role])} at ${pickOne(COS)}`, role, team, src: srcOf(role), outcome: o[0], reached: o[2], applied, closed,
    iv: o[2].startsWith("Round") || o[2] === "Offer" ? pickOne(TEAMS[team].members) : null, score: o[2] === "Applied" ? null : 50 + Math.floor(rnd() * 48) });
}
// A few people in the active pipeline applied before.
[["APP-109", "inf", "Not now", "Round 2", 410, "noor"], ["APP-120", "pe", "Withdrew", "Round 1", 230, "jonah"], ["APP-126", "eng", "Passed at Testbench", "Testbench", 600, null]].forEach(([id, role, outcome, reached, daysAgo, iv]) => {
  const a = A[id];
  HISTORY.push({ id: `H-${id}`, name: a.name, hl: a.hl, role, team: ROLES[role].team, src: "Applied", outcome, reached, applied: NOW - (daysAgo + 21) * DAY, closed: NOW - daysAgo * DAY, iv, score: 71, again: id });
});
APPLICANTS.concat(BULK).filter((a) => !isOpen(a)).forEach((a) => HISTORY.push({ id: `H-${a.id}`, name: a.name, hl: a.hl, role: a.role, team: a.team || ROLES[a.role].team, src: a.src, outcome: { offer: "Hired", rejected: "Rejected after interview", passed: "Rejected" }[a.state], reached: a.state === "offer" ? "Offer" : a.iv ? "Round 1" : "Applied", applied: (TRACE[a.id] || [])[0]?.at || a.when, closed: a.when, iv: a.iv || null, score: a.tb && a.tb.score, a: a.id }));
HISTORY.sort((x, y) => y.closed - x.closed);
const pastOf = (a) => HISTORY.filter((h) => h.again === a.id);
const everyone = () => APPLICANTS.concat(BULK);
const dayN = (a) => { const evs = TRACE[a.id] || []; const end = isOpen(a) ? Date.now() : evs.at(-1).at; return Math.max(1, Math.ceil((end - evs[0].at) / DAY)); };
const handle = (a) => `<span class="handle s-${srcTag(a).toLowerCase()}" title="${esc(srcLong(a))} · day ${dayN(a)}">${srcTag(a)}</span>`;
const emailOf = (a) => `${a.name.toLowerCase().split(" ").join(".")}@gmail.com`;
function priIcon(p, cls = "pri") {
  if (p === 1) return `<svg class="${cls}" viewBox="0 0 14 14" aria-label="Urgent"><rect x="1" y="1" width="12" height="12" rx="3" fill="var(--orange)"/><path d="M7 3.8v4M7 10.2v.01" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  if (!p) return `<svg class="${cls}" viewBox="0 0 14 14" aria-label="No priority"><path d="M2.5 7h1.6M6.2 7h1.6M9.9 7h1.6" stroke="var(--faint)" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  const n = 5 - p;
  return `<svg class="${cls}" viewBox="0 0 14 14" aria-label="${PRIORITIES[p].name}">${[0, 1, 2].map((i) => `<rect x="${2 + i * 3.8}" y="${9 - i * 3}" width="2.4" height="${3 + i * 3}" rx="0.8" fill="${i < n ? "var(--muted)" : "var(--line-strong)"}"/>`).join("")}</svg>`;
}
function labelsOf(a) {
  return [...new Set([...(a.labels || []), ...(a.bulk || !pastOf(a).length ? [] : ["Applied before"])])];
}
const labelChip = (n) => `<span class="label"><i style="background:${LABELS[n] || "var(--faint)"}"></i>${esc(n)}</span>`;

/* ---------------- triage: Superhuman's reading pane, Linear's tickets ---------------- */
// Each new applicant reads like an email, with a reply already drafted.
// I interview, T Testbench, D decline; ⌘↵ sends.
/* ---------------- applicants: Linear's list and board ---------------- */
const GROUPINGS = {
  court: [
    { k: "you", name: "With you", desc: "New applicant tickets, and decisions after an interview", f: (a) => STATES[a.state].court === "you" },
    { k: "bots", name: "With Grokbots", desc: "Finding an interviewer, asking them, scheduling, and getting their read", f: (a) => ["routing", "asked", "scheduling", "debrief"].includes(a.state) },
    { k: "iv", name: "Interview booked", desc: "On the calendar, waiting for the interview", f: (a) => a.state === "scheduled" },
    { k: "cand", name: "With the candidate", desc: "Doing the Testbench", f: (a) => a.state === "testbench" },
    { k: "closed", name: "Closed", desc: "Offer, passed or rejected", f: (a) => !isOpen(a), closed: true },
  ],
  team: [...Object.entries(TEAMS).map(([k, t]) => ({ k, name: t.name, icon: teamKey(k), f: (a) => a.team === k })), { k: "none", name: "No team yet", f: (a) => !a.team }],
  priority: [1, 2, 3, 4, 0].map((p) => ({ k: `p${p}`, name: PRIORITIES[p].name, icon: priIcon(p), f: (a) => (a.pri || 0) === p })),
  role: Object.entries(ROLES).map(([k, r]) => ({ k, name: r.title, f: (a) => a.role === k })),
};
const COLS = [
  { k: "new", name: "New", f: (a) => a.state === "new" },
  { k: "testbench", name: "Testbench", f: (a) => a.state === "testbench" },
  { k: "bots", name: "With Grokbots", f: (a) => ["routing", "asked", "scheduling", "debrief"].includes(a.state) },
  { k: "iv", name: "Interview booked", f: (a) => a.state === "scheduled" },
  { k: "judgment", name: "Your call", f: (a) => a.state === "judgment" },
  { k: "closed", name: "Closed", f: (a) => !isOpen(a) },
];
const picked = (state.picked = new Set());
// A Pipeline row works like a Linear issue row: click anywhere to open it, or click a property to change it.
function arow(a) {
  const c = court(a);
  return `<div class="trow arow2 calm ${state.focus === a.id ? "focus" : ""} ${picked.has(a.id) ? "picked" : ""}" data-tid="${a.id}" data-ctx="${a.id}" data-act="openRow" data-id="${a.id}" role="link" tabindex="-1" aria-label="Open ${esc(a.name)}">
    <button class="check" data-act="pick" data-id="${a.id}" aria-label="Select ${esc(a.name)}" title="Select (X)"></button>
    <span class="st-ico" title="${STATES[a.state].name}">${stIcon(a.state)}</span>
    <span class="title"><b data-hc="a:${a.id}">${esc(a.name)}</b><span class="hl">${esc(a.hl)}</span></span>
    <span class="doing-t trunc">${esc(doing(a))}</span>
    <span class="courtcell" title="With ${esc(c.label || "nobody")}">${c.av}</span>
    <span class="when" title="Last update ${esc(fmtWhen(a.when))}">${ago(a.when)}</span>
  </div>`;
}
function card(a) {
  const c = court(a);
  return `<div class="card calm" draggable="true" data-tid="${a.id}" data-ctx="${a.id}" data-act="openRow" data-id="${a.id}">
    <span class="name" data-hc="a:${a.id}">${esc(a.name)}</span>
    <div class="hl">${esc(a.hl)}</div>
    <div class="cfoot"><span class="trunc">${esc(doing(a))}</span><span title="With ${esc(c.label || "nobody")}">${c.av}</span></div>
  </div>`;
}
function scoped() {
  const tk = state.team, q = (state.q || "").toLowerCase().trim(), sv = state.savedView && viewById(state.savedView);
  return everyone().filter((a) => isOpen(a) && (!sv || viewMatch(sv, a)) && (tk === "all" || a.team === tk || (!a.team && ROLES[a.role].team === tk)) && (!q || `${a.name} ${a.hl} ${srcLong(a)} ${labelsOf(a).join(" ")}`.toLowerCase().includes(q)))
    .sort((x, y) => y.when - x.when);
}
// Pipeline is every open application. Closed ones are records in the CRM; one person can be in both.
const hSrc = (h) => srcTag(h);
function hscoped() {
  const f = (state.hf ||= {}), tk = state.team, q = (state.q || "").toLowerCase().trim();
  return HISTORY.filter((h) => (tk === "all" || h.team === tk) && (!f.outcome || h.outcome === f.outcome) && (!f.role || h.role === f.role) && (!f.src || hSrc(h) === f.src)
    && (!f.period || f.period === "all" || NOW - h.closed < +f.period * DAY) && (!q || `${h.name} ${h.hl} ${h.outcome}`.toLowerCase().includes(q)));
}
const outcomeTone = (o) => (o === "Hired" ? "ok" : o === "Not now" || o === "Withdrew" || o === "Offer declined" ? "wait" : "");
const fmtDate = (t) => { const d = new Date(t); return `${MO[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
function openHist(id) {
  if (id.startsWith("A-")) return go(`t~${id.slice(2)}`);
  const h = HISTORY.find((x) => x.id === id);
  if (!h) return;
  if (h.a) return go(`t~${h.a}`);
  openForm({ title: h.name, sub: `${esc(ROLES[h.role].title)} · ${esc(h.outcome)}`, body: `<dl class="dc-mail h-detail">
      <dt>Applied</dt><dd>${fmtDate(h.applied)} · ${esc(srcText(h.src))}</dd>
      <dt>Background</dt><dd>${esc(h.hl)}</dd>
      <dt>Got to</dt><dd>${esc(h.reached)}${h.iv ? ` with ${esc(PEOPLE[h.iv].name)}` : ""}</dd>
      ${h.score ? `<dt>Testbench</dt><dd>${h.score}/100</dd>` : ""}
      <dt>Closed</dt><dd>${fmtDate(h.closed)} · ${esc(h.outcome)}</dd></dl>
      ${h.again ? `<p class="h-note">${esc(first2(A[h.again]))} applied again. <a href="#t~${h.again}" data-close>Open the active application</a></p>` : ""}`,
    submit: h.again ? null : "Start a new application", onSubmit: () => { toast(`${h.name} is back in Applicant Tickets`); } });
}
/* ---------------- CRM: everyone the funnel has closed, as one database ---------------- */
// One row per closed application, hired or not. A Grokbot can sort it and post a list to Slack.
const CRM_VIEWS = [
  ["all", "All candidates", () => true],
  ["active", "In process", (h) => h.active],
  ["hired", "Hired", (h) => h.outcome === "Hired"],
  ["silver", "Silver medalists", (h) => ["Rejected after interview", "Not now", "Offer declined"].includes(h.outcome) && (h.score || 0) >= 80],
  ["rejected", "Rejected", (h) => h.outcome.startsWith("Rejected") || h.outcome === "Passed at Testbench"],
  ["withdrew", "Withdrew", (h) => h.outcome === "Withdrew" || h.outcome === "Offer declined"],
];
const relDay = (t) => { const d = Math.round((dayStart(Date.now()) - dayStart(t)) / DAY), dt = new Date(t); return d === 0 ? "Today" : d === 1 ? "Yesterday" : `${MO[dt.getMonth()]} ${dt.getDate()}${dt.getFullYear() !== new Date().getFullYear() ? `, ${dt.getFullYear()}` : ""}`; };
const profileOf = (h) => `in/${h.name.toLowerCase().replace(/[^a-z]+/g, "")}`;
const ownerOf = (h) => h.iv || ME;
const CRM_COLS = [["name", "Candidate", "people"], ["role", "Role", "brief"], ["profile", "Profile", "link"], ["owner", "Owner", "users"], ["score", "Testbench", "code"], ["outcome", "Outcome", "flag"], ["last", "Last contact", "cal"]];
// Everyone with an open application, as CRM rows: their stage in place of an outcome.
const activeRows = () => everyone().filter(isOpen).map((a) => ({ id: `A-${a.id}`, a: a.id, name: a.name, hl: a.hl, role: a.role, team: a.team || ROLES[a.role].team, src: a.src, outcome: procName(stageOf(a)), reached: "", applied: ((TRACE[a.id] || [])[0] || {}).at || a.when, closed: a.when, iv: a.iv || null, score: a.tb && a.tb.state === "done" ? a.tb.score : null, active: true }));
const crmBase = () => activeRows().concat(HISTORY);
function crmRows() {
  const v = CRM_VIEWS.find((x) => x[0] === (state.crmView || "all")), q = (state.q || "").toLowerCase().trim();
  return crmBase().filter((h) => v[2](h) && (!q || `${h.name} ${h.hl} ${ROLES[h.role].title} ${h.outcome}`.toLowerCase().includes(q)));
}
function crmPage() {
  const sort = (state.crmSort ||= { k: "last", dir: -1 }), pick = (state.crmPick ||= new Set());
  const key = { name: (h) => h.name, role: (h) => ROLES[h.role].title, profile: (h) => h.name, owner: (h) => PEOPLE[ownerOf(h)].name, score: (h) => h.score || 0, outcome: (h) => h.outcome, last: (h) => h.closed }[sort.k];
  const xs = crmRows().sort((x, y) => (key(x) > key(y) ? 1 : key(x) < key(y) ? -1 : 0) * sort.dir);
  const per = 50, pages = Math.max(1, Math.ceil(xs.length / per)), pg = Math.min(state.crmPg || 0, pages - 1), rows = xs.slice(pg * per, pg * per + per);
  const view = CRM_VIEWS.find((x) => x[0] === (state.crmView || "all"));
  return `<div class="bar"><div class="crumbs">${ico("db")}<b>CRM</b></div><span class="spacer"></span>
    <label class="searchbox sm">${ico("search")}<input id="filter" placeholder="Search by name" value="${esc(state.q || "")}" autocomplete="off"><span class="kbd">F</span></label></div>
  <div class="crm-tabs"><div class="pills">${CRM_VIEWS.map(([k, n, f]) => `<button class="crm-tab ${view[0] === k ? "on" : ""}" data-act="crmView" data-v="${k}">${n}<span>${crmBase().filter(f).length.toLocaleString()}</span></button>`).join("")}</div></div>
  <div class="crm">
    <div class="crm-head">${ico("db")}<b>${view[1]}</b><span class="faint">${xs.length.toLocaleString()}</span><span class="grow"></span>
      <form class="crm-ask" id="crmAskForm">${botAv(ME)}<input id="crmask" placeholder="${pick.size ? `Ask Grokbot about these ${pick.size}` : "Ask Grokbot for a list"}" autocomplete="off"><button class="btn sm" type="submit">${pick.size ? `Send ${pick.size} to Slack` : "Get the list"}</button></form></div>
    <div class="scroll" id="scroller"><div class="crm-t" role="table">
      <div class="crm-r crm-h" role="row"><span class="crm-c"><button class="ck ${rows.length && rows.every((h) => pick.has(h.id)) ? "on" : ""}" data-act="crmPickAll" aria-label="Select this page"></button></span>
        ${CRM_COLS.map(([k, n, ic]) => `<button class="crm-hc ${sort.k === k ? "on" : ""}" data-act="crmSort" data-k="${k}">${ico(ic)}${n}${sort.k === k ? `<i>${sort.dir < 0 ? "↓" : "↑"}</i>` : ""}</button>`).join("")}</div>
      ${rows.map((h) => `<div class="crm-r ${pick.has(h.id) ? "picked" : ""}" role="row" data-tid="${h.id}" data-act="openHist" data-id="${h.id}">
        <span class="crm-c"><button class="ck ${pick.has(h.id) ? "on" : ""}" data-act="crmPick" data-id="${h.id}" aria-label="Select ${esc(h.name)}"></button></span>
        <span class="crm-name"><b>${esc(h.name)}</b>${h.again ? `<a class="h-again" href="#t~${h.again}">Active again</a>` : ""}</span>
        <span><span class="crm-tag">${esc(ROLES[h.role].title)}</span></span>
        <span class="crm-link">${profileOf(h)}</span>
        <span class="crm-own">${esc(PEOPLE[ownerOf(h)].name)}</span>
        <span class="crm-num">${h.score ? `${h.score}/100` : `<span class="faint">None</span>`}</span>
        <span><span class="h-out ${h.active ? "live" : outcomeTone(h.outcome)}">${esc(h.outcome)}</span></span>
        <span class="crm-day">${relDay(h.closed)}</span></div>`).join("") || `<div class="empty">No candidates match</div>`}
    </div></div>
    <div class="crm-foot"><span>${pick.size ? `${pick.size} selected · <button class="linkish" data-act="crmClear">Clear</button>` : ""}</span><span class="grow"></span><span>${xs.length ? `${(pg * per + 1).toLocaleString()}–${Math.min(xs.length, pg * per + per).toLocaleString()} of ${xs.length.toLocaleString()}` : "0"}</span>
      <button class="icon-btn" data-act="crmPage" data-d="-1" ${pg ? "" : "disabled"} aria-label="Previous page">${ico("chevL")}</button><button class="icon-btn" data-act="crmPage" data-d="1" ${pg < pages - 1 ? "" : "disabled"} aria-label="Next page">${ico("chevR")}</button></div>
  </div>`;
}
// Plain words to a list: teams, outcomes, roles, a Testbench bar, a period. Anything it can't read falls back to the open view.
function crmAsk(text) {
  const t = text.toLowerCase(), pick = state.crmPick || new Set();
  let xs;
  if (pick.size) xs = HISTORY.filter((h) => pick.has(h.id));
  else {
    const team = Object.keys(TEAMS).find((k) => t.includes(k) || t.includes(TEAMS[k].name.toLowerCase()));
    const view = t.includes("silver") ? "silver" : /\bhired\b/.test(t) ? "hired" : /withdr|declin/.test(t) ? "withdrew" : /reject/.test(t) ? "rejected" : null;
    const role = /design/.test(t) ? "des" : /inference/.test(t) ? "inf" : /eval/.test(t) ? "evals" : /product engineer/.test(t) ? "pe" : null;
    const bar = (t.match(/(\d{2})\s*\+|(?:over|above|at least|>)\s*(\d{2})/) || []).slice(1).find(Boolean);
    const min = bar ? +bar : /strong|top|great/.test(t) ? 85 : 0;
    const since = /this year|last 12|past year/.test(t) ? 365 * DAY : /last 6|six months/.test(t) ? 182 * DAY : /2025/.test(t) ? NOW - new Date(2025, 0, 1) : 0;
    const any = team || view || role || min || since;
    xs = (any ? HISTORY : crmRows()).filter((h) => (!team || h.team === team) && (!view || CRM_VIEWS.find((v) => v[0] === view)[2](h)) && (!role || h.role === role) && (!min || (h.score || 0) >= min) && (!since || NOW - h.closed < since));
  }
  xs = xs.slice().sort((x, y) => (y.score || 0) - (x.score || 0));
  const ask = text.trim() || (pick.size ? `these ${pick.size} candidates` : CRM_VIEWS.find((v) => v[0] === (state.crmView || "all"))[1].toLowerCase());
  const show = xs.slice(0, 6);
  openForm({ title: "Post the list to Slack", sub: `${xs.length.toLocaleString()} candidate${xs.length === 1 ? "" : "s"}`, wide: true,
    body: `<label class="fm-f"><span>Channel</span><select name="ch"><option>#hiring</option><option>#infra-hiring</option><option>#research-hiring</option><option>A DM to me</option></select></label>
      <div class="slk"><div class="slk-m">${botAv(ME, "lg")}<div class="slk-b"><div class="slk-n"><b>${esc(possessive(first(ME)))} Grokbot</b><span>APP</span><time>now</time></div>
        <p>${xs.length.toLocaleString()} candidate${xs.length === 1 ? "" : "s"} for “${esc(ask)}”, best Testbench first:</p>
        <ol>${show.map((h) => `<li><b>${esc(h.name)}</b> · ${esc(ROLES[h.role].title)} · ${esc(h.outcome)}${h.score ? ` · ${h.score}/100` : ""}</li>`).join("")}</ol>
        ${xs.length > show.length ? `<p class="slk-more">and ${(xs.length - show.length).toLocaleString()} more in the attached sheet · <u>Open in tATS</u></p>` : ""}</div></div></div>`,
    submit: "Post to Slack", onSubmit: (v) => { toast(`Posted ${xs.length.toLocaleString()} candidates to ${v.ch === "A DM to me" ? "your DMs" : v.ch}`); state.crmPick = new Set(); } });
}
/* ---------------- Home: Recruiting Overview. Where are we slow, and where do we go to fix it? ---------------- */
// Every number links to the page where the work gets done. Targets are yours to set; none are assumed.
const THR_KEY = "tats.thr.v1";
try { state.thr = JSON.parse(localStorage.getItem(THR_KEY) || "{}"); } catch { state.thr = {}; }
const saveThr = () => { try { localStorage.setItem(THR_KEY, JSON.stringify(state.thr)); } catch {} };
const H_RANGES = [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]];
const homeDays = () => +(state.homeRange || 7);
const homeScope = (a) => (!state.homeTeam || (a.team || ROLES[a.role].team) === state.homeTeam) && (!state.homeRole || a.role === state.homeRole);
const hrs = (ms) => ms / HR;
const fmtHrs = (h) => (h >= 48 ? `${(h / 24).toFixed(1).replace(/\.0$/, "")}d` : h >= 1 ? `${Math.round(h)}h` : `${Math.max(1, Math.round(h * 60))}m`);
// Waits bucketed the way people talk about them, so a bar reads as "12 waiting 1 to 2 days".
const AGE_EDGES = [[0, 24, "<1d"], [24, 48, "1–2d"], [48, 72, "2–3d"], [72, 120, "3–5d"], [120, Infinity, "5d+"]];
const ageBuckets = (hs) => AGE_EDGES.map(([lo, hi, l]) => ({ lo, hi, l, n: hs.filter((h) => h >= lo && h < hi).length }));
// Applications per day (or per week past a month), from when each one came in.
function appsByDay(days) {
  const step = days > 30 ? 7 : 1, n = Math.ceil(days / step), end = dayStart(Date.now()) + DAY;
  const ats = everyone().filter(homeScope).map((a) => ((TRACE[a.id] || [])[0] || {}).at).concat(HISTORY.filter(homeScope).map((h) => h.applied)).filter(Boolean);
  return Array.from({ length: n }, (_, i) => { const hi = end - (n - 1 - i) * step * DAY, lo = hi - step * DAY, d = new Date(lo);
    return { l: step === 1 ? WD[d.getDay()].slice(0, 2) : `${MO[d.getMonth()]} ${d.getDate()}`, full: step === 1 ? `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}` : `Week of ${MO[d.getMonth()]} ${d.getDate()}`, n: ats.filter((t) => t >= lo && t < hi).length }; });
}
// Pending offer approvals: strong reads that turned into a drafted offer, waiting on the CTO.
const OFFERS = BULK.filter((a) => a.state === "judgment" && a.read && a.read.verdict === "Yes").slice(0, 3).map((a, i) => ({ a, by: "daniel", since: NOW - [26, 9, 52][i] * HR }));
// The company's interview process, as set in Settings. Stage timing reads in these words.
const PROCESS_KEY = "tats.process.v2";
const PROCESS_DEFAULT = [["review", "Application review"], ["tb", "Testbench"], ["r1", "Team interview"], ["r2", "Cross-team interview"], ["r3", "Final with the CTO"], ["offer", "Offer"]];
try { state.process = JSON.parse(localStorage.getItem(PROCESS_KEY) || "null"); } catch {}
if (!Array.isArray(state.process) || state.process.length !== PROCESS_DEFAULT.length) state.process = PROCESS_DEFAULT.map((x) => x[1]);
const procName = (k) => state.process[PROCESS_DEFAULT.findIndex((x) => x[0] === k)];
const saveProcess = () => { try { localStorage.setItem(PROCESS_KEY, JSON.stringify(state.process)); } catch {} };
// Which round a candidate is in: hand-written ones from their earlier rounds, generated ones spread 60/30/10.
const roundOf = (a) => (a.bulk ? (((+a.id.slice(4) * 7) % 10) < 6 ? 1 : ((+a.id.slice(4) * 7) % 10) < 9 ? 2 : 3) : Math.min(3, (PRIOR[a.id] || []).length + 1));
const isOfferOut = (a) => OFFERS.some((o) => o.a === a);
function stageOf(a) {
  if (a.state === "new") return "review";
  if (a.state === "testbench") return "tb";
  if (isOfferOut(a)) return "offer";
  return `r${roundOf(a)}`;
}
const IV_MIN = { r1: 60, r2: 60, r3: 45 };
function homeMetrics() {
  const act = everyone().filter((a) => isOpen(a) && homeScope(a));
  const runsOf = (kind) => RUNS.filter((r) => r.kind === kind && homeScope(A[r.a]));
  const took = (rs) => rs.map((r) => hrs((r.end || Date.now()) - r.start));
  const review = queue().filter(homeScope).map((a) => hrs(Date.now() - a.when));
  const sched = took(runsOf("Schedule the interview")).concat(act.filter((a) => ["asked", "scheduling"].includes(a.state)).map((a) => hrs(Date.now() - a.when)));
  const cards = took(runsOf("Get the read")).concat(act.filter((a) => a.state === "debrief" && a.bulk).map((a) => hrs(Date.now() - a.when)));
  const from = NOW - homeDays() * DAY, prevFrom = from - homeDays() * DAY;
  const appliedAt = (a) => ((TRACE[a.id] || [])[0] || {}).at;
  const apps = everyone().filter((a) => homeScope(a) && appliedAt(a) >= from).length + HISTORY.filter((h) => homeScope(h) && h.applied >= from).length;
  const prevApps = everyone().filter((a) => homeScope(a) && appliedAt(a) >= prevFrom && appliedAt(a) < from).length + HISTORY.filter((h) => homeScope(h) && h.applied >= prevFrom && h.applied < from).length;
  return [
    { k: "apps", label: "New applications", def: "Applications that came in during the period", v: apps, prev: prevApps, unit: "n", go: ["#triage", "Review in Applicant Tickets"] },
    { k: "active", label: "Candidates in process", def: "Everyone with an open application, by stage of your interview process", v: act.length, unit: "active", act, go: ["#crm~active", "Open in CRM"] },
    { k: "review", label: "Time to review applications", def: "From an application coming in to someone answering it", v: median(review), unit: "h", open: review, noun: "application", go: ["#triage", "Resolve in Applicant Tickets"] },
    { k: "sched", label: "Time to schedule", def: "From a candidate being ready to the interview being on both calendars", v: median(sched), unit: "h", open: act.filter((a) => ["asked", "scheduling"].includes(a.state)).map((a) => hrs(Date.now() - a.when)), noun: "candidate", go: ["#triage", "Resolve in Applicant Tickets"] },
    { k: "cards", label: "Time to submit interviewer feedback", def: "From the interview ending to the interviewer's feedback coming in", v: median(cards), unit: "h", open: act.filter((a) => a.state === "debrief").map((a) => hrs(Date.now() - a.when)), noun: "piece", nounOf: "feedback", go: ["#interviews", "Open Interviews"] },
    { k: "load", label: "Interview workload", def: "Team hours in interviews this period: booked, plus held and waiting on feedback", unit: "load", act, go: ["#calendar", "Open Calendar"] },
  ];
}
// Interview hours by team: booked interviews in the window ahead, plus ones already held awaiting feedback.
function workload(act) {
  const end = NOW + homeDays() * DAY;
  const ivs = act.filter((a) => (a.state === "scheduled" && a.at && a.at < end) || a.state === "debrief");
  const byTeam = Object.keys(TEAMS).map((k) => ({ k, h: ivs.filter((a) => a.team === k).reduce((n, a) => n + IV_MIN[`r${roundOf(a)}`] / 60, 0) }));
  const r1 = ivs.filter((a) => roundOf(a) === 1).length;
  return { n: ivs.length, h: byTeam.reduce((n, t) => n + t.h, 0), byTeam, r1 };
}
function metricCard(m) {
  const t = state.thr[m.k];
  let value, sub, chart, over = false;
  if (m.unit === "n") {
    over = t != null && m.v < t;
    const days = appsByDay(homeDays()), max = Math.max(...days.map((d) => d.n), 1), d = m.prev ? (m.v - m.prev) / m.prev : 0;
    value = m.v.toLocaleString();
    sub = `<span class="hm-d ${d >= 0 ? "good" : "bad"}">${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d * 100))}%</span><span class="hm-sub">vs the ${homeDays()} days before</span>`;
    chart = `<div class="hm-hist">${days.map((x) => `<span title="${x.n} on ${esc(x.full)}"><i style="height:${x.n ? Math.max(6, (x.n / max) * 100) : 0}%"></i><em>${esc(x.l)}</em></span>`).join("")}</div>`;
  } else if (m.unit === "active") {
    // Where the active candidates are, in the company's own stage names.
    const st = PROCESS_DEFAULT.map(([k]) => ({ k, n: m.act.filter((a) => stageOf(a) === k).length })), max = Math.max(...st.map((x) => x.n), 1);
    value = m.v.toLocaleString();
    sub = `<span class="hm-sub">across ${st.filter((x) => x.n).length} stages</span>`;
    chart = `<div class="hm-hist">${st.map((x, i) => `<span title="${x.n} in ${esc(procName(x.k))}"><i style="height:${x.n ? Math.max(6, (x.n / max) * 100) : 0}%"></i><em>${["Rev", "TB", "R1", "R2", "Fin", "Off"][i]}</em></span>`).join("")}</div>`;
  } else if (m.unit === "load") {
    // Actual hours are solid; the Testbench saving is an estimate and looks like one.
    const w = workload(m.act), max = Math.max(...w.byTeam.map((x) => x.h), 1);
    value = `${Math.round(w.h)}h`;
    over = t != null && w.h > t;
    sub = `<span class="hm-sub">${w.n} interviews booked or awaiting feedback</span>`;
    chart = `<div class="hm-load">${w.byTeam.map((x) => `<div><span>${esc(TEAMS[x.k].name)}</span><i style="width:${(x.h / max) * 100}%"></i><b>${Math.round(x.h)}h</b></div>`).join("")}</div>
      <div class="hm-est" title="An estimate, not booked time: moving each first-round live technical to the Testbench saves 30 to 60 minutes of interviewer time."><span class="tag">Estimate</span>Testbench as round 1 could free <b>${Math.round(w.r1 * 0.5)}–${w.r1}h</b></div>`;
  } else {
    // How long the open ones have waited. Past your target, the bars turn red.
    over = t != null && m.v > t;
    const bs = ageBuckets(m.open), max = Math.max(...bs.map((b) => b.n), 1), oldest = Math.max(0, ...m.open), nn = m.open.length;
    const noun = m.nounOf ? `${m.noun}${nn === 1 ? "" : "s"} of ${m.nounOf}` : `${m.noun}${nn === 1 ? "" : "s"}`;
    value = fmtHrs(m.v);
    sub = nn ? `<span class="hm-sub">${nn} ${noun} waiting · oldest ${fmtHrs(oldest)}</span>` : `<span class="hm-sub">Nothing waiting</span>`;
    chart = `<div class="hm-hist">${bs.map((b) => `<span title="${b.n} waiting ${b.l.replace("<", "under ").replace("+", " or more")}"><i style="height:${b.n ? Math.max(6, (b.n / max) * 100) : 0}%" class="${t != null && b.lo >= t ? "over" : ""}"></i><em>${b.l}</em></span>`).join("")}</div>`;
  }
  const thrLabel = m.unit === "n" ? "Alert below" : m.unit === "load" ? "Cap" : "Target";
  const thrVal = t == null ? "" : m.unit === "n" ? t : m.unit === "load" ? `${t}h` : fmtHrs(t);
  return `<section class="hm-card ${over ? "over" : ""} ${m.k === "active" ? "link" : ""}" ${m.k === "active" ? `data-act="goCrmActive"` : ""}>
    <div class="hm-l" title="${esc(m.def)}">${esc(m.label)}</div>
    <div class="hm-v"><b>${value}</b>${m.unit === "h" ? `<span class="hm-sub">typical</span>` : ""}</div>
    <div class="hm-ctx">${sub}</div>
    ${chart}
    <div class="hm-f">${m.unit === "active" ? `<span></span>` : `<button class="hm-t ${t != null ? "set" : ""}" data-act="setThr" data-k="${m.k}">${t != null ? `${over ? `<i class="dot"></i>` : ""}${thrLabel} ${thrVal}` : "Set a target"}</button>`}
      <a class="hm-go" href="${m.go[0]}">${esc(m.go[1])}${ico("arrowR")}</a></div>
  </section>`;
}
function homeOverview() {
  const ms = homeMetrics(), act = everyone().filter((a) => isOpen(a) && homeScope(a));
  const wait = (a) => Date.now() - a.when;
  const chip = (k, label, val) => `<button class="chip ${val ? "on" : ""}" data-act="homeFilter" data-k="${k}">${esc(val || label)}<svg class="chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>`;
  // Bottlenecks: real waits, oldest first, each with the page that clears it.
  const q = queue().filter(homeScope), sch = act.filter((a) => ["asked", "scheduling"].includes(a.state)), deb = act.filter((a) => a.state === "debrief"), yc = act.filter((a) => a.state === "judgment" && !isOfferOut(a));
  const unsent = inboxRows().filter((x) => x.inInbox && x.iss.k === "invite" && homeScope(x.a));
  const oldest = (xs) => xs.reduce((m, a) => Math.max(m, wait(a)), 0);
  const bn = [
    q.length && { k: "review", ico: "ticket", what: `${q.length} application${q.length === 1 ? "" : "s"} waiting for review`, why: `Oldest ${dur(oldest(q))}`, w: oldest(q), go: ["#triage", "Resolve in Applicant Tickets"] },
    sch.length && { k: "sched", ico: "cal", what: `${sch.length} candidate${sch.length === 1 ? "" : "s"} waiting to be scheduled`, why: `Oldest ${dur(oldest(sch))}${unsent.length ? ` · ${unsent.length} invite drafted, not sent` : ""}`, w: oldest(sch), go: ["#triage", "Resolve in Applicant Tickets"] },
    deb.length && { k: "cards", ico: "quote", what: `${deb.length} interview${deb.length === 1 ? "" : "s"} waiting on feedback`, why: `Oldest ${dur(oldest(deb))}`, w: oldest(deb), go: ["#interviews", "Open Interviews"] },
    yc.length && { k: "decide", ico: "flag", what: `${yc.length} candidate${yc.length === 1 ? "" : "s"} waiting on your call`, why: `Oldest ${dur(oldest(yc))}`, w: oldest(yc), go: ["#inbox", "Decide in Inbox"] },
  ].filter(Boolean).map((b) => ({ ...b, over: state.thr[b.k] != null && hrs(b.w) > state.thr[b.k] })).sort((x, y) => (y.over - x.over) || (y.w - x.w));
  // Stage timing, in the company's process: how many, how long they've waited, and who's waited longest.
  const SEG = [[0, 24, "Under a day"], [24, 72, "1 to 3 days"], [72, Infinity, "Over 3 days"]];
  const segs = (xs) => SEG.map(([lo, hi, l], i) => ({ i, l, n: xs.filter((a) => hrs(wait(a)) >= lo && hrs(wait(a)) < hi).length }));
  const stages = PROCESS_DEFAULT.map(([k]) => { const xs = act.filter((a) => stageOf(a) === k).sort((x, y) => wait(y) - wait(x)); return { k, n: procName(k), xs, med: xs.length ? median(xs.map(wait)) : 0, max: xs.length ? wait(xs[0]) : 0 }; });
  const maxN = Math.max(...stages.map((x) => x.xs.length), 1), open = state.homeStage;
  // Interviewer follow-through.
  const outFb = deb.map((a) => ({ a, iv: a.iv, w: wait(a) })).sort((x, y) => y.w - x.w);
  const ivs = Object.keys(PEOPLE).filter((id) => PEOPLE[id].team && (!state.homeTeam || PEOPLE[id].team === state.homeTeam)).map((id) => {
    const mine = RUNS.filter((r) => r.kind === "Get the read" && r.bot === id).map((r) => hrs((r.end || Date.now()) - r.start));
    const h = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
    return { id, med: mine.length ? median(mine.concat([(h % 30) + 4])) : (h % 30) + 4, out: outFb.filter((o) => o.iv === id).length };
  }).sort((x, y) => y.med - x.med);
  const maxIv = Math.max(...ivs.map((x) => x.med), 1);
  // Interview efficiency, from closed applications: how many get through each round, and what a hire costs in interviews.
  const H = HISTORY.filter((h) => homeScope(h) && h.closed >= NOW - 365 * DAY);
  const rank = { Applied: 0, Testbench: 0, "Round 1": 1, "Round 2": 2, Offer: 3 };
  const reached = (n) => H.filter((h) => rank[h.reached] >= n).length;
  const hires = H.filter((h) => h.outcome === "Hired").length || 1;
  const ivCount = H.reduce((n, h) => n + rank[h.reached], 0);
  const eff = [
    ["Round 1 to round 2", reached(2) / (reached(1) || 1)],
    ["Round 2 to the final", reached(3) / (reached(2) || 1)],
  ];
  const perHire = ivCount / hires;
  return `<div class="bar hm-bar"><div class="crumbs">${ico("home")}<b>Recruiting Overview</b></div><span class="spacer"></span>
    ${chip("range", "Last 7 days", H_RANGES.find((r) => r[0] === String(homeDays()))[1])}${chip("team", "All teams", state.homeTeam && TEAMS[state.homeTeam].name)}${chip("role", "All roles", state.homeRole && ROLES[state.homeRole].title)}
    <a class="btn sm ghost" href="#compare" title="The same layout in both styles, side by side">Compare styles</a></div>
  ${homeNav("overview")}
  <div class="scroll" id="scroller"><div class="hm">
    <div class="hm-grid6">${ms.map(metricCard).join("")}</div>
    <h2 class="hm-sec">Where are candidates getting stuck?</h2>
    <div class="hm-row stuck">
      <section class="hm-box"><div class="hm-h"><b>Bottlenecks</b><span>${bn.length}</span></div>
        ${bn.map((b) => `<a class="hm-bn ${b.over ? "over" : ""} k-${b.k}" href="${b.go[0]}"><span class="hm-ic">${ico(b.ico)}</span><span class="hm-bn-m"><b>${esc(b.what)}</b><span>${b.over ? `<i class="dot"></i>Over target · ` : ""}${esc(b.why)}</span></span><span class="hm-go">${esc(b.go[1])}${ico("arrowR")}</span></a>`).join("") || `<p class="hm-none">Nothing is waiting.</p>`}</section>
      <section class="hm-box" id="hm-stages"><div class="hm-h"><b title="Candidates in each stage of your interview process, how long they've waited, and the longest wait. Stage names come from Settings.">Time in stage</b><span>${act.length} active</span><a class="hm-go" href="#settings" title="Rename stages in Settings">Edit stages${ico("arrowR")}</a></div>
        <div class="hm-st-key">${SEG.map(([, , l], i) => `<span><i class="s${i}"></i>${l}</span>`).join("")}</div>
        <div class="hm-st-head"><span>Stage</span><span>Candidates</span><span>Waiting</span><span>Longest</span></div>
        ${stages.map((x) => `<button class="hm-st ${open === x.k ? "on" : ""}" data-act="homeStage" data-k="${x.k}" ${x.xs.length ? "" : "disabled"}><span>${ico(open === x.k ? "chevD" : "chevR")}${esc(x.n)}</span><b>${x.xs.length}</b>
            <span class="hm-st-w"><span class="hm-st-bar" style="width:${(x.xs.length / maxN) * 100}%">${segs(x.xs).filter((g) => g.n).map((g) => `<i class="s${g.i}" style="flex:${g.n}" title="${g.n} waiting ${g.l.toLowerCase()}"></i>`).join("")}</span><em>${x.xs.length ? `typical ${dur(x.med)}` : "None"}</em></span><span class="hm-st-max">${x.xs.length ? dur(x.max) : ""}</span></button>
          ${open === x.k ? `<div class="hm-st-list">${x.xs.slice(0, 8).map((a) => `<a href="#t~${a.id}">${candAv(a)}<b>${esc(a.name)}</b><span>${esc(ROLES[a.role].title)}</span><em>${dur(wait(a))}</em></a>`).join("")}${x.xs.length > 8 ? `<a class="hm-more" href="#crm~active">All ${x.xs.length} in CRM${ico("arrowR")}</a>` : ""}</div>` : ""}`).join("")}</section>
    </div>
    <div class="hm-row three">
      <section class="hm-box"><div class="hm-h"><b title="Typical time from interview to feedback, slowest first">Time to submit, by interviewer</b></div>
        ${ivs.slice(0, 7).map((x) => `<div class="hm-iv">${personAv(x.id)}<span class="hm-iv-n">${esc(first(x.id))}</span><span class="hm-iv-b"><i style="width:${(x.med / maxIv) * 100}%"></i></span><em>${fmtHrs(x.med)}</em>${x.out ? `<span class="hm-iv-o">${x.out} out</span>` : `<span class="hm-iv-o"></span>`}</div>`).join("")}</section>
      <section class="hm-box"><div class="hm-h"><b title="From applications closed in the last 12 months">Interview efficiency</b></div>
        ${eff.map(([l, r]) => `<div class="hm-eff"><div><span>${l}</span><b>${Math.round(r * 100)}%</b></div><i><i style="width:${r * 100}%"></i></i></div>`).join("")}
        <div class="hm-eff-n"><div><b>${perHire.toFixed(1)}</b><span>interviews per hire</span></div><div><b>${(perHire * 0.95).toFixed(1)}h</b><span>interviewer time per hire</span></div></div></section>
      <section class="hm-box"><div class="hm-h"><b title="Interviews whose feedback hasn't come in">Outstanding feedback</b><span>${outFb.length}</span></div>
        ${outFb.slice(0, 5).map((o) => `<div class="hm-li">${personAv(o.iv)}<span><b>${esc(PEOPLE[o.iv].name)}</b><span>${esc(o.a.name)} · ${esc(ROLES[o.a.role].title)}</span></span><em>${dur(o.w)}</em><button class="btn sm" data-act="askGrok" data-id="${o.a.id}">Nudge</button></div>`).join("") || `<p class="hm-none">All feedback is in.</p>`}
        ${outFb.length > 5 ? `<a class="hm-more" href="#interviews">All ${outFb.length} in Interviews${ico("arrowR")}</a>` : ""}</section>
    </div>
  </div></div>`;
}
// Home's slider switches tabs inside Home: the slider stays put, so Overview is always one click back.
const HOME_TABS = [["overview", "Overview"], ["tickets", "Applicant Tickets"], ["interviews", "Interviews"], ["referrals", "Referrals"]];
const homeNav = (on) => `<div class="hm-nav"><div class="pills" role="tablist">${HOME_TABS.map(([k, n]) => `<a class="${on === k ? "on" : ""}" href="${k === "overview" ? "#home" : `#home~${k}`}" role="tab" aria-selected="${on === k}">${n}</a>`).join("")}</div></div>`;
function homePage(tab, key) {
  if (!HOME_TABS.some((t) => t[0] === tab) || tab === "overview") return homeOverview();
  const inner = tab === "tickets" ? triagePage()
    : tab === "interviews" ? interviewsPage(key).replace(/href="#interviews~/g, 'href="#home~interviews~').replace(/href="#interviews"/g, 'href="#home~interviews"')
    : referralsPage();
  return `<div class="bar hm-bar"><div class="crumbs">${ico("home")}<a href="#home">Recruiting Overview</a></div><span class="spacer"></span></div>
  ${homeNav(tab)}<div class="hm-sub hm-sub-${tab}">${inner}</div>`;
}
// Two treatments of the same layout, side by side, so the styling can be judged on its own.
function comparePage() {
  const html = homePage().replace(/id="[^"]*"/g, "");
  return `<div class="bar"><div class="crumbs">${ico("home")}<a href="#home">Recruiting Overview</a><span class="sep"><svg viewBox="0 0 16 16"><path d="${P.chevR}"/></svg></span><b>Compare styles</b></div><span class="spacer"></span><a class="btn sm" href="#home">Back</a></div>
  <div class="cmp">${[["cur", "Current"], ["prev", "Previous palette, refined shading"]].map(([k, l]) => `<section class="cmp-col"><div class="cmp-h"><b>${l}</b><button class="btn sm ghost" data-act="usePal" data-v="${k}">Use everywhere</button></div><div class="cmp-frame ${k === "prev" ? "pal-prev" : "pal-cur"}"><div class="cmp-inner">${html}</div></div></section>`).join("")}</div>`;
}
// Styling treatments: "cur" is the current calm grey; "prev" is the earlier palette with refined shading.
function setPal(v) { document.documentElement.classList.toggle("pal-prev", v === "prev"); try { localStorage.setItem("tats.pal", v); } catch {} }
try { const qp = new URLSearchParams(location.search).get("pal"); setPal(qp || localStorage.getItem("tats.pal") || "cur"); } catch {}
/* ---------------- Team setup: add people and their Grokbots, put them on teams, say what they interview for ---------------- */
// One portal for first-run onboarding and for every change after. The Grokbots route interviews from it.
const SETUP_STEPS = [["people", "People"], ["teams", "Teams"], ["skills", "Interview skills"], ["review", "Review"]];
const staff = () => Object.keys(PEOPLE).filter((id) => PEOPLE[id].team);
const setupDone = () => ({ people: staff().length > 0 && staff().every((id) => PEOPLE[id].bot === "on" || PEOPLE[id].bot === "invited"), teams: staff().every((id) => teamsOf(id).length), skills: staff().every((id) => Object.keys(PEOPLE[id].runs || {}).length), review: !!state.setupSaved });
const ivCoverage = () => IV_TYPES.map((t) => ({ t, who: staff().filter((id) => t in (PEOPLE[id].runs || {})), lead: staff().filter((id) => (PEOPLE[id].runs || {})[t] === 1) }));
function setupPage(step) {
  step = SETUP_STEPS.some((x) => x[0] === step) ? step : "people";
  const idx = SETUP_STEPS.findIndex((x) => x[0] === step), done = setupDone(), ndone = Object.values(done).filter(Boolean).length;
  const ids = staff();
  const tagChip = (id, t) => `<span class="su-tag">${esc(t)}<button data-act="suTagDel" data-id="${id}" data-v="${esc(t)}" aria-label="Remove ${esc(t)}">${ico("x")}</button></span>`;
  let body = "";
  if (step === "people") body = `<div class="su-card"><div class="su-ch"><div><h3>Add your interviewers</h3><p>Everyone who interviews gets a Grokbot. It messages them in Slack or iMessage for asks, scheduling and feedback.</p></div>
      <button class="btn sm" data-act="suImport">${CH.slack}Import from Slack</button></div>
    <div class="su-list">${ids.map((id) => { const p = PEOPLE[id]; return `<div class="su-row" data-tid="sup-${id}">${personAv(id)}<span class="su-who"><b>${esc(p.name)}</b><span>${esc(p.role)}${teamsOf(id).length > 1 ? ` · <em class="su-multi">Multidisciplinary</em>` : ""}</span></span>
        <span class="su-bot ${p.bot}">${p.bot === "on" ? `${botAv(id)}Grokbot on ${p.ch === "slack" ? "Slack" : "iMessage"}` : p.bot === "invited" ? `${ico("clock")}Invite sent in Slack` : "No Grokbot"}</span>
        <button class="su-tog ${p.bot === "on" ? "on" : ""}" data-act="suBot" data-id="${id}" role="switch" aria-checked="${p.bot === "on"}" aria-label="Grokbot for ${esc(p.name)}"><i></i></button></div>`; }).join("")}</div>
    <form class="su-add" id="suAddForm"><input name="name" placeholder="Full name" autocomplete="off"><input name="email" placeholder="name@meridian.com" autocomplete="off"><input name="role" placeholder="Role, e.g. Staff engineer" autocomplete="off"><button class="btn sm" type="submit">${ico("plus")}Add person</button></form></div>`;
  if (step === "teams") body = `<div class="su-card"><div class="su-ch"><div><h3>Put people on teams</h3><p>A Grokbot asks people on the team that owns a role first. Put someone on more than one team when they can interview across both.</p></div>
      <button class="btn sm" data-act="suTeamNew">${ico("plus")}New team</button></div>
    <div class="su-mx" style="--cols:${Object.keys(TEAMS).length}">
      <div class="su-mx-h"><span></span>${Object.keys(TEAMS).map((k) => `<span>${teamKey(k)}${esc(TEAMS[k].name)}<em>${TEAMS[k].members.length}</em></span>`).join("")}</div>
      ${ids.map((id) => `<div class="su-mx-r" data-tid="sut-${id}"><span class="su-who">${personAv(id)}<b>${esc(PEOPLE[id].name)}</b>${teamsOf(id).length > 1 ? `<em class="su-multi">Multidisciplinary</em>` : ""}</span>
        ${Object.keys(TEAMS).map((k) => { const on = TEAMS[k].members.includes(id), lead = TEAMS[k].members[0] === id; return `<span class="su-cell"><button class="ck ${on ? "on" : ""}" data-act="suTeam" data-id="${id}" data-v="${k}" aria-label="${esc(PEOPLE[id].name)} on ${esc(TEAMS[k].name)}" aria-pressed="${on}"></button>${on ? `<button class="su-lead ${lead ? "on" : ""}" data-act="suLead" data-id="${id}" data-v="${k}" title="${lead ? "Team lead" : "Make team lead"}">Lead</button>` : ""}</span>`; }).join("")}</div>`).join("")}
    </div></div>`;
  if (step === "skills") body = `<div class="su-card"><div class="su-ch"><div><h3>Say what each person interviews for</h3><p>Skills help the Grokbot match a candidate to the right interviewer. Star an interview type to send it to them first.</p></div></div>
    <div class="su-list">${ids.map((id) => { const p = PEOPLE[id], runs = p.runs || {}; return `<div class="su-sk" data-tid="sus-${id}"><div class="su-sk-h">${personAv(id)}<span class="su-who"><b>${esc(p.name)}</b><span>${teamsOf(id).map((k) => TEAMS[k].name).join(" · ")}</span></span></div>
        <div class="su-sk-b"><div class="su-sk-l">Skills</div><div class="su-tags">${(p.focus || []).map((t) => tagChip(id, t)).join("")}<button class="su-tag add" data-act="suTagAdd" data-id="${id}">${ico("plus")}Skill</button></div>
          <div class="su-sk-l">Interviews</div><div class="su-tags">${IV_TYPES.map((t) => { const st = t in runs ? (runs[t] ? "prio" : "on") : ""; return `<button class="su-iv ${st}" data-act="suRun" data-id="${id}" data-v="${esc(t)}" title="${st === "prio" ? "Prioritized: they get this interview first" : st ? "Runs this. Click again to prioritize" : "Click if they run this"}">${st === "prio" ? "★ " : ""}${esc(t)}</button>`; }).join("")}</div></div></div>`; }).join("")}</div></div>`;
  if (step === "review") { const cov = ivCoverage(), gaps = cov.filter((c) => !c.who.length); body = `<div class="su-card"><div class="su-ch"><div><h3>Ready for tATS</h3><p>Here's who the Grokbots will ask for each kind of interview.</p></div></div>
    <div class="su-sum"><div><b>${ids.length}</b><span>interviewers</span></div><div><b>${ids.filter((id) => PEOPLE[id].bot === "on").length}</b><span>Grokbots on</span></div><div><b>${Object.keys(TEAMS).length}</b><span>teams</span></div><div><b>${ids.filter((id) => teamsOf(id).length > 1).length}</b><span>multidisciplinary</span></div></div>
    <div class="su-cov">${cov.map((c) => `<div class="su-cov-r ${c.who.length ? "" : "gap"}"><span class="su-cov-t">${esc(c.t)}</span><span class="su-cov-p">${c.who.length ? c.who.sort((x, y) => (PEOPLE[y].runs[c.t] || 0) - (PEOPLE[x].runs[c.t] || 0)).map((id) => `<span class="su-cov-a ${PEOPLE[id].runs[c.t] ? "prio" : ""}" title="${esc(PEOPLE[id].name)}${PEOPLE[id].runs[c.t] ? ", prioritized" : ""}">${personAv(id)}${PEOPLE[id].runs[c.t] ? "<i>★</i>" : ""}</span>`).join("") : `<span class="su-gap">No one runs this yet</span>`}</span></div>`).join("")}</div>
    ${gaps.length ? `<p class="su-note">${ico("alert")}${gaps.length} interview type${gaps.length === 1 ? " has" : "s have"} no interviewer. Candidates who need ${gaps.length === 1 ? "it" : "them"} wait in Inbox until someone's added.</p>` : ""}</div>`; }
  return `<div class="scroll su-page" id="scroller"><div class="su">
    <div class="su-main">
      <div class="su-step">${state.setupSaved ? "People & teams" : `Step ${idx + 1} of ${SETUP_STEPS.length}`}</div>
      <h1>${state.setupSaved ? "Your hiring team" : `Set up ${esc(ORG.name)}'s hiring team`}</h1>
      <p class="su-sub">${state.setupSaved ? "Add people, move them between teams, and change what they interview for. Grokbots pick it up right away." : "Add who interviews, connect their Grokbots, and say what they're best at. About five minutes."}</p>
      <nav class="su-steps">${SETUP_STEPS.map(([k, n], i) => `${i ? `<i></i>` : ""}<a href="#setup~${k}" class="${k === step ? "on" : ""} ${done[k] && k !== step ? "done" : ""}"><span>${done[k] && k !== step ? ico("check") : i + 1}</span>${n}</a>`).join("")}</nav>
      <div class="su-frame">${body}
        <div class="su-foot"><a class="su-skip" href="#home">${state.setupSaved ? "Back to tATS" : "Skip for now"}</a><span class="grow"></span>
          ${idx ? `<a class="btn" href="#setup~${SETUP_STEPS[idx - 1][0]}">${ico("chevL")}Back</a>` : ""}
          ${idx < SETUP_STEPS.length - 1 ? `<a class="btn primary dark" href="#setup~${SETUP_STEPS[idx + 1][0]}">Continue${ico("chevR")}</a>` : `<button class="btn primary dark" data-act="suFinish">${state.setupSaved ? "Save" : "Open tATS"}${ico("chevR")}</button>`}</div></div>
    </div>
    <aside class="su-side">
      <section class="su-check"><div class="su-check-h"><b>Setup checklist</b><span>${ndone}/${SETUP_STEPS.length}</span></div><i class="su-prog"><i style="width:${(ndone / SETUP_STEPS.length) * 100}%"></i></i>
        ${SETUP_STEPS.map(([k, n]) => `<a class="su-ci ${k === step ? "on" : ""}" href="#setup~${k}"><span class="su-ck ${done[k] ? "done" : ""}">${done[k] ? ico("check") : ""}</span><span><b>${n}</b><span>${k === "people" ? `${ids.length} people · ${ids.filter((id) => PEOPLE[id].bot === "on").length} Grokbots on` : k === "teams" ? `${Object.keys(TEAMS).length} teams` : k === "skills" ? `${ivCoverage().filter((c) => c.who.length).length} of ${IV_TYPES.length} interview types covered` : done.review ? "Saved" : "About a minute"}</span></span></a>`).join("")}</section>
      <button class="su-help" data-act="goChat">${ico("help")}<span><b>Need a hand?</b><span>Ask your Grokbot, or book a 15-minute setup call</span></span></button>
    </aside>
  </div></div>`;
}
function addPerson(name, email, role) {
  name = (name || "").trim().replace(/\s+/g, " ");
  if (name.split(" ").length < 2) { toast("Add their full name"); return false; }
  let id = name.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "");
  while (PEOPLE[id]) id += "2";
  PEOPLE[id] = { name, role: (role || "").trim() || "Engineer", team: null, color: "#7d8088", likes: "fine", cap: 2, load: 0, focus: [], ch: "slack", said: "New", runs: {}, bot: "invited", email };
  const k = Object.keys(TEAMS)[0];
  PEOPLE[id].team = k; TEAMS[k].members.push(id);
  toast(`${name} added. Their Grokbot invite went out in Slack.`);
  setTimeout(() => { if (PEOPLE[id] && PEOPLE[id].bot === "invited") { PEOPLE[id].bot = "on"; render(); } }, 6000);
  return true;
}
/* ---------------- Referrals: who referred whom, where they are now, and adding one ---------------- */
const refBy = (src) => { const n = (src.split("· ")[1] || "").trim(); return Object.keys(PEOPLE).find((id) => first(id) === n) || null; };
const REF_TABS = [["all", "All"], ["open", "In process"], ["hired", "Hired"], ["closed", "Closed"]];
function refRows() {
  const act = everyone().filter((a) => a.src.startsWith("Referral")).map((a) => ({ id: a.id, a, name: a.name, by: refBy(a.src), role: a.role, at: ((TRACE[a.id] || [])[0] || {}).at || a.when, status: isOpen(a) ? STATES[a.state].name : a.state === "offer" ? "Hired" : "Closed", open: isOpen(a), hired: a.state === "offer" }));
  const past = HISTORY.filter((h) => h.src.startsWith("Referral") && !h.a).map((h) => ({ id: h.id, h, name: h.name, by: refBy(h.src), role: h.role, at: h.applied, status: h.outcome, open: false, hired: h.outcome === "Hired" }));
  return act.concat(past).sort((x, y) => y.at - x.at);
}
function referralsPage() {
  const tab = state.refTab || "all", q = (state.q || "").toLowerCase().trim(), all = refRows();
  const f = { all: () => true, open: (r) => r.open, hired: (r) => r.hired, closed: (r) => !r.open && !r.hired }[tab];
  const xs = all.filter((r) => f(r) && (!q || `${r.name} ${r.by ? PEOPLE[r.by].name : ""}`.toLowerCase().includes(q)));
  const per = 50, pages = Math.max(1, Math.ceil(xs.length / per)), pg = Math.min(state.refPg || 0, pages - 1), rows = xs.slice(pg * per, pg * per + per);
  const people = Object.keys(PEOPLE).filter((id) => id !== ME).map((id) => { const mine = all.filter((r) => r.by === id); return { id, n: mine.length, open: mine.filter((r) => r.open).length, hired: mine.filter((r) => r.hired).length }; }).filter((p) => p.n).sort((x, y) => y.hired - x.hired || y.n - x.n);
  const maxN = Math.max(...people.map((p) => p.n), 1);
  return `<div class="bar"><div class="crumbs">${ico("users")}<b>Referrals</b><span class="faint">${all.length.toLocaleString()}</span></div><span class="spacer"></span>
    <button class="btn sm ghost" data-act="refGrok">${botAv(ME)}Add with Grokbot</button><button class="btn sm primary" data-act="refAdd">${ico("plus")}Add referral</button></div>
  <div class="crm-tabs"><div class="pills">${REF_TABS.map(([k, n]) => `<button class="crm-tab ${tab === k ? "on" : ""}" data-act="refTab" data-v="${k}">${n}<span>${all.filter({ all: () => true, open: (r) => r.open, hired: (r) => r.hired, closed: (r) => !r.open && !r.hired }[k]).length.toLocaleString()}</span></button>`).join("")}</div>
    <span class="grow"></span><label class="searchbox sm">${ico("search")}<input id="filter" placeholder="Search by name" value="${esc(state.q || "")}" autocomplete="off"></label></div>
  <div class="ref-wrap">
    <div class="crm ref-t">
      <div class="scroll" id="scroller"><div class="crm-t" role="table">
        <div class="crm-r rf-r crm-h" role="row"><span class="crm-hc">${ico("people")}Candidate</span><span class="crm-hc">${ico("users")}Referred by</span><span class="crm-hc">${ico("brief")}Role</span><span class="crm-hc">${ico("flag")}Where they are</span><span class="crm-hc">${ico("cal")}Referred</span></div>
        ${rows.map((r) => `<div class="crm-r rf-r" role="row" data-tid="rf-${r.id}" ${r.a ? `data-act="openRow" data-id="${r.a.id}"` : `data-act="openHist" data-id="${r.id}"`}>
          <span class="crm-name"><b>${esc(r.name)}</b></span>
          <span class="crm-own">${r.by ? `${personAv(r.by)}${esc(PEOPLE[r.by].name)}` : `<span class="faint">Unknown</span>`}</span>
          <span><span class="crm-tag">${esc(ROLES[r.role].title)}</span></span>
          <span><span class="h-out ${r.hired ? "ok" : r.open ? "live" : ""}">${esc(r.status)}</span></span>
          <span class="crm-day">${relDay(r.at)}</span></div>`).join("") || `<div class="empty">No referrals match</div>`}
      </div></div>
      <div class="crm-foot"><span class="grow"></span><span>${xs.length ? `${(pg * per + 1).toLocaleString()}–${Math.min(xs.length, pg * per + per).toLocaleString()} of ${xs.length.toLocaleString()}` : "0"}</span>
        <button class="icon-btn" data-act="refPage" data-d="-1" ${pg ? "" : "disabled"} aria-label="Previous page">${ico("chevL")}</button><button class="icon-btn" data-act="refPage" data-d="1" ${pg < pages - 1 ? "" : "disabled"} aria-label="Next page">${ico("chevR")}</button></div>
    </div>
    <section class="hm-box ref-side"><div class="hm-h"><b>Top referrers</b></div>
      <div class="ref-lb-h"><span></span><span>Referred</span><span>In process</span><span>Hired</span></div>
      ${people.map((p) => `<div class="ref-lb">${personAv(p.id)}<span class="ref-lb-n"><b>${esc(PEOPLE[p.id].name)}</b><i style="width:${(p.n / maxN) * 100}%"></i></span><em>${p.n}</em><em>${p.open}</em><em class="${p.hired ? "hired" : ""}">${p.hired}</em></div>`).join("")}</section>
  </div>`;
}
// Add a referral by hand. It becomes an Applicant Ticket, sourced to whoever referred them.
function openRefForm(pre = {}) {
  const opt = (sel, xs) => xs.map(([v, n]) => `<option value="${v}" ${sel === v ? "selected" : ""}>${esc(n)}</option>`).join("");
  openForm({ title: "Add referral", sub: pre.from ? "Your Grokbot filled this in. Check it, then add." : "", submit: "Add referral",
    body: `<div class="fm-row"><label class="fm-f"><span>Candidate</span><input name="name" value="${esc(pre.name || "")}" placeholder="Full name" autocomplete="off"></label>
        <label class="fm-f"><span>Email or LinkedIn</span><input name="link" value="${esc(pre.link || "")}" placeholder="name@company.com or linkedin.com/in/…" autocomplete="off"></label></div>
      <div class="fm-row"><label class="fm-f"><span>Role</span><select name="role">${opt(pre.role || "eng", Object.entries(ROLES).map(([k, r]) => [k, r.title]))}</select></label>
        <label class="fm-f"><span>Referred by</span><select name="by">${opt(pre.by || ME, Object.keys(PEOPLE).map((id) => [id, PEOPLE[id].name]))}</select></label></div>
      <label class="fm-f"><span>Why they're a fit</span><textarea name="note" rows="3" placeholder="How they know them, and what they'd be great at">${esc(pre.note || "")}</textarea></label>`,
    onSubmit: (v) => {
      const name = (v.name || "").trim().replace(/\s+/g, " ");
      if (name.split(" ").length < 2) { toast("Add their full name"); return false; }
      const a = { id: `APP-${140 + APPLICANTS.length}`, pri: 3, labels: [], name, hl: v.link ? v.link.replace(/^https?:\/\/(www\.)?/, "") : `Referred by ${first(v.by)}`, role: v.role, src: `Referral · ${first(v.by)}`, loc: "", yrs: 0, links: v.link ? [v.link.replace(/^https?:\/\/(www\.)?/, "")] : [], state: "new", when: Date.now(), sum: v.note ? [v.note] : [], exp: [], tb: null, note: v.note ? `${v.note}\n\n${first(v.by)}` : "" };
      APPLICANTS.push(a); A[a.id] = a; seed(a); touch(a);
      toast(`${name} is in Applicant Tickets, referred by ${first(v.by)}`);
    } });
}
// Add with Grokbot: paste what you have (a Slack message, an email, a link) and it fills the form.
function openRefGrok(text = "") {
  openForm({ title: "Add a referral with Grokbot", submit: "Fill the form",
    body: `<label class="fm-f"><span>What did you get?</span><textarea name="t" rows="5" placeholder="Paste a Slack message, an email or a LinkedIn link">${esc(text)}</textarea></label>`,
    onSubmit: (v) => { setTimeout(() => openRefForm(parseReferral(v.t || "")), 0); } });
}
function parseReferral(t) {
  const link = (t.match(/(https?:\/\/\S+|linkedin\.com\/in\/\S+|[\w.+-]+@[\w-]+\.[\w.]+)/) || [])[0] || "";
  const by = Object.keys(PEOPLE).find((id) => new RegExp(`\\b${first(id)}\\b`, "i").test(t)) || ME;
  const names = (t.replace(link, "").match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || []).filter((n) => !Object.values(PEOPLE).some((p) => p.name === n) && !/^(Hi|Hey|Hello|Founding|Product|Research|Staff)\b/.test(n));
  const role = /design/i.test(t) ? "des" : /inference|latency|gpu/i.test(t) ? "inf" : /eval/i.test(t) ? "evals" : /research|rl\b|post-?training/i.test(t) ? "res" : /product|frontend|full.?stack/i.test(t) ? "pe" : "eng";
  return { name: names[0] || "", link, by, role, note: t.trim().slice(0, 280), from: "grok" };
}
/* ---------------- Chat with your Grokbot: the same DM as in Slack ---------------- */
// tATS is Slack-native. You talk to your Grokbot here or in Slack; the dashboard is for checking in.
const chatT = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
function chatSeed() {
  if (state.chat) return state.chat;
  const iss = inboxRows().filter((x) => x.inInbox && x.iss.k !== "decide").slice(0, 3);
  const dec = inboxRows().filter((x) => x.inInbox && x.iss.k === "decide").length;
  return (state.chat = [
    { me: false, at: chatT(9, 0), html: `Morning, ${esc(first(ME))}. ${iss.length} thing${iss.length === 1 ? "" : "s"} need${iss.length === 1 ? "s" : ""} you, and ${dec} read${dec === 1 ? " is" : "s are"} back for a decision.`,
      list: iss.map((x) => `<b>${esc(x.iss.what)}</b> · ${esc(x.a.name)}`), btns: iss.map((x) => [x.iss.act.label, x.iss.act.a, x.iss.act.id]).concat([["Open Inbox", "goInbox", ""]]) },
    { me: true, at: chatT(9, 4), html: "who still owes a scorecard?" },
    { me: false, at: chatT(9, 4), html: grokOwes() },
  ]);
}
function grokOwes() {
  const deb = everyone().filter((a) => a.state === "debrief").sort((x, y) => x.when - y.when).slice(0, 4);
  return `${deb.length ? `Oldest first: ${deb.map((a) => `<b>${esc(first(a.iv))}</b> for ${esc(a.name)} (${dur(Date.now() - a.when)})`).join(", ")}. Say "nudge" and a name and I'll remind them.` : "Every scorecard is in."}`;
}
// What the Grokbot can do from a sentence. Anything else it takes on and reports back in Grokbot Activity.
function grokReply(text) {
  const t = text.toLowerCase();
  if (/refer/.test(t)) { const r = parseReferral(text); return { html: r.name ? `Got it: <b>${esc(r.name)}</b> for ${esc(ROLES[r.role].title)}, referred by ${esc(PEOPLE[r.by].name)}. Want me to add them?` : "Who's the referral? Send their name, the role, and a link if you have one.", btns: r.name ? [["Add referral", "chatRef", encodeURIComponent(text)]] : [] }; }
  const nudge = t.match(/nudge (\w+)/);
  if (nudge) { const id = Object.keys(PEOPLE).find((k) => first(k).toLowerCase() === nudge[1]); const r = id && RUNS.find((x) => x.on === id && runState(x) === "stuck"); if (r) { nudgeRun(r); return { html: `Nudged <b>${esc(first(id))}</b> in Slack about ${esc(A[r.a].name)}.` }; } return { html: id ? `${esc(first(id))} doesn't owe anything overdue right now.` : "Who should I nudge?" }; }
  if (/invite/.test(t)) { const x = inboxRows().find((r) => r.inInbox && r.iss.k === "invite"); if (x) { sendInvite(x.a); return { html: `Sent ${esc(possessive(x.a.name))} invite from ${esc(possessive(first(x.a.iv)))} Gmail.` }; } return { html: "No invites are waiting to go out." }; }
  if (/scorecard|owe/.test(t)) return { html: grokOwes() };
  if (/silver|hired|rejected|withdr|list/.test(t)) {
    const view = t.includes("silver") ? "silver" : /hired/.test(t) ? "hired" : /withdr/.test(t) ? "withdrew" : "rejected";
    const team = Object.keys(TEAMS).find((k) => t.includes(k));
    const xs = HISTORY.filter((h) => CRM_VIEWS.find((v) => v[0] === view)[2](h) && (!team || h.team === team)).sort((x, y) => (y.score || 0) - (x.score || 0));
    return { html: `${xs.length.toLocaleString()} ${CRM_VIEWS.find((v) => v[0] === view)[1].toLowerCase()}${team ? ` on ${TEAMS[team].name}` : ""}, best Testbench first:`, list: xs.slice(0, 5).map((h) => `<b>${esc(h.name)}</b> · ${esc(ROLES[h.role].title)}${h.score ? ` · ${h.score}/100` : ""}`), btns: [["Post to #hiring", "chatPost", String(xs.length)], ["Open CRM", "goCrm", ""]] };
  }
  if (/stuck|need|today|status|morning|what/.test(t)) { const iss = inboxRows().filter((x) => x.inInbox); return { html: iss.length ? `${iss.length} open:` : "Nothing needs you right now.", list: iss.slice(0, 5).map((x) => `<b>${esc(x.iss.what)}</b> · ${esc(x.a.name)}`), btns: iss.length ? [["Open Inbox", "goInbox", ""]] : [] }; }
  return { html: "On it. I'll post here when it's done, and it'll show in Grokbot Activity." };
}
function chatPage() {
  const msgs = chatSeed();
  let day = "";
  return `<div class="bar chat-bar"><div class="crumbs">${botAv(ME)}<b>${esc(possessive(first(ME)))} Grokbot</b></div><span class="chat-slack">${CH.slack}Synced with Slack</span><span class="spacer"></span></div>
  <div class="chat">
    <div class="chat-log" id="scroller">${msgs.map((m, i) => {
      const d = dayStart(m.at) === dayStart(Date.now()) ? "Today" : fmtDay(m.at);
      const head = d !== day ? `<div class="chat-day"><span>${(day = d)}</span></div>` : "";
      const same = i && msgs[i - 1].me === m.me && m.at - msgs[i - 1].at < 5 * MIN && !head;
      return `${head}<div class="chat-m ${same ? "cont" : ""}" data-tid="cm-${i}">${same ? `<span></span>` : m.me ? personAv(ME) : botAv(ME, "lg")}
        <div class="chat-b">${same ? "" : `<div class="chat-n"><b>${m.me ? esc(PEOPLE[ME].name) : `${esc(possessive(first(ME)))} Grokbot`}</b>${m.me ? "" : `<span class="app">APP</span>`}<time>${fmtTime(m.at)}</time></div>`}
          <div class="chat-t">${m.html}</div>${m.list && m.list.length ? `<ul>${m.list.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}
          ${m.btns && m.btns.length ? `<div class="chat-btns">${m.btns.map(([l, a, id], j) => `<button class="slk-btn ${j === 0 ? "primary" : ""}" data-act="${a}" data-id="${esc(id)}">${esc(l)}</button>`).join("")}</div>` : ""}</div></div>`;
    }).join("")}</div>
    <form class="chat-compose" id="chatForm"><textarea id="chatIn" rows="1" placeholder="Message your Grokbot" autocomplete="off"></textarea><button class="btn sm primary" type="submit">Send</button></form>
  </div>`;
}
function chatSend(text) {
  text = text.trim(); if (!text) return;
  const msgs = chatSeed();
  msgs.push({ me: true, at: Date.now(), html: esc(text) });
  const box = $("#chatIn"); if (box) box.value = "";
  render();
  const sc = () => { const l = $(".chat-log"); if (l) l.scrollTop = l.scrollHeight; };
  sc();
  setTimeout(() => { msgs.push({ me: false, at: Date.now(), ...grokReply(text) }); render(); sc(); }, 650);
}

/* ---------------- Tutorial: a walk through every page, one spotlight at a time ---------------- */
const TOUR = [
  ["home", '.sb-item[href="#home"]', "Home", "Start here. Recruiting Overview shows where hiring is slow, and links each delay to the page that clears it."],
  ["home", ".hm-grid6", "The numbers that matter", "Applications coming in, who's in process, how long each step takes, and how much interviewing the team is doing. Set your own targets."],
  ["home", ".hm-row.stuck", "Where candidates are stuck", "Bottlenecks beside time in each stage of your interview process, so you see what's slow and where to fix it."],
  ["inbox", ".ibx", "Inbox", "What's worth your time from everything that happened: what needs you, what was decided, what got booked."],
  ["inbox", ".ibx-g.need", "Needs you", "Click a problem and it opens with the fix already drafted. Read it, edit it, send it."],
  ["crm", ".crm", "CRM", "Everyone the funnel has closed, hired or not. Ask your Grokbot for a list and it posts it to Slack."],
  ["triage", ".act-glow", "Applicant Tickets", "New applicants, read like email. Pick Interview, Testbench or Decline, then send."],
  ["all", ".board", "Pipeline", "Every open candidate, by stage."],
  ["interviews", ".pt", "Interviews", "Where a candidate is in their loop, who has met them, and how each round went."],
  ["referrals", '[data-act="refAdd"]', "Referrals", "Who referred whom and where they are now. Add one here, or send it to your Grokbot."],
  ["activity", ".af-todo", "Grokbot Activity", "What the Grokbots did, and the few things they couldn't finish without you."],
  ["chat", ".chat-compose", "Chat with your Grokbot", "The same conversation as in Slack. Open it from ⌘K. Ask, delegate and assign here or there; this dashboard is for checking in."],
];
let tour = null;
function startTour() { tour = { i: 0 }; tourShow(); }
function tourEnd() { tour = null; $("#tour")?.remove(); }
function tourShow() {
  const [hash] = TOUR[tour.i];
  const cur = location.hash.slice(1) || "home";
  if (cur.split("~")[0] !== hash) { location.hash = hash; state.route = parseHash(); render(); }
  // render() is synchronous, so the target exists now: place the spotlight in the same click, then once more after layout settles.
  tourPlace();
  requestAnimationFrame(tourPlace);
}
function tourPlace() {
  if (!tour) return;
  const [, sel, title, body] = TOUR[tour.i];
  let root = $("#tour");
  if (!root) { root = document.createElement("div"); root.id = "tour"; root.innerHTML = `<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"></div>`; document.body.appendChild(root); }
  const el = $(sel), spot = $(".tour-spot", root), card = $(".tour-card", root);
  if (el) el.scrollIntoView({ block: "nearest" });
  const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0, right: innerWidth / 2, bottom: innerHeight / 2 };
  const pad = 8;
  Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  card.innerHTML = `<div class="tour-step">${tour.i + 1} of ${TOUR.length}</div><h3>${esc(title)}</h3><p>${esc(body)}</p>
    <div class="tour-acts"><button class="linkish" data-tour="end">Skip</button><span class="grow"></span>${tour.i ? `<button class="btn sm" data-tour="back">Back</button>` : ""}<button class="btn sm primary" data-tour="next">${tour.i === TOUR.length - 1 ? "Done" : "Next"}</button></div>`;
  const cw = 320, ch = card.offsetHeight || 170, gap = 16;
  let x = r.right + gap, y = r.top;
  if (x + cw > innerWidth - 16) { x = Math.max(16, Math.min(r.left, innerWidth - cw - 16)); y = r.bottom + gap; }
  if (y + ch > innerHeight - 16) y = Math.max(16, r.top - ch - gap);
  if (y < 16) y = Math.max(16, Math.min(innerHeight - ch - 16, r.top + 16));
  Object.assign(card.style, { left: `${x}px`, top: `${y}px` });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tour]");
  if (!b || !tour) return;
  e.stopPropagation();
  const d = b.dataset.tour;
  if (d === "end" || (d === "next" && tour.i === TOUR.length - 1)) return tourEnd();
  tour.i += d === "next" ? 1 : -1;
  tourShow();
}, true);
addEventListener("resize", () => tour && tourPlace());
document.addEventListener("keydown", (e) => {
  if (!tour) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); return tourEnd(); }
  if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); if (tour.i === TOUR.length - 1) return tourEnd(); tour.i++; tourShow(); }
  if (e.key === "ArrowLeft" && tour.i) { e.preventDefault(); e.stopImmediatePropagation(); tour.i--; tourShow(); }
}, true);
function applicantsPage() {
  const tk = state.team;
  const list = scoped();
  const view = state.view || "board", by = state.groupBy || "court";
  const team = TEAMS[tk];
  let body;
  if (view === "board") {
    state.lastList = list.map((a) => a.id);
    const more = (state.colAll ||= new Set());
    body = `<div class="scroll" id="scroller"><div class="board">${COLS.filter((c) => c.k !== "closed").map((col) => { const items = list.filter(col.f), cap = more.has(col.k) ? items.length : 12; return `<div class="col" data-drop="${col.k}"><div class="col-head">${col.name}<span class="n">${items.length}</span></div>${items.slice(0, cap).map(card).join("")}${items.length > cap ? `<button class="col-more" data-act="colAll" data-k="${col.k}">Show all ${items.length}</button>` : ""}</div>`; }).join("")}</div></div>`;
  } else {
    const groups = GROUPINGS[by].filter((g) => !g.closed).map((g) => ({ ...g, items: list.filter(g.f) })).filter((g) => g.items.length);
    const more = (state.grpAll ||= new Set());
    const open = (g) => (g.closed ? state.closedOpen : !(state.shut || new Set()).has(`${by}:${g.k}`));
    state.lastList = groups.filter(open).flatMap((g) => g.items.map((a) => a.id));
    body = `<div class="scroll" id="scroller"><div class="list">${groups.map((g) => `
      <div class="group-head ${open(g) ? "" : "collapsed"}"><button class="toggle" data-act="toggleGroup" data-k="${by}:${g.k}" data-closed="${g.closed ? 1 : ""}"${g.desc ? ` title="${esc(g.desc)}"` : ""}><svg class="tri" viewBox="0 0 8 8"><path d="M1 2.2h6L4 6Z"/></svg>${g.icon || ""}${esc(g.name)}<span class="n">${g.items.length}</span></button></div>
      ${open(g) ? g.items.slice(0, more.has(g.k) ? g.items.length : 25).map(arow).join("") + (g.items.length > 25 && !more.has(g.k) ? `<button class="grp-more" data-act="grpAll" data-k="${g.k}">Show ${g.items.length - 25} more</button>` : "") : ""}`).join("") || `<div class="empty">No applicants match</div>`}</div></div>`;
  }
  const sv = state.savedView && viewById(state.savedView);
  return `<div class="bar"><div class="crumbs">${sv ? `<a href="#views">Views</a><span class="sep"><svg viewBox="0 0 16 16"><path d="${P.chevR}"/></svg></span>${viewIcon(sv)}<b>${esc(sv.name)}</b>` : `${ico("people")}<b>Pipeline</b>`}<span class="faint">${list.length.toLocaleString()}</span></div><span class="spacer"></span>
    <div class="seg"><button class="${view === "list" ? "on" : ""}" data-act="setView" data-v="list" title="List">${ico("list")}</button><button class="${view === "board" ? "on" : ""}" data-act="setView" data-v="board" title="Board (B)">${ico("board")}</button></div>
    <a class="btn ghost sm" href="#views">${ico("layers")}Views</a><button class="btn ghost sm" data-act="display">${ico("sliders")}Display</button></div>
  ${team ? `<div class="members">${team.members.map((m) => { const p = PEOPLE[m]; return `<div class="mem">${botAv(m, "lg")}<span class="grow"><b>${esc(p.name)}</b><span>${esc(p.role)}</span></span><span class="mem-load" title="Interviews booked this week, of their weekly limit">${p.quiet ? "Away" : `${p.load} of ${p.cap} this week`}</span></div>`; }).join("")}</div>` : ""}
  <div class="subbar"><div class="tabs">${[["all", "All"], ...Object.entries(TEAMS).map(([k, t]) => [k, t.name])].map(([k, n]) => `<a class="tab ${tk === k ? "on" : ""}" href="${k === "all" ? "#all" : `#team~${k}`}">${n}</a>`).join("")}</div>
    <span class="grow"></span><label class="searchbox sm">${ico("search")}<input id="filter" placeholder="Filter" value="${esc(state.q || "")}" autocomplete="off"><span class="kbd">F</span></label></div>
  ${state.q && state.q.trim() ? (() => { const n = hscoped().length; return n ? `<a class="also" href="#crm">${ico("db")}${n.toLocaleString()} past candidate${n === 1 ? "" : "s"} in CRM also match “${esc(state.q.trim())}”</a>` : ""; })() : ""}
  ${body}
  ${picked.size ? `<div class="bulk"><span class="n">${picked.size} selected</span>
    <button class="btn ghost sm" data-act="bulkTeam" title="Send to team (A)">Send to team…</button>
    <button class="btn ghost sm" data-act="bulkPri" title="Priority (P)">Priority</button>
    <button class="btn ghost sm" data-act="bulkTB">Send Testbench…</button>
    <button class="btn ghost sm" data-act="bulkPass">Pass…</button>
    <button class="icon-btn" data-act="clearPick" aria-label="Clear selection (Esc)">${ico("x")}</button></div>` : ""}`;
}
const loadBar = (p) => `<span class="lbar">${Array.from({ length: p.cap }, (_, i) => `<i class="${i < p.load ? "on" : ""}"></i>`).join("")}</span>`;
const likesLabel = (p) => (p.likes === "loves" ? "Likes interviewing" : p.likes === "avoids" ? "Rather not" : "Either way");

/* ---------------- ticket menus: status, priority, team, labels ---------------- */
function setPri(a, p) { if ((a.pri || 0) === p) return; a.pri = p; now(a, "me", `Set priority to ${PRIORITIES[p].name.toLowerCase()}`); touch(a); }
function priMenu(anchor, ids) {
  const cur = ids.length === 1 ? A[ids[0]].pri || 0 : -1;
  openMenu(anchor, [1, 2, 3, 4, 0].map((p) => ({ id: p, label: PRIORITIES[p].name, icon: priIcon(p), checked: cur === p, hint: String(p) })), (o) => ids.forEach((id) => setPri(A[id], o.id)), { title: "Priority" });
}
function teamPick(anchor, ids) { openAssign(ids); }
function labelMenu(anchor, a) {
  const auto = labelsOf(a).filter((l) => !(a.labels || []).includes(l));
  openMenu(anchor, Object.keys(LABELS).filter((l) => !auto.includes(l)).map((l) => ({ id: l, label: l, icon: `<i class="ldot" style="background:${LABELS[l]}"></i>`, checked: (a.labels || []).includes(l) })), (o) => {
    a.labels = (a.labels || []).includes(o.id) ? a.labels.filter((x) => x !== o.id) : [...(a.labels || []), o.id];
    now(a, "me", `${a.labels.includes(o.id) ? "Added" : "Removed"} the ${esc(o.id)} label`);
    touch(a);
  }, { title: "Labels" });
}

/* ---------------- ticket ---------------- */
function actorAv(actor, a) {
  if (actor === "me") return personAv(ME);
  if (actor === "orch") return `<span class="orch">${SPARK}</span>`;
  if (actor === "tb") return `<span class="tb-mark lg"><span class="mark"></span></span>`;
  if (actor === "cand") return candAv(a);
  if (actor.startsWith("bot:")) return botAv(actor.slice(4));
  return personAv(actor);
}
function actorName(actor, a) {
  if (actor === "me") return "You";
  if (actor === "orch") return "Tacit";
  if (actor === "tb") return "Testbench";
  if (actor === "cand") return esc(first2(a));
  if (actor.startsWith("bot:")) return actor === `bot:${ME}` ? "Your Grokbot" : `${esc(first(actor.slice(4)))}'s Grokbot`;
  return esc(PEOPLE[actor].name);
}
function draftMail(a, by) {
  const slots = a.slots || ["Thu 2:00 PM", "Fri 11:00 AM"];
  return `<div class="mail"><div class="mail-h"><span class="k">From</span>${esc(PEOPLE[by].name)} &lt;${esc(first(by).toLowerCase())}@meridian.com&gt;<span class="draft-tag">Draft</span></div>
    <div class="mail-h"><span class="k">To</span>${esc(a.name)}</div>
    <div class="mail-b">Hi ${esc(first2(a))}, I'm ${esc(first(by))}, ${esc(PEOPLE[by].role.toLowerCase())} at Meridian. I'd love to talk with you about the ${esc(ROLES[a.role].title.split(",")[0])} role. Does ${esc(slots.join(" or "))} work? 45 minutes on Meet.<br><br>${esc(first(by))}</div></div>`;
}
function traceView(a) {
  const evs = TRACE[a.id] || [];
  return `<div class="trace2">${evs.map((e) => e.comment ? `<div class="tev cmt ${Date.now() - e.at < 2500 ? "fresh" : ""}"><span class="tav">${actorAv(e.actor, a)}</span><div class="tbody"><div class="cbox"><div class="tline"><span class="who">${actorName(e.actor, a)}</span><span class="t">${ago(e.at)}</span></div><div class="ctext">${e.html}</div></div></div></div>` : `<div class="tev ${e.muted ? "muted" : ""} ${Date.now() - e.at < 2500 ? "fresh" : ""}">
    <span class="tav">${actorAv(e.actor, a)}</span>
    <div class="tbody"><div class="tline">${e.run && e.run.steps[0] === e ? `<a class="runid" href="#run~${e.run.id}" title="Open this run">${e.run.id}</a>` : ""}<span class="who">${actorName(e.actor, a)}</span>${e.bubble ? "" : `<span class="what">${e.html}</span>`}${e.ch ? `<span class="chico" title="${CH_NAME[e.ch]}">${CH[e.ch]}</span>` : ""}<span class="t">${ago(e.at)}</span></div>
      ${e.bubble ? `<div class="bubble ${e.ch}">${e.html}</div>` : ""}
      ${e.quote ? `<div class="bubble out">${esc(e.quote)}</div>` : ""}
      ${e.draft ? draftMail(a, e.actor.slice(4)) : ""}</div></div>`).join("")}</div>`;
}
const plain = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent; };
// Activity, told as a short story: one line per step, the raw Grokbot steps folded underneath.
const shortDay = (t) => (sameDay(t, Date.now()) ? fmtTime(t) : `${MO[new Date(t).getMonth()]} ${new Date(t).getDate()}`);
function storyItem(g, a) {
  const r = g.run, last = g.steps.at(-1);
  if (!r) {
    const e = g.steps[0], text = plain(e.html);
    if (e.comment) return { ...g, st: "note", who: actorAv(e.actor, a), title: `${actorName(e.actor, a)} commented`, detail: text };
    if (e.actor === "me") return { ...g, st: "you", who: personAv(ME), title: `You: ${text.replace(/^./, (c) => c.toLowerCase())}` };
    if (/^Back with you/.test(text)) return null;
    if (/^Interview done/.test(text)) return { ...g, st: "done", who: actorAv("orch", a), title: "Interview done", detail: `${text.split("· ")[1] || ""}` };
    if (e === TRACE[a.id][0]) return { ...g, st: "done", who: candAv(a), title: "Applied", detail: `${srcLong(a)}, for ${ROLES[a.role].title}` };
    return { ...g, st: "done", who: actorAv(e.actor, a), title: actorName(e.actor, a), detail: text };
  }
  const s = runState(r), st = s === "done" ? "done" : s === "failed" || s === "stuck" ? "fail" : "wait";
  const base = { ...g, st, who: runBot(r).av };
  const p = (id) => first(id);
  if (s === "failed") return { ...base, title: `${r.kind}: failed`, detail: `${r.error}. ${r.fix || ""}` };
  if (r.kind === "Send the Testbench") {
    const done = a.tb && a.tb.state === "done" && st === "done";
    return { ...base, who: candAv(a), title: done ? `Testbench: ${tbScore(a)}` : "Testbench sent", detail: done ? `Better than ${a.tb.pct}% of applicants. Took ${a.tb.time}` : a.tb && a.tb.state === "running" ? `${first2(a)} is working on it` : `Waiting for ${first2(a)} to start` };
  }
  if (r.kind === "Find an interviewer") {
    const tm = TEAMS[r.bot.slice(5)], n = (r.scores || []).length;
    return r.chose ? { ...base, who: botAv(r.chose), title: `Picked ${PEOPLE[r.chose].name} to interview`, detail: `${tm.name}'s Grokbots asked ${n} people. ${p(r.chose)} ${why(r.chose).replace("said", "has said")}` }
      : { ...base, title: "Picking the interviewer", detail: `${tm.name}'s Grokbots are asking ${n || tm.members.length} people who has room` };
  }
  if (r.kind.startsWith("Ask ")) {
    const rep = g.steps.find((e) => e.bubble);
    return { ...base, title: rep ? `${p(r.bot)} said yes` : `Asked ${p(r.bot)} to interview`, detail: rep ? `Replied in ${dur(rep.at - r.start)} over ${CH_NAME[r.ch]}` : `Texted over ${CH_NAME[r.ch]}${s === "stuck" ? `. No reply in ${dur(Date.now() - r.start)}` : ". Waiting for a yes"}` };
  }
  if (r.kind === "Schedule the interview") {
    return st === "done" ? { ...base, title: "Interview booked", detail: a.at ? `${fmtWhen(a.at)} with ${PEOPLE[r.bot].name}. On both calendars` : plain(last.html) }
      : { ...base, title: "Scheduling", detail: `Invite drafted in ${possessive(p(r.bot))} Gmail${a.slots ? `, offering ${a.slots.join(" or ")}` : ""}` };
  }
  if (r.kind === "Get the read") {
    const q = g.steps.find((e) => e.bubble);
    if (q && a.read) return { ...base, who: personAv(r.bot), title: `${p(r.bot)}'s read: ${a.read.verdict}`, detail: `“${plain(q.html)}”` };
    return { ...base, title: "Getting the read", detail: s === "stuck" ? `No reply from ${p(r.bot)} in ${dur(Date.now() - r.start)}, after a nudge` : `Asked ${p(r.bot)} in Slack for their read` };
  }
  return { ...base, title: r.kind, detail: plain(last.html) };
}
function storyOf(a) {
  const groups = [], byRun = new Map();
  for (const e of TRACE[a.id] || []) {
    if (e.run && byRun.has(e.run)) { byRun.get(e.run).steps.push(e); continue; }
    const g = { key: e.run ? e.run.id : `${a.id}:${e.at}`, run: e.run, at: e.at, steps: [e] };
    if (e.run) byRun.set(e.run, g);
    groups.push(g);
  }
  const items = groups.map((g) => storyItem(g, a)).filter(Boolean);
  if (a.state === "scheduled" && a.at) items.push({ key: "next", st: "next", who: personAv(a.iv), at: a.at, title: "Interview", detail: `${fmtWhen(a.at)} with ${PEOPLE[a.iv].name}`, steps: [] });
  return items;
}
function storyView(a) {
  const open = (state.storyOpen ||= new Set());
  return `<ol class="story">${storyOf(a).map((it) => {
    const more = it.steps.length > 1 || it.steps.some((e) => e.quote || e.draft);
    const isOpen2 = open.has(it.key);
    return `<li class="sy ${it.st}">
      <span class="sy-mark">${it.st === "done" ? ico("check") : it.st === "fail" ? "!" : it.st === "wait" ? `<i></i>` : it.st === "next" ? ico("cal") : ""}</span>
      <${more ? `button data-act="storyToggle" data-k="${it.key}" aria-expanded="${isOpen2}"` : "div"} class="sy-main">
        <span class="sy-who">${it.who}</span>
        <span class="sy-text"><b>${esc(it.title)}</b>${it.detail ? `<span>${esc(it.detail)}</span>` : ""}</span>
        <span class="sy-when">${it.st === "next" ? "Next" : shortDay(it.at)}${more ? `<svg class="chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>` : ""}</span>
      </${more ? "button" : "div"}>
      ${more && isOpen2 ? `<div class="sy-steps">${it.steps.map((e) => `<div class="sx ${e.err ? "err" : ""} ${e.muted ? "muted" : ""}">${actorAv(e.actor, a)}<span class="grow"><b>${actorName(e.actor, a)}</b> ${e.bubble ? `“${e.html}”` : e.html}${e.quote ? `<span class="sx-q">“${esc(e.quote)}”</span>` : ""}${e.draft ? `<span class="sx-q">Invite draft in Gmail</span>` : ""}</span><span class="faint">${shortDay(e.at)}</span></div>`).join("")}</div>` : ""}
    </li>`;
  }).join("")}</ol>`;
}
// Interview rounds, as Linear sub-issues.
function roundsOf(a) {
  const picks = RUNS.filter((r) => r.a === a.id && r.kind === "Find an interviewer");
  return picks.map((p, i) => {
    const last = i === picks.length - 1;
    const verdict = last ? (a.read && ["judgment", "rejected", "offer"].includes(a.state) ? a.read.verdict : null) : "Advanced";
    const st = verdict ? "offer" : last && a.state === "scheduled" ? "scheduled" : "routing";
    return { n: i + 1, team: p.bot.slice(5), iv: p.chose, verdict, st, at: last && a.at ? a.at : null, run: p.id };
  });
}
function roundsBlock(a) {
  const rs = roundsOf(a);
  if (!rs.length) return "";
  return `<div class="block"><div class="block-head">Interviews<span class="n">${rs.length}</span></div><div class="plan">${rs.map((r) => `<a class="plan-row" href="${recByKey(`${a.id}-${r.n}`) ? `#interviews~${a.id}-${r.n}` : `#run~${r.run}`}">${stIcon(r.st)}
    <span class="what"><b>Round ${r.n} · ${TEAMS[r.team].name}</b><span>${r.iv ? `${esc(PEOPLE[r.iv].name)}${r.at ? ` · ${esc(fmtWhen(r.at))}` : ""}` : "Picking the interviewer"}</span></span>
    ${r.verdict ? `<span class="readpill ${verdictCls(r.verdict)}">${esc(r.verdict)}</span>` : `<span></span>`}
    <span class="avs">${r.iv ? botAv(r.iv) : ""}</span></a>`).join("")}</div></div>`;
}
// The top panel: what's happening now and, when it's yours, the call.
function nowPanel(a) {
  const s = a.state;
  if (s === "judgment" && a.read) {
    const r = a.read, x = recByKey(`${a.id}-${roundsOf(a).length || 1}`);
    const date = x ? `${MO[new Date(x.start).getMonth()]} ${new Date(x.start).getDate()}` : "";
    return `<section class="call-card">
      <div class="cc-head">${personAv(r.by, "lg")}<div class="grow"><b>${esc(possessive(PEOPLE[r.by].name))} read</b><span>Round ${a.round || 1} · ${TEAMS[a.team].name}${date ? ` · ${date}` : ""}</span></div>
        <span class="readpill ${verdictCls(r.verdict)} lg">${esc(r.verdict)}</span></div>
      <p class="cc-quote">“${esc(r.quote)}”</p>
      ${x ? interviewHighlights(a, x, r) : `<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`}
      <div class="cc-acts">
        <button class="btn primary" data-act="advance" data-id="${a.id}" title="Next round (A)">${ico("arrowR")}Next round<kbd>A</kbd></button>
        <button class="btn" data-act="offer" data-id="${a.id}" title="Move to offer (O)">Move to offer<kbd>O</kbd></button>
        <button class="btn" data-act="reject" data-id="${a.id}" title="Reject (R). The note goes out from ${esc(possessive(first(r.by)))} email after you approve it.">Reject<kbd>R</kbd></button>
      </div></section>`;
  }
  if (s === "judgment") return `<section class="call-card"><div class="cc-head"><span class="orch">${SPARK}</span><div class="grow"><b>Back with you</b><span>${esc(stripTags(lastEv(a).html))}</span></div></div>
    <div class="cc-acts"><button class="btn primary" data-act="advance" data-id="${a.id}" title="Send to a team (A)">${ico("arrowR")}Send to a team</button><button class="btn" data-act="reject" data-id="${a.id}" title="Reject (R)">Reject</button></div></section>`;
  if (s === "new") return `<section class="call-card"><div class="cc-head"><span class="orch">${SPARK}</span><div class="grow"><b>New applicant</b><span>Reply from Applicant Tickets. A draft is ready.</span></div><a class="btn primary" href="#triage" data-act="triOpen" data-id="${a.id}">Open in Applicant Tickets</a></div></section>`;
  const c = court(a);
  if (["routing", "asked", "scheduling", "debrief"].includes(s)) {
    const r = RUNS.find((x) => x.a === a.id && !x.end);
    return `<section class="now-card"><span class="now-av">${c.av}</span><div class="grow"><b>With ${esc(c.label)}</b><span>${esc(doing(a))}</span></div>${r ? `<a class="btn sm" href="#run~${r.id}">${runPill(r)}</a>` : `<span class="working-dots"><i></i><i></i><i></i></span>`}</section>`;
  }
  if (s === "scheduled") return `<section class="now-card">${personAv(a.iv, "lg")}<div class="grow"><b>Interview booked</b><span>${esc(a.at ? fmtWhen(a.at) : "")} with ${esc(PEOPLE[a.iv].name)}. Feedback is collected afterwards.</span></div>
</section>`;
  if (s === "testbench") return `<section class="now-card">${candAv(a, "lg")}<div class="grow"><b>With ${esc(first2(a))}</b><span>${a.tb.state === "running" ? "Working on the Testbench" : "Testbench sent, not started yet"}. It comes back to Applicant Tickets with a score.</span></div></section>`;
  return `<section class="now-card closed">${stIcon(s)}<div class="grow"><b>${STATES[s].name}</b><span>${esc(stripTags(lastEv(a).html))}</span></div></section>`;
}
const prop = (k, v) => `<div class="prop"><span class="k">${k}</span><span class="v">${v}</span></div>`;
const bprop = (k, v, act, id) => `<button class="prop" data-act="${act}" data-id="${id}"><span class="k">${k}</span><span class="v">${v}</span></button>`;
function ticketPage(id) {
  const a = A[id];
  const c = court(a);
  const team = a.team && TEAMS[a.team];
  const back = state.backTo && !state.backTo.startsWith("t~") && !state.backTo.startsWith("run~") ? state.backTo : "all";
  const backName = back.startsWith("inbox") ? "Inbox" : back.startsWith("view") ? "Views" : back === "calendar" ? "Calendar" : back === "jobs" ? "Job Postings" : back === "triage" ? "Applicant Tickets" : back.startsWith("bots") || back.startsWith("activity") ? "Grokbot Activity" : back.startsWith("analytics") ? "Analytics" : back.startsWith("team~") ? TEAMS[back.slice(5)].name : "Pipeline";
  const pos = state.lastList.indexOf(id);
  return `<div class="bar"><div class="crumbs"><a href="#${back}">${esc(backName)}</a><span class="sep"><svg viewBox="0 0 16 16"><path d="${P.chevR}"/></svg></span><b>${esc(a.name)}</b></div><span class="spacer"></span>
    ${pos >= 0 ? `<span class="faint pos">${pos + 1} / ${state.lastList.length}</span>` : ""}
    <button class="icon-btn" data-act="step" data-d="-1" aria-label="Previous (K)" title="Previous (K)">${ico("chevL")}</button><button class="icon-btn" data-act="step" data-d="1" aria-label="Next (J)" title="Next (J)">${ico("chevR")}</button></div>
  <div class="scroll" id="scroller"><div class="detail">
    <div class="body">
      <div class="t-head">${candAv(a, "xl")}<div><h1>${esc(a.name)}</h1><p>${esc(a.hl)} · ${esc(a.loc)}</p></div></div>
      <div class="chips">
        <button class="chip" data-act="menuStatus" data-id="${a.id}">${stIcon(a.state)}${STATES[a.state].name}</button>
        <button class="chip" data-act="menuPri" data-id="${a.id}">${priIcon(a.pri)}${PRIORITIES[a.pri || 0].name}</button>
        <button class="chip" data-act="menuTeam" data-id="${a.id}">${team ? `${teamKey(a.team)}${team.name}` : `<span class="team-key none"></span>Team`}</button>
        ${labelsOf(a).map((l) => `<button class="chip" data-act="menuLabels" data-id="${a.id}"><i class="ldot" style="background:${LABELS[l]}"></i>${esc(l)}</button>`).join("")}
        <button class="chip ghost" data-act="menuLabels" data-id="${a.id}" aria-label="Add label">${ico("plus")}</button>
      </div>
      ${nowPanel(a)}
      ${roundsBlock(a)}
      ${pastOf(a).length ? `<div class="block"><div class="block-head">Past applications<span class="n">${pastOf(a).length}</span></div><div class="plan">${pastOf(a).map((h) => `<button class="past-row" data-act="openHist" data-id="${h.id}"><span class="what"><b>${esc(ROLES[h.role].title)}</b><span>${fmtDate(h.applied)} to ${fmtDate(h.closed)} · got to ${esc(h.reached)}</span></span><span class="h-out ${outcomeTone(h.outcome)}">${esc(h.outcome)}</span></button>`).join("")}</div></div>` : ""}
      <div class="block">${tbPanel(a)}</div>
      <div class="block"><div class="block-head">Profile</div>${profile(a)}</div>
      <div class="block"><div class="block-head">Activity<button class="aside linkish" data-act="rawLog">${state.rawLog ? "Show summary" : "Show all steps"}</button></div>${state.rawLog ? traceView(a) : storyView(a)}
        <div class="composer"><textarea id="cmt" data-compose="${a.id}" placeholder="Add a comment…" rows="2"></textarea>
          <div class="tools"><span class="grow"></span><button class="btn sm" data-act="comment" data-id="${a.id}" title="Comment (⌘↵)">Comment</button></div></div>
      </div>
    </div>
    <aside class="props">
      <div class="group">
        ${bprop("Status", `${stIcon(a.state)}<span class="trunc">${STATES[a.state].name}</span>`, "menuStatus", a.id)}
        ${bprop("Priority", `${priIcon(a.pri)}<span class="trunc">${PRIORITIES[a.pri || 0].name}</span>`, "menuPri", a.id)}
        ${bprop("Team", team ? `${teamKey(a.team)}${team.name}` : `<span class="faint">Not assigned</span>`, "menuTeam", a.id)}
        ${prop("With", `${c.av || "–"}<span class="trunc">${esc(c.label || "Closed")}</span>`)}
        ${prop("Interviewer", a.iv ? `${botAv(a.iv)}<span class="trunc">${esc(PEOPLE[a.iv].name)}</span>` : `<span class="faint">${a.state === "routing" ? "Being picked" : "–"}</span>`)}
        ${a.at && a.state === "scheduled" ? prop("Interview", `<span class="trunc">${esc(fmtWhen(a.at))}</span>`) : ""}
      </div>
      <div class="group">
        ${bprop("Labels", labelsOf(a).length ? `<span class="lwrap">${labelsOf(a).map(labelChip).join("")}</span>` : `<span class="faint">Add label</span>`, "menuLabels", a.id)}
        ${prop("Role", `<span class="trunc">${esc(ROLES[a.role].title)}</span>`)}
        ${prop("Testbench", a.tb && a.tb.state === "done" ? `<b>${tbScore(a)}</b><span class="faint">top ${100 - a.tb.pct}%</span>` : `<span class="faint">${a.tb ? "In progress" : "Not sent"}</span>`)}
        ${prop("Source", esc(a.src))}
        ${prop("Email", `<span class="trunc">${esc(emailOf(a))}</span>`)}
      </div>
</aside>
  </div></div>`;
}
// Comments: notes for the team, and @grok to ask a Grokbot to act.
function comment(id) {
  const a = A[id];
  const el = $("#cmt");
  const text = el && el.value.trim();
  if (!text) return;
  now(a, "me", esc(text).replace(/@grok/gi, `<span class="mention">@grok</span>`), { comment: true });
  el.value = "";
  touch(a);
  if (!/@grok/i.test(text)) return;
  const tk = Object.keys(TEAMS).find((k) => new RegExp(`\\b(${k}|${TEAMS[k].name})\\b`, "i").test(text));
  setTimeout(() => {
    if (tk && /send|move|assign|route|to/i.test(text) && isOpen(a)) {
      now(a, `bot:${ME}`, `On it. Sending ${esc(first2(a))} to ${esc(TEAMS[tk].name)}; their Grokbots will pick the interviewer.`, { comment: true });
      a.state === "judgment" && a.read ? assign(a, tk, (a.round || 1) + 1) : assign(a, tk);
    } else if (/testbench/i.test(text) && !a.tb) {
      now(a, `bot:${ME}`, `Sent ${esc(first2(a))} the Testbench.`, { comment: true });
      sendTB(a); touch(a);
    } else if (/who|where|status/i.test(text)) {
      const c = court(a);
      now(a, `bot:${ME}`, `${esc(first2(a))} is with ${esc(c.label || "nobody")}: ${esc(doing(a).toLowerCase())}.`, { comment: true }); touch(a);
    } else { now(a, `bot:${ME}`, `Noted. I'll keep an eye on ${esc(first2(a))}.`, { comment: true }); touch(a); }
  }, 900);
}

/* ---------------- calendar: every interview the Grokbots booked or proposed ---------------- */
const CAL_H0 = 8, CAL_H1 = 19;
// Hour height is fitted to the window after each render (fitCalendar), like Google Calendar.
let HOUR = 52;
const TEAM_TONE = { infra: "blue", research: "mint", product: "pink" };
const sameDay = (x, y) => new Date(x).toDateString() === new Date(y).toDateString();
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Past interviews sit in working hours, the afternoon before their read.
function workHours(t) {
  const d = new Date(t);
  if (d.getHours() < 9) d.setHours(-10, 0, 0, 0);
  else if (d.getHours() > 16) d.setHours(14, 0, 0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
  while (d.getDay() % 6 === 0) d.setDate(d.getDate() - 1);
  return d.getTime();
}
function calEvents() {
  const out = [];
  for (const a of APPLICANTS) {
    const round = roundsOf(a).length || 1;
    if (a.state === "scheduled" && a.at) out.push({ a, kind: "iv", start: a.at, end: a.at + 60 * MIN, tone: TEAM_TONE[a.team], status: "Booked", iv: a.iv, team: a.team, round });
    if (a.state === "scheduling" || (a.state === "asked" && a.slotTimes)) {
      if (!a.slotTimes) a.slots = slotsFor(a);
      a.slotTimes.forEach((t) => out.push({ a, kind: "hold", start: t, end: t + 60 * MIN, tone: "peach", status: "Pending", iv: a.iv, team: a.team, round }));
    }
    const rd = RUNS.filter((r) => r.a === a.id && r.kind === "Get the read");
    rd.forEach((r, i) => {
      const start = workHours(r.start - 52 * MIN);
      const last = i === rd.length - 1;
      const read = last && a.read && r.end ? a.read.verdict : last && !isOpen(a) ? STATES[a.state].name : r.end ? "Read in" : "Read pending";
      out.push({ a, kind: "past", start, end: start + 60 * MIN, tone: "gray", status: read, iv: r.bot, team: a.team, round: i + 1, run: r.id });
    });
    if (a.state === "testbench") { const due = dayStart(a.tbSent) + 5 * DAY; out.push({ a, kind: "due", allDay: true, start: due, end: due, tone: "lav", title: `Testbench due · ${first2(a)}` }); }
  }
  // Who's out, from what the Grokbots learned.
  const wk = weekStartOf(Date.now());
  out.push({ kind: "away", allDay: true, start: wk, end: wk + 6 * DAY, tone: "gray", title: `Wei · heads-down`, who: "wei" });
  out.push({ kind: "away", allDay: true, start: wk + DAY, end: wk + 5 * DAY, tone: "gray", title: `Noor · on call`, who: "noor" });
  const team = state.calTeam || "all";
  return out.filter((e) => team === "all" || e.team === team || (e.who && PEOPLE[e.who].team === team));
}
const weekStartOf = (t) => { const d = new Date(dayStart(t)); d.setDate(d.getDate() - d.getDay()); return d.getTime(); };
const calMode = () => (["day", "week", "month", "list"].includes(state.calMode) ? state.calMode : innerWidth < 768 ? "day" : "week");
function calRange() {
  const mode = calMode(), off = state.calOff || 0;
  if (mode === "day") { const d = new Date(dayStart(Date.now())); d.setDate(d.getDate() + off); return { days: [d.getTime()], from: d.getTime(), to: d.getTime() + DAY }; }
  if (mode === "month") {
    const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); m.setMonth(m.getMonth() + off);
    const from = weekStartOf(m.getTime());
    return { month: m, days: Array.from({ length: 42 }, (_, i) => from + i * DAY), from, to: from + 42 * DAY };
  }
  const from = weekStartOf(Date.now()) + off * 7 * DAY;
  return { days: Array.from({ length: 7 }, (_, i) => from + i * DAY), from, to: from + 7 * DAY };
}
function weekNo(t) { const d = new Date(t); const j = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - j) / DAY + j.getDay() + 1) / 7); }
const hm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function evTitle(e) { return e.title || e.a.name; }
function evBlock(e, lane, lanes) {
  const s = new Date(e.start);
  const top = (s.getHours() + s.getMinutes() / 60 - CAL_H0) * HOUR;
  const h = Math.max(22, ((e.end - e.start) / HR) * HOUR - 4);
  const w = 100 / lanes;
  const sub = e.kind === "hold" ? `${esc(first(e.iv))} offered this` : `Round ${e.round} · ${esc(first(e.iv))}`;
  return `<a class="ev2 ${e.tone} ${e.kind} ${h < 52 || lanes > 1 && h < 70 ? "tight" : ""}" role="button" tabindex="0" data-act="calEv" data-k="${esc(evKey(e))}" style="top:${top + 2}px;height:${h}px;left:calc(${lane * w}% + 3px);width:calc(${w}% - 6px)" title="${esc(evTitle(e))}">
    <b>${esc(evTitle(e))}</b><span>${h < 52 || lanes > 1 && h < 70 ? hm(e.start) : `${hm(e.start)} – ${hm(e.end)}`}</span>${h > 66 ? `<span>${sub}</span>` : ""}${h > 88 ? `<span class="st2">${esc(e.status)}</span>` : ""}</a>`;
}
// Side-by-side lanes for overlapping blocks in a day.
function laneOut(evs) {
  const sorted = [...evs].sort((x, y) => x.start - y.start), ends = [];
  const placed = sorted.map((e) => { let l = ends.findIndex((t) => t <= e.start); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = e.end; return { e, l }; });
  return placed.map((p) => evBlock(p.e, p.l, Math.max(1, ends.length))).join("");
}
function timeGrid(r, evs) {
  const today = dayStart(Date.now());
  const timed = evs.filter((e) => !e.allDay);
  const allDay = evs.filter((e) => e.allDay);
  const n = r.days.length;
  const hours = Array.from({ length: CAL_H1 - CAL_H0 }, (_, i) => CAL_H0 + i);
  const nowTop = ((new Date().getHours() + new Date().getMinutes() / 60) - CAL_H0) * HOUR;
  return `<div class="wk" style="--n:${n}">
    <div class="wk-head"><span></span>${r.days.map((d) => { const x = new Date(d); return `<div class="wk-day ${d === today ? "today" : ""}"><span>${WD[x.getDay()].toUpperCase()}</span><b>${x.getDate()}</b></div>`; }).join("")}</div>
    ${allDayRow(r, allDay)}
    <div class="wk-scroll" id="wkScroll"><div class="wk-body" style="height:${hours.length * HOUR}px">
      <div class="wk-gutter">${hours.map((h) => `<span style="top:${(h - CAL_H0) * HOUR}px">${String(h).padStart(2, "0")}:00</span>`).join("")}</div>
      ${r.days.map((d) => `<div class="wk-col ${d === today ? "today" : ""} ${new Date(d).getDay() % 6 === 0 ? "wkend" : ""}" data-day="${d}">${hours.map((h) => `<i style="top:${(h - CAL_H0) * HOUR}px"></i>`).join("")}${laneOut(timed.filter((e) => sameDay(e.start, d)))}${d === today && nowTop > 0 && nowTop < hours.length * HOUR ? `<em class="nowline" style="top:${nowTop}px"></em>` : ""}</div>`).join("")}
    </div></div>
  </div>`;
}
// All-day items span their days, one row each.
function allDayRow(r, allDay) {
  const n = r.days.length, first0 = r.days[0], last0 = r.days[n - 1];
  const bars = allDay.filter((e) => dayStart(e.end) >= first0 && dayStart(e.start) <= last0).map((e) => {
    const s = Math.max(0, Math.round((dayStart(e.start) - first0) / DAY)), t = Math.min(n - 1, Math.round((dayStart(e.end) - first0) / DAY));
    return { e, s, t };
  }).sort((x, y) => x.s - y.s || y.t - x.t);
  // Pack bars into as few rows as fit side by side.
  const ends = [];
  bars.forEach((b) => { let row = ends.findIndex((t) => t < b.s); if (row < 0) { row = ends.length; ends.push(-1); } ends[row] = b.t; b.row = row; });
  const rows = Math.max(1, ends.length);
  return `<div class="wk-all" style="grid-template-rows:repeat(${rows}, 22px)"><span class="wk-gl" style="grid-row:1 / span ${rows}">All day</span>${r.days.map((_, i) => `<i class="wk-cell" style="grid-column:${i + 2};grid-row:1 / span ${rows}"></i>`).join("")}${bars.map((b, i) => `<button class="pill2 ${b.e.tone}" data-act="calEv" data-k="${esc(evKey(b.e))}" style="grid-column:${b.s + 2} / ${b.t + 3};grid-row:${b.row + 1}" title="${esc(b.e.title)}">${esc(b.e.title)}</button>`).join("")}</div>`;
}
function monthGrid(r, evs) {
  const today = dayStart(Date.now());
  return `<div class="mo"><div class="mo-head">${WD.map((w) => `<span>${w.toUpperCase()}</span>`).join("")}</div><div class="mo-grid">${r.days.map((d) => {
    const x = new Date(d);
    const es = evs.filter((e) => (e.allDay ? d >= dayStart(e.start) && d <= dayStart(e.end) : sameDay(e.start, d))).sort((p, q) => !!p.allDay - !!q.allDay || p.start - q.start);
    return `<div class="mo-cell ${x.getMonth() !== r.month.getMonth() ? "out" : ""} ${d === today ? "today" : ""}"><b>${x.getDate()}</b>${es.slice(0, 3).map((e) => e.allDay ? `<button class="pill2 ${e.tone}" data-act="calEv" data-k="${esc(evKey(e))}">${esc(e.title)}</button>` : `<a class="mo-ev ${e.tone}" role="button" tabindex="0" data-act="calEv" data-k="${esc(evKey(e))}"><i></i>${hm(e.start)} ${esc(evTitle(e))}</a>`).join("")}${es.length > 3 ? `<span class="faint more2">${es.length - 3} more</span>` : ""}</div>`;
  }).join("")}</div></div>`;
}
function calendarPage() {
  const mode = calMode();
  const r = calRange();
  const all = calEvents();
  const evs = all.filter((e) => e.end >= r.from && e.start < r.to);
  const title = mode === "analytics" ? "Analytics" : mode === "month" ? `${MO[r.month.getMonth()]} ${r.month.getFullYear()}` : `${MONTHS[new Date(r.days[0]).getMonth()]}, ${new Date(r.days[0]).getFullYear()}`;
  const sub = mode === "analytics" ? `What's moving, what's stuck, and who's carrying the interviews${state.calTeam && state.calTeam !== "all" ? ` on ${TEAMS[state.calTeam].name}` : ""}` : mode === "month" ? `${evs.filter((e) => !e.allDay).length} interviews and holds` : mode === "day" ? fmtDay(r.days[0]) : `Week ${weekNo(r.days[0])} · ${MO[new Date(r.days[0]).getMonth()]} ${new Date(r.days[0]).getDate()} – ${new Date(r.days[6]).getDate()}`;
  const rows = all.filter((e) => ["iv", "hold", "past"].includes(e.kind) && (!state.calQ || `${e.a.name} ${PEOPLE[e.iv].name}`.toLowerCase().includes(state.calQ.toLowerCase())));
  const seen = new Set();
  const table = rows.sort((x, y) => (x.kind === "past") - (y.kind === "past") || (x.kind === "past" ? y.start - x.start : x.start - y.start)).filter((e) => (e.kind === "hold" ? (seen.has(e.a.id) ? false : seen.add(e.a.id)) : true));
  const statusPill = (e) => {
    const [tone, icon, word] = e.kind === "iv" ? ["ok", "check", "Booked"] : e.kind === "hold" ? ["warn", "clock", "Pending"] : e.status === "Read pending" ? ["info", "clock", "Read pending"]
      : e.status === "Offer" ? ["accent", "arrowR", "Offer"] : e.status === "Rejected" ? ["bad", "x", "Rejected"] : verdictCls(e.status) === "yes" ? ["ok", "check", e.status] : verdictCls(e.status) === "no" ? ["bad", "x", e.status] : ["warn", "clock", e.status];
    return `<span class="cx-pill ${tone}"><i>${ico(icon)}</i>${esc(word)}</span>`;
  };
  const note = (e) => e.kind === "iv" ? `Invite sent from ${first(e.iv)}'s Gmail.` : e.kind === "hold" ? `Waiting on ${first2(e.a)} to pick ${e.a.slots.join(" or ")}` : e.a.read && e.status === e.a.read.verdict ? `“${e.a.read.quote}”` : e.status === "Offer" ? "Moved to offer. Draft ready in Gmail." : e.status === "Rejected" ? `Rejected. ${first(e.iv)}'s Grokbot sent the note.` : e.status === "Read in" ? "Read is in" : `${first(e.iv)}'s Grokbot is collecting the read`;
  const teamName = state.calTeam && state.calTeam !== "all" ? TEAMS[state.calTeam].name : "Everyone";
  return `<div class="bar cx-bar"><h1 class="cx-title">Calendar</h1><span class="spacer"></span>
    <label class="cx-search hide-sm">${ico("search")}<input id="calq" placeholder="Search interviews…" value="${esc(state.calQ || "")}" autocomplete="off"></label>
    <button class="cx-ibtn" data-act="help" aria-label="Keyboard Shortcuts" title="Keyboard Shortcuts (?)">?</button>
    <button class="cx-primary" data-act="findTime" title="Suggests an interviewer and a time">${ico("cal")}<span>Find a time</span></button></div>
  <div class="scroll ${mode === "list" ? "" : "fitv"}" id="scroller"><div class="calpage ${mode === "list" ? "" : "fit"}">
    <div class="cal-main">
      <div class="cal-top">
        ${mode === "list" ? `<h2>All interviews</h2>` : `<button class="cx-btn" data-act="calToday">Today</button>
        <div class="cx-pair"><button class="cx-btn" data-act="calNav" data-d="-1" aria-label="Previous">${ico("arrowL")}</button><button class="cx-btn" data-act="calNav" data-d="1" aria-label="Next">${ico("arrowR")}</button></div>
        <h2>${title}</h2>${mode === "day" ? `<span class="cal-sub hide-sm">${sub}</span>` : ""}`}
        <span class="grow"></span>
        <button class="cx-btn" data-act="calTeamMenu">${state.calTeam && state.calTeam !== "all" ? teamKey(state.calTeam) : ico("people")}${teamName}<svg class="chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>
        <div class="cx-seg">${[["day", "Day"], ["week", "Week"], ["month", "Month"], ["list", "List"]].map(([k, n]) => `<button class="${mode === k ? "on" : ""}" data-act="calMode" data-v="${k}">${n}</button>`).join("")}</div>
      </div>
      ${mode === "list" ? `<section class="cal-table">
      <div class="ct-head"><b>Interviews</b><span class="faint">${table.length}</span><span class="grow"></span></div>
      <div class="ct-row th"><span>Status</span><span>Applicant</span><span>Round</span><span>Interviewer</span><span>Date</span><span>Time</span><span>Notes</span></div>
      ${table.map((e) => `<div class="ct-row" role="button" tabindex="0" data-act="calEv" data-k="${esc(evKey(e))}"><span>${statusPill(e)}</span><span class="ct-a">${candAv(e.a)}<span class="trunc">${esc(e.a.name)}</span></span><span class="ct-r">${e.team ? teamKey(e.team) : ""}<span class="trunc">Round ${e.round}${e.team ? ` · ${TEAMS[e.team].name}` : ""}</span></span><span class="ct-a">${botAv(e.iv)}<span class="trunc">${esc(PEOPLE[e.iv].name)}</span></span><span>${esc(`${MONTHS[new Date(e.start).getMonth()]} ${new Date(e.start).getDate()}, ${new Date(e.start).getFullYear()}`)}</span><span>${e.kind === "hold" ? "2 options" : hm(e.start)}</span><span class="trunc ct-note">${esc(note(e))}</span></div>`).join("") || `<div class="empty">No interviews match</div>`}
    </section>` : mode === "month" ? monthGrid(r, evs) : timeGrid(r, evs)}
    </div>
  </div></div>`;
}

// The Grokbots pick the next booking: who's waiting longest on you, the
// interviewer they'd choose, and that person's first free hour.
function findTime() {
  const a = bookable()[0];
  if (!a) return toast("Nobody is waiting on an interview");
  const tk = teamFor(a);
  const met = a.state === "judgment" && a.iv ? [a.iv] : [];
  const best = pickInterviewer(tk, a.role, met).best;
  const order = [best, ...TEAMS[tk].members.filter((id) => id !== best && !PEOPLE[id].quiet && PEOPLE[id].load < PEOPLE[id].cap && !met.includes(id))].filter(Boolean);
  let iv = null, t = null;
  for (const id of order) {
    for (let d = 1; d <= 8 && !t; d++) for (const h of [10, 11, 14, 15, 16]) { const x = wdAt(d, h); if (!busyAt(id, x, x + HR)) { t = x; break; } }
    if (t) { iv = id; break; }
  }
  if (!t) return toast(`Nobody on ${TEAMS[tk].name} is free in the next two weeks`);
  state.calMode = calMode() === "day" ? "day" : "week";
  state.calOff = state.calMode === "day" ? Math.round((dayStart(t) - dayStart(Date.now())) / DAY) : Math.round((weekStartOf(t) - weekStartOf(Date.now())) / (7 * DAY));
  render();
  const col = $(`.wk-col[data-day="${dayStart(t)}"]`);
  if (!col) return;
  const g = document.createElement("div");
  g.className = "ev2 ghost";
  col.appendChild(g);
  const top = ((new Date(t).getHours() - CAL_H0) * HOUR);
  Object.assign(g.style, { top: `${top + 2}px`, height: `${HOUR - 4}px`, left: "3px", width: "calc(100% - 6px)" });
  g.innerHTML = `<b>${esc(a.name)}</b><span>${hm(t)} – ${hm(t + HR)}</span>`;
  g.scrollIntoView({ block: "center" });
  setTimeout(() => {
    openNewPop(t, t + HR, g);
    Object.assign(pop.nw, { a: a.id, iv, found: true });
    drawPop();
  }, 60);
}

/* ---------------- event card: Google Calendar's popover, for interviews ---------------- */
// Click a block: details, Meet link, guests and reminders, plus who the
// candidate is and the report, without leaving the calendar.
const evKey = (e) => `${e.kind}|${e.a ? e.a.id : e.who}|${e.start}`;
const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const longDay = (t) => { const d = new Date(t); return `${DAYNAMES[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
function meetCode(id) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const l = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((h >> (i * 3 + n)) % 26))).join("");
  return `${l(3)}-${l(4)}-${l(3)}`;
}
const GICO = {
  pencil: `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>`,
  more: `<svg viewBox="0 0 24 24"><path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="3"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>`,
  copy: `<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>`,
  people: `<svg viewBox="0 0 24 24"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M16 4.3a3.5 3.5 0 0 1 0 6.6M18 14.8c1.7.8 2.8 2.6 3 5.2"/></svg>`,
  bell: `<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4ZM10 20a2 2 0 0 0 4 0"/></svg>`,
  cal: `<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>`,
  meet: `<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="#fbbc04"/><path d="M15.5 10.2 21 7v10l-5.5-3.2Z" fill="#ea4335"/><rect x="2.5" y="12" width="13" height="6" rx="2.5" fill="#34a853" opacity=".55"/></svg>`,
  person: `<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/></svg>`,
  report: `<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7ZM14 3v5h5M10 13h6M10 17h6"/></svg>`,
};
const gbtn = (name, act, label, extra = "") => `<button class="gbtn" data-act="${act}" aria-label="${label}" title="${label}" ${extra}>${GICO[name]}</button>`;
let pop = null;
function openEventPop(key, anchor) {
  const e = calEvents().find((x) => evKey(x) === key);
  if (!e) return;
  closeLayer();
  pop = { key, e, view: "main", rect: anchor.getBoundingClientRect() };
  modal = { send: () => {} };
  drawPop();
}
function guestRow(av, name, sub, ok) { return `<div class="g-guest"><span class="g-av">${av}${ok === true ? `<i class="ok">${ico("check")}</i>` : ok === false ? `<i class="wait">${ico("clock")}</i>` : ""}</span><div><b>${esc(name)}</b>${sub ? `<span>${sub}</span>` : ""}</div></div>`; }
function popMain(e) {
  const a = e.a;
  if (!a) return `<div class="g-title"><i class="g-sq ${e.tone}"></i><div><h3>${esc(e.title)}</h3><p>${longDay(e.start)} – ${longDay(e.end)}</p><p class="faint">Learned by ${esc(first(e.who))}'s Grokbot. No interviews are offered on these days.</p></div></div>
    <div class="g-row">${GICO.cal}<div><b>${esc(PEOPLE[e.who].name)}</b></div></div>`;
  const iv = e.iv, ivp = PEOPLE[iv];
  const kindTitle = e.kind === "hold" ? `Hold · ${a.name}` : `Interview · ${a.name}`;
  const status = e.kind === "hold" ? `<span class="spill wait"><span class="dot"></span>Waiting on ${esc(first2(a))}</span>` : e.kind === "past" ? `<span class="readpill ${e.status === "Offer" ? "yes" : e.status === "Rejected" ? "no" : verdictCls(e.status)}">${esc(e.status)}</span>` : `<span class="spill done">${ico("check")}Booked</span>`;
  const cand = e.kind === "hold" ? false : true;
  const code = meetCode(a.id + e.round);
  return `<div class="g-title"><i class="g-sq ${e.tone}"></i><div><h3>${esc(kindTitle)}</h3><p>${longDay(e.start)} · ${hm(e.start)} – ${hm(e.end)}</p><p class="faint">Round ${e.round} · ${esc(ROLES[a.role].title)}${e.team ? ` · ${TEAMS[e.team].name}` : ""}</p><div class="g-status">${status}</div></div></div>
    ${e.kind === "hold" ? `<div class="g-hold"><b>${esc(possessive(first(iv)))} Grokbot offered two times.</b><span>${esc(a.slots.join(" or "))}. ${esc(first2(a))} hasn't picked yet.</span></div>` : ""}
    ${e.kind !== "past" ? `<div class="g-row">${GICO.meet}<div><a href="#" data-act="noop" class="g-link">Join with Google Meet</a><span>meet.google.com/${code}</span></div>${gbtn("copy", "copyMeet", "Copy the Meet link", `data-v="meet.google.com/${code}"`)}</div>` : ""}
    <div class="g-row">${GICO.people}<div class="grow"><b>2 guests</b><span>${cand ? "2 yes" : "1 yes, 1 awaiting"}</span>
      ${guestRow(botAv(iv, "lg"), ivp.name, `Interviewer · organizer`, true)}
      ${guestRow(candAv(a, "lg"), a.name, esc(emailOf(a)), cand)}</div></div>
    <div class="g-row">${GICO.bell}<div><b>${e.kind === "past" ? (a.read && e.status === a.read.verdict ? `Read: ${esc(a.read.verdict)}` : "Read requested after the interview") : "Read requested 10 minutes after"}</b><span>${esc(possessive(first(iv)))} Grokbot asks in Slack</span></div></div>
    <div class="g-row">${GICO.cal}<div><b>${esc(ivp.name)}</b><span>Booked by ${esc(possessive(first(iv)))} Grokbot from ${esc(first(iv).toLowerCase())}@meridian.com</span></div></div>`;
}
function popPerson(e) {
  const a = e.a;
  return `<div class="g-person">${candAv(a, "xl")}<div><h3>${esc(a.name)}</h3><p>${esc(a.hl)}</p><p class="faint">${esc(a.loc)} · ${a.yrs} years · ${esc(a.src)}</p></div></div>
    <div class="g-chips">${labelsOf(a).map(labelChip).join("")}<span class="label">${priIcon(a.pri)}${PRIORITIES[a.pri || 0].name}</span><span class="label">${stIcon(a.state)}${STATES[a.state].name}</span></div>
    ${a.note ? `<div class="g-sec"><div class="mv-k">Why they applied</div><p class="g-note">${esc(a.note.replace(/^(Hi|Hello)[^\n]*\n+/, "").split("\n\n")[0])}</p></div>` : ""}
    <div class="g-sec"><div class="mv-k">Tacit's read of the resume</div>${profile(a)}</div>`;
}
function popReport(e) {
  const a = e.a;
  const r = a.read && e.kind === "past" && e.status === a.read.verdict ? a.read : null;
  return `<div class="g-person"><span class="g-repico">${GICO.report}</span><div><h3>Report on ${esc(a.name)}</h3><p>${r ? `${esc(possessive(PEOPLE[r.by].name))} read, plus the Testbench` : "The Testbench, which the interviewer sees beforehand"}</p></div></div>
    ${r ? `<div class="g-sec"><div class="g-readhead">${personAv(r.by, "lg")}<b>${esc(possessive(first(r.by)))} read</b><span class="readpill ${verdictCls(r.verdict)}">${esc(r.verdict)}</span></div><blockquote class="g-q">${esc(r.quote)}</blockquote><ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><div class="cc-senti"><span class="faint">Sentiment</span>${senti(r.senti)}<span class="num">${r.senti.toFixed(2)}</span></div></div>` : ""}
    <div class="g-sec">${tbPanel(a, true)}</div>
    ${e.kind !== "past" ? `<div class="g-sec"><div class="mv-k">What ${esc(first(e.iv))} will be asked to cover</div><ul class="sum">${(a.tb && a.tb.state === "done" ? [`Dig into ${Object.entries(a.tb.rubric).sort((x, y) => x[1] - y[1])[0][0].toLowerCase()}, the Testbench's weakest area`, `Walk through ${a.exp[0] ? a.exp[0][0] : "their last role"}: ${a.sum[0].toLowerCase()}`, "Ask what they'd want to own in the first 90 days"] : [`Walk through ${a.exp[0] ? a.exp[0][0] : "their last role"}`, "A live problem in place of the missing Testbench", "Ask what they'd want to own in the first 90 days"]).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}`;
}
// Free slots for the interviewer this week and next.
function freeSlots(e) {
  const out = [];
  const taken = calEvents().filter((x) => x.iv === e.iv && !x.allDay).map((x) => x.start);
  for (let d = 1; d <= 6 && out.length < 5; d++) for (const h of [10, 11, 14, 15.5]) {
    const t = wdAt(d, Math.floor(h), (h % 1) * 60);
    if (!taken.includes(t) && t !== e.start && out.length < 5) out.push(t);
  }
  return out;
}
function popMove(e) {
  return `<div class="g-person"><span class="g-repico">${GICO.pencil}</span><div><h3>${e.kind === "hold" ? "Book a time" : "Reschedule"}</h3><p>${e.kind === "hold" ? `Pick for ${esc(first2(e.a))}. ${esc(possessive(first(e.iv)))} Grokbot sends the invite.` : `Free times on ${esc(possessive(first(e.iv)))} calendar. The Grokbot emails ${esc(first2(e.a))} from ${esc(possessive(first(e.iv)))} Gmail.`}</p></div></div>
    <div class="g-slots">${(e.kind === "hold" ? e.a.slotTimes.concat(freeSlots(e).slice(0, 3)) : freeSlots(e)).map((t) => `<button class="g-slot" data-act="popMoveTo" data-t="${t}"><b>${longDay(t)}</b><span>${hm(t)} – ${hm(t + HR)}</span>${e.kind === "hold" && e.a.slotTimes.includes(t) ? `<span class="sugg">Offered</span>` : ""}</button>`).join("")}</div>`;
}
function popCancel(e) {
  const a = e.a, iv = e.iv;
  return `<div class="g-person"><span class="g-repico red">${GICO.trash}</span><div><h3>${e.kind === "hold" ? "Withdraw these times?" : "Cancel this interview?"}</h3><p>${esc(possessive(first(iv)))} Grokbot emails ${esc(first2(a))} from ${esc(possessive(first(iv)))} Gmail, frees the slot, and ${esc(a.name)} comes back to you.</p></div></div>
    <div class="g-confirm"><button class="btn" data-act="popView" data-v="main">Keep it</button><button class="btn danger" data-act="popCancelGo">${e.kind === "hold" ? "Withdraw" : "Cancel interview"}</button></div>`;
}
function drawPop() {
  if (!pop) return;
  const { e, view } = pop;
  const body = view === "new" ? popNew() : view === "person" ? popPerson(e) : view === "report" ? popReport(e) : view === "move" ? popMove(e) : view === "cancel" ? popCancel(e) : popMain(e);
  const live = e.a && (e.kind === "iv" || e.kind === "hold");
  const el = document.createElement("div");
  el.className = "gpop-wrap";
  el.innerHTML = `<div class="gpop" role="dialog" aria-label="${esc(e.a ? e.a.name : e.title)}">
    <div class="gp-tools">${view !== "main" && view !== "new" ? gbtn("back", "popView", "Back", 'data-v="main"') : ""}<span class="grow"></span>
      ${live ? gbtn("pencil", "popView", e.kind === "hold" ? "Book a time" : "Reschedule", 'data-v="move"') + gbtn("trash", "popView", e.kind === "hold" ? "Withdraw times" : "Cancel interview", 'data-v="cancel"') : ""}
      ${e.a ? gbtn("more", "popMore", "More") : ""}${gbtn("x", "popClose", "Close (Esc)")}</div>
    <div class="gp-body">${body}</div>
    ${view === "new" ? `<div class="gp-foot"><span class="hint faint">${pop.nw.ask ? "Books once confirmed" : "Books and sends the invite"}</span><span class="grow"></span><button class="btn sm" data-act="popClose">Cancel</button><button class="btn primary sm" data-act="newSave" ${pop.nw.a ? "" : "disabled"}>${pop.nw.ask ? `Ask ${esc(first(pop.nw.iv || ME))}` : "Book"}</button></div>` : ""}
    ${e.a ? `<div class="gp-foot">
      <button class="gp-tab ${view === "person" ? "on" : ""}" data-act="popView" data-v="${view === "person" ? "main" : "person"}">${GICO.person}Profile</button>
      <button class="gp-tab ${view === "report" ? "on" : ""}" data-act="popView" data-v="${view === "report" ? "main" : "report"}">${GICO.report}Report</button>
      <span class="grow"></span>
      ${e.kind === "hold" && view === "main" ? `<button class="btn primary sm" data-act="popView" data-v="move">Book a time</button>` : `<a class="btn sm" href="#t~${e.a.id}">Open ticket</a>`}
    </div>` : ""}
  </div>`;
  $("#layer").innerHTML = "";
  $("#layer").appendChild(el);
  const card = $(".gpop", el);
  if (innerWidth < 768) { card.classList.add("sheet"); return; }
  // Placed beside the block once, then held still while the views change.
  if (!pop.pos) {
    const r = pop.rect, w = card.offsetWidth, h = card.offsetHeight;
    let left = r.right + 12;
    if (left + w > innerWidth - 12) left = r.left - w - 12;
    if (left < 12) left = Math.max(12, (innerWidth - w) / 2);
    pop.pos = { left, top: Math.max(12, Math.min(r.top - 24, innerHeight - h - 12)) };
  }
  Object.assign(card.style, { left: `${pop.pos.left}px`, top: `${pop.pos.top}px`, maxHeight: `${innerHeight - pop.pos.top - 12}px` });
}
function popAct(fn) { const e = pop.e; fn(e, e.a); }
function moveEvent(e, t) {
  const a = e.a, iv = e.iv;
  if (e.kind === "hold") {
    const sch = RUNS.find((r) => r.a === a.id && r.kind === "Schedule the interview" && !r.end);
    a.state = "scheduled"; a.at = t;
    now(a, "me", `Booked ${esc(longDay(t))}, ${esc(hm(t))} for ${esc(first2(a))}`);
    const ev2 = now(a, `bot:${iv}`, `Sent the invite from ${nm(iv)}'s Gmail. On both calendars`, { ch: "cal", run: sch });
    if (sch) endRun(sch, ev2.at);
    toast(`${a.name} is booked with ${PEOPLE[iv].name}, ${longDay(t)} at ${hm(t)}`);
  } else {
    a.at = t;
    const r = startRun(a, "Reschedule the interview", iv, Date.now(), "gmail");
    now(a, "me", `Moved the interview to ${esc(longDay(t))}, ${esc(hm(t))}`);
    endRun(r, now(a, `bot:${iv}`, `Emailed ${esc(first2(a))} the new time from ${nm(iv)}'s Gmail`, { ch: "gmail", run: r }).at);
    toast(`Moved to ${longDay(t)} at ${hm(t)}. ${possessive(first(iv))} Grokbot told ${first2(a)}.`);
  }
  touch(a);
}
function cancelEvent(e) {
  const a = e.a, iv = e.iv;
  cancel(a);
  RUNS.filter((r) => r.a === a.id && !r.end).forEach((r) => endRun(r, Date.now()));
  a.state = "judgment"; a.at = null; a.slotTimes = null; a.read = null;
  PEOPLE[iv].load = Math.max(0, PEOPLE[iv].load - 1);
  const r = startRun(a, e.kind === "hold" ? "Withdraw the offered times" : "Cancel the interview", iv, Date.now(), "gmail");
  now(a, "me", e.kind === "hold" ? "Withdrew the offered times" : "Cancelled the interview");
  endRun(r, now(a, `bot:${iv}`, `Emailed ${esc(first2(a))} from ${nm(iv)}'s Gmail and freed the slot. Back with you`, { ch: "gmail", run: r }).at);
  toast(`${e.kind === "hold" ? "Withdrew the times for" : "Cancelled the interview with"} ${a.name}. They're back with you.`, { open: a.id });
  touch(a);
}

/* ---------------- calendar: drag to add, drag to move ---------------- */
// Drag down an empty stretch of a day to add an interview (a click adds an
// hour). Drag a booked interview to move it. Everything snaps to 15 minutes.
const SNAP = 15;
function yToMin(y) { const m = Math.round(((y / HOUR) * 60) / SNAP) * SNAP; return Math.max(0, Math.min((CAL_H1 - CAL_H0) * 60 - SNAP, m)); }
const colAt = (x, y) => document.elementsFromPoint(x, y).find((n) => n.classList && n.classList.contains("wk-col"));
let cdrag = null;
document.addEventListener("pointerdown", (e) => {
  if (state.route.name !== "calendar" || e.button || pop) return;
  const block = e.target.closest(".ev2.iv");
  const col = e.target.closest(".wk-col");
  if (!col || (e.target.closest(".ev2") && !block)) return;
  if (block) { cdrag = { mode: "move", el: block, key: block.dataset.k, col, dy: e.clientY - block.getBoundingClientRect().top, x0: e.clientX, y0: e.clientY, moved: false }; return; }
  if (e.pointerType !== "touch") e.preventDefault();
  const m0 = yToMin(e.clientY - col.getBoundingClientRect().top - (HOUR * SNAP) / 120);
  const g = document.createElement("div");
  g.className = "ev2 ghost";
  col.appendChild(g);
  cdrag = { mode: "new", col, m0, m1: m0 + 60, g, moved: false, x0: e.clientX, y0: e.clientY };
  drawGhost();
});
function drawGhost(d = cdrag) {
  const { g, m0, m1 } = d;
  const a = Math.min(m0, m1), b = Math.max(m0, m1, a + 30);
  Object.assign(g.style, { top: `${(a / 60) * HOUR + 2}px`, height: `${((b - a) / 60) * HOUR - 4}px`, left: "3px", width: "calc(100% - 6px)" });
  const base = +d.col.dataset.day + CAL_H0 * HR;
  d.start = base + a * MIN; d.end = base + b * MIN;
  g.innerHTML = `<b>New interview</b><span>${hm(d.start)} – ${hm(d.end)}</span>`;
}
document.addEventListener("pointermove", (e) => {
  if (!cdrag) return;
  if (Math.abs(e.clientY - cdrag.y0) > 4 || Math.abs(e.clientX - cdrag.x0) > 4) cdrag.moved = true;
  if (!cdrag.moved) return;
  if (cdrag.mode === "new") {
    cdrag.m1 = yToMin(e.clientY - cdrag.col.getBoundingClientRect().top) + SNAP;
    drawGhost();
    return;
  }
  const col = colAt(e.clientX, e.clientY) || cdrag.col;
  if (col !== cdrag.el.parentElement) { col.appendChild(cdrag.el); cdrag.col = col; }
  const m = yToMin(e.clientY - col.getBoundingClientRect().top - cdrag.dy);
  cdrag.el.classList.add("dragging");
  Object.assign(cdrag.el.style, { top: `${(m / 60) * HOUR + 2}px`, left: "3px", width: "calc(100% - 6px)" });
  cdrag.newStart = +col.dataset.day + CAL_H0 * HR + m * MIN;
  const sp = $("span", cdrag.el);
  if (sp) sp.textContent = `${hm(cdrag.newStart)} – ${hm(cdrag.newStart + HR)}`;
});
// A scroll on a phone takes the gesture over: drop the drag.
document.addEventListener("pointercancel", () => { if (!cdrag) return; if (cdrag.g) cdrag.g.remove(); cdrag = null; render(); });
document.addEventListener("pointerup", () => {
  if (!cdrag) return;
  const d = cdrag; cdrag = null;
  if (d.mode === "move") {
    if (!d.moved) return;
    state.noClick = Date.now();
    const ev = calEvents().find((x) => evKey(x) === d.key);
    if (ev && d.newStart && d.newStart !== ev.start) moveEvent(ev, d.newStart); else render();
    return;
  }
  if (!d.moved) { d.m1 = d.m0 + 60; drawGhost(d); }
  openNewPop(d.start, d.end, d.g);
});
// Who can be booked: anyone waiting on an interview, your calls first.
const BOOK_ORDER = { judgment: 0, routing: 1, scheduling: 2, asked: 2, new: 3 };
const bookable = () => APPLICANTS.filter((a) => a.state in BOOK_ORDER).sort((x, y) => BOOK_ORDER[x.state] - BOOK_ORDER[y.state] || y.when - x.when);
const busyAt = (id, start, end) => calEvents().some((x) => x.iv === id && !x.allDay && x.start < end && x.end > start);
function openNewPop(start, end, ghost) {
  closeLayer();
  const a = bookable()[0];
  pop = { e: { kind: "new", tone: "blue", start, end }, view: "new", rect: ghost.getBoundingClientRect(), ghost, nw: { a: a && a.id, iv: null, ask: true } };
  pickDefaultIv();
  modal = { send: () => saveNew() };
  drawPop();
}
const teamFor = (a) => a.team || ROLES[a.role].team;
function pickDefaultIv() {
  const a = A[pop.nw.a];
  if (!a) return;
  const tk = teamFor(a);
  const met = a.state === "judgment" && a.iv ? [a.iv] : [];
  const free = TEAMS[tk].members.filter((id) => !busyAt(id, pop.e.start, pop.e.end) && !PEOPLE[id].quiet && PEOPLE[id].load < PEOPLE[id].cap && !met.includes(id));
  const best = pickInterviewer(tk, a.role, met).best;
  pop.nw.iv = free.includes(best) ? best : free[0] || TEAMS[tk].members[0];
}
function popNew() {
  const { e, nw } = pop;
  const a = A[nw.a];
  const tk = a && teamFor(a);
  return `<div class="g-title"><i class="g-sq blue"></i><div><h3>${a ? `Interview · ${esc(a.name)}` : "New interview"}</h3><p>${longDay(e.start)} · ${hm(e.start)} – ${hm(e.end)}</p>
      ${pop.nw.found ? `<div class="g-found"><span>Grokbot's pick: ${esc(first2(a))} ${a.state === "judgment" ? `is back with you after round ${a.round || 1}` : a.state === "routing" ? "is waiting for an interviewer" : a.state === "new" ? "is a new applicant" : "still needs a time"}, and ${esc(first(nw.iv))} ${PEOPLE[nw.iv].likes === "loves" ? "likes interviewing" : "has room"} and is free then.</span></div>` : ""}
      <div class="durs">${[30, 45, 60, 90].map((m) => `<button class="${e.end - e.start === m * MIN ? "on" : ""}" data-act="newDur" data-v="${m}">${m} min</button>`).join("")}</div></div></div>
    <div class="g-row">${GICO.person}<div class="grow"><b>Applicant</b><div class="pick">${bookable().map((x) => `<button class="pick-row ${x.id === nw.a ? "on" : ""}" data-act="newApp" data-id="${x.id}">${candAv(x)}<span class="grow"><b>${esc(x.name)}</b><span>${esc(doing(x))}</span></span>${x.id === nw.a ? ico("check") : ""}</button>`).join("") || `<span class="faint">Nobody is waiting on an interview</span>`}</div></div></div>
    ${a ? `<div class="g-row">${GICO.people}<div class="grow"><b>Interviewer · ${TEAMS[tk].name}</b><div class="pick">${TEAMS[tk].members.map((id) => {
      const p = PEOPLE[id];
      const busy = busyAt(id, e.start, e.end);
      const why = busy ? "Busy then" : p.quiet ? p.quiet : p.load >= p.cap ? `Full this week (${p.load} of ${p.cap})` : `${likesLabel(p)} · ${p.load} of ${p.cap} this week`;
      return `<button class="pick-row ${id === nw.iv ? "on" : ""} ${busy || p.quiet ? "warn" : ""}" data-act="newIv" data-id="${id}">${botAv(id)}<span class="grow"><b>${esc(p.name)}</b><span>${esc(why)}</span></span>${id === nw.iv ? ico("check") : ""}</button>`;
    }).join("")}</div></div></div>
    <div class="g-row">${GICO.bell}<div class="grow"><b>Ask ${esc(first(nw.iv))} first</b><span>${esc(possessive(first(nw.iv)))} Grokbot texts them and sends the invite from their Gmail once they say yes</span></div><button class="switch ${nw.ask ? "on" : ""}" data-act="newAsk" role="switch" aria-checked="${nw.ask}" aria-label="Ask first"><i></i></button></div>` : ""}`;
}
function saveNew() {
  const { e, nw } = pop;
  const a = A[nw.a];
  if (!a || !nw.iv) return;
  closeLayer();
  bookAt(a, nw.iv, e.start, e.end, nw.ask);
}
function bookAt(a, iv, start, end, askFirst) {
  cancel(a);
  RUNS.filter((r) => r.a === a.id && !r.end).forEach((r) => endRun(r, Date.now()));
  const tk = PEOPLE[iv].team;
  const round = a.state === "judgment" && a.read ? (a.round || 1) + 1 : a.round || 1;
  Object.assign(a, { team: tk, iv, read: null, round, at: null, len: end - start });
  PEOPLE[iv].load++;
  const pick = startRun(a, "Find an interviewer", `team:${tk}`, Date.now(), null, { scores: pickInterviewer(tk, a.role).replies });
  endRun(pick, now(a, "me", `Booked ${round > 1 ? `round ${round}` : "an interview"} with ${nm(iv)}: ${esc(longDay(start))}, ${esc(hm(start))}`, { run: pick }).at, "done", { chose: iv });
  const finish = () => {
    const sch = startRun(a, "Schedule the interview", iv, Date.now(), "gmail");
    a.state = "scheduled"; a.at = start; a.slotTimes = null;
    endRun(sch, now(a, `bot:${iv}`, `Sent the invite from ${nm(iv)}'s Gmail. On both calendars`, { ch: "cal", run: sch }).at);
  };
  if (askFirst) {
    a.state = "asked"; a.slotTimes = [start]; a.slots = [`${WD[new Date(start).getDay()]} ${fmtTime(start)}`];
    const ask = startRun(a, `Ask ${first(iv)} to interview`, iv, Date.now(), chOf(iv));
    now(a, `bot:${iv}`, `Texted ${nm(iv)}`, { ch: chOf(iv), quote: `Can you interview ${a.name} ${longDay(start)} at ${hm(start)}? Reply Y or N`, run: ask });
    waitOn(ask, iv);
    touch(a);
    toast(`Asked ${PEOPLE[iv].name}. Booking once confirmed.`, { open: a.id });
    later(a, SPEED * 2.6, () => { endRun(ask, now(a, iv, "Y", { ch: chOf(iv), bubble: true, run: ask }).at); finish(); toast(`${first(iv)} said yes. ${a.name} is booked.`); });
  } else { finish(); touch(a); toast(`${a.name} is booked with ${PEOPLE[iv].name}`, { open: a.id }); }
}

/* ---------------- Analytics: the careers page, and the pipeline behind it ---------------- */
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const tipAttrs = (v, l) => `data-tv="${esc(v)}" data-tl="${esc(l)}" tabindex="0"`;
const CHANNELS = [["Referral", "Referred"], ["Tacit", "Sent by Tacit"], ["Careers", "Careers page"], ["LinkedIn", "LinkedIn"], ["HN", "Hacker News"]];
const SPAN = 180;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
// Daily views and applications (by channel) for every post, over the last SPAN days.
const TRAFFIC = (() => {
  const day0 = dayStart(Date.now()) - (SPAN - 1) * DAY, out = {};
  Object.entries(POST_TRAFFIC).forEach(([k, p], j) => {
    const r = rng(11 + j * 97), views = [], apps = [];
    for (let d = 0; d < SPAN; d++) {
      const ago = SPAN - 1 - d, live = ago <= p.since && ago >= (p.until || 0);
      const wd = new Date(day0 + d * DAY).getDay();
      const v = live ? Math.round(p.base * (1 + p.growth * (1 - ago / SPAN)) * (wd === 0 || wd === 6 ? 0.55 : 1) * (p.spikes.includes(ago) ? 2.6 : 1) * (0.75 + 0.5 * r())) : 0;
      const n = live ? Math.round(v * p.rate * (0.6 + 0.8 * r())) : 0;
      const by = Object.fromEntries(CHANNELS.map(([c]) => [c, 0]));
      for (let i = 0; i < n; i++) { let x = r(); for (const [c] of CHANNELS) { x -= p.mix[c]; if (x <= 0) { by[c]++; break; } } }
      views.push(v); apps.push(by);
    }
    out[k] = { views, apps };
  });
  return out;
})();
const RANGES = { week: [7, "Last 7 days"], month: [30, "Last 30 days"], quarter: [90, "Last 90 days"] };
// Totals over a window of days ending `back` days before today, optionally for one post.
function trafficIn(n, back = 0, keys = Object.keys(TRAFFIC)) {
  const from = SPAN - back - n, to = SPAN - back;
  const t = { views: 0, apps: 0, by: Object.fromEntries(CHANNELS.map(([c]) => [c, 0])) };
  keys.forEach((k) => { const tr = TRAFFIC[k]; if (!tr) return; for (let d = from; d < to; d++) { t.views += tr.views[d]; CHANNELS.forEach(([c]) => { t.by[c] += tr.apps[d][c]; t.apps += tr.apps[d][c]; }); } });
  t.warm = t.by.Referral + t.by.Tacit;
  return t;
}
const METRICS = {
  views: { name: "Page views", of: (t) => t.views, fmt: (v) => Math.round(v).toLocaleString(), unit: "" },
  apps: { name: "Applications", of: (t) => t.apps, fmt: (v) => Math.round(v).toLocaleString(), unit: "" },
  rate: { name: "Views that apply", of: (t) => (t.views ? (t.apps / t.views) * 100 : 0), fmt: (v) => `${v.toFixed(1)}%`, pts: true },
  warm: { name: "Warm applicants", of: (t) => (t.apps ? (t.warm / t.apps) * 100 : 0), fmt: (v) => `${Math.round(v)}%`, pts: true },
};
// One point per day (per week for a quarter), for this period and the one before.
function seriesFor(metric, range) {
  const n = RANGES[range][0], step = range === "quarter" ? 7 : 1, pts = Math.ceil(n / step);
  const day0 = dayStart(Date.now()) - (n - 1) * DAY;
  const make = (back) => Array.from({ length: pts }, (_, i) => METRICS[metric].of(trafficIn(Math.min(step, n - i * step), back + n - Math.min(n, (i + 1) * step))));
  const labels = Array.from({ length: pts }, (_, i) => { const d = new Date(day0 + i * step * DAY); return `${MO[d.getMonth()]} ${d.getDate()}`; });
  return { cur: make(0), prev: make(n), labels, step };
}
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
const short = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(Math.round(v * 10) / 10));
// Monotone cubic through the points, so the curve never overshoots a day.
function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return "";
  const m = [], t = [];
  for (let i = 0; i < n - 1; i++) m.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) { const dx = (pts[i + 1][0] - pts[i][0]) / 3; d += `C${pts[i][0] + dx},${pts[i][1] + t[i] * dx} ${pts[i + 1][0] - dx},${pts[i + 1][1] - t[i + 1] * dx} ${pts[i + 1][0]},${pts[i + 1][1]}`; }
  return d;
}
let LC = null;
function lineChart(metric, range) {
  const { cur, prev, labels, step } = seriesFor(metric, range);
  const cmp = !!state.anCompare, bars = state.anChart === "bar", M = METRICS[metric];
  const top = niceMax(Math.max(...cur, ...(cmp ? prev : [0])) * 1.08);
  const n = cur.length, xAt = (i) => (bars ? ((i + 0.5) / n) * 1000 : n === 1 ? 500 : (i / (n - 1)) * 1000), yAt = (v) => 300 - (v / top) * 300;
  LC = { cur, prev, labels, step, fmt: M.fmt, name: M.name, n, bars, cmp, top };
  const every = Math.ceil(n / (innerWidth < 760 ? 4 : 7));
  const line = (xs) => smoothPath(xs.map((v, i) => [xAt(i), yAt(v)]));
  return `<div class="lc">
    <div class="lc-y">${[1, 0.75, 0.5, 0.25, 0].map((f) => `<span style="top:${(1 - f) * 100}%">${M.pts ? `${short(top * f)}%` : short(top * f)}</span>`).join("")}</div>
    <div class="lc-plot" data-lc>
      ${[0, 0.25, 0.5, 0.75].map((f) => `<i class="lc-grid" style="top:${f * 100}%"></i>`).join("")}
      ${bars ? `<div class="lc-bars">${cur.map((v, i) => `<div class="lc-bcol">${cmp ? `<i class="lc-b prev" style="height:${(prev[i] / top) * 100}%"></i>` : ""}<i class="lc-b" style="height:${(v / top) * 100}%"></i></div>`).join("")}</div>`
        : `<svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="lcg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs>
          <path class="lc-area" d="${line(cur)}L1000,300L0,300Z"/>${cmp ? `<path class="lc-line prev" d="${line(prev)}"/>` : ""}<path class="lc-line" d="${line(cur)}"/></svg>
          ${n <= 31 ? cur.map((v, i) => `<i class="lc-dot" style="left:${xAt(i) / 10}%;top:${yAt(v) / 3}%"></i>`).join("") : ""}`}
      <i class="lc-cross" hidden></i><i class="lc-dot hot" hidden></i><div class="lc-tip" hidden></div>
    </div>
    <div class="lc-x">${labels.map((l, i) => (i % every === 0 ? `<span class="${xAt(i) > 940 ? "end" : ""}" style="left:${xAt(i) / 10}%">${l}</span>` : "")).join("")}</div>
  </div>`;
}
// Crosshair and tooltip: value for the nearest day, and the same day last period.
document.addEventListener("pointermove", (e) => {
  const plot = e.target.closest && e.target.closest("[data-lc]");
  $$(".lc-plot").forEach((p) => { if (p !== plot) { ["lc-cross", "lc-tip"].forEach((c) => (p.querySelector(`.${c}`).hidden = true)); p.querySelector(".lc-dot.hot").hidden = true; } });
  if (!plot || !LC) return;
  const r = plot.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const i = LC.bars ? Math.min(LC.n - 1, Math.floor(f * LC.n)) : Math.round(f * (LC.n - 1));
  const x = LC.bars ? ((i + 0.5) / LC.n) * 100 : LC.n === 1 ? 50 : (i / (LC.n - 1)) * 100, y = 100 - (LC.cur[i] / LC.top) * 100;
  const cross = plot.querySelector(".lc-cross"), dot = plot.querySelector(".lc-dot.hot"), tip = plot.querySelector(".lc-tip");
  cross.hidden = false; cross.style.left = `${x}%`;
  dot.hidden = LC.bars; dot.style.left = `${x}%`; dot.style.top = `${y}%`;
  tip.hidden = false;
  tip.innerHTML = `<span>${LC.step > 1 ? `Week of ${LC.labels[i]}` : LC.labels[i]}</span><b>${LC.fmt(LC.cur[i])}</b>${LC.cmp ? `<small>${LC.fmt(LC.prev[i])} the period before</small>` : ""}`;
  tip.style.left = `${x}%`;
  tip.classList.toggle("flip", x > 70);
});
function rankList(title, col, rows) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return `<section class="rk"><div class="rk-h"><b>${title}</b><span>${col}</span></div>
    ${rows.map((r) => `<${r.href ? `a href="${r.href}"` : "div"} class="rk-r" ${tipAttrs(`${r.v} applications`, r.name)}><i style="width:${Math.max(4, (r.v / max) * 100)}%"></i><span class="trunc">${esc(r.name)}</span><b>${r.v.toLocaleString()}</b></${r.href ? "a" : "div"}>`).join("")}</section>`;
}
function postsAnalytics() {
  const range = state.anRange || "month", metric = state.anMetric || "apps";
  const [n, label] = RANGES[range];
  const now = trafficIn(n), before = trafficIn(n, n);
  const card = (k) => {
    const M = METRICS[k], v = M.of(now), p = M.of(before);
    const d = M.pts ? v - p : p ? ((v - p) / p) * 100 : 0;
    return `<button class="kc ${metric === k ? "on" : ""}" data-act="anMetric" data-v="${k}" aria-pressed="${metric === k}"><span>${M.name}</span><b>${M.fmt(v)}</b>
      <em class="${d >= 0 ? "up" : "down"}">${ico(d >= 0 ? "chevU" : "chevD")}${M.pts ? `${Math.abs(d).toFixed(1)} pts` : `${Math.abs(d).toFixed(1)}%`}</em></button>`;
  };
  const posts = Object.keys(ROLES).map((k) => ({ name: ROLES[k].title, v: trafficIn(n, 0, [k]).apps, href: "#jobs" })).sort((a, b) => b.v - a.v);
  const chans = CHANNELS.map(([c, nm]) => ({ name: nm, v: now.by[c] })).sort((a, b) => b.v - a.v);
  return `<div class="an">
    <div class="an-head"><div><h2>Careers page</h2></div><span class="grow"></span>
      <div class="cx-seg">${Object.keys(RANGES).map((k) => `<button class="${range === k ? "on" : ""}" data-act="anRange" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
      <button class="cx-btn" data-act="anExport">${ico("download")}Export</button></div>
    <div class="kcs">${Object.keys(METRICS).map(card).join("")}</div>
    <div class="an-card">
      <div class="an-ch"><span class="an-key"><i></i>${METRICS[metric].name}${state.anCompare ? `<i class="prev"></i><span class="faint">Period before</span>` : ""}</span><span class="grow"></span>
        <div class="an-tog"><button class="${state.anChart !== "bar" ? "on" : ""}" data-act="anChart" data-v="line" aria-label="Line chart">${ico("lineC")}</button><button class="${state.anChart === "bar" ? "on" : ""}" data-act="anChart" data-v="bar" aria-label="Bar chart">${ico("chart")}</button></div>
        <button class="switch ${state.anCompare ? "on" : ""}" data-act="anCompare" role="switch" aria-checked="${!!state.anCompare}" aria-label="Compare to previous period"><i></i></button><span class="an-cmp hide-sm">Compare to previous period</span></div>
      ${lineChart(metric, range)}
      <div class="rks">${rankList("Top postings", "Applications", posts)}${rankList("Where they came from", "Applications", chans)}</div>
    </div>
  </div>`;
}

// Pipeline explorer: pick what to count, how to slice it, and how to split each bar.
const PRI_KEYS = [[1, "Urgent", "p1"], [2, "High", "p2"], [3, "Medium", "p3"], [4, "Low", "p4"], [0, "None", "p0"]];
const EX_MEASURES = {
  applicants: { name: "Applicants", unit: "applicants", of: () => 1 },
  interviews: { name: "Interviews", unit: "interviews", of: (a) => RUNS.filter((r) => r.a === a.id && r.kind === "Get the read").length + (a.state === "scheduled" ? 1 : 0) },
  runs: { name: "Grokbot runs", unit: "Grokbot runs", of: (a) => runsOf(a).length },
};
const EX_SLICES = {
  stage: { name: "Stage", groups: () => [
    ["new", "Applicant Tickets", (a) => a.state === "new"], ["testbench", "Testbench", (a) => a.state === "testbench"],
    ["routing", "With Grokbots", (a) => ["routing", "asked", "scheduling"].includes(a.state)], ["scheduled", "Interview booked", (a) => a.state === "scheduled"],
    ["debrief", "Getting the read", (a) => a.state === "debrief"], ["judgment", "Your call", (a) => a.state === "judgment"],
    ["offer", "Offer", (a) => a.state === "offer"], ["rejected", "Closed", (a) => a.state === "passed" || a.state === "rejected"],
  ].map(([k, n, f]) => ({ k, name: n, f, icon: stIcon(k) })) },
  job: { name: "Job posting", groups: () => Object.entries(ROLES).map(([k, r]) => ({ k, name: r.title, f: (a) => a.role === k, icon: teamKey(r.team) })) },
  team: { name: "Team", groups: () => Object.entries(TEAMS).map(([k, t]) => ({ k, name: t.name, f: (a) => (a.team || ROLES[a.role].team) === k, icon: teamKey(k) })) },
  interviewer: { name: "Interviewer", groups: () => Object.keys(PEOPLE).filter((id) => PEOPLE[id].team).map((id) => ({ k: id, name: PEOPLE[id].name, f: (a) => a.iv === id, icon: personAv(id) })) },
};
const EX_SEGMENTS = {
  priority: { name: "Priority", keys: PRI_KEYS, of: (a) => a.pri || 0 },
  source: { name: "Source", keys: [["Referral", "Referred", "c1"], ["Tacit", "Sent by Tacit", "c2"], ["Cold", "Applied cold", "c3"]], of: srcTag },
};
function exMenu(el, which) {
  const [map, cur] = which === "measure" ? [EX_MEASURES, state.exMeasure || "applicants"] : which === "slice" ? [EX_SLICES, state.exSlice || "stage"] : [EX_SEGMENTS, state.exSegment || "priority"];
  openMenu(el, Object.entries(map).map(([k, m]) => ({ id: k, label: m.name, checked: k === cur })), (o) => { state[{ measure: "exMeasure", slice: "exSlice", segment: "exSegment" }[which]] = o.id; render(); });
}
function pipelineExplorer() {
  const M = EX_MEASURES[state.exMeasure || "applicants"], S = EX_SLICES[state.exSlice || "stage"], G = EX_SEGMENTS[state.exSegment || "priority"];
  const rows = S.groups().map((g) => {
    const xs = APPLICANTS.filter(g.f);
    const by = G.keys.map(([k]) => sum(xs.filter((a) => G.of(a) === k).map(M.of)));
    return { ...g, by, total: sum(by) };
  });
  const total = sum(rows.map((r) => r.total));
  const most = Math.max(1, ...rows.map((r) => r.total));
  const top = most <= 40 ? Math.ceil(most / 4) * 4 : niceMax(most);
  const pick = (which, label, val) => `<label class="ex-f"><span>${label}</span><button class="ex-sel" data-act="exMenu" data-v="${which}">${esc(val)}<svg class="chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button></label>`;
  return `<div class="ex">
    <div class="ex-top"><h2>Pipeline</h2><span class="grow"></span><span class="ex-total"><b>${total}</b> ${M.unit}</span></div>
    <div class="ex-picks">${pick("measure", "Measure", M.name)}${pick("slice", "Slice", S.name)}${pick("segment", "Segment", G.name)}</div>
    <div class="ex-chart">
      <div class="ex-plot" style="--n:${rows.length}">${[0.25, 0.5, 0.75, 1].map((f) => `<i class="ex-grid" style="bottom:${f * 100}%"></i>`).join("")}
        ${rows.map((r) => `<div class="ex-col"><div class="ex-stack" style="height:${(r.total / top) * 100}%">${G.keys.map(([k, n, c], j) => (r.by[j] ? `<i class="${c}" style="flex:${r.by[j]}" ${tipAttrs(`${r.by[j]} ${n.toLowerCase()}`, `${r.name} · ${r.total} ${M.unit}`)}></i>` : "")).join("")}</div></div>`).join("")}</div>
      <div class="ex-y">${[1, 0.75, 0.5, 0.25, 0].map((f) => `<span style="bottom:${f * 100}%">${short(top * f)}</span>`).join("")}</div>
      <div class="ex-icons" style="--n:${rows.length}">${rows.map((r) => `<span title="${esc(r.name)}">${r.icon}</span>`).join("")}</div>
    </div>
    <div class="ex-table" style="--k:${G.keys.length}">
      <div class="ex-r th"><span>${S.name}</span><span>${M.name}</span>${G.keys.map(([, n, c]) => `<span><i class="sq ${c}"></i>${n}</span>`).join("")}</div>
      ${rows.map((r) => `<div class="ex-r"><span class="ex-name">${r.icon}<span class="trunc">${esc(r.name)}</span></span><span class="num">${r.total}</span>${r.by.map((v) => `<span class="num ${v ? "" : "zero"}">${v}</span>`).join("")}</div>`).join("")}
    </div>
    <div class="ex-legend">${G.keys.map(([, n, c]) => `<span><i class="sq ${c}"></i>${n}</span>`).join("")}</div>
  </div>`;
}
function analyticsPage(tab = "posts") {
  return `<div class="bar cx-bar"><h1 class="cx-title">Analytics</h1>
    <div class="cx-seg"><a class="${tab === "posts" ? "on" : ""}" href="#analytics">Job Postings</a><a class="${tab === "pipeline" ? "on" : ""}" href="#analytics~pipeline">Pipeline</a></div><span class="spacer"></span></div>
  <div class="scroll" id="scroller"><div class="page anapage">${tab === "posts" ? postsAnalytics() : pipelineExplorer()}</div></div>`;
}
// One tooltip for every chart mark: the value first, then the label.
function showTip(m) {
  let tip = $("#viztip");
  if (!m) { if (tip) tip.hidden = true; return; }
  if (!tip) { tip = document.createElement("div"); tip.id = "viztip"; tip.className = "viztip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
  const b = document.createElement("b"); b.textContent = m.dataset.tv;
  const s = document.createElement("span"); s.textContent = m.dataset.tl;
  tip.replaceChildren(b, s);
  tip.hidden = false;
  const r = m.getBoundingClientRect();
  tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
}
document.addEventListener("pointerover", (e) => showTip(e.target.closest && e.target.closest("[data-tv]")));
document.addEventListener("focusin", (e) => showTip(e.target.closest && e.target.closest("[data-tv]")));


/* ---------------- motion: patch the page in place, and animate only what changed ---------------- */
// Live updates used to rebuild the whole page, which flickered and jumped. Now the new markup is
// diffed into the page (morphdom), rows that move glide with GSAP Flip, and new things ease in.
const G = window.gsap, FL = window.Flip;
if (G && FL) G.registerPlugin(FL);
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const motion = (fn) => { if (G && !calm()) { try { fn(G); } catch {} } };
// One feel everywhere: 0.2s with a slight spring, like Motion's { duration: 0.2, bounce: 0.2 }.
const DUR = 0.2, SPRING = "back.out(1.25)";
if (G) G.defaults({ duration: DUR, ease: SPRING });
const LIVE_ROWS = ".ib, .ivr, .trow, .af-r, .ck-r, .mrow, .vw-r, .card, .jp-row, .iv-r, .runrow";
const nodeKey = (n) => (n.id ? n.id : n.dataset && n.dataset.tid ? `t:${n.dataset.tid}` : undefined);
function patch(el, html) {
  if (!window.morphdom) { el.innerHTML = html; return; }
  const next = el.cloneNode(false);
  next.innerHTML = html;
  const rows = [...el.querySelectorAll(LIVE_ROWS)];
  const flip = FL && !calm() && rows.length && rows.length < 150 ? FL.getState(rows) : null;
  const added = [], bumped = [];
  morphdom(el, next, {
    childrenOnly: true,
    getNodeKey: nodeKey,
    onBeforeElUpdated: (from, to) => {
      if (from.isEqualNode(to)) return false;
      // Never overwrite what someone is typing.
      if (from === document.activeElement && (/^(INPUT|TEXTAREA)$/.test(from.tagName) || from.isContentEditable)) return false;
      if (from.classList.contains("sb-count") && from.textContent !== to.textContent) bumped.push(from);
      return true;
    },
    onNodeAdded: (n) => { if (n.nodeType === 1 && (n.matches(LIVE_ROWS) || n.matches(".drawer, .toast, .af-new, .blk"))) added.push(n); return n; },
  });
  motion((g) => {
    if (flip) FL.from(flip, { duration: DUR, ease: SPRING, targets: el.querySelectorAll(LIVE_ROWS), simple: true, prune: true });
    const fresh = added.filter((n) => n.isConnected).slice(0, 24);
    if (fresh.length) g.fromTo(fresh, { opacity: 0, y: (i, n) => (n.matches(".drawer") ? 0 : -4), x: (i, n) => (n.matches(".drawer") ? 24 : 0) }, { opacity: 1, y: 0, x: 0, duration: DUR, ease: SPRING, stagger: 0.01, clearProps: "opacity,transform" });
    if (bumped.length) g.fromTo(bumped, { scale: 1.2 }, { scale: 1, duration: DUR, ease: SPRING, clearProps: "transform" });
  });
}
// A new page eases in; the same page with a new selection only eases the reader.
// Every entrance states both ends, so elements with their own CSS fade never get stuck at 0.
const IN = (from, to) => [{ opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, scale: 1, clearProps: "opacity,transform", ...to }];
// Pages arrive whole: one quick fade, nothing staggered, nothing sliding, so nothing twitches.
function enterPage(el) { if (tour) return; motion((g) => g.fromTo(el, { opacity: 0.4 }, { opacity: 1, duration: 0.12, ease: "power1.out", clearProps: "opacity" })); }
function enterReader(sel) { if (tour) return; motion((g) => { const r = $(sel); if (r) g.fromTo(r, { opacity: 0.4 }, { opacity: 1, duration: 0.12, ease: "power1.out", clearProps: "opacity" }); }); }
// Menus, dialogs and the command menu open with a short scale and fade; toasts rise.
// Overlays, menus and toasts enter with CSS keyframes (style.css, v45), so they never wait on a tween to become visible.

/* ---------------- Views: everything you don't need every day, one click away ---------------- */
// Pages you visit now and then. Pin the ones you use to the sidebar.
const PAGE_VIEWS = [
  { id: "calendar", name: "Calendar", icon: "cal", href: "#calendar", desc: "Interviews and holds by week. Drag to book." },
  { id: "interviewers", name: "Interviewers", icon: "users", href: "#bots~people", desc: "Who interviews, their load, and their Grokbot" },
  { id: "activity", name: "Grokbot Activity", icon: "route", href: "#activity", desc: "Anything that needs you, then a log of what the Grokbots did" },
];
// Saved Pipeline filters.
const SAVED_VIEWS = [
  { id: "strong", name: "Strong Testbench", minTb: 85, desc: "Scored 85/100 or more" },
  { id: "offers", name: "Competing offers", label: "Competing offer", desc: "Applicants with another offer in hand" },
  { id: "referrals", name: "Referrals", source: "Referral", desc: "Referred by someone at Meridian" },
];
const STAGE_F = { you: (a) => STATES[a.state].court === "you", bots: (a) => ["routing", "asked", "scheduling", "debrief"].includes(a.state), booked: (a) => a.state === "scheduled", closed: (a) => !isOpen(a) };
const viewMatch = (v, a) => (!v.team || (a.team || ROLES[a.role].team) === v.team) && (!v.source || srcTag(a) === v.source) && (!v.label || labelsOf(a).includes(v.label)) && (!v.minTb || (a.tb && a.tb.state === "done" && a.tb.score >= v.minTb)) && (!v.stage || STAGE_F[v.stage](a));
const viewById = (id) => PAGE_VIEWS.find((v) => v.id === id) || SAVED_VIEWS.find((v) => v.id === id);
const viewHref = (v) => v.href || `#view~${v.id}`;
const viewIcon = (v) => (v.team ? teamKey(v.team) : ico(v.icon || "layers"));
// Pins and views you create are remembered in this browser.
const VIEWS_KEY = "tats.views.v2";
try {
  const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || "null");
  if (saved) { (saved.custom || []).forEach((v) => SAVED_VIEWS.push(v)); state.pins = new Set(saved.pins); }
} catch {}
if (!state.pins) state.pins = new Set();
function saveViews() { try { localStorage.setItem(VIEWS_KEY, JSON.stringify({ pins: [...state.pins], custom: SAVED_VIEWS.filter((v) => v.id.startsWith("v")) })); } catch {} }
function viewsPage() {
  const row = (v) => {
    const n = v.href ? "" : APPLICANTS.filter((a) => viewMatch(v, a)).length;
    const pinned = state.pins.has(v.id);
    return `<div class="vw-r" role="link" tabindex="0" data-act="openView" data-id="${v.id}">
      <span class="vw-ico">${viewIcon(v)}</span>
      <span class="vw-main" title="${esc(v.desc || "")}"><b>${esc(v.name)}</b></span>
      <span class="vw-n">${n === "" ? "" : `${n} applicant${n === 1 ? "" : "s"}`}</span>
      ${v.href ? `<span></span>` : `<button class="vw-pin ${pinned ? "on" : ""}" data-act="pinView" data-id="${v.id}" title="${pinned ? "Unpin from sidebar" : "Pin to sidebar"}" aria-label="${pinned ? "Unpin" : "Pin"} ${esc(v.name)}" aria-pressed="${pinned}">${ico("tack")}</button>`}
    </div>`;
  };
  return `<div class="bar cx-bar"><h1 class="cx-title">Views</h1><span class="spacer"></span><button class="cx-btn" data-act="newView">${ico("plus")}New view</button></div>
  <div class="scroll" id="scroller"><div class="page vws">
    <section class="vw-sec"><div class="vw-h"><b>Pages</b></div>${PAGE_VIEWS.map(row).join("")}</section>
    <section class="vw-sec"><div class="vw-h"><b>Saved views</b></div>${SAVED_VIEWS.map(row).join("")}</section>
  </div></div>`;
}
function openNewView() {
  const opt = (name, pairs) => `<select name="${name}">${pairs.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select>`;
  openForm({
    title: "New view", sub: "A saved filter on the Pipeline.", submit: "Create view",
    body: `<label class="fm-f"><span>Name</span><input name="name" placeholder="Strong infra referrals" required></label>
      <div class="fm-row"><label class="fm-f"><span>Team</span>${opt("team", [["", "Any team"], ...Object.entries(TEAMS).map(([k, t]) => [k, t.name])])}</label>
      <label class="fm-f"><span>Stage</span>${opt("stage", [["", "Any stage"], ["you", "With you"], ["bots", "With Grokbots"], ["booked", "Interview booked"], ["closed", "Closed"]])}</label></div>
      <div class="fm-row"><label class="fm-f"><span>Source</span>${opt("source", [["", "Any source"], ["Referral", "Referral"], ["Tacit", "Tacit"], ["Cold", "Cold"]])}</label>
      <label class="fm-f"><span>Label</span>${opt("label", [["", "Any label"], ...Object.keys(LABELS).map((l) => [l, l])])}</label></div>
      <label class="fm-check"><input type="checkbox" name="pin" checked> Pin to sidebar</label>`,
    onSubmit: (v) => {
      if (!v.name.trim()) return false;
      const id = `v${Date.now()}`;
      SAVED_VIEWS.push({ id, name: v.name.trim(), team: v.team || null, stage: v.stage || null, source: v.source || null, label: v.label || null, desc: [v.team && TEAMS[v.team].name, v.stage && { you: "With you", bots: "With Grokbots", booked: "Interview booked", closed: "Closed" }[v.stage], v.source, v.label].filter(Boolean).join(" · ") || "All applicants" });
      if (v.pin) state.pins.add(id);
      saveViews();
      go(`view~${id}`);
      toast(`Created ${v.name.trim()}`);
    },
  });
}

/* ---------------- sidebar: live views, agent orchestration, teams ---------------- */
// What each page showed you last time you opened it.
const sbSeen = { inbox: null, triage: null, activity: null };
const sbKeys = { inbox: () => inboxRows().filter((x) => x.inInbox).map((x) => x.iss.key), triage: () => queue().map((a) => a.id), activity: () => RUNS.filter(needsAttention).map((r) => r.id) };
const sbNew = (k) => { const seen = sbSeen[k]; return sbKeys[k]().some((id) => !seen || !seen.has(id)); };
function renderSide() {
  const r = state.route;
  const on = (c) => (c ? "on" : "");
  const nQ = queue().length;
  const attn = RUNS.filter(needsAttention).length;
  const closed = (state.sbShut ||= new Set());
  const shut = (k) => (closed.has(k) ? "shut" : "");
  const sec = (k, label, hint = "") => `<button class="sb-sec" data-act="sbSec" data-k="${k}" aria-expanded="${!closed.has(k)}" title="${hint}">${label}<svg class="tri" viewBox="0 0 8 8"><path d="M1 2.2h6L4 6Z"/></svg></button>`;
  // Counts only where they mean "this many need you", each with a plain-English tooltip.
  // No counts in the sidebar: a faint red highlight only when something new arrived since you last opened the page.
  if (r.name === "inbox") sbSeen.inbox = new Set(sbKeys.inbox());
  if (r.name === "triage") sbSeen.triage = new Set(sbKeys.triage());
  if (r.name === "bots" && (r.id === "runs" || r.id === "checks")) sbSeen.activity = new Set(sbKeys.activity());
  const item = (href, icon, label, active, dot, tone = "", tip = "") => `<a class="sb-item ${on(active)} ${dot ? "new" : ""}" href="${href}" title="${dot ? tip : label}"${dot ? ` aria-description="${esc(tip)}"` : ""}><span class="sb-ico">${icon}</span><span class="trunc">${label}</span></a>`;
  const faces = (ids) => `<span class="sb-faces" aria-hidden="true">${ids.slice(0, 3).map((id) => personAv(id)).join("")}</span>`;
  patch($("#side"), `<div class="sb">
    <div class="sb-ws"><button class="sb-org" data-act="palette"><span class="ws-logo">${ORG.initials}</span><b class="trunc">${ORG.name}</b><svg class="chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>
      <button class="icon-btn" data-act="palette" title="Search (⌘K)" aria-label="Search">${ico("search")}</button>
      <button class="icon-btn sb-toggle" data-act="sbToggle" title="${state.sbCollapsed ? "Expand" : "Collapse"} sidebar ([)" aria-label="${state.sbCollapsed ? "Expand" : "Collapse"} sidebar" aria-expanded="${!state.sbCollapsed}">${ico("sidebar")}</button></div>
    <nav class="sb-group" aria-label="Inbox">
      ${item("#home", ico("home"), "Home", r.name === "home")}
      ${item("#inbox", ico("inbox"), "Inbox", r.name === "inbox", sbNew("inbox"), "", "New in your Inbox")}
      ${item("#crm", ico("db"), "CRM", r.name === "crm")}
    </nav>
    <nav class="sb-group ${shut("top")}" aria-label="Top of Funnel">${sec("top", "Top of Funnel")}
      ${item("#jobs", ico("brief"), "Job Postings", r.name === "jobs")}
      ${item("#triage", ico("ticket"), "Applicant Tickets", r.name === "triage", sbNew("triage"), "", "New applicants since you last looked")}
      ${item("#analytics", ico("chart"), "Analytics", r.name === "analytics")}
    </nav>
    <nav class="sb-group ${shut("rt")}" aria-label="Routing and Tracking">${sec("rt", "Routing &amp; Tracking")}
      ${item("#all", ico("people"), "Pipeline", (r.name === "all" && !state.savedView) || r.name === "t" || r.name === "views")}
      ${[...state.pins].map(viewById).filter((v) => v && !v.href).map((v) => `<a class="sb-item sub ${on(r.name === "all" && state.savedView === v.id)}" href="${viewHref(v)}"><span class="sb-ico">${viewIcon(v)}</span><span class="trunc">${esc(v.name)}</span></a>`).join("")}
      ${item("#interviews", ico("mic"), "Interviews", r.name === "interviews")}
      ${item("#calendar", ico("cal"), "Calendar", r.name === "calendar")}
      ${item("#bots~people", ico("users"), "Interviewers", r.name === "bots" && r.id === "people")}
      ${item("#referrals", ico("users"), "Referrals", r.name === "referrals")}
      ${item("#activity", ico("route"), "Grokbot Activity", r.name === "bots" && (r.id === "runs" || r.id === "checks"), sbNew("activity"), "", "A Grokbot task got stuck or failed")}
    </nav>
    <div class="sb-me">${personAv(ME, "lg")}<span class="grow"><b class="trunc">${PEOPLE[ME].name}</b><span>${PEOPLE[ME].role}</span></span></div>
    <div class="sb-foot"><button class="sb-tour" data-act="tour">${ico("help")}Tutorial</button><a class="sb-tour ${on(r.name === "settings")}" href="#settings">${ico("gear")}Settings</a></div>
  </div>`);
}

/* ---------------- moves: what you can do with an applicant, as buttons or a menu ---------------- */
function statusMoves(a) {
  const m = [];
  if (a.state !== "new" && isOpen(a)) m.push({ k: "triage", label: "Back to Applicant Tickets", icon: stIcon("new"), run: () => { cancel(a); RUNS.filter((r) => r.a === a.id && !r.end).forEach((r) => endRun(r, Date.now())); a.state = "new"; a.iv = null; a.at = null; now(a, "me", "Moved back to Applicant Tickets"); touch(a); toast(`${a.name} is back in Applicant Tickets`); } });
  if (!a.tb && isOpen(a)) m.push({ k: "testbench", label: "Send Testbench", icon: stIcon("testbench"), run: () => { const undo = sendTB(a); render(); toast(`Testbench sent to ${a.name}`, { undo }); } });
  if (isOpen(a)) m.push({ k: "team", label: a.state === "judgment" ? "Next round…" : "Send to a team…", icon: stIcon("routing"), primary: a.state === "judgment", run: (el) => teamPick(el, [a.id]) });
  if (a.state === "judgment") m.push({ k: "offer", label: "Move to offer…", icon: stIcon("offer"), run: () => openOffer(a) });
  if (isOpen(a)) m.push(a.state === "new" || a.state === "testbench" ? { k: "pass", label: "Pass…", icon: stIcon("passed"), run: () => openPass(a) } : { k: "reject", label: "Reject", icon: stIcon("rejected"), run: () => openReject(a) });
  if (!isOpen(a)) m.push({ k: "reopen", label: "Reopen", icon: stIcon("new"), run: () => { a.state = "new"; now(a, "me", "Reopened"); touch(a); } });
  return m;
}
function statusMenu(anchor, a) { openMenu(anchor, statusMoves(a), (o) => o.run(anchor), { title: `${STATES[a.state].name} · move to` }); }
const moveButtons = (a, only) => statusMoves(a).filter((m) => !only || only.includes(m.k)).sort((x, y) => (only ? only.indexOf(x.k) - only.indexOf(y.k) : 0)).map((m) => `<button class="mv-btn ${m.primary ? "primary" : ""} mv-${m.k}" data-act="move" data-id="${a.id}" data-k="${m.k}">${m.label}</button>`).join("");

/* ---------------- Inbox: one row per applicant, newest first, read like email ---------------- */
const seen = new Map(), archived = new Map();
const attnRun = (a) => RUNS.find((r) => r.a === a.id && needsAttention(r));
// Only a decision or a stuck Grokbot needs you. New applicants have their own page, Applicant Tickets.
const needsYou = (a) => a.state === "judgment" || !!attnRun(a);
// The Inbox is a queue of operational issues, not of applicants. An applicant has at most one open
// issue: a Grokbot that broke, an invite drafted but not sent, someone who hasn't answered, or a
// decision that's yours. Each says what's wrong, who it's about, and the one action that fixes it.
const LATE = { invite: 2 * HR, cand: 36 * HR };
const ISSUE_KINDS = { bot: "Bot failures", invite: "Unsent invites", late: "Overdue replies", decide: "Decisions" };
const ISSUE_ICON = { bot: "alert", invite: "mail", late: "clock", decide: "flag" };
function issueOf(a) {
  if (!a || a.bulk) return null;
  const mine = RUNS.filter((r) => r.a === a.id);
  const fail = mine.find((r) => runState(r) === "failed");
  if (fail) return { k: "bot", key: fail.id, at: fail.end || fail.start, run: fail,
    what: `${botName(fail)} couldn't ${fail.kind.toLowerCase()}`, why: fail.error, who: runBot(fail).av, whoName: botName(fail),
    act: { a: "retryRun", id: fail.id, label: fail.ch === "slack" ? "Retry by email" : "Retry" } };
  const stuck = mine.find((r) => runState(r) === "stuck");
  if (stuck) return { k: "late", key: stuck.id, at: stuck.start, run: stuck, late: Date.now() - stuck.start,
    what: stuck.kind === "Get the read" ? `${first(stuck.on)} hasn't sent the read` : `${first(stuck.on)} hasn't replied`, why: `Asked ${dur(Date.now() - stuck.start)} ago`, who: personAv(stuck.on), whoName: PEOPLE[stuck.on].name,
    act: { a: "nudgeRun", id: stuck.id, label: `Nudge ${first(stuck.on)}` } };
  const sch = mine.find((r) => r.kind === "Schedule the interview" && r.status === "waiting" && !r.sent);
  if (sch && Date.now() - sch.start > LATE.invite) return { k: "invite", key: sch.id, at: sch.start, run: sch, late: Date.now() - sch.start,
    what: "Interview invite drafted, not sent", why: `In ${possessive(first(a.iv))} Gmail for ${dur(Date.now() - sch.start)}`, who: personAv(a.iv), whoName: PEOPLE[a.iv].name,
    act: { a: "sendInvite", id: a.id, label: "Send invite" } };
  if (a.state === "testbench" && a.tb.state === "sent" && Date.now() - Math.max(a.tbSent, a.candNudged || 0) > LATE.cand) return { k: "late", key: `tb-${a.id}`, at: a.tbSent, late: Date.now() - a.tbSent,
    what: `${first2(a)} hasn't started the Testbench`, why: `Sent ${dur(Date.now() - a.tbSent)} ago${a.candNudged ? ", reminded once" : ""}`, who: candAv(a), whoName: a.name,
    act: { a: "nudgeCand", id: a.id, label: `Remind ${first2(a)}` } };
  if (a.state === "judgment") return { k: "decide", key: `dec-${a.id}`, at: (TRACE[a.id] || []).at(-1).at,
    what: `Decide on ${a.name}`, why: a.read ? `${first(a.read.by)}'s read: ${a.read.verdict}` : "The read is in", who: a.read ? personAv(a.read.by) : candAv(a), whoName: a.read ? PEOPLE[a.read.by].name : a.name,
    act: { a: "ibSel", id: a.id, label: "Decide" } };
  return null;
}
// Send the drafted invite from the interviewer's Gmail, on your OK.
function sendInvite(a) {
  const r = RUNS.find((x) => x.a === a.id && x.kind === "Schedule the interview" && x.status === "waiting");
  if (!r) return;
  r.sent = true;
  ev(a, Date.now(), `bot:${a.iv}`, `Sent the invite from ${possessive(nm(a.iv))} Gmail, on your OK`, { ch: "gmail", run: r });
  waitOn(r, "cand");
  touch(a);
  toast(`Invite sent to ${a.name}`);
}
function nudgeCand(a) {
  a.candNudged = Date.now();
  ev(a, Date.now(), `bot:${ME}`, `Reminded ${esc(first2(a))} about the Testbench`, { ch: "gmail" });
  touch(a);
  toast(`Reminded ${first2(a)} about the Testbench`);
}
// The latest thing that happened, said the way a person would.
function headline(a) {
  const r = attnRun(a);
  if (r) return runState(r) === "failed" ? `${possessive(first(r.bot))} Grokbot couldn't ${r.kind.toLowerCase()}` : `No read from ${first(r.on)} in ${dur(Date.now() - r.start)}`;
  if (a.state === "judgment") return a.read ? `${first(a.read.by)} sent the read: ${a.read.verdict}` : "Back with you to decide";
  if (a.state === "new") {
    const src = srcLong(a);
    return a.tb && a.tb.state === "done" ? `${src} · Testbench ${tbScore(a)}` : src;
  }
  if (a.state === "testbench") return a.tb.state === "running" ? "Working on the Testbench" : "Testbench sent, not started yet";
  if (LIVE.includes(a.state)) return plainLine(a);
  if (a.state === "offer") return "Offer drafted for your review";
  if (a.state === "rejected") return a.iv ? `Rejection sent from ${possessive(first(a.iv))} email` : "Rejected";
  return "Passed. A kind no went out";
}
const LIVE = ["routing", "asked", "scheduling", "scheduled", "debrief"];
// One sentence a person would say about where this interview stands.
function plainLine(a) {
  const iv = a.iv && first(a.iv);
  if (a.state === "routing") return `${TEAMS[a.team].name} Grokbots are picking who interviews`;
  if (a.state === "asked") return `Texted ${iv}, waiting for a yes`;
  if (a.state === "scheduling") return a.slots ? `Offered ${a.slots.join(" or ")}` : `Invite drafted in ${iv}'s Gmail`;
  if (a.state === "scheduled") return a.at ? `Interview ${fmtWhen(a.at)} with ${iv}` : `Booked with ${iv}`;
  return `Waiting on ${iv}'s read`;
}
// Who the row is about: the Grokbot that's stuck, the interviewer who wrote, or the applicant.
function inboxAv(a) {
  const r = attnRun(a);
  if (r) return [runBot(r, "lg").av, "warn"];
  if (a.state === "judgment" && a.read) return [personAv(a.read.by, "lg"), "read"];
  if (a.state === "new") return [candAv(a, "lg"), "new"];
  if (a.state === "testbench") return [candAv(a, "lg"), "tb"];
  if (a.iv && isOpen(a)) return [botAv(a.iv, "lg"), a.state === "scheduled" ? "cal" : "bot"];
  if (a.state === "routing") return [`<span class="orch lg">${SPARK}</span>`, "bot"];
  return [candAv(a, "lg"), "done"];
}
const BADGE = { warn: "!", read: ico("quote"), new: ico("plus"), tb: ico("code"), cal: ico("cal"), bot: SPARK, done: ico("check") };
// An applicant is in the Inbox only while it has an open issue you haven't dismissed. Resolved and
// dismissed issues are listed under Done, as they were when they left.
const cleared = new Map();
const agoText = (t) => { const g = ago(t); return g === "now" ? "just now" : `${g} ago`; };
function inboxRows() {
  return APPLICANTS.map((a) => {
    const iss = issueOf(a);
    const dismissed = iss && archived.has(a.id) && archived.get(a.id) >= iss.at;
    return { a, iss, at: iss ? iss.at : 0, you: !!iss, unread: false, inInbox: !!iss && !dismissed };
  });
}
const isCleared = (x) => !x.inInbox;
const ISSUE_RANK = { bot: 0, invite: 1, late: 2, decide: 3 };
function inboxItems(f = state.ibFilter || "all") {
  if (f === "done") return [...cleared.entries()].map(([id, c]) => ({ a: A[id], iss: c.iss, at: c.at, how: c.how, inInbox: false })).sort((x, y) => y.at - x.at);
  return inboxRows().filter((x) => x.inInbox || (x.a.id === state.ibSel && x.iss)).sort((x, y) => ISSUE_RANK[x.iss.k] - ISSUE_RANK[y.iss.k] || y.iss.at - x.iss.at);
}
const unreadCount = () => inboxRows().filter((x) => x.inInbox && x.unread).length;
const inboxLeft = () => inboxRows().filter((x) => x.inInbox).length;
// A button that says its key, like Superhuman: the label, then the letter that does the same thing.
const kb = (label, key, act, id, primary) => `<button class="kb ${primary ? "primary" : ""}" data-act="${act}" data-id="${id}" title="${esc(label)} (${key})">${esc(label)}<kbd>${key}</kbd></button>`;
function issueKeys(a, i) {
  if (!i) return "";
  const fix = i.k === "decide" ? "" : kb(i.act.label, "F", i.act.a, i.act.id, true);
  return `<div class="kb-bar">${fix}${kb("Dismiss", "E", "ibDone", a.id)}${kb("Ask Grokbot", "/", "askGrok", a.id)}<a class="kb" href="#t~${a.id}" title="Open the ticket (Enter)">Open ticket<kbd>↵</kbd></a></div>`;
}
function ibRow(x, sel) {
  const a = x.a, i = x.iss, done = state.ibFilter === "done";
  const row = `<div class="ib iss ${i.k} ${sel ? "sel" : ""}" role="button" tabindex="0" data-act="ibSel" data-id="${a.id}" id="ib-${a.id}">
    <span class="ib-av ib-k ${i.k}">${ico(ISSUE_ICON[i.k])}</span>
    <span class="ib-l1"><span class="trunc ib-what">${esc(i.what)}</span></span>
    <span class="ib-l2 trunc"><span class="ib-who">${i.who}${esc(i.whoName)}</span>${i.whoName === a.name || i.k === "decide" ? "" : `<i>·</i><b data-hc="a:${a.id}">${esc(a.name)}</b>`}<i>·</i><span class="trunc">${esc(i.why || "")}</span></span>
    <span class="ib-act">${done ? `<span class="ib-how">${esc(x.how || "Done")} ${agoText(x.at)}</span><button class="icon-btn" data-act="ibRestore" data-id="${a.id}" title="Move back to Inbox" aria-label="Move back to Inbox">${ico("inbox")}</button>`
: `<span class="ib-t2">${ago(i.at)}</span><span class="ib-keys">${kb(i.k === "decide" ? "Decide" : i.act.label, "F", i.k === "decide" ? "ibSel" : i.act.a, i.act.id)}${kb("Dismiss", "E", "ibDone", a.id)}</span>`}</span>
  </div>`;
  return row;
}
const TRAY = `<svg class="ib-tray" viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="6" width="46" height="46" rx="10"/><path d="M9 34h13.5c1.4 0 2.5 1.1 2.5 2.5v.5a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-.5c0-1.4 1.1-2.5 2.5-2.5H55"/><path d="M14 52.5c0 3 2.2 5.5 5 5.5h26c2.8 0 5-2.5 5-5.5"/></svg>`;
// A stuck or failed Grokbot step: the facts in one line, and the one action that fixes it.
function blockCard(r, withRun = true) {
  const s = runState(r);
  const view = withRun ? `<a class="btn sm ghost" href="#run~${r.id}">View run</a>` : "";
  if (s === "failed") return `<section class="blk fail"><span class="blk-ico">${ico("x")}</span>
    <div class="blk-main"><b>Couldn't ${esc(r.kind.toLowerCase())}</b><span>${esc(r.error)} · ${ago(r.end || r.start)} ago</span></div>
    <div class="blk-acts">${view}<button class="btn sm primary" data-act="retryRun" data-id="${r.id}" title="${esc(r.fix || "")}">${r.ch === "slack" ? "Retry by email" : "Retry"}</button></div></section>`;
  const iv = r.on, lead = TEAMS[PEOPLE[r.bot].team].members[0];
  const nudges = r.steps.filter((e) => /^Nudged|Nudged/.test(stripTags(e.html))).length;
  return `<section class="blk wait"><span class="blk-ico">${ico("clock")}</span>
    <div class="blk-main"><b>Waiting on ${esc(possessive(first(iv)))} read</b><span>Asked ${dur(Date.now() - r.start)} ago · ${nudges ? `nudged ${nudges === 1 ? "once" : `${nudges} times`}` : "not nudged yet"}</span></div>
    <div class="blk-acts">${view}<button class="btn sm primary" data-act="nudgeRun" data-id="${r.id}" title="Reminds ${esc(first(iv))} in Slack${lead !== iv ? ` and copies ${esc(PEOPLE[lead].name)}, the team lead` : ""}">${lead !== iv ? `Nudge and copy ${esc(first(lead))}` : "Nudge again"}</button></div></section>`;
}
// The issue's fix comes first: the broken step, the unsent draft, the reminder, or the decision.
function issueCard(a, i) {
  if (i.run && (i.k === "bot" || (i.k === "late" && i.run.kind === "Get the read"))) return blockCard(i.run, false);
  if (i.k === "invite") {
    const iv = PEOPLE[a.iv];
    return `<section class="draft-card"><div class="dc-head"><span class="ib-k invite">${ico("mail")}</span><div><b>Invite drafted in ${esc(possessive(first(a.iv)))} Gmail</b><span>Waiting for ${esc(first(a.iv))} to send it · ${dur(i.late)}</span></div></div>
      <dl class="dc-mail"><dt>From</dt><dd>${esc(iv.name)} &lt;${esc(first(a.iv).toLowerCase())}@meridian.com&gt;</dd><dt>To</dt><dd>${esc(a.name)} &lt;${esc(emailOf(a))}&gt;</dd><dt>Subject</dt><dd>Interview with Meridian: ${esc(ROLES[a.role].title)}</dd></dl>
      <p class="dc-body">Hi ${esc(first2(a))}, would either of these work for a first conversation with me? ${esc((a.slots || []).join(" or "))}. Pick one and it goes on both calendars.</p>
      <div class="blk-acts"><button class="btn sm primary" data-act="sendInvite" data-id="${a.id}">Send invite</button></div></section>`;
  }
  if (i.k === "late") return `<section class="blk wait"><span class="blk-ico">${ico("clock")}</span>
    <div class="blk-main"><b>No start on the Testbench</b><span>${esc(i.why)}</span></div>
    <div class="blk-acts"><button class="btn sm primary" data-act="nudgeCand" data-id="${a.id}">Remind ${esc(first2(a))}</button></div></section>`;
  return nowPanel(a);
}
function ibReader(a) {
  const done = state.ibFilter === "done", c = done && cleared.get(a.id);
  const i = done ? c && c.iss : issueOf(a);
  return `<div class="ib-top"><button class="icon-btn ib-back" data-act="ibBack" aria-label="Back to Inbox">${ico("chevL")}</button>
      <span class="ib-crumb"><span class="trunc">${esc(a.name)}</span></span><span class="spacer"></span>
      ${done ? `<button class="cx-btn" data-act="ibRestore" data-id="${a.id}">${ico("inbox")}Move back to Inbox</button>` : ""}</div>
    <div class="r-scroll" id="scroller"><div class="ib-read">
      <header class="ib-head"><div class="grow"><h1>${esc(i ? i.what : a.name)}</h1><p><span data-hc="a:${a.id}">${esc(a.name)}</span> · ${esc(ROLES[a.role].title)}</p></div></header>
      ${done ? "" : issueKeys(a, i)}
      ${done ? `<section class="blk ok"><span class="blk-ico">${ico("check")}</span><div class="blk-main"><b>${esc(c.how)}</b><span>${agoText(c.at)}</span></div></section>` : i ? issueCard(a, i) : nowPanel(a)}
      <div class="block ib-story"><div class="block-head">Activity<a class="aside" href="#t~${a.id}">Open ticket</a></div>${storyView(a)}</div>
    </div></div>`;
}
/* ---------------- Inbox as a digest: what's worth your time from everything that happened ---------------- */
// One card. Problems that need you come first and open a pop-up with the fix already drafted;
// below them, what was decided, what got booked, and what's worth knowing.
const IB_RANGES = [[1, "1 day"], [3, "3 days"], [7, "1 week"]];
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
const ibWhen = (t) => (dayStart(t) === dayStart(Date.now()) ? hhmm(t) : `${WD[new Date(t).getDay()].slice(0, 3)} ${hhmm(t)}`);
const ISSUE_SRC = { bot: "slack", invite: "gmail", late: "slack", decide: "slack" };
function ibDigest() {
  const days = state.ibRange || 1, from = Date.now() - days * DAY, read = (state.ibRead ||= new Set());
  const needs = inboxRows().filter((x) => x.inInbox).sort((x, y) => ISSUE_RANK[x.iss.k] - ISSUE_RANK[y.iss.k] || y.iss.at - x.iss.at).map((x) => {
    const i = x.iss, a = x.a;
    const what = ({ bot: () => `${possessive(first(i.run.bot))} Grokbot couldn't send ${possessive(a.name)} interview brief.`, invite: () => `${possessive(a.name)} interview invite is drafted in ${possessive(first(a.iv))} Gmail but not sent.`,
      late: () => i.run ? `${first(i.run.on)} still owes feedback on ${a.name}, ${dur(i.late)} after the interview.` : `${a.name} hasn't started the Testbench, ${dur(i.late)} after it went out.`,
      decide: () => `${a.read ? first(a.read.by) : "The interviewer"} read ${a.name} as ${a.read ? a.read.verdict.toLowerCase() : "in"}; the next step is your call.` })[i.k]();
    const who = i.k === "late" && !i.run ? [candAv(a)] : i.k === "decide" && a.read ? [personAv(a.read.by), candAv(a)] : [i.k === "bot" ? personAv(i.run.bot) : personAv(a.iv || ME), candAv(a)];
    const names = i.k === "late" && !i.run ? a.name : `${i.k === "bot" ? PEOPLE[i.run.bot].name : PEOPLE[a.iv || ME].name}`;
    return { key: `n-${a.id}`, kind: "need", a, iss: i, src: i.k === "late" && !i.run ? "testbench" : ISSUE_SRC[i.k], what, who, meta: `${names} · ${esc(ROLES[a.role].title)} · ${ibWhen(i.at)}` };
  });
  const evs = [];
  everyone().forEach((a) => (TRACE[a.id] || []).forEach((e) => { if (e.at >= from) evs.push({ a, e }); }));
  const total = evs.length + needs.length;
  const decided = [], booked = [], fyi = [];
  evs.forEach(({ a, e }) => {
    const t = plain(e.html), key = `${a.id}-${e.at}`;
    if (read.has(key) || a.bulk) return;
    let m;
    if (e.actor === "me" && /^Assigned to/.test(t)) decided.push({ key, a, src: "grok", what: `${a.name} goes to ${TEAMS[a.team] ? TEAMS[a.team].name : "a team"} for an interview.`, who: [personAv(ME), candAv(a)], meta: `${PEOPLE[ME].name} · ${esc(ROLES[a.role].title)} · ${ibWhen(e.at)}`, at: e.at });
    else if (e.actor === "orch" && (m = t.match(/^Picked (\w+)/))) decided.push({ key, a, src: "grok", what: `${m[1]} will interview ${a.name}: ${t.split(": ")[1] || "best fit this week"}.`, who: [personAv(a.iv), candAv(a)], meta: `${TEAMS[a.team] ? TEAMS[a.team].name : ""} Grokbots · ${ibWhen(e.at)}`, at: e.at });
    else if (e.actor === "me" && /^(Rejected|Moved to offer|Passed)/.test(t)) decided.push({ key, a, src: "grok", what: /offer/.test(t) ? `${a.name} moves to an offer.` : `${a.name} is a no. The note went out from the interviewer.`, who: [personAv(ME), candAv(a)], meta: `${PEOPLE[ME].name} · ${ibWhen(e.at)}`, at: e.at });
    else if (/picked .*On both calendars/.test(t)) booked.push({ key, a, src: "cal", what: `${a.name} is booked with ${first(a.iv)}${a.at ? ` for ${fmtWhen(a.at)}` : ""}.`, who: [personAv(a.iv), candAv(a)], meta: `${PEOPLE[a.iv].name} · Calendar · ${ibWhen(e.at)}`, at: e.at });
    else if (e.actor === "tb" && /Scored/.test(t)) fyi.push({ key, a, src: "testbench", what: `${a.name} finished the Testbench: ${a.tb.score}/100, better than ${a.tb.pct}% of applicants.`, who: [candAv(a)], meta: `${a.name} · ${esc(ROLES[a.role].title)} · ${ibWhen(e.at)}`, at: e.at });
    else if (/^Read:/.test(t)) fyi.push({ key, a, src: "slack", what: `${first(a.iv)} sent a read on ${a.name}: ${(a.read || {}).verdict || "in"}.`, who: [personAv(a.iv), candAv(a)], meta: `${PEOPLE[a.iv].name} · Slack · ${ibWhen(e.at)}`, at: e.at });
  });
  const byTime = (x, y) => y.at - x.at;
  const groups = [["need", "Needs you", "alert", needs], ["decided", "Decisions made", "flag", decided.sort(byTime).slice(0, 6)], ["booked", "Booked", "cal", booked.sort(byTime).slice(0, 6)], ["fyi", "FYI", "help", fyi.sort(byTime).slice(0, 6)]].filter((g) => g[3].length);
  return { groups, total, shown: groups.reduce((n, g) => n + g[3].length, 0), infoKeys: decided.concat(booked, fyi).map((r) => r.key) };
}
const SRC_ICO = (k) => (k === "grok" ? `<span class="ibx-grok">${botAv(ME)}</span>` : CH[k] || CH.slack);
function inboxPage() {
  const d = ibDigest(), days = state.ibRange || 1;
  const row = (r) => `<div class="ibx-r ${r.kind === "need" ? "need" : ""}" role="button" tabindex="0" data-act="${r.kind === "need" ? "ibOpen" : "ibGo"}" data-id="${r.a.id}" data-tid="${r.key}">
      <span class="ibx-src">${SRC_ICO(r.src)}</span>
      <span class="ibx-m"><span class="ibx-what">${esc(r.what)}</span><span class="ibx-meta"><span class="ibx-avs">${r.who.join("")}</span>${r.meta}</span></span>
      <span class="ibx-acts"><a class="icon-btn" href="#t~${r.a.id}" title="Open the ticket" aria-label="Open the ticket">${ico("arrowUR")}</a><button class="icon-btn" data-act="ibCheck" data-id="${r.a.id}" data-k="${r.key}" data-need="${r.kind === "need" ? 1 : ""}" title="${r.kind === "need" ? "Dismiss" : "Mark read"}" aria-label="${r.kind === "need" ? "Dismiss" : "Mark read"}">${ico("check")}</button></span></div>`;
  return `<div class="scroll ibx-page" id="scroller"><section class="ibx">
    <header class="ibx-h"><div><h1>Welcome back</h1><p>${d.shown} worth your time, from ${d.total.toLocaleString()} update${d.total === 1 ? "" : "s"}</p></div>
      <div class="ibx-seg" role="tablist">${IB_RANGES.map(([n, l]) => `<button class="${days === n ? "on" : ""}" data-act="ibRange" data-v="${n}" role="tab" aria-selected="${days === n}">${l}</button>`).join("")}</div></header>
    ${d.groups.map(([k, l, ic, rows]) => `<div class="ibx-g ${k}"><div class="ibx-gh">${ico(ic)}<b>${l}</b><span>${rows.length}</span></div>${rows.map(row).join("")}</div>`).join("") || `<div class="ibx-zero">${ico("check")}<b>You're all caught up</b><span>Nothing new in the last ${IB_RANGES.find((r) => r[0] === days)[1]}.</span></div>`}
    <footer class="ibx-f"><span class="ibx-by">${botAv(ME)}Summarized by your Grokbot</span><button class="ibx-all" data-act="ibAllRead">Mark all as read</button></footer>
  </section></div>`;
}
// The pop-up: the problem, what we know, and the fix already drafted. Send does it.
function ibDraft(a, i) {
  const iv = a.iv && PEOPLE[a.iv];
  if (i.k === "bot") return { ch: "gmail", to: `${PEOPLE[i.run.bot].name} <${first(i.run.bot).toLowerCase()}@meridian.com>`, subject: `Interview brief: ${a.name}, ${ROLES[a.role].title}`,
    body: `Hi ${first(i.run.bot)},\n\nYou're meeting ${a.name} ${a.at ? fmtWhen(a.at) : "this week"}. ${a.hl}.\n\n${(a.sum || []).map((x) => `· ${x}`).join("\n")}${a.tb && a.tb.state === "done" ? `\n· Testbench ${a.tb.score}/100, better than ${a.tb.pct}% of applicants` : ""}\n\nWorth probing: how they'd own this end to end.\n\nThanks,\n${first(ME)}`,
    why: `Slack access for ${possessive(first(i.run.bot))} Grokbot expired, so the brief didn't go out. This sends it by email instead.`, send: "Send by email", act: () => retryRun(i.run) };
  if (i.k === "invite") return { ch: "gmail", to: `${a.name} <${emailOf(a)}>`, from: `${iv.name}`, subject: `Interview with Meridian: ${ROLES[a.role].title}`,
    body: `Hi ${first2(a)},\n\nWould either of these work for a first conversation? ${(a.slots || []).join(" or ")}. Pick one and it goes on both calendars.\n\n${first(a.iv)}`,
    why: `Drafted in ${possessive(first(a.iv))} Gmail ${dur(i.late)} ago and not sent. This sends it from ${possessive(first(a.iv))} account.`, send: "Send invite", act: () => sendInvite(a) };
  if (i.k === "late" && i.run) return { ch: "slack", to: `${PEOPLE[i.run.on].name} (DM)`, body: `Hey ${first(i.run.on)}, how did ${a.name} go? A yes or no and a line on why is enough. I'll take it from there.`,
    why: `The interview ended ${dur(i.late)} ago and no feedback has come in.`, send: `Send to ${first(i.run.on)}`, act: () => nudgeRun(i.run) };
  if (i.k === "late") return { ch: "gmail", to: `${a.name} <${emailOf(a)}>`, subject: "Your Meridian Testbench", body: `Hi ${first2(a)},\n\nJust checking the Testbench link reached you. It takes about ${ROLES[a.role].tbLen || "three hours"}, any time this week. Reply here if anything's in the way.\n\n${first(ME)}`,
    why: `The Testbench went out ${dur(i.late)} ago and hasn't been started.`, send: "Send reminder", act: () => nudgeCand(a) };
  return null;
}
function ibOpen(id) {
  const a = A[id], i = issueOf(a);
  if (!i) return go(`t~${id}`);
  if (i.k === "decide") {
    const r = a.read || {};
    return openForm({ title: a.name, sub: `${esc(ROLES[a.role].title)} · ${esc(r.by ? PEOPLE[r.by].name : "")}'s read: ${esc(r.verdict || "")}`, wide: true,
      body: `<blockquote class="ibp-q">“${esc(r.quote || "")}”</blockquote>${(r.notes || []).length ? `<ul class="ibp-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        <div class="ibp-dec"><button class="btn primary" data-act="advance" data-id="${a.id}" data-close>${ico("arrowR")}Next round</button><button class="btn" data-act="offer" data-id="${a.id}" data-close>Move to offer</button><button class="btn" data-act="reject" data-id="${a.id}" data-close>Reject</button><span class="grow"></span><a class="linkish" href="#t~${a.id}" data-close>Open ticket</a></div>` });
  }
  const d = ibDraft(a, i);
  openForm({ title: ({ bot: "Send the interview brief", invite: "Send the interview invite", late: i.run ? "Ask for feedback" : "Remind the candidate" })[i.k], sub: esc(d.why), wide: true, submit: d.send,
    body: `<div class="ibp-mail"><div class="ibp-hd"><span class="ibp-ch">${CH[d.ch]}${d.ch === "slack" ? "Slack" : "Gmail"}</span>${d.from ? `<span><em>From</em>${esc(d.from)}</span>` : ""}<span><em>To</em>${esc(d.to)}</span>${d.subject ? `<span><em>Subject</em>${esc(d.subject)}</span>` : ""}</div>
      <textarea name="body" rows="${d.body.split("\n").length + 1}" spellcheck="false">${esc(d.body)}</textarea></div>
      <p class="ibp-draft">${botAv(ME)}Drafted by your Grokbot. Edit anything before it goes.</p>`,
    onSubmit: () => { d.act(); toast(`${d.send.replace(/^Send( by)?/, "Sent$1").replace(/^Sent invite/, "Invite sent").replace(/^Send reminder/, "Reminder sent")}: ${a.name}`); } });
}
function ibMove(d) {
  const xs = inboxItems();
  let i = xs.findIndex((x) => x.a.id === state.ibSel);
  i = i < 0 ? 0 : Math.max(0, Math.min(xs.length - 1, i + d));
  if (!xs[i]) return;
  state.ibSel = xs[i].a.id;
  render();
  $(`#ib-${state.ibSel}`)?.scrollIntoView({ block: "nearest" });
}
function ibRestore(id) {
  archived.delete(id);
  cleared.delete(id);
  seen.set(id, 0);
  state.ibFilter = "all";
  render();
  toast(`${A[id].name} is back in your Inbox`);
}
// Acting on something that needed you (a decision, a nudge, a retry) clears it and moves to the next one.
function autoClear(id) {
  const xs = inboxItems().filter((x) => x.inInbox || x.a.id === id);
  const i = xs.findIndex((x) => x.a.id === id);
  const nx = xs[i + 1] || xs[i - 1];
  if (state.ibIss) cleared.set(id, { iss: state.ibIss, at: Date.now(), how: "Resolved" });
  archived.set(id, Date.now());
  state.ibSel = nx && nx.a.id !== id ? nx.a.id : null;
  setTimeout(() => toast(`${A[id].name} moved to Done. ${state.ibSel ? `Next: ${A[state.ibSel].name}` : "You're all caught up."}`, { undo: () => { archived.delete(id); cleared.delete(id); state.ibSel = id; } }), 0);
}
function ibDone(id) {
  const xs = inboxItems();
  const i = xs.findIndex((x) => x.a.id === id);
  const prev = archived.get(id), wasSel = state.ibSel;
  const iss = issueOf(A[id]);
  if (iss) cleared.set(id, { iss, at: Date.now(), how: "Dismissed" });
  archived.set(id, Date.now());
  if (state.ibSel === id) { const nx = xs[i + 1] || xs[i - 1]; state.ibSel = nx ? nx.a.id : null; }
  render();
  toast(`Dismissed: ${A[id].name}`, { undo: () => { prev ? archived.set(id, prev) : archived.delete(id); cleared.delete(id); state.ibSel = wasSel; } });
}

/* ---------------- Applicant Tickets: one email each, a reply ready ---------------- */
const MODES = [["interview", "Interview", "I"], ["testbench", "Testbench", "T"], ["decline", "Decline", "D"]];
function suggestMode(a) {
  if (!a.tb) return "testbench";
  if (a.tb.state !== "done") return "interview";
  return a.tb.score < 70 ? "decline" : "interview";
}
function draftFor(a, mode, tk) {
  const role = ROLES[a.role].title;
  if (mode === "interview") return `Hi ${first2(a)},\n\nThanks for applying for the ${role} role${a.tb && a.tb.state === "done" ? ", and for the time you put into the Testbench" : ""}. The ${TEAMS[tk].name} team would like to meet you. Someone from the team will email you a few times this week.\n\nPriya`;
  if (mode === "testbench") return `Hi ${first2(a)},\n\nThanks for applying for the ${role} role. Before we talk, we'd like you to try a short take-home in a real coding environment: ${ROLES[a.role].tb.toLowerCase()} (${ROLES[a.role].tbLen}). Do it whenever suits you this week. The link is below.\n\nPriya`;
  return `Hi ${first2(a)},\n\nThank you for applying for the ${role} role, and for your interest in Meridian. We've looked closely and decided not to move forward right now.${a.tb && a.tb.state === "done" ? " Thank you for taking the Testbench." : ""} We'd be glad to hear from you again in the future.\n\nPriya`;
}
function triState(q) {
  const t = (state.tri ||= {});
  if (!q.some((a) => a.id === t.sel)) { t.sel = q[0] && q[0].id; t.mode = null; t.draft = null; }
  const a = A[t.sel];
  if (a && !t.mode) { t.mode = suggestMode(a); t.team = ROLES[a.role].team; t.draft = null; }
  return t;
}
function mrow(a, sel) {
  const tb = a.tb && a.tb.state === "done" ? ` · <span class="m-tb" title="Testbench score, better than ${a.tb.pct}% of applicants">Testbench ${tbScore(a)}</span>` : "";
  return `<button class="mrow ${sel ? "sel" : ""}" data-act="triSel" data-id="${a.id}" id="m-${a.id}">
    ${candAv(a, "lg")}
    <span class="m1"><b class="trunc" data-hc="a:${a.id}">${esc(a.name)}</b><span class="mt">${ago(a.when)}</span></span>
    <span class="m2 trunc">${srcKind(a.src) !== "cold" ? `<span class="m-src ${srcKind(a.src)}" title="${esc(srcText(a.src))}">${srcKind(a.src) === "tacit" ? "Tacit" : esc(a.src)}</span>` : ""}${esc(ROLES[a.role].title)}${tb}</span>
  </button>`;
}
const filesOf = (a) => [
  { k: "resume", name: `${a.name.split(" ")[1].toLowerCase()}-resume.pdf`, sub: "Resume · 2 pages", tone: "pink" },
  ...(a.role === "res" ? [{ k: "research", name: "research-statement.pdf", sub: "Research · 4 pages", tone: "lav" }] : []),
  ...(a.tb && a.tb.state === "done" ? [{ k: "testbench", name: "Testbench report", sub: `${a.tb.score} · ${a.tb.time}`, tone: "mint" }] : []),
];
function stepsOf(a) {
  const tbDone = a.tb && a.tb.state === "done";
  return [
    { n: "Applied", s: "done" },
    { n: tbDone ? `Testbench ${tbScore(a)}` : "Testbench", s: tbDone ? "done" : a.tb ? "now" : "next" },
    { n: "Interview", s: "next" },
    { n: "Your call", s: "next" },
    { n: "Offer", s: "next" },
  ];
}
// Everything an applicant sent, as one document: resume, research statement, their note, the Testbench report.
const SCHOOLS = [["UC Berkeley", "B.S. Electrical Engineering and Computer Science"], ["Carnegie Mellon", "B.S. Computer Science"], ["University of Waterloo", "B.Math, Computer Science"], ["MIT", "S.B. Computer Science"], ["Georgia Tech", "M.S. Computer Science"], ["UIUC", "B.S. Computer Engineering"]];
const eduOf = (a) => { const h = [...a.name].reduce((s, c) => s + c.charCodeAt(0), 0); const [sch, deg] = SCHOOLS[h % SCHOOLS.length]; return { sch, deg, yr: 2025 - (a.yrs || 4) - 1 }; };
const SESSIONS = {
  eng: [["$", "pytest tests/test_limiter.py -q"], ["", "....F......."], ["err", "FAILED test_burst_refill: assert 98 == 100"], ["$", "git diff --stat"], ["", " limiter.py | 24 +++++++-----"], ["$", "pytest -q"], ["ok", "12 passed in 1.84s"]],
  res: [["$", "python run_eval.py --suite gsm8k"], ["", "accuracy 0.913 (expected ~0.71)"], ["$", "grep -n strip eval/harness.py"], ["", "88:  answer = out.strip().split()[-1]"], ["$", "python run_eval.py --suite gsm8k"], ["ok", "accuracy 0.712, leak fixed"]],
  pe: [["$", "npm test settings"], ["err", "✕ saves on blur (34 ms)"], ["$", "git diff --stat"], ["", " SettingsForm.tsx | 41 +++++++++++------"], ["$", "npm test settings"], ["ok", "✓ 9 tests passed"]],
};
function docPages(a) {
  const role = ROLES[a.role], ed = eduOf(a), pages = [];
  pages.push({ k: "resume", name: "Resume", html: `<header class="pg-head"><h1>${esc(a.name)}</h1><p>${esc(emailOf(a))} · ${esc(a.loc)}${a.links.length ? ` · ${a.links.map(esc).join(" · ")}` : ""}</p></header>
    <h2>Experience</h2>${a.exp.length ? a.exp.map(([co, ti, yr]) => `<div class="pg-row"><b>${esc(co)}</b><span>${esc(ti)}</span><em>${esc(yr)}</em></div>`).join("") : `<p>Student</p>`}
    <h2>Highlights</h2><ul>${a.sum.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <h2>Education</h2><div class="pg-row"><b>${esc(ed.sch)}</b><span>${esc(ed.deg)}</span><em>${ed.yr}</em></div>` });
  if (a.role === "res") pages.push({ k: "research", name: "Research statement", html: `<header class="pg-head"><h1>Research statement</h1><p>${esc(a.name)} · ${esc(role.title)}</p></header>
    <p>${esc(a.sum[0])}. That work taught me most of what I know about where evaluation quietly goes wrong: the metric moves, and nobody can say whether the model got better or the harness got easier.</p>
    <p>The thread through all of my work is measurement. I would rather ship one eval the team trusts than five it argues about.</p>
    <h2>What I want to work on</h2><p>How reward models fail under distribution shift, and how evals can catch that before a model ships. Concretely: held-out perturbation suites, contamination checks that run on every training mix, and graders that report their own uncertainty.</p>
    <h2>Why here</h2><p>Your post-training team publishes its evals and its mistakes. That is rare, and it is the environment where this kind of work compounds.</p>` });
  if (a.note) pages.push({ k: "note", name: `Note from ${first2(a)}`, html: `<header class="pg-head"><h1>Note</h1><p>From ${esc(a.name)} · sent with the application</p></header>${esc(a.note).split("\n\n").map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}` });
  if (a.tb && a.tb.state === "done") {
    const t = a.tb, ses = SESSIONS[a.role] || SESSIONS.eng;
    pages.push({ k: "testbench", name: "Testbench report", html: `<header class="pg-head"><h1>Testbench report</h1><p>${esc(role.tb)} · ${esc(role.tbLen)} · finished in ${esc(t.time)}</p></header>
      <div class="pg-score"><b>${t.score}<small>/100</small></b><span>Better than ${t.pct}% of applicants<br><em>${esc(t.pass)}</em></span></div>
      <h2>Rubric</h2>${Object.entries(t.rubric).map(([k, v]) => `<div class="pg-rub"><span>${esc(k)}</span><i><b style="width:${v * 20}%"></b></i><em>${v} / 5</em></div>`).join("")}
      ${t.note ? `<h2>Reviewer note</h2><p>${esc(t.note)}</p>` : ""}
      <h2>From the session</h2><pre class="pg-term">${ses.map(([k, l]) => `<span class="${k === "$" ? "cmd" : k}">${k === "$" ? "$ " : ""}${esc(l)}</span>`).join("\n")}</pre>` });
  }
  return pages;
}
function docViewer(a) {
  const pages = docPages(a), z = state.dvZoom || 1;
  const file = `${a.name.toLowerCase().replace(/\s+/g, "-")}-application.pdf`;
  return `<div class="dv">
    <div class="dv-bar dv-float">
      <button class="icon-btn" data-act="dvZoom" data-d="-1" aria-label="Zoom out" title="Zoom out">${ico("minus")}</button><span class="dv-z">${Math.round(z * 100)}%</span><button class="icon-btn" data-act="dvZoom" data-d="1" aria-label="Zoom in" title="Zoom in">${ico("plus")}</button>
      <i class="dv-sep"></i><button class="icon-btn" data-act="dvDownload" data-k="${file}" aria-label="Download" title="Download ${esc(file)}">${ico("download")}</button></div>
    <div class="dv-body">
      <nav class="dv-rail" aria-label="Pages">${pages.map((p, i) => `<button class="dv-th ${i ? "" : "on"}" data-act="dvGo" data-i="${i}"><span class="dv-mini"><i></i><i></i><i></i><i></i><i></i></span><span>${esc(p.name)}</span></button>`).join("")}</nav>
      <div class="dv-pages" id="dvPages" style="--z:${z}">${pages.map((p, i) => `<article class="pg pg-${p.k}" data-i="${i}">${p.html}<footer>${esc(a.name)} · ${i + 1} / ${pages.length}</footer></article>`).join("")}</div>
    </div>
  </div>`;
}
// Keep the page counter and the rail in step with scrolling.
document.addEventListener("scroll", (e) => {
  const el = e.target;
  if (!el || el.id !== "dvPages") return;
  const pgs = $$(".pg", el), top = el.scrollTop + 40;
  let i = 0;
  pgs.forEach((p, j) => { if (p.offsetTop - el.offsetTop <= top) i = j; });
  const lbl = $(".dv-pg"); if (lbl) lbl.textContent = `Page ${i + 1} of ${pgs.length}`;
  $$(".dv-th").forEach((b, j) => b.classList.toggle("on", j === i));
}, true);
function triagePage() {
  const q = queue();
  const t = triState(q);
  const a = A[t.sel];
  const head = `<div class="bar cx-bar"><h1 class="cx-title">Applicant Tickets</h1><span class="faint tk-count">${q.length}</span><span class="spacer"></span></div>`;
  if (!a) return `${head}<div class="scroll"><div class="tri-done">${ico("check", "ico big")}<h2>No new applicants</h2><p>Every applicant ticket has been answered.</p><a class="btn" href="#inbox">Back to Inbox</a></div></div>`;
  const draft = t.draft ?? draftFor(a, t.mode, t.team);
  const sendLabel = t.mode === "interview" ? `Send and assign to ${TEAMS[t.team].name}` : t.mode === "testbench" ? "Send Testbench" : "Send decline";
  return `<div class="inbox2 tk tk-nohead ${state.dvFull ? "dv-full" : ""}">
    <div class="mlist" id="mlist">${Object.keys(TEAMS).map((tk) => { const xs = q.filter((x) => ROLES[x.role].team === tk);
      return xs.length ? `<div class="m-team">${teamKey(tk)}<b>${esc(TEAMS[tk].name)}</b><span>${xs.length}</span></div>${xs.map((x) => mrow(x, x.id === a.id)).join("")}` : ""; }).join("")}</div>
    <div class="reader" id="reader">
      ${docViewer(a)}
      <div class="composer2 cp ${t.mode} ${state.triEdit ? "open" : ""}">
        <div class="cp-top">
          <div class="cp-f"><span class="cp-l">Next step</span><div class="cx-seg act-glow" title="Pick what happens next">${MODES.map(([k, n, key]) => `<button class="${t.mode === k ? "on" : ""}" data-act="triMode" data-v="${k}" title="${n} (${key})">${n}</button>`).join("")}</div>
            ${t.mode === suggestMode(a) ? `<span class="sugg" title="Recommended for this applicant">Recommended</span>` : ""}</div>
          ${t.mode === "interview" ? `<div class="cp-f"><span class="cp-l">Team</span><button class="chip" data-act="triTeam">${teamKey(t.team)}${TEAMS[t.team].name}<svg class="chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button></div>` : ""}
        </div>
        <div class="cp-main">
          ${state.triEdit ? `<div class="cp-msg editing"><div class="cp-msg-h"><span>To ${esc(a.name)} · from ${esc(first(ME).toLowerCase())}@meridian.com</span><button class="linkish" data-act="triEdit">Done</button></div><textarea id="tri-draft" data-draft spellcheck="false" aria-label="Reply to ${esc(a.name)}">${esc(draft)}</textarea></div>`
            : `<button class="cp-msg" data-act="triEdit" title="Read or edit the message"><span class="cp-msg-h"><span>To ${esc(a.name)} · from ${esc(first(ME).toLowerCase())}@meridian.com</span><b>Edit</b></span><span class="cp-msg-b">${esc(draft)}</span></button>`}
          <div class="cp-send"><button class="cx-primary" data-act="triSend" title="${sendLabel} (⌘↵)">${sendLabel}</button><span class="cp-hint">⌘ ↵ to send</span></div>
        </div>
      </div>
    </div>
  </div>`;
}
function triMove(d) {
  const q = queue();
  const t = triState(q);
  const i = q.findIndex((a) => a.id === t.sel);
  const n = q[Math.max(0, Math.min(q.length - 1, i + d))];
  if (!n || n.id === t.sel) return;
  Object.assign(t, { sel: n.id, mode: null, draft: null });
  render();
  $(`#m-${n.id}`)?.scrollIntoView({ block: "nearest" });
}
function triSend() {
  const q = queue();
  const t = triState(q);
  const a = A[t.sel];
  if (!a) return;
  const i = q.indexOf(a);
  const next = q[i + 1] || q[i - 1];
  const mode = t.mode, tk = t.team;
  const row = $(`#m-${a.id}`);
  const go = () => {
    Object.assign(t, { sel: next && next.id, mode: null, draft: null });
    if (mode === "interview") {
      now(a, `bot:${ME}`, `Emailed ${esc(first2(a))}: the ${esc(TEAMS[tk].name)} team will be in touch`, { ch: "gmail" });
      assign(a, tk);
      toast(`Sent ${a.name} to ${TEAMS[tk].name}`, { open: a.id });
    } else if (mode === "testbench") {
      const undo = sendTB(a); render(); toast(`Testbench sent to ${a.name}`, { undo });
    } else {
      const undo = pass(a); render(); toast(`Declined ${a.name}. The note goes out tomorrow morning.`, { undo });
    }
  };
  if (row) { row.classList.add("leaving"); setTimeout(go, 180); } else go();
}

/* ---------------- forms: email, files, job posts, Grokbots ---------------- */
function openForm({ title, sub, body, submit, onSubmit, onChange, wide }) {
  closeLayer();
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `<div class="modal fm ${wide ? "wide" : ""}" role="dialog" aria-label="${esc(title)}"><div class="fm-head"><div><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ""}</div><button class="gbtn" data-close aria-label="Close">${GICO.x}</button></div>
    <form class="fm-body">${body}</form>
    ${submit ? `<div class="modal-foot"><span class="hint"></span><button class="btn ghost" data-close>Cancel</button><button class="cx-primary" data-send title="${submit} (⌘↵)">${submit}</button></div>` : ""}</div>`;
  $("#layer").appendChild(el);
  const send = () => { const f = new FormData($("form", el)); if (onSubmit(Object.fromEntries(f)) !== false) { closeLayer(); render(); } };
  modal = { send };
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) closeLayer(); if (e.target.closest("[data-send]")) send(); });
  $("form", el).addEventListener("submit", (e) => { e.preventDefault(); send(); });
  if (onChange) $("form", el).addEventListener("change", (e) => onChange(Object.fromEntries(new FormData($("form", el))), el, e));
  setTimeout(() => ($("input:checked", el) || $("input, textarea", el))?.focus(), 30);
}
// Sending someone to a team is a decision, so it gets a step: pick the team, see who'd likely
// interview and what happens next, then confirm. Nothing is assigned until "Send to …".
// Sending someone to a team: pick the team, then the interviewer. The usual choice is preselected,
// but it's your call; nothing is assigned until you confirm.
function openAssign(ids) {
  const xs = ids.map((id) => A[id]).filter(isOpen);
  if (!xs.length) return;
  const a = xs[0], one = xs.length === 1;
  const next = one && a.state === "judgment" && a.read;
  const round = next ? (a.round || 1) + 1 : 1;
  const def = a.team || ROLES[a.role].team;
  const met = one && a.iv ? [a.iv] : [];
  const people = (tk) => {
    const { best, replies } = pickInterviewer(tk, a.role, met);
    return { best, html: `<div class="as-people" role="radiogroup" aria-label="Interviewer">${TEAMS[tk].members.map((id) => {
      const p = PEOPLE[id], rep2 = replies.find((r) => r.id === id), ok = rep2 && rep2.ok;
      const why = met.includes(id) ? `Interviewed round ${round - 1}` : p.quiet ? p.quiet : p.load >= p.cap ? "Full this week" : p.likes === "avoids" ? "Prefers not to" : `${p.load} of ${p.cap} this week`;
      return `<label class="as-person ${ok ? "" : "off"}"><input type="radio" name="iv" value="${id}" ${id === best ? "checked" : ""} ${ok ? "" : "disabled"}>${personAv(id)}<span><b>${esc(p.name)}</b><small>${esc(why)}</small></span>${id === best ? `<em>Suggested</em>` : ""}</label>`;
    }).join("")}</div>` };
  };
  const first0 = people(def);
  const label = (iv, tk) => (one && iv ? `Ask ${first(iv)}` : `Send to ${TEAMS[tk].name}`);
  openForm({
    title: next ? `Next round for ${a.name}` : one ? `Send ${a.name} to a team` : `Send ${xs.length} applicants to a team`,
    sub: next ? `Round ${round}` : one ? esc(ROLES[a.role].title) : xs.map((x) => esc(x.name)).join(", "),
    body: `<div class="as-sec"><span class="as-l">Team</span><div class="as-teams" role="radiogroup" aria-label="Team">${Object.entries(TEAMS).map(([k, t]) => `<label class="as-team"><input type="radio" name="team" value="${k}" ${k === def ? "checked" : ""}>
        ${teamKey(k)}<span><b>${esc(t.name)}</b><small>${t.members.length} interviewers</small></span></label>`).join("")}</div></div>
      ${one ? `<div class="as-sec"><span class="as-l">Interviewer</span><div class="as-who-pick">${first0.html}</div></div>` : ""}`,
    submit: label(first0.best, def),
    onChange: (v, el, e) => {
      if (one && e && e.target.name === "team") { const pp = people(v.team); $(".as-who-pick", el).innerHTML = pp.html; v.iv = pp.best; }
      $("[data-send]", el).textContent = label(one ? v.iv || (people(v.team).best) : null, v.team);
    },
    onSubmit: (v) => {
      xs.forEach((x) => (x.state === "judgment" && x.read ? assign(x, v.team, (x.round || 1) + 1, one ? v.iv : null) : assign(x, v.team, 1, one ? v.iv : null)));
      picked.clear();
      toast(one ? `${a.name} sent to ${TEAMS[v.team].name}${v.iv ? `. Asking ${PEOPLE[v.iv].name}.` : ""}` : `${xs.length} applicants sent to ${TEAMS[v.team].name}`);
    },
  });
}
function openOffer(a) {
  const r = a.read;
  openForm({
    title: `Move ${a.name} to offer?`,
    sub: `${esc(ROLES[a.role].title)}${r ? ` · ${esc(possessive(first(r.by)))} read: ${esc(r.verdict)}` : ""}`,
    body: `<p class="as-next">A draft offer is created in your Gmail for review. Nothing is sent to ${esc(first2(a))} until you send it.</p>
      <label class="fm-f"><span>Anything the draft should mention</span><textarea name="note" rows="3" placeholder="Start date, level, anything from the interviews"></textarea></label>`,
    submit: "Move to offer",
    onSubmit: () => { offer(a); toast(`${a.name} moved to offer. The draft will be in your Gmail.`); },
  });
}
function openPass(a) {
  openForm({
    title: `Pass on ${a.name}?`,
    sub: esc(ROLES[a.role].title),
    body: `<label class="fm-f"><span>Note to ${esc(first2(a))}, sent from your email tomorrow morning</span><textarea name="note" rows="7">${esc(draftFor(a, "decline"))}</textarea></label>`,
    submit: "Pass and send note",
    onSubmit: () => { const undo = pass(a); render(); toast(`Passed on ${a.name}`, { undo }); },
  });
}
function openEmail(a) {
  openForm({
    title: `Email ${a.name}`, sub: `From priya@meridian.com`, submit: "Send",
    body: `<label class="fm-f"><span>To</span><input name="to" value="${esc(emailOf(a))}" readonly></label>
      <label class="fm-f"><span>Subject</span><input name="subject" value="Your application for ${esc(ROLES[a.role].title)}"></label>
      <label class="fm-f"><textarea name="body" rows="8">Hi ${esc(first2(a))},\n\n\n\nPriya</textarea></label>
      <div class="fm-sugg"><span>Drafts</span>${["Ask for their availability", "Share the interview format", "Check in on the Testbench"].map((x) => `<button type="button" class="chip" data-act="emailSugg" data-v="${esc(x)}">${esc(x)}</button>`).join("")}</div>`,
    onSubmit: (v) => { now(a, `bot:${ME}`, `Emailed ${esc(first2(a))}: “${esc(v.subject)}”`, { ch: "gmail" }); touch(a); toast(`Email sent to ${a.name}`); },
  });
}
const EMAIL_SUGG = {
  "Ask for their availability": (a) => `Hi ${first2(a)},\n\nWould you share a few times that work for a 45-minute call over the next week? Our Grokbot will line it up with the team.\n\nPriya`,
  "Share the interview format": (a) => `Hi ${first2(a)},\n\nA quick note on what to expect: a 45-minute technical conversation with someone from the ${TEAMS[a.team || ROLES[a.role].team].name} team, then time for your questions. No whiteboard puzzles.\n\nPriya`,
  "Check in on the Testbench": (a) => `Hi ${first2(a)},\n\nJust checking in on the Testbench. No rush at all; reply here if anything's unclear.\n\nPriya`,
};
function openFile(a, k) {
  const f = filesOf(a).find((x) => x.k === k);
  const body = k === "testbench" ? `<div class="doc">${tbPanel(a)}</div>` : k === "research" ? `<div class="doc paper"><h4>Research statement</h4><p>${esc(a.name)}</p><p>${esc(a.sum.join(". "))}. My next question is how reward models fail under distribution shift, and how evals can catch it before deployment.</p><p class="faint">Pages 2–4 summarise prior work and a proposed agenda.</p></div>`
    : `<div class="doc paper"><h4>${esc(a.name)}</h4><p class="faint">${esc(emailOf(a))} · ${esc(a.loc)} · ${a.links.map(esc).join(" · ")}</p><h5>Experience</h5>${a.exp.map(([co, ti, yr]) => `<div class="doc-row"><b>${esc(co)}</b><span>${esc(ti)}</span><span class="faint">${esc(yr)}</span></div>`).join("") || `<p class="faint">Student</p>`}<h5>Highlights</h5><ul>${a.sum.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
  openForm({ title: f.name, sub: `${esc(f.sub)} · from ${esc(a.name)}`, body, wide: true });
}
function jobsPage() {
  if (state.route.id) return jobEditor(state.route.id);
  const shut = (state.jpShut ||= new Set());
  const live = Object.values(ROLES).filter((r) => r.status !== "paused").length;
  const applied = (k) => APPLICANTS.filter((a) => a.role === k).length;
  const row = ([k, r]) => `<button class="jp-row ${r.status === "paused" ? "paused" : ""}" data-act="editJob" data-k="${k}">
      ${ico("file")}<span class="jp-t"><b>${esc(r.title)}</b><span>${r.status === "paused" ? "Paused" : esc(r.where || "On-site")}</span>${r.posted ? `<span class="jp-new">New</span>` : ""}</span>
      <span class="jp-n">${applied(k) ? `${applied(k)} in pipeline` : ""}</span>
      <span class="jp-loc">${esc(r.loc || "San Francisco")}</span><span class="jp-edit">Edit</span></button>`;
  return `<div class="bar cx-bar"><h1 class="cx-title">Job Postings</h1><span class="faint tk-count">${live} live</span><span class="spacer"></span>
    <button class="cx-btn" data-act="careersSite">${ico("arrowUR")}<span class="hide-sm">Careers page</span></button>
    <button class="icon-btn round jp-plus" data-act="newJob" title="New Job Posting" aria-label="New Job Posting">${ico("plus")}</button></div>
  <div class="scroll" id="scroller"><div class="jp">
    <h2 class="jp-hero">Careers at ${esc(ORG.name)}</h2>
    <div class="jp-list">
      <div class="jp-head">${ico("search")}<span>${Object.keys(ROLES).length} roles</span><span class="grow"></span><button class="jp-add" data-act="newJob">${ico("plus")}Add a role</button></div>
      ${Object.entries(TEAMS).map(([tk, t]) => {
        const rs = Object.entries(ROLES).filter(([, r]) => r.team === tk);
        return `<section class="jp-group ${shut.has(tk) ? "shut" : ""}">
          <div class="jp-team"><button class="jp-fold" data-act="jpFold" data-k="${tk}" aria-expanded="${!shut.has(tk)}"><svg class="chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>${ico("folder")}<b>${esc(t.name)}</b><span>${rs.length}</span></button>
            <button class="jp-tplus" data-act="newJob" data-team="${tk}" title="Add a role to ${esc(t.name)}" aria-label="Add a role to ${esc(t.name)}">${ico("plus")}</button></div>
          ${shut.has(tk) ? "" : rs.map(row).join("")}
        </section>`;
      }).join("")}
    </div>
  </div></div>`;
}
// A role's posting, edited the way an applicant sees it: click any text and type over it.
const JOB_COPY = {
  infra: { intro: "Build and run the systems our models train and serve on.", does: ["Own services end to end, from design to on-call", "Make training and inference faster and cheaper", "Work closely with research on what to build next"], fit: ["You've run production systems at scale", "You like writing things down", "You'd rather fix the root cause than the symptom"] },
  research: { intro: "Make our models better, and prove it with evals the team trusts.", does: ["Design and run post-training experiments", "Build evals that catch regressions before they ship", "Write up what worked, and what didn't"], fit: ["You've trained or evaluated large models", "You care how a number was measured", "You read a codebase and a paper with the same care"] },
  product: { intro: "Shape what customers see and touch, from the first screen to the last detail.", does: ["Build the product's front end and the APIs behind it", "Turn rough ideas into polished, fast interfaces", "Talk to users and ship changes the same week"], fit: ["You have product work you're proud of", "You notice details others miss", "You're as happy in TypeScript as in a design file"] },
};
const JOB_QS = [{ q: "Are you authorized to work in the US?", kind: "yesno", req: true }, { q: "Will you need visa sponsorship now or in the future?", kind: "yesno", req: true }, { q: "Earliest start date", kind: "date", req: true }];
const Q_KINDS = [["yesno", "Yes / No"], ["text", "Short answer"], ["date", "Date"]];
const JOB_PICKS = { type: ["Full time", "Part time", "Contract", "Internship"], where: ["On-site", "Hybrid", "Remote"] };
function jobDraft(k) {
  if (state.job && state.job.k === k) return state.job;
  const r = k === "new" ? null : ROLES[k], team = r ? r.team : state.jobTeam || "infra", c = JOB_COPY[team] || JOB_COPY.infra;
  return (state.job = {
    k, tab: "overview", preview: false, title: r ? r.title : "", team, status: (r && r.status) || "live",
    loc: (r && r.loc) || "San Francisco", type: (r && r.type) || "Full time", where: (r && r.where) || "On-site", comp: (r && r.comp) || "$180K – $240K", equity: r && r.equity != null ? r.equity : "Offers equity",
    intro: (r && r.intro) || c.intro, does: [...((r && r.does) || c.does)], fit: [...((r && r.fit) || c.fit)], steps: [...((r && r.steps) || state.process.slice(1, -1))],
    qs: ((r && r.qs) || JOB_QS).map((q) => ({ ...q })), tb: (r && r.tb) || "", tbLen: (r && r.tbLen) || "3 hours",
  });
}
function jobEditor(k) {
  const d = jobDraft(k), pv = d.preview;
  const ed = (f, v, ph, i) => `<span class="je-ed" data-f="${f}"${i != null ? ` data-i="${i}"` : ""} data-ph="${esc(ph)}" contenteditable="${pv ? "false" : "true"}" spellcheck="false">${esc(v)}</span>`;
  const pick = (f, opts, v) => (pv ? esc(opts.find((o) => o[0] === v)?.[1] || v) : `<select class="je-sel" data-jf="${f}" aria-label="${f}">${opts.map(([val, n]) => `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`);
  const both = (xs) => xs.map((x) => [x, x]);
  const x = (f, i, what) => (pv ? "" : `<button class="je-x" data-act="jeDel" data-f="${f}" data-i="${i}" aria-label="Remove ${what}" title="Remove">${ico("x")}</button>`);
  const add = (f, label) => (pv ? "" : `<button class="je-add" data-act="jeAdd" data-f="${f}">${ico("plus")}${label}</button>`);
  const list = (f, ph) => `<ul class="je-list">${d[f].map((v, i) => `<li>${ed(f, v, ph, i)}${x(f, i, "line")}</li>`).join("")}</ul>${add(f, "Add a line")}`;
  const fact = (label, body) => `<div class="je-fact"><b>${label}</b><span>${body}</span></div>`;
  const answer = (q) => (q.kind === "yesno" ? `<span class="je-yn"><i>Yes</i><i>No</i></span>` : `<span class="je-box ${q.kind}">${q.kind === "date" ? "MM / DD / YYYY" : ""}</span>`);
  const overview = `<div class="je-doc">
      <p class="je-intro">${ed("intro", d.intro, "One or two sentences on what this person will do")}</p>
      <h3>What you'll do</h3>${list("does", "Something they'll do")}
      <h3>You might be a fit if</h3>${list("fit", "Something that makes a good fit")}
      <h3>How we hire</h3><ol class="je-steps">${d.steps.map((v, i) => `<li><em>${i + 1}</em>${ed("steps", v, "A step", i)}${x("steps", i, "step")}</li>`).join("")}</ol>${add("steps", "Add a step")}
    </div>`;
  const field = (n, req) => `<label class="je-field"><span>${n}${req ? "<i>*</i>" : ""}</span><span class="je-box"></span></label>`;
  const application = `<div class="je-doc je-app">
      ${pv ? "" : `<p class="je-fixed">Resume, About you and Why this role are on every application. Questions are yours to change.</p>`}
      <h3>Resume<i>*</i></h3><div class="je-drop">${ico("file")}<b>Drop your resume or browse</b><small>PDF or Word, up to 10 MB</small></div>
      <h3>About you</h3><div class="je-grid">${field("Name", 1)}${field("Email", 1)}${field("Phone")}${field("Location")}${field("LinkedIn", 1)}${field("Website")}</div>
      <h3>Why this role<i>*</i></h3><span class="je-box tall"></span>
      <h3>Questions</h3>
      ${d.qs.map((q, i) => `<div class="je-q"><div class="je-qh">${ed("qs", q.q, "Type a question", i)}${q.req ? "<i>*</i>" : ""}${x("qs", i, "question")}</div>${answer(q)}
        ${pv ? "" : `<div class="je-qo">${pick("kind", Q_KINDS, q.kind).replace('data-jf="kind"', `data-jf="kind" data-i="${i}"`)}<label class="je-req"><input type="checkbox" data-jf="req" data-i="${i}" ${q.req ? "checked" : ""}>Required</label></div>`}</div>`).join("")}
      ${add("qs", "Add a question")}
      <p class="je-eeo">Voluntary self-identification <span>Optional</span></p>
      <button class="je-submit" disabled>Submit application</button>
    </div>`;
  const isNew = k === "new";
  return `<div class="bar je-bar"><div class="crumbs"><a href="#jobs">Job Postings</a><span class="sep"><svg viewBox="0 0 16 16"><path d="${P.chevR}"/></svg></span><b class="je-crumb">${esc(d.title || "New role")}</b></div><span class="spacer"></span>
    <div class="cx-seg sm" role="tablist" aria-label="Mode">${[["edit", "Edit"], ["preview", "Preview as applicant"]].map(([v, n]) => `<button class="${(v === "preview") === pv ? "on" : ""}" data-act="jePreview" data-v="${v}">${n}</button>`).join("")}</div>
    <button class="chip je-status" data-act="jeStatus" title="${d.status === "paused" ? "Hidden from the careers page" : "Shown on the careers page"}"><i class="ldot" style="background:${d.status === "paused" ? "var(--faint)" : "var(--green, #3fa66b)"}"></i>${d.status === "paused" ? "Paused" : "Live"}</button>
    <button class="cx-primary je-save" data-act="jeSave">${isNew ? "Post the job" : "Save"}</button></div>
  <div class="scroll" id="scroller"><div class="je ${pv ? "pv" : ""}">
    <article class="je-sheet">
      ${pv ? "" : `<p class="je-hint">This is what applicants see. Click any text to change it.</p>`}
      <h1 class="je-title">${ed("title", d.title, "Role title")}</h1>
      <div class="je-cols">
        <aside class="je-facts">
          ${fact("Location", ed("loc", d.loc, "City"))}
          ${fact("Employment type", pick("type", both(JOB_PICKS.type), d.type))}
          ${fact("Location type", pick("where", both(JOB_PICKS.where), d.where))}
          ${fact("Department", pick("team", Object.entries(TEAMS).map(([tk, t]) => [tk, t.name]), d.team))}
          ${fact("Compensation", `${ed("comp", d.comp, "$150K – $200K")}<small>${ed("equity", d.equity, "Equity, bonus or benefits")}</small>`)}
        </aside>
        <div class="je-main">
          <div class="je-tabs" role="tablist">${[["overview", "Overview"], ["application", "Application"]].map(([v, n]) => `<button role="tab" aria-selected="${d.tab === v}" class="${d.tab === v ? "on" : ""}" data-act="jeTab" data-v="${v}">${n}</button>`).join("")}</div>
          ${d.tab === "application" ? application : overview}
        </div>
      </div>
    </article>
    ${pv ? "" : `<section class="je-private"><h4>Only your team sees this</h4>
      <div class="je-fact"><b>Testbench</b><span>${ed("tb", d.tb, "What the take-home asks them to build")}</span></div>
      <div class="je-fact"><b>Time it takes</b><span>${ed("tbLen", d.tbLen, "3 hours")}</span></div></section>`}
  </div></div>`;
}
function jeFocus(f, i) {
  const el = $(`.je [data-f="${f}"]${i != null ? `[data-i="${i}"]` : ""}`);
  if (!el) return;
  el.focus();
  const s = getSelection(); s.selectAllChildren(el); s.collapseToEnd();
}
function jeAdd(f, at) {
  const d = state.job, i = at == null ? d[f].length : at;
  d[f].splice(i, 0, f === "qs" ? { q: "", kind: "text", req: false } : "");
  render(); jeFocus(f, i);
}
function jeSave() {
  const d = state.job;
  if (!d.title.trim()) { toast("Give the role a title first"); jeFocus("title"); return; }
  let k = d.k;
  if (k === "new") { const base = d.title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "role"; k = base; for (let n = 2; ROLES[k]; n++) k = `${base}-${n}`; }
  const lines = (xs) => xs.map((s) => s.trim()).filter(Boolean);
  ROLES[k] = { ...(ROLES[k] || {}), title: d.title.trim(), team: d.team, status: d.status, loc: d.loc.trim(), type: d.type, where: d.where, comp: d.comp.trim(), equity: d.equity.trim(),
    intro: d.intro.trim(), does: lines(d.does), fit: lines(d.fit), steps: lines(d.steps), qs: d.qs.filter((q) => q.q.trim()), tb: d.tb.trim() || "A take-home in a real coding environment", tbLen: d.tbLen.trim() || "3 hours", posted: d.k === "new" || ROLES[k].posted };
  state.job = null;
  go("jobs");
  toast(d.k === "new" ? `Posted ${d.title.trim()}. Your Grokbot shared it in #hiring and on the careers page.` : "Saved");
}
const newJob = (team) => { state.job = null; state.jobTeam = team; go("jobs~new"); };
// Typing on the posting: Enter in a list starts the next line, Backspace on an empty one removes it.
document.addEventListener("keydown", (e) => {
  const el = e.target.closest && e.target.closest(".je [data-f]");
  if (!el) return;
  const f = el.dataset.f, i = el.dataset.i != null ? +el.dataset.i : null, d = state.job, many = Array.isArray(d[f]) && f !== "qs";
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (many) jeAdd(f, i + 1); else el.blur(); }
  if (e.key === "Backspace" && many && !el.textContent && d[f].length > 1) { e.preventDefault(); d[f].splice(i, 1); render(); jeFocus(f, Math.max(0, i - 1)); }
});
document.addEventListener("paste", (e) => {
  if (!e.target.closest || !e.target.closest(".je [data-f]")) return;
  e.preventDefault();
  document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
});
document.addEventListener("input", (e) => {
  const el = e.target.closest && e.target.closest(".je [data-f]");
  if (!el || !state.job) return;
  const f = el.dataset.f, v = el.textContent, i = el.dataset.i;
  if (i == null) state.job[f] = v; else if (f === "qs") state.job.qs[+i].q = v; else state.job[f][+i] = v;
  if (f === "title") $(".je-crumb").textContent = v.trim() || "New role";
});
document.addEventListener("change", (e) => {
  const f = e.target.dataset && e.target.dataset.jf;
  if (!f || !state.job) return;
  const i = e.target.dataset.i;
  if (f === "kind") state.job.qs[+i].kind = e.target.value;
  else if (f === "req") state.job.qs[+i].req = e.target.checked;
  else state.job[f] = e.target.value;
  render();
});
const BOT_COLORS = ["#5b7c99", "#8a5a83", "#4f7a6a", "#9a6b3c", "#6a5fa0"];
function openAddBot() {
  openForm({
    title: "Add a Grokbot", sub: "Their executive assistant for interviews: it asks, schedules, briefs and collects their read, over Slack or iMessage.", submit: "Send invite",
    body: `<div class="fm-row"><label class="fm-f"><span>Name</span><input name="name" placeholder="Ada Lin" required></label><label class="fm-f"><span>Work email</span><input name="email" placeholder="ada@meridian.com"></label></div>
      <div class="fm-row"><label class="fm-f"><span>Team</span><select name="team">${Object.entries(TEAMS).map(([k, t]) => `<option value="${k}" ${state.team === k ? "selected" : ""}>${t.name}</option>`).join("")}</select></label>
      <label class="fm-f"><span>Role</span><input name="role" placeholder="Senior engineer"></label></div>
      <div class="fm-f"><span>Their Grokbot reaches them on</span><div class="fm-seg">${[["slack", "Slack"], ["imessage", "iMessage"]].map(([k, n], i) => `<label><input type="radio" name="ch" value="${k}" ${i ? "" : "checked"}>${CH[k]}${n}</label>`).join("")}</div></div>
      <div class="fm-f"><span>Interviews per week</span><div class="fm-seg">${[1, 2, 3].map((n) => `<label><input type="radio" name="cap" value="${n}" ${n === 2 ? "checked" : ""}>${n}</label>`).join("")}</div></div>`,
    onSubmit: (v) => {
      if (!v.name.trim()) return false;
      const id = v.name.trim().toLowerCase().replace(/[^a-z]/g, "") + Object.keys(PEOPLE).length;
      PEOPLE[id] = { name: v.name.trim(), role: v.role || "Engineer", team: v.team, color: BOT_COLORS[Object.keys(PEOPLE).length % BOT_COLORS.length], likes: "fine", cap: +v.cap, load: 0, focus: [TEAMS[v.team].name], ch: v.ch, said: "0 of 0 yes", invited: true };
      TEAMS[v.team].members.push(id);
      render();
      toast(`Invite sent to ${v.name.trim()}`);
    },
  });
}

/* ---------------- Interviews: every recorded interview, with the read and the verdict ---------------- */
// What Granola captured, in order: who asked, the question, a one-line answer, and the words as said.
// [asker, question, short answer, kind, what was actually said]
const QA_BANK = {
  eng: [
    ["iv", "What's the system you're proudest of?", "The edge rate-limiting fleet; owned it end to end, including on-call.", "strength", "The rate-limiting fleet at the edge. I owned it end to end, design through on-call, for about two years."],
    ["iv", "How would you rate-limit a multi-tenant API so one customer can't starve the rest?", "Shard by tenant, then by time window; isolate hot tenants.", "strength", "I'd shard by tenant first, then by time, so one hot customer can't starve the rest. Hot tenants get their own bucket."],
    ["iv", "Tell me about a latency problem you fixed.", "Cut p99 from 900 to 140 ms by batching writes behind a queue.", "technical", "We were sitting around 900 milliseconds at p99. Batching the writes behind a queue got us to 140."],
    ["iv", "How would you test that?", "Hasn't written many tests for that path, and said so.", "concern", "Honestly, I haven't written many tests for that path. I'd start with a load test on the queue."],
    ["iv", "Tell me about a design decision you disagreed with.", "Argued against a cache layer, wrote it up, lost, helped ship it anyway.", "technical", "I argued against adding a cache layer. I wrote it up, lost the argument, and helped ship it anyway."],
    ["cand", "How do you decide when infra work beats product work here?", "Infra gets a fixed share each quarter; the rest is argued case by case.", "question", "There's a fixed share for infra every quarter, and the rest gets argued case by case."],
  ],
  res: [
    ["iv", "What result are you proudest of?", "A contamination check that now runs on every training mix.", "strength", "Probably the contamination check. It runs on every training mix now, and it caught two leaks last quarter."],
    ["iv", "Walk me through a time an eval misled you.", "The reward model was learning the grader's formatting, not the answer.", "strength", "The reward model was learning the grader's formatting, not the answer. Scores went up and the outputs got worse."],
    ["iv", "How did you confirm it?", "Held out a perturbed eval set; the gain dropped by half.", "technical", "We held out a perturbed eval set, and the gain dropped by half. That was enough to convince people."],
    ["iv", "What's the largest training run you've owned?", "Hasn't run anything past a few hundred GPUs personally.", "concern", "I haven't run anything past a few hundred GPUs myself. I've been close to bigger ones, but not the owner."],
    ["iv", "How do you decide what to measure first?", "Starts from the failure users notice, then builds the eval backwards.", "technical", "I start from the failure users actually notice, and build the eval backwards from there."],
    ["cand", "Who decides what ships when the evals disagree?", "The post-training lead, with the eval owners in the room.", "question", "The post-training lead makes the call, but the eval owners are always in the room."],
  ],
  pe: [
    ["iv", "What have you shipped that you're proudest of?", "Deploy-preview comments at Vercel, from prototype to GA.", "strength", "The deploy-preview comments at Vercel. I took it from a weekend prototype to GA."],
    ["iv", "A feature is half done and the deadline is Friday. What do you do?", "Ship the boring version Tuesday rather than the clever one next month.", "strength", "I'd rather ship the boring version Tuesday than the clever one next month, and say so up front."],
    ["iv", "What's a bug you were glad to kill?", "Moved form state to the server; that whole class of bugs went away.", "technical", "We moved form state to the server, and that whole class of bugs just went away."],
    ["iv", "How much of the design do you usually own?", "Has mostly built from someone else's designs.", "concern", "I've mostly built from someone else's designs. I'd like to own more of it."],
    ["iv", "How do you know a feature worked?", "Watches support tickets and one usage number per feature.", "technical", "I watch support tickets for a week, and pick one usage number per feature before it ships."],
    ["cand", "How close do engineers sit to customers here?", "Engineers join a customer call most weeks.", "question", "Pretty close. Most weeks an engineer is on a customer call."],
  ],
};
function qaOf(x) {
  const len = x.dur * 60, n = (QA_BANK[x.a.role] || QA_BANK.eng).length;
  return (QA_BANK[x.a.role] || QA_BANK.eng).map(([who, q, ans, k, said], i) => ({ who, q, ans, k, said, t: Math.round(len * (0.06 + (i / n) * 0.86) + (i * 37) % 50) }));
}
function qaList(x, max) {
  const a = x.a;
  return `<ol class="qa">${qaOf(x).slice(0, max || 99).map((m) => `<li class="qa-r k-${m.k}">
    <span class="qa-t">${mmss(m.t)}</span>
    <div class="qa-b"><p class="qa-q">${m.who === "cand" ? candAv(a) : personAv(x.iv)}<span><b>${esc(m.who === "cand" ? first2(a) : first(x.iv))}</b> ${esc(m.q)}</span></p>
      <p class="qa-a">${esc(m.ans)}</p></div>
    <span class="qa-k">${MOMENT_KIND[m.k][0]}</span></li>`).join("")}</ol>`;
}
// The full transcript, built from the Granola notes: every question and answer, as said.
function openTranscript(key) {
  const x = recByKey(key); if (!x) return;
  const a = x.a, iv = x.iv, qa = qaOf(x), len = x.dur * 60;
  const line = (t, who, txt, q) => `<div class="tr-l ${q ? "q" : ""}"><span class="tr-t">${mmss(t)}</span>${who === "cand" ? candAv(a) : personAv(iv)}<div><b>${esc(who === "cand" ? a.name : PEOPLE[iv].name)}</b><p>${esc(txt)}</p></div></div>`;
  const lines = [line(0, "iv", `Thanks for making time, ${first2(a)}. I'm ${first(iv)}, I work on ${TEAMS[x.a.team || ROLES[a.role].team].name}. I'll ask a few questions, and leave time for yours.`), line(14, "cand", "Thanks for having me. Sounds good.")];
  qa.forEach((m) => { const other = m.who === "cand" ? "iv" : "cand"; lines.push(line(m.t, m.who, m.q, true), line(m.t + 18, other, m.said)); });
  lines.push(line(len - 40, "iv", `That's everything I had. You'll hear from us soon.`), line(len - 32, "cand", "Thank you, this was fun."));
  openForm({ title: `Transcript · ${a.name}`, sub: `Round ${x.round} with ${esc(PEOPLE[iv].name)} · ${esc(`${MO[new Date(x.start).getMonth()]} ${new Date(x.start).getDate()}`)} · ${x.dur} min · from Granola`, wide: true,
    body: `<div class="tr">${lines.join("")}</div>` });
}
const MOMENT_KIND = { strength: ["Strength", "check"], technical: ["Technical", "code"], concern: ["Concern", "alert"], question: ["Question", "help"] };
const verdictOf = (v) => (!v ? "pending" : /no/i.test(v) ? "fail" : /mixed/i.test(v) ? "mixed" : "pass");
const VERDICT_NAME = { pass: "Pass", fail: "Fail", mixed: "Mixed", pending: "Read pending" };
const sentiWord = (x) => (x >= 0.7 ? "Positive" : x >= 0.5 ? "Leaning positive" : x >= 0.35 ? "Mixed" : "Negative");
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// One entry per recorded round, newest first.
function recordings() {
  const out = [];
  for (const a of APPLICANTS) {
    const rd = RUNS.filter((r) => r.a === a.id && r.kind === "Get the read");
    rd.forEach((r, i) => {
      const last = i === rd.length - 1, start = workHours(r.start - 52 * MIN);
      let read = null;
      if (!last) read = { verdict: "Yes", senti: 0.7, by: r.bot, notes: ["Advanced to the next round"], quote: "Worth another round." };
      else if (r.end) read = a.read || (a.state === "rejected" ? { verdict: "No", senti: 0.28, by: r.bot, notes: ["Struggled to go past the first design", "Good communicator", "Not the depth this role needs"], quote: "Not the depth we need for this role." } : { verdict: "Yes", senti: 0.68, by: r.bot, notes: ["Clear, structured answers", "Owned past projects end to end", "Asked good questions about the team"], quote: "Solid. Yes." });
      const h = [...a.id].reduce((s, c) => s + c.charCodeAt(0), 0) + i;
      out.push({ key: `${a.id}-${i + 1}`, a, iv: r.bot, round: (PRIOR[a.id] || []).length + i + 1, start, dur: 44 + (h % 12), read, v: verdictOf(read && read.verdict), run: r.id, cand: 52 + (h % 14) });
    });
  }
  return out.sort((x, y) => y.start - x.start);
}
const recByKey = (k) => recordings().find((x) => x.key === k);
const vPill = (v) => `<span class="vpill ${v}">${VERDICT_NAME[v]}</span>`;
// Interviews opens straight into the list and the newest interview, like the Inbox.
// Interviews are sorted by how they went, so the page reads as sentiment before any one name.
const V_ORDER = ["pass", "mixed", "fail", "pending"];
const ivList = () => recordings().slice().sort((x, y) => V_ORDER.indexOf(x.v) - V_ORDER.indexOf(y.v) || y.start - x.start);
function sentBar(xs) {
  const n = (v) => xs.filter((x) => x.v === v).length;
  const vs = V_ORDER.filter(n);
  return `<div class="iv-sent" role="img" aria-label="${vs.map((v) => `${n(v)} ${VERDICT_NAME[v]}`).join(", ")}">
    <div class="iv-bar">${vs.map((v) => `<i class="${v}" style="flex:${n(v)}" title="${n(v)} ${VERDICT_NAME[v]}"></i>`).join("")}</div>
    <div class="iv-key">${vs.map((v) => `<span><i class="${v}"></i>${VERDICT_NAME[v]}<b>${n(v)}</b></span>`).join("")}</div></div>`;
}
function interviewsPage(selKey) {
  const xs = ivList();
  const phone = innerWidth < 900;
  const sel = (selKey && xs.find((x) => x.key === selKey)) || (!phone && xs[0]);
  const head = `<div class="bar cx-bar"><h1 class="cx-title">Interviews</h1><span class="faint tk-count">${(() => { const n = xs.filter((x) => !(state.ivReviewed || new Set()).has(x.key)).length; return n ? `${n} to review` : "All reviewed"; })()}</span><span class="spacer"></span></div>`;
  return `${head}
  <div class="ivw ${sel ? "has-sel" : ""}" id="ivw">
    <div class="ivw-list" id="mlist">${sentBar(xs)}${xs.map((x, i) => { const rv = (state.ivReviewed ||= new Set()).has(x.key); return `${!i || xs[i - 1].v !== x.v ? `<div class="iv-gh" data-tid="ivgh-${x.v}"><i class="${x.v}"></i>${VERDICT_NAME[x.v]}<span>${xs.filter((y) => y.v === x.v).length}</span></div>` : ""}<div class="ivr ${sel && x.key === sel.key ? "sel" : ""} ${rv ? "rv" : ""}" role="link" tabindex="0" data-act="openRec" data-k="${x.key}" id="ivr-${x.key}">
        <span class="ivr-av">${candAv(x.a, "lg")}</span>
        <span class="ivr-l1"><b>${esc(x.a.name)}</b></span>
        <span class="ivr-l2">Round ${x.round} · ${esc(first(x.iv))} · ${esc(`${MO[new Date(x.start).getMonth()]} ${new Date(x.start).getDate()}`)}</span>
        <button class="ivr-check ${rv ? "on" : ""}" data-act="ivReview" data-k="${x.key}" title="${rv ? "Mark not reviewed" : "Mark reviewed (E)"}" aria-label="${rv ? "Mark not reviewed" : "Mark reviewed"}" aria-pressed="${rv}">${ico("check")}</button></div>`; }).join("") || `<p class="ib-none">No interviews yet.</p>`}</div>
    ${sel ? `<div class="ivw-read" id="scroller">${recReader(sel)}</div>` : ""}
  </div>`;
}
function ivStep(d) {
  const xs = ivList(), cur = state.route.id || (xs[0] && xs[0].key);
  let i = xs.findIndex((x) => x.key === cur);
  i = Math.max(0, Math.min(xs.length - 1, i + d));
  if (xs[i] && xs[i].key !== cur) go(`interviews~${xs[i].key}`);
}
// Opening an interview from the table: the table narrows into the list and the reader slides in.
function animateIvOpen() {
  const w = $("#ivw"); if (!w || !state.ivAnim) return;
  state.ivAnim = false;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || innerWidth < 760) return;
  const list = $(".ivw-list", w), read = $(".ivw-read", w), W = w.clientWidth;
  list.animate([{ flexBasis: `${W}px` }, { flexBasis: "360px" }], { duration: 200, easing: "cubic-bezier(0.3, 1.25, 0.6, 1)" });
  read.animate([{ opacity: 0, transform: "translateX(32px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(0.3, 1.25, 0.6, 1)", fill: "backwards" });
  
}
function nextSteps(x) {
  const a = x.a, iv = x.iv, d = (n) => x.start + n * DAY;
  if (!x.read) return [[`Send your read on ${first2(a)}`, iv, d(1)]];
  if (x.round < (roundsOf(a).length || 1)) return [[`Brief the round ${x.round + 1} interviewer`, iv, d(1), true]];
  if (a.state === "offer") return [["Review the offer draft", ME, d(1)], ["Reference check", iv, d(2)], [`Send the offer to ${first2(a)}`, ME, d(3)]];
  if (a.state === "rejected") return [["Send the decline note", iv, d(1), true]];
  return [[`Decide on ${first2(a)}`, ME, d(1)], ["Share the notes with the next interviewer", iv, d(1)], [`Reply to ${first2(a)}`, ME, d(2)]];
}
// The thread between the interviewer and their Grokbot after the interview, styled after AffectUI's
// Ghosted Chat: the Grokbot's messages on the right, the interviewer's replies on the left, a Read
// receipt, and when nobody has answered, the last nudge shimmers like it's been left on read.
function readThread(x) {
  const a = x.a, r = x.read, run = RUNS.find((q) => q.id === x.run);
  const ask = run && run.steps.find((e) => e.actor === `bot:${x.iv}`);
  const reply = run && run.steps.find((e) => e.bubble);
  const nudge = run && run.steps.find((e) => /Nudged/.test(stripTags(e.html)));
  const ch = CH_NAME[(run && run.ch) || "slack"];
  const when = (e) => (e ? `${sameDay(e.at, Date.now()) ? "Today" : `${WD[new Date(e.at).getDay()]} ${MO[new Date(e.at).getMonth()]} ${new Date(e.at).getDate()}`} ${fmtTime(e.at)}` : "");
  const played = (state.gcPlayed ||= new Map());
  if (!played.has(x.key)) played.set(x.key, Date.now());
  const play = Date.now() - played.get(x.key) < 4000;
  let i = 0;
  const out = (txt, cls = "") => `<div class="gc-row out" style="--i:${i++}"><div class="gc-bubble ${cls}">${txt}</div></div>`;
  const inn = (txt, first) => `<div class="gc-row in" style="--i:${i++}">${first ? `<span class="gc-av">${personAv(x.iv)}</span>` : `<span class="gc-av"></span>`}<div class="gc-col">${first ? `<span class="gc-name">${esc(PEOPLE[x.iv].name)}</span>` : ""}<div class="gc-bubble in">${txt}</div></div></div>`;
  const meta = (txt) => `<span class="gc-meta" style="--i:${i++}">${txt}</span>`;
  let body = meta(`${esc(possessive(first(x.iv)))} Grokbot · ${ch} · ${when(ask)}`);
  body += out(`How did it go with ${esc(first2(a))}? A yes or no and a line on why is enough.`);
  if (r) {
    body += meta(`Read ${reply ? fmtTime(reply.at) : ""}`);
    body += inn(esc(r.quote), true);
    if (r.notes.length > 1) {
      body += out("Anything the next interviewer should dig into?");
      body += inn(`${esc(r.notes[r.notes.length - 1])}.`, true);
    }
  } else {
    if (nudge) { body += meta(when(nudge)); body += out(`<span class="gc-alert">Following up on ${esc(first2(a))}. Even one line helps.</span>`, "last"); }
    body += meta("Read");
    body += `<div class="gc-foot" style="--i:${i++}">No reply yet</div>`;
  }
  return `<div class="gc" ${play ? "data-play" : ""}>${body}</div>`;
}
/* ---------------- the interview loop: where a candidate is, who met them, and how it went ---------------- */
// Rounds before the one on file: [team, interviewer, verdict, days ago].
const PRIOR = { "APP-109": [["infra", "sam", "pass", 9]], "APP-104": [["research", "marcus", "pass", 12], ["infra", "wei", "pass", 8]], "APP-101": [["infra", "noor", "pass", 14]], "APP-117": [["infra", "sam", "pass", 6]] };
// Every loop is three rounds: their own team, a partner team, then a final with the CTO. Then the offer.
const LOOP = 3, PARTNER = { infra: "research", research: "infra", product: "infra" };
function loopOf(a) {
  const own = a.team || ROLES[a.role].team;
  const rs = (PRIOR[a.id] || []).map(([team, iv, v, d]) => ({ team, iv, v, at: NOW - d * DAY }));
  recordings().filter((x) => x.a.id === a.id).sort((x, y) => x.round - y.round).forEach((x) => rs.push({ team: PEOPLE[x.iv].team, iv: x.iv, v: x.v, at: x.start, key: x.key }));
  const out = rs.map((r, i) => ({ ...r, n: i + 1, st: "done" }));
  if (isOpen(a)) for (let n = out.length + 1; n <= LOOP; n++) out.push({ n, team: n === LOOP ? "final" : n === 1 ? own : PARTNER[own], iv: n === LOOP ? "daniel" : null, st: "next" });
  out.push({ n: out.length + 1, team: "offer", st: a.state === "offer" ? "done" : a.state === "rejected" || a.state === "passed" ? "closed" : "next" });
  return out;
}
const loopName = (t) => (t === "final" ? "Final" : t === "offer" ? "Offer" : TEAMS[t].name);
// The loop as a path, left to right: where they've been, the one you're reading, who's next, and what's left before the offer.
function processTree(x) {
  const a = x.a, rs = loopOf(a), met = rs.filter((r) => r.st === "done" && r.iv);
  const view = rs.find((r) => r.key === x.key);
  const names = [...new Set(met.map((r) => first(r.iv)))];
  const line = `${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)} have` : `${names[0]} has`} interviewed ${first2(a)}. ${x.v === "pending" ? `Waiting on ${possessive(first(x.iv))} read.` : `${possessive(first(x.iv))} read: ${VERDICT_NAME[x.v]}.`}`;
  const nextI = rs.findIndex((r) => r.st === "next");
  // Who the Grokbot would ask for a step that isn't booked yet.
  const whoNext = (r) => r.iv || (r.team !== "offer" && TEAMS[r.team] ? pickInterviewer(r.team, a.role).best : null);
  const left = rs.filter((r) => r.st === "next" && r.team !== "offer").length;
  const tag = a.state === "offer" ? "Offer made" : !isOpen(a) ? "Closed" : left ? `${left} round${left === 1 ? "" : "s"} left before the offer` : "Next: the offer";
  const step = (r, i) => {
    const kind = r === view ? "view" : r.st === "done" ? "done" : i === nextI ? "up" : r.st === "closed" ? "closed" : "todo";
    const iv = r.st === "done" ? r.iv : whoNext(r);
    const label = r.team === "offer" ? "Offer" : `Round ${r.n} · ${loopName(r.team)}`;
    const flag = kind === "view" ? "This interview" : kind === "up" ? "Up next" : kind === "closed" ? "Closed" : "";
    const body = r.team === "offer"
      ? `<span class="pth-p">${r.st === "done" ? `${ico("check")}<b>Offer out</b>` : `<span class="pth-sub">${kind === "up" ? "Your call after the last read" : "After the last round"}</span>`}</span>`
      : iv ? `<span class="pth-p">${personAv(iv)}<span><b>${esc(PEOPLE[iv].name)}</b>${r.st === "done" ? `<span class="pt-v ${r.v}">${VERDICT_NAME[r.v]} · ${MO[new Date(r.at).getMonth()]} ${new Date(r.at).getDate()}</span>` : `<span class="pth-sub">${kind === "up" ? "Grokbot will ask" : "Not booked"}</span>`}</span></span>`
      : `<span class="pth-p"><span class="pth-sub">Not booked</span></span>`;
    const tagName = r.key && r !== view ? "a" : "div";
    return `<${tagName} class="pth-s ${kind}" ${tagName === "a" ? `href="#interviews~${r.key}"` : ""}><span class="pth-h"><span class="pt-num">${r.team === "offer" ? ico(r.st === "closed" ? "x" : "check") : r.n}</span><b>${esc(label)}</b>${flag ? `<em>${flag}</em>` : ""}</span>${body}</${tagName}>`;
  };
  const arrow = (i) => `<i class="pth-ar ${i < nextI || nextI < 0 ? "done" : i === nextI ? "up" : "todo"}" aria-hidden="true"></i>`;
  return `<section class="pth">
    <div class="pth-c"><p>${esc(line)}</p><span class="pt-tag">${tag}</span></div>
    <div class="pth-row">${rs.map((r, i) => `${i ? arrow(i) : ""}${step(r, i)}`).join("")}</div>
  </section>`;
}
// Elbow lines from the candidate to each round, and from each round to who ran it. The current path is drawn last, in the accent.
function drawTrees() {
  $$(".pt").forEach((pt) => {
    const svg = $(".pt-lines", pt), box = pt.getBoundingClientRect(), card = $(".pt-card", pt);
    if (!card || !box.width) return;
    const at = (el, side) => { const r = el.getBoundingClientRect(); return [(side === "r" ? r.right : r.left) - box.left, r.top + r.height / 2 - box.top]; };
    const path = ([x1, y1], [x2, y2], c) => { const mx = x1 + (x2 - x1) / 2, dy = y2 - y1, r = Math.min(10, Math.abs(dy) / 2), s = Math.sign(dy);
      return `<path class="${c}" d="${Math.abs(dy) < 1 ? `M${x1} ${y1}H${x2}` : `M${x1} ${y1}H${mx - r}Q${mx} ${y1} ${mx} ${y1 + s * r}V${y2 - s * r}Q${mx} ${y2} ${mx + r} ${y2}H${x2}`}"/>`; };
    const lines = [];
    $$(".pt-n.round", pt).forEach((n) => {
      const c = n.classList.contains("cur") ? "hot" : n.classList.contains("done") ? "" : "ghost";
      lines.push([c, path(at(card, "r"), at(n, "l"), c)]);
      const iv = $(`.pt-n.iv[data-n="${n.dataset.n}"]`, pt);
      if (iv) lines.push([c, path(at(n, "r"), at(iv, "l"), c)]);
    });
    svg.setAttribute("width", box.width); svg.setAttribute("height", box.height);
    svg.innerHTML = lines.sort((p, q) => (p[0] === "hot") - (q[0] === "hot")).map((l) => l[1]).join("");
  });
}
addEventListener("resize", () => { drawTrees(); $$(".cmp-inner").forEach((el) => { el.style.zoom = (el.parentElement.clientWidth - 2) / 1180; }); });
function recReader(x) {
  const a = x.a, r = x.read, key = x.key, len = x.dur * 60;
  const steps = nextSteps(x), done = (state.nsDone ||= new Set());
  const nDone = steps.filter((s, i) => s[3] || done.has(`${key}:${i}`)).length;
  return `<article class="rc">
      <header class="rc-head"><a class="icon-btn rc-back" href="#interviews" aria-label="Back to Interviews">${ico("chevL")}</a>
        <div class="grow"><h1>${esc(a.name)} · Round ${x.round}</h1><p>${esc(ROLES[a.role].title)}<i>·</i>${esc(`${MO[new Date(x.start).getMonth()]} ${new Date(x.start).getDate()}, ${new Date(x.start).getFullYear()}`)}</p></div>
        ${vPill(x.v)}<span class="stackav">${candAv(a)}${personAv(x.iv)}</span>
        <a class="icon-btn" href="#t~${a.id}" title="Open ticket" aria-label="Open ticket">${ico("arrowR")}</a>
</header>
      ${processTree(x)}
      <div class="rc-cols"><div class="rc-col">
      <section class="rc-sec grow-sec"><div class="rc-h"><b>Post-interview read</b>${r ? `<span class="spill-s">${sentiWord(r.senti)}</span>` : ""}</div>${readThread(x)}</section>
      </div><div class="rc-col">
      <section class="rc-sec"><div class="rc-h"><b>Summary</b></div>
        <ul class="rc-sum">${(r ? r.notes : [`Waiting on ${possessive(first(x.iv))} read.`]).map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>
      <section class="rc-sec"><div class="rc-h"><b>Next steps</b><span class="faint">${nDone} of ${steps.length} done</span></div>
        ${steps.map(([t, who, due, fixed], i) => { const on = fixed || done.has(`${key}:${i}`); return `<label class="rc-step ${on ? "done" : ""}"><input type="checkbox" ${on ? "checked" : ""} ${fixed ? "disabled" : ""} data-ns="${key}:${i}"><span class="grow">${esc(t)}</span><span class="rc-own">${personAv(who)}${esc(who === ME ? "You" : first(who))}</span><span class="faint">${esc(`${MO[new Date(due).getMonth()]} ${new Date(due).getDate()}`)}</span></label>`; }).join("")}</section>
      </div></div>
    </article>`;
}
// What happened in the interview, without scrubbing: a short summary, then the moments worth hearing.
const SUMMARY_BANK = {
  eng: (n) => `${n} designed a sharded rate limiter, then debugged a failing shard live.`,
  res: (n) => `${n} walked through a reward model gaming its grader and how a held-out eval caught it.`,
  pe: (n) => `${n} talked through shipping small and moving form state to the server.`,
};
// Granola notes and a question-by-question breakdown come back once an interviewer connects Granola.
function interviewHighlights() { return ""; }
document.addEventListener("change", (e) => {
  const k = e.target.dataset && e.target.dataset.ns;
  if (!k) return;
  const s = (state.nsDone ||= new Set());
  e.target.checked ? s.add(k) : s.delete(k);
  render();
});

/* ---------------- Grokbot activity: what needs you first, then a searchable log ---------------- */
const botName = (r) => (r.bot.startsWith("team:") ? `${TEAMS[r.bot.slice(5)].name} Grokbots` : r.bot === ME ? "Your Grokbot" : `${possessive(first(r.bot))} Grokbot`);
// One line per run, said the way a person would.
function feedLine(r) {
  const a = A[r.a], s = runState(r), who = `<b>${esc(botName(r))}</b>`, cand = `<b>${esc(a.name)}</b>`;
  const iv = r.bot.startsWith("team:") ? null : r.bot;
  if (s === "failed") return `${who} <em class="bad">failed to ${esc(r.kind.toLowerCase())}</em> for ${cand}`;
  if (r.kind === "Find an interviewer") return r.chose ? `${who} picked <b>${esc(PEOPLE[r.chose].name)}</b> to interview ${cand}` : `${who} are picking an interviewer for ${cand}`;
  if (r.kind.startsWith("Ask ")) return r.end ? `${who} got a yes from <b>${esc(first(iv))}</b> for ${cand}` : `${who} asked <b>${esc(first(iv))}</b> to interview ${cand}`;
  if (r.kind === "Schedule the interview") return r.end ? `${who} booked ${cand} with <b>${esc(first(iv))}</b>` : `${who} offered times to ${cand}`;
  if (r.kind === "Get the read") return r.end ? `${who} collected <b>${esc(possessive(first(iv)))}</b> read on ${cand}` : `${who} ${s === "stuck" ? `<em class="bad">is still waiting</em>` : "is waiting"} on <b>${esc(possessive(first(iv)))}</b> read on ${cand}`;
  if (r.kind === "Send the Testbench") return r.end ? `${cand} finished the Testbench sent by ${who}` : `${who} sent the Testbench to ${cand}`;
  return `${who} ${esc(r.kind.charAt(0).toLowerCase() + r.kind.slice(1))} for ${cand}`;
}
const feedAt = (r) => (r.steps.length ? r.steps.at(-1).at : r.start);
// What needs you: only failed or stuck Grokbot tasks, said plainly, each with its one fix.
function todoOf(r) {
  const a = A[r.a], s = runState(r);
  if (s === "stuck") return {
    what: r.kind === "Get the read" ? `${first(r.on)} hasn't sent a read on ${a.name}` : `${first(r.on)} hasn't replied about ${a.name}`,
    why: `Asked ${dur(Date.now() - r.start)} ago${r.nudges ? `, nudged ${r.nudges === 1 ? "once" : `${r.nudges} times`}` : ""}`,
    fix: `<button class="btn sm" data-act="nudgeRun" data-id="${r.id}">Nudge ${esc(first(r.on))}</button>`,
  };
  return {
    what: r.kind.startsWith("Send the ") ? `The ${r.kind.slice(9)} for ${a.name} didn't send` : `${r.kind} for ${a.name} didn't go through`,
    why: r.error || "",
    fix: `<button class="btn sm" data-act="retryRun" data-id="${r.id}">${r.ch === "slack" ? "Send by email" : "Try again"}</button>`,
  };
}
const feedText = (r) => `${plain(feedLine(r))} ${r.kind} ${A[r.a].team ? TEAMS[A[r.a].team].name : ""} ${ROLES[A[r.a].role].title}`.toLowerCase();
function feedPage() {
  const q = (state.actQ || "").trim().toLowerCase();
  const todos = RUNS.filter(needsAttention).sort((x, y) => x.start - y.start);
  const xs = RUNS.slice().sort((x, y) => feedAt(y) - feedAt(x)).filter((r) => !q || feedText(r).includes(q));
  let day = "";
  const dayLabel = (t) => { const d = dayStart(t), today = dayStart(Date.now()); const md = `${MO[new Date(t).getMonth()]} ${new Date(t).getDate()}`; return d === today ? `Today<span>${md}</span>` : d === today - DAY ? `Yesterday<span>${md}</span>` : `${WD[new Date(t).getDay()]}<span>${md}</span>`; };
  return `<div class="af">
    <section class="af-todo">
      <div class="af-h"><b>Needs you</b>${todos.length ? `<span>${todos.length}</span>` : ""}</div>
      ${todos.map((r) => { const t = todoOf(r); return `<div class="td-r" role="button" tabindex="0" data-act="openRun" data-id="${r.id}" data-tid="td-${r.id}">
        <span class="td-main"><b>${esc(t.what)}</b><span>${esc(t.why)}</span></span><span class="td-fix">${t.fix}</span></div>`; }).join("")
        || `<p class="td-none">${ico("check")}Nothing needs you. The Grokbots are handling the rest.</p>`}
    </section>
    <div class="af-h log"><b>Log</b><span class="grow"></span>
      <label class="cx-search">${ico("search")}<input id="actq" placeholder="Search by name" value="${esc(state.actQ || "")}" autocomplete="off"></label></div>
    <div class="af-list">${xs.map((r) => {
      const t = feedAt(r), dl = dayLabel(t), s = runState(r);
      const head = dl !== day ? `<div class="af-day">${(day = dl)}</div>` : "";
      return `${head}<div class="af-r ${state.runSel === r.id ? "sel" : ""}" role="button" tabindex="0" data-act="openRun" data-id="${r.id}" data-tid="af-${r.id}">
        <span class="af-av">${runBot(r, "lg").av}${s === "failed" || s === "stuck" ? `<i class="af-badge bad">${ico(s === "failed" ? "x" : "clock")}</i>` : ""}</span>
        <span class="af-l1">${feedLine(r)}</span><span class="af-t">${fmtTime(t)}</span></div>`;
    }).join("") || `<p class="ib-none">Nothing matches “${esc(state.actQ)}”.</p>`}</div>
  </div>`;
}

/* ---------------- Grokbots: observability for every recruiting run ---------------- */
const STUCK = 24 * HR;
const runState = (r) => (r.status === "waiting" && r.on !== "cand" && Date.now() - r.start > STUCK ? "stuck" : r.status);
const needsAttention = (r) => ["failed", "stuck"].includes(runState(r));
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const runDur = (r) => (r.end || Date.now()) - r.start;
const onWho = (r) => (r.on === "cand" ? "candidate" : r.on ? first(r.on) : "");
function runPill(r) {
  const s = runState(r);
  if (s === "running") return `<span class="spill run"><span class="ring"></span>Running</span>`;
  if (s === "waiting") return `<span class="spill wait"><span class="dot"></span>Waiting on ${esc(onWho(r))}</span>`;
  if (s === "stuck") return `<span class="spill fail"><span class="dot"></span>No reply from ${esc(onWho(r))}</span>`;
  if (s === "failed") return `<span class="spill fail">${ico("x")}Failed</span>`;
  return `<span class="spill done">${ico("check")}Done</span>`;
}
function runBot(r, size = "") {
  if (r.bot.startsWith("team:")) { const k = r.bot.slice(5); return { av: `<span class="stackav">${TEAMS[k].members.slice(0, 3).map((m) => botAv(m, size)).join("")}</span>`, name: `${TEAMS[k].name} Grokbots` }; }
  return { av: botAv(r.bot, size), name: r.bot === ME ? "Your Grokbot" : `${first(r.bot)}'s Grokbot` };
}
const RUN_FILTERS = [["all", "All"], ["attn", "Needs attention"], ["running", "Running"], ["waiting", "Waiting"], ["done", "Done"]];
function filteredRuns() {
  const f = state.runFilter || "all", b = state.runBot || "all";
  return RUNS.filter((r) => {
    const s = runState(r);
    if (f === "attn" && !needsAttention(r)) return false;
    if (f === "running" && s !== "running") return false;
    if (f === "waiting" && s !== "waiting") return false;
    if (f === "done" && s !== "done") return false;
    if (b !== "all" && r.bot !== b && !(r.bot === `team:${PEOPLE[b]?.team}`)) return false;
    return true;
  }).sort((x, y) => (needsAttention(y) - needsAttention(x)) || ((y.end ? 0 : 1) - (x.end ? 0 : 1)) || (y.start - x.start));
}
// Runs started per day, last 14 days.
function dayChart() {
  const days = 14, W = 560, H = 96, gap = 6, bw = (W - gap * (days - 1)) / days;
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, () => ({ ok: 0, bad: 0 }));
  for (const r of RUNS) {
    const d = Math.floor((day0.getTime() + DAY - r.start) / DAY);
    if (d >= 0 && d < days) buckets[days - 1 - d][needsAttention(r) ? "bad" : "ok"]++;
  }
  const max = Math.max(4, ...buckets.map((b) => b.ok + b.bad));
  return `<svg class="daychart" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Runs per day, last 14 days">${buckets.map((b, i) => {
    const x = i * (bw + gap), hOk = (b.ok / max) * H, hBad = (b.bad / max) * H;
    const d = new Date(day0.getTime() - (days - 1 - i) * DAY);
    return `<rect class="b-ok" x="${x}" y="${H - hOk - hBad}" width="${bw}" height="${hOk}" rx="2"/>${b.bad ? `<rect class="b-bad" x="${x}" y="${H - hBad}" width="${bw}" height="${hBad}" rx="2"/>` : ""}${i % 2 === 1 || i === days - 1 ? `<text x="${x + bw / 2}" y="${H + 14}" text-anchor="middle">${i === days - 1 ? "Today" : `${MO[d.getMonth()]} ${d.getDate()}`}</text>` : ""}`;
  }).join("")}<line class="base" x1="0" x2="${W}" y1="${H + 0.5}" y2="${H + 0.5}"/></svg>`;
}
function runRow(r) {
  const a = A[r.a], b = runBot(r);
  return `<button class="runrow ${state.runSel === r.id ? "sel" : ""} ${needsAttention(r) ? "attn" : ""}" data-act="openRun" data-id="${r.id}">
    <span class="rp">${runPill(r)}</span>
    <span class="rid">${r.id}</span>
    <span class="rk"><b>${esc(r.kind)}</b><span>${esc(a.name)}</span></span>
    <span class="rb">${b.av}<span class="trunc">${esc(b.name)}</span></span>
    <span class="rc">${r.ch ? CH[r.ch] : `<span class="orch sm">${SPARK}</span>`}</span>
    <span class="rt">${ago(r.start)}</span>
    <span class="rd">${dur(runDur(r))}</span>
    <span class="rn">${r.steps.length}</span>
  </button>`;
}
function scoresTable(r) {
  if (!r.scores) return "";
  return `<div class="dr-sec"><div class="dr-k">How it picked</div><div class="scores">
    <div class="sh"><span></span><span>Wants</span><span>Room</span><span>Knows</span><span>Fair</span><span>Score</span></div>
    ${r.scores.map((s) => `<div class="sr ${s.ok ? "" : "out"} ${r.chose === s.id ? "chose" : ""}"><span class="sp">${botAv(s.id)}<span class="trunc">${esc(first(s.id))}</span></span>${s.ok ? `${["want", "room", "match", "fair"].map((k) => `<span class="num">${s.parts[k] ? s.parts[k].toFixed(1) : "–"}</span>`).join("")}<span class="num"><b>${s.score.toFixed(2)}</b>${r.chose === s.id ? ico("check") : ""}</span>` : `<span class="why">${esc(s.text.replace(/^\S+\s/, ""))}</span>`}</div>`).join("")}
  </div></div>`;
}
function runDrawer(r) {
  const a = A[r.a], b = runBot(r, "lg"), s = runState(r);
  return `<aside class="drawer rundrawer" aria-label="${esc(r.id)}">
    <div class="dr-top"><span class="faint">${r.id}</span><span class="grow"></span><button class="icon-btn" data-act="closeRun" aria-label="Close">${ico("x")}</button></div>
    <div class="dr-title"><h2>${esc(r.kind)}</h2><a href="#t~${a.id}" class="dr-app">${candAv(a)}${esc(a.name)}</a></div>
    <div>${runPill(r)}</div>
    ${s === "failed" || s === "stuck" ? blockCard(r, false) : ""}
    <div class="dr-props">
      ${prop("Grokbot", `${b.av}<span class="trunc">${esc(b.name)}</span>`)}
      ${prop("Started", `${esc(fmtWhen(r.start))}`)}
      ${prop("Took", `${dur(runDur(r))}${r.end ? "" : " so far"}`)}
      ${r.ch ? prop("Through", `${CH[r.ch]}${CH_NAME[r.ch]}`) : ""}
    </div>
    ${scoresTable(r)}
    <div class="dr-sec"><div class="dr-k">Steps</div><div class="rsteps">${r.steps.map((e) => `<div class="rs ${e.err ? "err" : ""} ${e.muted ? "muted" : ""}">
      <span class="rs-t">+${dur(e.at - r.start)}</span><span class="rs-av">${actorAv(e.actor, a)}</span>
      <div class="rs-b"><span><b>${actorName(e.actor, a)}</b> ${e.bubble ? `“${e.html}”` : e.html}</span>${e.quote ? `<span class="rs-q">${esc(e.quote)}</span>` : ""}${e.draft ? `<span class="rs-q">Invite draft in Gmail</span>` : ""}</div></div>`).join("")}</div></div>
  </aside>`;
}
function nowDoing(id) {
  const r = RUNS.find((x) => x.bot === id && !x.end);
  if (r) return `<a href="#run~${r.id}" class="busy">${runState(r) === "running" ? `<span class="working-dots sm"><i></i><i></i><i></i></span>` : ""}${esc(r.kind)} · ${esc(A[r.a].name)}</a>`;
  const b = APPLICANTS.find((x) => x.iv === id && x.state === "scheduled");
  if (b) return `<a href="#t~${b.id}" class="muted">Interview ${esc(WD[new Date(b.at).getDay()])} · ${esc(b.name)}</a>`;
  return `<span class="faint">${PEOPLE[id].quiet ? esc(PEOPLE[id].quiet) : "Idle"}</span>`;
}
function botsPage(tab = "runs") {
  if (tab === "log") tab = "runs";
  const ids = Object.keys(PEOPLE).filter((k) => PEOPLE[k].team);
  const open = RUNS.filter((r) => !r.end);
  const attn = RUNS.filter(needsAttention);
  const asks = RUNS.filter((r) => r.kind.startsWith("Ask ") && r.end).map((r) => r.end - r.start).sort((x, y) => x - y);
  const median = asks.length ? asks[Math.floor(asks.length / 2)] : 0;
  const weekDone = RUNS.filter((r) => r.end && Date.now() - r.end < 7 * DAY && r.status === "done").length;
  const sel = state.runSel && RUNS.find((r) => r.id === state.runSel);
  let body = "";
  if (tab === "runs" || tab === "checks") {
    body = feedPage();
  } else if (tab === "_table") {
    const list = filteredRuns();
    const bf = state.runBot && state.runBot !== "all" ? PEOPLE[state.runBot] : null;
    body = `<div class="stats">
        <button class="stat" data-act="runFilter" data-v="running"><span>Running now</span><b>${open.filter((r) => runState(r) === "running").length}</b><small>All Grokbots</small></button>
        <button class="stat" data-act="runFilter" data-v="waiting"><span>Waiting on people</span><b>${open.filter((r) => runState(r) === "waiting").length}</b><small>Interviewers and candidates</small></button>
        <button class="stat ${attn.length ? "alert" : ""}" data-act="runFilter" data-v="attn"><span>Needs attention</span><b>${attn.length}</b><small>Failed, or no reply in 24h</small></button>
        <div class="stat"><span>Interviewer replies</span><b>${dur(median)}</b><small>Median response time</small></div>
        <div class="stat"><span>Done this week</span><b>${weekDone}</b><small>Completed</small></div>
      </div>
      <section class="cardbox"><div class="cardbox-head">Runs per day<span class="aside"><i class="lg-ok"></i>Done or open <i class="lg-bad"></i>Needs attention</span></div><div class="chartwrap">${dayChart()}</div></section>
      <section class="cardbox runs">
        <div class="runs-bar"><div class="seg">${RUN_FILTERS.map(([k, n]) => `<button class="${(state.runFilter || "all") === k ? "on" : ""}" data-act="runFilter" data-v="${k}">${n}${k === "attn" && attn.length ? ` <span class="n red">${attn.length}</span>` : ""}</button>`).join("")}</div>
          <button class="chip" data-act="runBotMenu">${bf ? `${botAv(state.runBot)}${esc(bf.name)}` : "All Grokbots"}<svg class="chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>
          <span class="grow"></span><span class="faint">${list.length} runs</span></div>
        <div class="runhead"><span>Status</span><span>Run</span><span>Task</span><span>Grokbot</span><span></span><span>Started</span><span>Took</span><span>Steps</span></div>
        ${list.map(runRow).join("") || `<div class="empty">No runs match</div>`}
      </section>`;
  } else if (tab === "people") {
    body = `<section class="cardbox">
      <div class="cardbox-head" title="Every interviewer has a Grokbot: their assistant for interviews. It asks, schedules, briefs and collects the read.">Interviewers<span class="n">${ids.length}</span></div>
      <div class="ptable">
        <div class="ph"><span>Interviewer</span><span>Interviews</span><span>This week</span><span>Knows</span><span>Reach</span><span>Their Grokbot is</span></div>
        ${ids.map((id) => { const p = PEOPLE[id]; return `<div class="pr2">
          <span class="pcell">${botAv(id, "lg")}<span class="grow"><b data-hc="p:${id}">${esc(p.name)}</b><span>${esc(p.role)} · ${TEAMS[p.team].name}</span></span></span>
          <span class="pl"><span class="likes ${p.likes}">${likesLabel(p)}</span><small class="faint">${esc(p.said)}</small></span>
          <span class="load">${loadBar(p)}<small class="faint">${p.load} of ${p.cap}</small></span>
          <span class="trunc muted pk">${esc(p.focus.join(", "))}</span>
          <span class="chico pc" title="${CH_NAME[p.ch]}">${CH[p.ch]}</span>
          <span class="trunc pn">${nowDoing(id)}</span></div>`; }).join("")}
      </div></section>`;
  } else {
    body = `<section class="cardbox">
      <div class="cardbox-head">Interviewer selection</div>
      ${POLICY.map((p) => `<div class="lrow pol"><span class="grow"><b>${p.name}</b><span>${p.d}</span></span><button class="switch ${p.off ? "" : "on"}" data-act="policy" data-k="${p.k}" role="switch" aria-checked="${!p.off}" aria-label="${p.name}"><i></i></button></div>`).join("")}
      </section>
      <section class="cardbox"><div class="cardbox-head">Escalation</div>
        <div class="lrow pol"><span class="grow"><b>No reply in 24 hours</b><span>One automatic reminder, then flagged in Grokbot Activity</span></span></div>
        <div class="lrow pol"><span class="grow"><b>A tool fails</b><span>Gmail, Slack or Calendar access lost. The run stops and can be retried</span></span></div>
        <div class="lrow pol"><span class="grow"><b>Nobody on the team can take it</b><span>Returned to your Inbox</span></span></div>
      </section>`;
  }
  const title = tab === "people" ? "Interviewers" : tab === "rules" ? "Settings" : "Grokbot Activity";
  if (tab === "checks") tab = "runs";
  if (tab === "rules") body = `<a class="set-link" href="#setup~people">${ico("users")}<span><b>People &amp; teams</b><span>Add interviewers and their Grokbots, move people between teams, and set what each person interviews for</span></span>${ico("arrowR")}</a>
    <div class="set-h"><h2>Interview Process</h2></div>
    <section class="cardbox set-proc">${PROCESS_DEFAULT.map(([k], i) => `<label class="proc-r"><span class="proc-n">${i + 1}</span><input class="proc-in" data-i="${i}" value="${esc(state.process[i])}" aria-label="Stage ${i + 1}"></label>`).join("")}</section>
    <div class="set-h"><h2>Routing Rules</h2></div>${body}`;
  return `<div class="bar cx-bar"><h1 class="cx-title">${title}</h1><span class="spacer"></span>${tab === "people" ? `<a class="cx-btn" href="#setup~teams">${ico("users")}Manage people &amp; teams</a><a class="cx-btn" href="#setup~people">${ico("plus")}Add people</a>` : ""}
    </div>
  <div class="scroll" id="scroller"><div class="page obs obs-${tab}">
    ${body}
  </div></div>
  ${sel && tab === "runs" ? runDrawer(sel) : ""}`;
}

/* ---------------- routing, render ---------------- */
function parseHash() {
  const [name, a] = decodeURIComponent(location.hash.slice(1) || "home").split("~");
  if (name === "home") {
    if (HOME_TABS.some((t) => t[0] === a)) return { name: "home", id: a, key: decodeURIComponent(location.hash.slice(1)).split("~")[2] };
    if (a) setTimeout(() => $(`#hm-${a}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return { name: "home" };
  }
  if (name === "t" && A[a]) return { name: "t", id: a };
  if (name === "inbox") { if (A[a]) state.ibSel = a; return { name }; }
  if (name === "team" && TEAMS[a]) { state.team = a; state.savedView = null; return { name: "all" }; }
  if (name === "all") { state.team = "all"; state.savedView = null; return { name: "all" }; }
  if (name === "referrals" || (name === "view" && a === "referrals")) return { name: "referrals" };
  if (name === "view" && viewById(a)) { const v = viewById(a); if (v.href) { location.replace(v.href); return { name: "views" }; } state.team = "all"; state.savedView = a; return { name: "all" }; }
  if (name === "views") return { name };
  if (name === "history") { location.replace("#crm"); return { name: "crm" }; }
  if (name === "crm") { if (a && CRM_VIEWS.some((v) => v[0] === a)) { state.crmView = a; state.crmPg = 0; } return { name }; }
  if (name === "compare") return { name };
  if (name === "chat") return { name };
  if (name === "setup") return { name, id: a || "people" };
  if (name === "bots" && a === "rules") return { name: "settings" };
  if (name === "bots") return { name, id: a === "people" ? a : "runs" };
  if (name === "activity" || (name === "interviews" && (a === "activity" || a === "checks"))) return { name: "bots", id: a === "checks" ? "checks" : "runs" };
  if (name === "interviews") { if (a && recByKey(a)) return { name, id: a }; return { name }; }
  if (name === "settings") return { name };
  if (name === "run" && RUNS.some((r) => r.id === a)) { state.runSel = a; return { name: "bots", id: "runs" }; }
  if (name === "analytics") return { name, id: a === "pipeline" || a === "interviews" ? "pipeline" : "posts" };
  if (name === "jobs") return { name, id: a === "new" || ROLES[a] ? a : undefined };
  if (["triage", "calendar"].includes(name)) return { name };
  return { name: "inbox" };
}
function render() {
  const act = document.activeElement;
  const keep = act && act.id && $("#panel").contains(act) ? { id: act.id, s: act.selectionStart, e: act.selectionEnd } : null;
  const scroll = $("#scroller") ? $("#scroller").scrollTop : 0;
  const ml = $("#mlist") ? $("#mlist").scrollTop : 0;
  const draft = $("#tri-draft");
  if (draft && state.tri && draft.dataset.dirty) state.tri.draft = draft.value;
  const r = state.route;
  if (r.name === "inbox") {
    if (state.ibNeed && state.ibNeed === state.ibSel && !issueOf(A[state.ibNeed])) autoClear(state.ibNeed);
    state.ibIss = state.ibSel && state.ibFilter !== "done" ? issueOf(A[state.ibSel]) : null;
    state.ibNeed = state.ibIss ? state.ibSel : null;
    if (state.ibSel) seen.set(state.ibSel, Date.now());
  }
  renderSide();
  $("#panel").classList.add("calx");
  document.body.classList.add("on-cal");
  const pageKey = `${r.name}|${["inbox", "interviews"].includes(r.name) ? "" : r.id || ""}|${state.savedView || ""}|${r.name === "inbox" ? state.ibFilter || "" : ""}`;
  const newPage = pageKey !== state.pageKey, newSel = r.name === "inbox" ? state.ibSel !== state.lastSel : r.name === "interviews" ? r.id !== state.lastSel : false;
  state.pageKey = pageKey; state.lastSel = r.name === "inbox" ? state.ibSel : r.id;
  const html = r.name === "t" ? ticketPage(r.id) : r.name === "all" ? applicantsPage() : r.name === "triage" ? triagePage() : r.name === "bots" ? botsPage(r.id) : r.name === "calendar" ? calendarPage() : r.name === "jobs" ? jobsPage() : r.name === "analytics" ? analyticsPage(r.id) : r.name === "interviews" ? interviewsPage(r.id) : r.name === "settings" ? botsPage("rules") : r.name === "views" ? viewsPage() : r.name === "crm" ? crmPage() : r.name === "compare" ? comparePage() : r.name === "chat" ? chatPage() : r.name === "setup" ? setupPage(r.id) : r.name === "referrals" ? referralsPage() : r.name === "home" ? homePage(r.id, r.key) : inboxPage();
  if (newPage) { $("#panel").innerHTML = html; enterPage($("#panel")); } else { patch($("#panel"), html); if (newSel) enterReader(r.name === "inbox" ? ".ib-reader" : ".ivw-read"); }
  fitCalendar();
  drawTrees(); setTimeout(drawTrees, 420);
  $$(".cmp-inner").forEach((el) => { el.style.zoom = (el.parentElement.clientWidth - 2) / 1180; });
  if (r.name === "interviews" && r.id) $(".ivr.sel")?.scrollIntoView({ block: "nearest" });
  animateIvOpen();
  if (state.keepScroll) { if ($("#scroller")) $("#scroller").scrollTop = scroll; if ($("#mlist")) $("#mlist").scrollTop = ml; }
  state.keepScroll = true;
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch {} } }
  document.title = r.name === "t" ? `${A[r.id].name} · ${ORG.name}` : `${ORG.name} · tATS`;
}
// Size the hours so the working day fills the calendar exactly; below 40px an hour it scrolls instead.
function fitCalendar() {
  const sc = $("#wkScroll");
  if (!sc || fitCalendar.busy) return;
  const fit = Math.min(96, Math.max(40, Math.floor((sc.clientHeight - 1) / (CAL_H1 - CAL_H0))));
  if (fit === HOUR) return;
  HOUR = fit;
  fitCalendar.busy = true;
  render();
  fitCalendar.busy = false;
}
let fitT = 0;
window.addEventListener("resize", () => { clearTimeout(fitT); fitT = setTimeout(() => { if (state.route.name === "calendar" && !pop) render(); }, 120); });
function go(hash) { if (location.hash.slice(1) === hash) { state.route = parseHash(); render(); } else location.hash = hash; }
let prevHash = location.hash.slice(1) || "inbox";
window.addEventListener("hashchange", () => {
  const prev = state.route;
  state.route = parseHash();
  if (prev.name !== "t" && state.route.name === "t") state.backTo = prevHash;
  prevHash = location.hash.slice(1);
  if (prev.name !== state.route.name || prev.id !== state.route.id) state.keepScroll = false;
  if (state.route.name === "t") state.focus = state.route.id;
  if (state.route.name === "bots" && prev.name !== "bots") state.actOpened = Date.now();
  if (state.route.name !== "all") picked.clear();
  $("#app").classList.remove("drawer");
  hideHc();
  closeLayer();
  render();
});

/* ---------------- layer: menus, command menu, modals, toasts ---------------- */
let menu = null, palette = null, modal = null;
function openMenu(anchor, items, onPick, { title, restore, above } = {}) {
  closeLayer();
  const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const el = document.createElement("div");
  el.className = "menu";
  el.setAttribute("role", "menu");
  el.innerHTML = `${title ? `<div class="sec">${esc(title)}</div>` : ""}<div class="opts">${items.map((o, i) => o.sec ? `<div class="sec">${esc(o.sec)}</div>` : `<button class="opt" data-i="${i}" role="menuitem">${o.icon || ""}<span class="grow">${esc(o.label)}</span>${o.checked ? `<svg class="tick" viewBox="0 0 16 16"><path d="${P.check}"/></svg>` : ""}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ""}</button>`).join("")}</div>`;
  $("#layer").appendChild(el);
  el.style.left = Math.max(12, Math.min(rect.left, innerWidth - el.offsetWidth - 12)) + "px";
  el.style.top = rect.bottom + 6 + "px";
  if (above || rect.bottom + el.offsetHeight > innerHeight - 12) el.style.top = Math.max(12, rect.top - el.offsetHeight - 6) + "px";
  const opts = $$(".opt", el);
  menu = { el, opts, hi: Math.max(0, opts.findIndex((b) => items[+b.dataset.i].checked)), restore };
  menu.hl = () => opts.forEach((b, k) => b.classList.toggle("hi", k === menu.hi));
  menu.hl();
  el.addEventListener("click", (e) => { const b = e.target.closest(".opt"); if (!b) return; menu.restore = null; closeLayer(); onPick(items[+b.dataset.i]); });
}
function closeLayer() {
  const r = menu && menu.restore;
  if (pop && pop.ghost) pop.ghost.remove();
  menu = null; palette = null; modal = null; pop = null;
  const layer = $("#layer");
  if (layer.children.length && G && !calm()) {
    const ghost = document.createElement("div");
    ghost.className = "layer-ghost";
    [...layer.children].forEach((k) => ghost.appendChild(k));
    document.body.appendChild(ghost);
    G.to(ghost, { opacity: 0, duration: 0.14, ease: "power1.in", onComplete: () => ghost.remove() });
    setTimeout(() => ghost.remove(), 400);
  }
  layer.innerHTML = "";
  return r;
}
document.addEventListener("pointerdown", (e) => {
  if (menu && !e.target.closest(".menu")) { const r = closeLayer(); if (r) r(); }
  if (pop && !e.target.closest(".gpop, .menu, [data-act='calEv']")) closeLayer();
});
function teamMenu(anchor, a, onPick) {
  const sug = ROLES[a.role].team;
  const items = Object.keys(TEAMS).sort((x, y) => (y === sug) - (x === sug)).map((k, i) => ({ id: k, label: TEAMS[k].name, hint: k === sug ? "Suggested" : String(i + 1), icon: teamKey(k), checked: a.team === k }));
  openMenu(anchor, items, (o) => onPick(o.id), { title: a.state === "judgment" ? "Next round with" : "Send to a team" });
}
function toast(msg, { undo, open } = {}) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${esc(msg)}</span>${open ? `<button data-open>Open</button>` : ""}${undo ? `<button data-undo>Undo <span class="kbd">Z</span></button>` : ""}`;
  $("#toasts").appendChild(el);
  const fn = undo && (() => { undo(); el.remove(); toast.undo = null; render(); });
  if (fn) toast.undo = fn;
  el.addEventListener("click", (e) => { if (e.target.closest("[data-undo]") && fn) fn(); if (e.target.closest("[data-open]")) { el.remove(); go(`t~${open}`); } });
  setTimeout(() => { if (toast.undo === fn) toast.undo = null; if (G && !calm() && el.isConnected) { G.to(el, { opacity: 0, y: 8, duration: 0.22, ease: "power2.in", onComplete: () => el.remove() }); setTimeout(() => el.remove(), 500); } else el.remove(); }, 6000);
}
// ⌘K: jump anywhere, find anyone, and act on the ticket you're on.
function openPalette(ctx) {
  closeLayer();
  const cur = ctx ? A[ctx] : state.route.name === "t" ? A[state.route.id] : null;
  const acts = cur ? [
    ...Object.keys(TEAMS).filter(() => isOpen(cur)).map((k) => ({ sec: "This applicant", label: `Send ${cur.name} to ${TEAMS[k].name}`, icon: teamKey(k), run: () => (cur.state === "judgment" && cur.read ? assign(cur, k, (cur.round || 1) + 1) : assign(cur, k)) })),
    ...[1, 2, 3, 4, 0].map((p) => ({ sec: "This applicant", label: `Set priority: ${PRIORITIES[p].name}`, icon: priIcon(p), run: () => setPri(cur, p) })),
    ...(cur.state === "judgment" ? [{ sec: "This applicant", label: "Move to offer…", icon: stIcon("offer"), run: () => openOffer(cur) }, { sec: "This applicant", label: "Reject…", icon: stIcon("rejected"), run: () => openReject(cur) }] : []),
  ] : [];
  // Everything in the Inbox can be handed to a Grokbot from here.
  const grok = inboxRows().filter((x) => x.inInbox && x.iss.k !== "decide" && (!cur || x.a.id === cur.id)).map((x) => ({ sec: "Ask Grokbot", label: `${x.iss.act.label}: ${x.a.name}`, sub: x.iss.what, icon: botAv(ME), run: () => ACT[x.iss.act.a]({ dataset: { id: x.iss.act.id } }) }));
  const all = [
    ...grok,
    ...acts,
    { sec: "Go to", label: "Chat with your Grokbot", icon: botAv(ME), run: () => go("chat") },
    { sec: "Go to", label: "Inbox", sub: `${unreadCount()} unread`, icon: ico("inbox"), hint: "G I", run: () => go("inbox") },
    { sec: "Go to", label: "Applicant Tickets", sub: `${queue().length} new`, icon: ico("ticket"), hint: "G T", run: () => go("triage") },
    { sec: "Go to", label: "Pipeline", icon: ico("people"), hint: "G A", run: () => go("all") },
    { sec: "Go to", label: "Job Postings", icon: ico("brief"), hint: "G J", run: () => go("jobs") },
    { sec: "Do", label: "New Job Posting", icon: ico("plus"), run: () => newJob() },
    { sec: "Do", label: "Add a Grokbot", icon: ico("plus"), run: () => openAddBot() },
    { sec: "Do", label: "Set up people and teams", icon: ico("users"), run: () => go("setup~people") },
    { sec: "Go to", label: "Applicants board", icon: ico("board"), run: () => { state.view = "board"; go("all"); } },
    { sec: "Go to", label: "Calendar", icon: ico("cal"), hint: "G L", run: () => go("calendar") },
    { sec: "Go to", label: "Analytics", icon: ico("chart"), run: () => go("analytics") },
    { sec: "Go to", label: "Grokbot Activity", icon: ico("route"), hint: "G B", run: () => go("activity") },
    { sec: "Go to", label: "Interviews", icon: ico("mic"), run: () => go("interviews") },
    { sec: "Go to", label: "Settings", icon: ico("gear"), run: () => go("settings") },
    { sec: "Go to", label: "Views", icon: ico("layers"), hint: "G V", run: () => go("views") },
    { sec: "Do", label: "New view", icon: ico("plus"), run: () => openNewView() },
    { sec: "Go to", label: "Keyboard Shortcuts", icon: ico("keyboard"), hint: "?", run: () => openHelp() },
    ...APPLICANTS.map((a) => ({ sec: "Applicants", label: a.name, sub: `${ROLES[a.role].title} · ${doing(a)}`, run: () => go(`t~${a.id}`), icon: candAv(a) })),
  ];
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `<div class="palette">${cur ? `<div class="ctx"><span class="chip">${candAv(cur)}${esc(cur.name)}</span></div>` : ""}<input placeholder="Search, or ask your Grokbot" aria-label="Command menu"><div class="res"></div><div class="foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> move</span><span><span class="kbd">↵</span> run</span><span><span class="kbd">esc</span> close</span></div></div>`;
  $("#layer").appendChild(el);
  palette = { hi: 0, items: all };
  const input = $("input", el);
  palette.draw = () => {
    const q = input.value.toLowerCase().trim();
    palette.items = all.filter((x) => !q || `${x.label} ${x.sub || ""}`.toLowerCase().includes(q)).slice(0, q ? 11 : 16);
    if (/^refer/.test(q)) palette.items.unshift({ sec: "Ask Grokbot", label: "Add this as a referral", sub: input.value.trim(), icon: botAv(ME), run: () => setTimeout(() => openRefForm(parseReferral(input.value)), 0) });
    if (q.length > 2) palette.items.push({ sec: "Ask Grokbot", label: `“${input.value.trim()}”`, sub: cur ? `for ${cur.name}` : "", icon: botAv(ME), run: () => { if (cur) ev(cur, Date.now(), `bot:${ME}`, `On it: ${esc(input.value.trim())}`); toast("Your Grokbot is on it. It'll show up in Grokbot Activity."); } });
    palette.hi = Math.min(palette.hi, Math.max(0, palette.items.length - 1));
    let sec = "";
    $(".res", el).innerHTML = palette.items.map((x, i) => `${x.sec !== sec ? `<div class="sec">${esc((sec = x.sec))}</div>` : ""}<button class="opt ${i === palette.hi ? "hi" : ""}" data-i="${i}">${x.icon || ""}<span class="grow">${esc(x.label)} ${x.sub ? `<span class="faint">${esc(x.sub)}</span>` : ""}</span>${x.hint ? `<span class="hint">${esc(x.hint)}</span>` : ""}</button>`).join("") || `<div class="empty">Nothing found</div>`;
    $(".res .opt.hi", el)?.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => { palette.hi = 0; palette.draw(); });
  el.addEventListener("click", (e) => { if (e.target === el) return closeLayer(); const b = e.target.closest(".opt"); if (b) { const it = palette.items[+b.dataset.i]; closeLayer(); it.run(); } });
  palette.draw();
  input.focus();
}
function openHelp() {
  closeLayer();
  const rows = [
    ["Anywhere", [["⌘K", "Command menu"], ["G then I / T / V", "Inbox, Applicant Tickets, Views"], ["G then A / B / J", "Pipeline, Grokbot Activity, Job Postings"], ["[", "Collapse or expand the sidebar"], ["?", "This list"], ["Z", "Undo"]]],
    ["Inbox", [["J / K", "Next, previous"], ["E", "Done: clear it from your Inbox"], ["U", "Mark unread"], ["↵", "Open the ticket"], ["Esc", "Close the reader"]]],
    ["Applicant Tickets", [["J / K", "Next, previous"], ["I", "Interview reply"], ["T", "Testbench reply"], ["D", "Decline reply"], ["⌘↵", "Send"], ["↵", "Open the ticket"]]],
    ["Applicants", [["J / K", "Move"], ["X", "Select"], ["↵", "Open"], ["A", "Send to a team"], ["P", "Priority"], ["S", "Status"], ["L", "Labels"], ["F", "Filter"], ["B", "List or board"]]],
    ["Calendar", [["← / →", "Previous, next"], ["D / W / M", "Day, week, month"], ["Drag", "Add an interview, or move one"], [".", "Today"]]],
    ["An applicant", [["A", "Send to a team, or next round"], ["O", "Move to offer"], ["R", "Reject"], ["C", "Comment"], ["Esc", "Back"]]],
  ];
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `<div class="modal help"><div class="modal-head"><b>Keyboard Shortcuts</b></div><div class="help-grid">${rows.map(([h, ks]) => `<section><div class="dr-k">${h}</div>${ks.map(([k, d]) => `<div class="hk"><span>${d}</span><span>${k.split(" ").map((x) => (["then", "/", "or"].includes(x) ? `<span class="faint">${x}</span>` : `<span class="kbd">${x}</span>`)).join(" ")}</span></div>`).join("")}</section>`).join("")}</div></div>`;
  $("#layer").appendChild(el);
  modal = { send: () => {} };
  el.addEventListener("click", (e) => { if (e.target === el) closeLayer(); });
}
// Reject: preview the note the interviewer's Grokbot will send in their voice.
function openReject(a) {
  closeLayer();
  const by = a.iv || ME;
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `<div class="modal"><div class="modal-head">${botAv(by)}<span>${by === ME ? "Your Grokbot" : `${esc(possessive(first(by)))} Grokbot`} wrote this in ${by === ME ? "your" : esc(possessive(first(by)))} voice</span></div>
    <div class="mail big"><div class="mail-h"><span class="k">From</span>${esc(PEOPLE[by].name)} &lt;${esc(first(by).toLowerCase())}@meridian.com&gt;</div><div class="mail-h"><span class="k">To</span>${esc(a.name)} &lt;${esc(emailOf(a))}&gt;</div>
    <div class="mail-b" contenteditable="true" spellcheck="false">Hi ${esc(first2(a))},<br><br>Thanks for the time ${a.read ? "on our call" : "you put into applying"}. ${a.read ? "I enjoyed talking with you." : ""} We've decided not to move forward for the ${esc(ROLES[a.role].title)} role right now. ${a.tb && a.tb.state === "done" ? "Your Testbench was strong, and we'd be glad to hear from you again." : "I hope our paths cross again."}<br><br>${esc(first(by))}</div></div>
    <div class="modal-foot"><span class="hint">Sent from ${esc(possessive(first(by)))} Gmail.</span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-send title="Send (⌘↵)">Send</button></div></div>`;
  $("#layer").appendChild(el);
  modal = { send: () => { closeLayer(); reject(a); toast(`Rejected ${a.name}. ${by === ME ? "Your" : possessive(first(by))} Grokbot is sending the note.`); } };
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) closeLayer(); if (e.target.closest("[data-send]")) modal.send(); });
}

/* ---------------- actions ---------------- */
const idsFor = (el) => (picked.size && picked.has(el.dataset.id) ? [...picked] : [el.dataset.id]);
const ACT = {
  palette: () => openPalette(),
  askGrok: (el) => openPalette(el.dataset.id),
  help: () => openHelp(),
  openDrawer: () => $("#app").classList.add("drawer"),
  closeDrawer: () => $("#app").classList.remove("drawer"),
  noop: () => {},
  replay: () => toast("The session replay opens in Testbench"),
  triSel: (el) => { Object.assign(state.tri, { sel: el.dataset.id, mode: null, draft: null }); render(); },
  triMode: (el) => { Object.assign(state.tri, { mode: el.dataset.v, draft: null }); render(); },
  triTeam: (el) => { const a = A[state.tri.sel]; teamMenu(el, a, (k) => { Object.assign(state.tri, { team: k, draft: null }); render(); }); },
  triStep: (el) => triMove(+el.dataset.d),
  triSend: () => triSend(),
  triEdit: () => { state.triEdit = !state.triEdit; render(); if (state.triEdit) $("#tri-draft")?.focus(); },
  dvZoom: (el) => { const zs = [0.75, 0.9, 1, 1.15, 1.3]; const i = zs.indexOf(state.dvZoom || 1); state.dvZoom = zs[Math.max(0, Math.min(zs.length - 1, i + +el.dataset.d))]; render(); },
  dvGo: (el) => { const p = $$("#dvPages .pg")[+el.dataset.i]; const box = $("#dvPages"); if (p && box) box.scrollTo({ top: p.offsetTop - box.offsetTop - 16, behavior: "smooth" }); },
  dvFull: () => { state.dvFull = !state.dvFull; render(); },
  dvDownload: (el) => toast(`Downloaded ${el.dataset.k}`),
  triOpen: (el) => { state.tri = { sel: el.dataset.id }; go("triage"); },
  toggleGroup: (el) => { if (el.dataset.closed) state.closedOpen = !state.closedOpen; else { const s = (state.shut ||= new Set()); s.has(el.dataset.k) ? s.delete(el.dataset.k) : s.add(el.dataset.k); } render(); },
  setView: (el) => { state.view = el.dataset.v; render(); },
  display: (el) => openMenu(el, [{ sec: "Layout" }, { id: "v:list", label: "List", icon: ico("list"), checked: (state.view || "board") === "list" }, { id: "v:board", label: "Board", icon: ico("board"), checked: (state.view || "board") === "board" }, { sec: "Group the list by" }, ...[["court", "Court"], ["team", "Team"], ["priority", "Priority"], ["role", "Role"]].map(([k, n]) => ({ id: `g:${k}`, label: n, checked: (state.groupBy || "court") === k }))], (o) => { const [t, v] = o.id.split(":"); if (t === "v") state.view = v; else { state.groupBy = v; state.view = "list"; } render(); }),
  pick: (el) => { const id = el.dataset.id; picked.has(id) ? picked.delete(id) : picked.add(id); render(); },
  clearPick: () => { picked.clear(); render(); },
  bulkTeam: (el) => teamPick(el, [...picked]),
  bulkPri: (el) => { priMenu(el, [...picked]); },
  bulkTB: () => {
    const ids = [...picked].filter((id) => !A[id].tb && isOpen(A[id])), skip = picked.size - ids.length;
    if (!ids.length) return toast("Everyone selected already has a Testbench");
    openForm({ title: `Send the Testbench to ${ids.length} applicant${ids.length === 1 ? "" : "s"}?`, sub: ids.map((id) => esc(A[id].name)).join(", "),
      body: `<p class="as-next">Each applicant receives the Testbench for their role.${skip ? ` ${skip} selected already ${skip === 1 ? "has" : "have"} one and won't get another.` : ""}</p>`,
      submit: "Send Testbench", onSubmit: () => { ids.forEach((id) => sendTB(A[id])); picked.clear(); toast(`Testbench sent to ${ids.length} applicant${ids.length === 1 ? "" : "s"}`); } });
  },
  bulkPass: () => {
    const ids = [...picked].filter((id) => ["new", "testbench"].includes(A[id].state)), skip = picked.size - ids.length;
    if (!ids.length) return toast("Only new or Testbench applicants can be passed on. Use Reject for the rest.");
    openForm({ title: `Pass on ${ids.length} applicant${ids.length === 1 ? "" : "s"}?`, sub: ids.map((id) => esc(A[id].name)).join(", "),
      body: `<p class="as-next">A decline note is sent from your email tomorrow morning.${skip ? ` ${skip} selected ${skip === 1 ? "is" : "are"} further along and won't be passed on.` : ""}</p>`,
      submit: "Pass and send notes", onSubmit: () => { const undos = ids.map((id) => pass(A[id])); picked.clear(); toast(`Passed on ${ids.length}`, { undo: () => undos.forEach((u) => u()) }); } });
  },
  menuPri: (el) => priMenu(el, idsFor(el)),
  menuTeam: (el) => teamPick(el, idsFor(el)),
  menuStatus: (el) => statusMenu(el, A[el.dataset.id]),
  menuLabels: (el) => labelMenu(el, A[el.dataset.id]),
  interview: (el) => teamPick(el, [el.dataset.id]),
  advance: (el) => openAssign([el.dataset.id]),
  reject: (el) => openReject(A[el.dataset.id]),
  offer: (el) => openOffer(A[el.dataset.id]),
  comment: (el) => comment(el.dataset.id),
  step: (el) => stepTicket(+el.dataset.d),
  openRun: (el) => { state.runSel = state.runSel === el.dataset.id ? null : el.dataset.id; render(); },
  closeRun: () => { state.runSel = null; render(); },
  runFilter: (el) => { state.runFilter = el.dataset.v; render(); },
  runBotMenu: (el) => openMenu(el, [{ id: "all", label: "All Grokbots" }, ...Object.keys(PEOPLE).filter((k) => PEOPLE[k].team || k === ME).map((k) => ({ id: k, label: k === ME ? "Your Grokbot" : `${first(k)}'s Grokbot`, icon: botAv(k), checked: state.runBot === k }))], (o) => { state.runBot = o.id; render(); }),
  retryRun: (el) => retryRun(RUNS.find((r) => r.id === el.dataset.id)),
  nudgeRun: (el) => nudgeRun(RUNS.find((r) => r.id === el.dataset.id)),
  calEv: (el) => { if (state.noClick && Date.now() - state.noClick < 400) return; openEventPop(el.dataset.k, el); },
  newDur: (el) => { pop.e.end = pop.e.start + +el.dataset.v * MIN; pop.ghost.style.height = `${(+el.dataset.v / 60) * HOUR - 4}px`; $("span", pop.ghost).textContent = `${hm(pop.e.start)} – ${hm(pop.e.end)}`; drawPop(); },
  newApp: (el) => { pop.nw.a = el.dataset.id; pickDefaultIv(); drawPop(); },
  newIv: (el) => { pop.nw.iv = el.dataset.id; drawPop(); },
  newAsk: () => { pop.nw.ask = !pop.nw.ask; drawPop(); },
  newSave: () => saveNew(),
  popClose: () => closeLayer(),
  popView: (el) => { pop.view = el.dataset.v; drawPop(); },
  popMore: (el) => { const e = pop.e; const rect = el.getBoundingClientRect(); const items = [{ id: "open", label: "Open ticket", icon: ico("arrowR") }, { id: "run", label: "See the Grokbot run", icon: ico("bot") }, { id: "copy", label: "Copy the Meet link", icon: ico("link") }]; const m = document.createElement("div"); m.className = "menu"; m.style.cssText = `left:${Math.min(rect.left, innerWidth - 240)}px;top:${rect.bottom + 4}px;z-index:90`; m.innerHTML = `<div class="opts">${items.map((o) => `<button class="opt" data-id="${o.id}">${o.icon}<span class="grow">${o.label}</span></button>`).join("")}</div>`; $("#layer").appendChild(m); m.addEventListener("click", (ev) => { const b = ev.target.closest(".opt"); if (!b) return; m.remove(); if (b.dataset.id === "open") go(`t~${e.a.id}`); if (b.dataset.id === "run") { const r = RUNS.filter((x) => x.a === e.a.id).at(-1); if (r) go(`run~${r.id}`); } if (b.dataset.id === "copy") ACT.copyMeet({ dataset: { v: `meet.google.com/${meetCode(e.a.id + e.round)}` } }); }); },
  copyMeet: (el) => { try { navigator.clipboard.writeText(`https://${el.dataset.v}`); } catch {} toast("Meet link copied"); },
  popMoveTo: (el) => { const e = pop.e; closeLayer(); moveEvent(e, +el.dataset.t); },
  popCancelGo: () => { const e = pop.e; closeLayer(); cancelEvent(e); },
  calMode: (el) => { state.calMode = el.dataset.v; state.calOff = 0; render(); },
  calNav: (el) => { state.calOff = (state.calOff || 0) + +el.dataset.d; render(); },
  calToday: () => { state.calOff = 0; render(); },
  calTeam: (el) => { state.calTeam = el.dataset.v; render(); },
  calTeamMenu: (el) => openMenu(el, [{ id: "all", label: "Everyone", icon: ico("people"), checked: (state.calTeam || "all") === "all" }, ...Object.keys(TEAMS).map((k) => ({ id: k, label: TEAMS[k].name, icon: teamKey(k), checked: state.calTeam === k }))], (o) => { state.calTeam = o.id; render(); }, { title: "Show" }),
  findTime: () => findTime(),
  move: (el) => { const a = A[el.dataset.id]; const m = statusMoves(a).find((x) => x.k === el.dataset.k); if (m) m.run(el); },
  storyToggle: (el) => { const o = (state.storyOpen ||= new Set()); o.has(el.dataset.k) ? o.delete(el.dataset.k) : o.add(el.dataset.k); render(); },
  rawLog: () => { state.rawLog = !state.rawLog; render(); },
  anRange: (el) => { state.anRange = el.dataset.v; render(); },
  anMetric: (el) => { state.anMetric = el.dataset.v; render(); },
  anChart: (el) => { state.anChart = el.dataset.v; render(); },
  anCompare: () => { state.anCompare = !state.anCompare; render(); },
  anExport: () => toast(`Exported ${RANGES[state.anRange || "month"][1].toLowerCase()} of careers page data as CSV`),
  exMenu: (el) => exMenu(el, el.dataset.v),
  jpFold: (el) => { const o = (state.jpShut ||= new Set()); o.has(el.dataset.k) ? o.delete(el.dataset.k) : o.add(el.dataset.k); render(); },
  careersSite: () => toast("Opening meridian.com/careers"),
  sbToggle: () => setSidebar(!state.sbCollapsed),
  openView: (el) => go(viewHref(viewById(el.dataset.id)).slice(1)),
  pinView: (el) => { const id = el.dataset.id; state.pins.has(id) ? state.pins.delete(id) : state.pins.add(id); saveViews(); render(); toast(state.pins.has(id) ? `Pinned ${viewById(id).name} to the sidebar` : `Unpinned ${viewById(id).name}`); },
  newView: () => openNewView(),
  transcript: (el) => openTranscript(el.dataset.k),
  qaMore: (el) => { state.qaOpen = state.qaOpen === el.dataset.k ? null : el.dataset.k; render(); },
  ivReview: (el) => { const s2 = (state.ivReviewed ||= new Set()), k = el.dataset.k; s2.has(k) ? s2.delete(k) : s2.add(k); render(); },
  openRec: (el) => go(`${state.route.name === "home" ? "home~" : ""}interviews~${el.dataset.k}`),
  openRow: (el) => { if (getSelection().toString()) return; state.focus = el.dataset.id; go(`t~${el.dataset.id}`); },
  ibSel: (el) => { state.ibSel = el.dataset.id; render(); },
  colAll: (el) => { state.colAll.add(el.dataset.k); render(); },
  goChat: () => go("chat"),
  ibOpen: (el) => ibOpen(el.dataset.id),
  ibGo: (el) => go(`t~${el.dataset.id}`),
  ibRange: (el) => { state.ibRange = +el.dataset.v; render(); },
  ibCheck: (el) => { if (el.dataset.need) return ibDone(el.dataset.id); (state.ibRead ||= new Set()).add(el.dataset.k); render(); },
  ibAllRead: () => { const d = ibDigest(); d.infoKeys.forEach((k) => (state.ibRead ||= new Set()).add(k)); render(); toast(d.groups.some((g) => g[0] === "need") ? "Marked read. Needs you stays until it's handled." : "All caught up"); },
  suBot: (el) => { const p = PEOPLE[el.dataset.id]; p.bot = p.bot === "on" ? "off" : "on"; render(); },
  suImport: () => { [["Ravi Menon", "ML infra engineer"], ["Elif Demir", "Forward deployed engineer"], ["Kenji Ito", "Research engineer"]].forEach(([n, r]) => { if (!Object.values(PEOPLE).some((p) => p.name === n)) addPerson(n, "", r); }); render(); },
  suTeam: (el) => { const id = el.dataset.id, k = el.dataset.v, m = TEAMS[k].members, i = m.indexOf(id); if (i >= 0) { if (teamsOf(id).length === 1) return toast("Everyone needs at least one team"); m.splice(i, 1); } else m.push(id); PEOPLE[id].team = teamsOf(id)[0]; render(); },
  suLead: (el) => { const m = TEAMS[el.dataset.v].members, i = m.indexOf(el.dataset.id); m.splice(i, 1); m.unshift(el.dataset.id); render(); },
  suTeamNew: () => openForm({ title: "New team", submit: "Create team", body: `<label class="fm-f"><span>Name</span><input name="n" placeholder="e.g. Applied AI" autocomplete="off"></label>`, onSubmit: (v) => { const n = (v.n || "").trim(); if (!n) return false; const k = n.toLowerCase().replace(/[^a-z0-9]+/g, "-"); TEAMS[k] = { name: n, color: "#7d8088", members: [] }; toast(`${n} created. Tick who's on it.`); } }),
  suTagDel: (el) => { const p = PEOPLE[el.dataset.id]; p.focus = (p.focus || []).filter((t) => t !== el.dataset.v); render(); },
  suTagAdd: (el) => { const p = PEOPLE[el.dataset.id]; openMenu(el, [...SKILL_SUGGEST.filter((t) => !(p.focus || []).includes(t)).map((t) => ({ id: t, label: t })), { id: "__new", label: "Something else…", icon: ico("plus") }], (o) => { if (o.id === "__new") return openForm({ title: `Add a skill for ${first(el.dataset.id)}`, submit: "Add", body: `<label class="fm-f"><span>Skill</span><input name="t" autocomplete="off"></label>`, onSubmit: (v) => { if (!v.t.trim()) return false; (p.focus ||= []).push(v.t.trim()); } }); (p.focus ||= []).push(o.id); render(); }); },
  suRun: (el) => { const r = (PEOPLE[el.dataset.id].runs ||= {}), t = el.dataset.v; if (!(t in r)) r[t] = 0; else if (!r[t]) r[t] = 1; else delete r[t]; render(); },
  suFinish: () => { state.setupSaved = true; toast("Saved. The Grokbots will route interviews with this from now on."); go("home"); },
  goInbox: () => go("inbox"),
  goCrm: () => go("crm"),
  goCrmActive: (el, e) => { if (e && e.target.closest("a, button") && e.target.closest("a, button") !== el) return; go("crm~active"); },
  usePal: (el) => { setPal(el.dataset.v); toast(el.dataset.v === "prev" ? "Using the previous palette with refined shading" : "Using the current styling"); go("home"); },
  procName: () => {},
  tour: () => startTour(),
  chatRef: (el) => openRefForm(parseReferral(decodeURIComponent(el.dataset.id))),
  chatPost: (el) => toast(`Posted ${(+el.dataset.id).toLocaleString()} candidates to #hiring`),
  refTab: (el) => { state.refTab = el.dataset.v; state.refPg = 0; render(); },
  refPage: (el) => { state.refPg = (state.refPg || 0) + +el.dataset.d; render(); $("#scroller") && ($("#scroller").scrollTop = 0); },
  refAdd: () => openRefForm(),
  refGrok: () => openRefGrok(),
  homeStage: (el) => { state.homeStage = state.homeStage === el.dataset.k ? null : el.dataset.k; render(); },
  homeFilter: (el) => {
    const k = el.dataset.k;
    const opts = k === "range" ? H_RANGES : k === "team" ? [["", "All teams"], ...Object.entries(TEAMS).map(([t, v]) => [t, v.name])] : [["", "All roles"], ...Object.entries(ROLES).map(([r, v]) => [r, v.title])];
    const cur = k === "range" ? String(homeDays()) : k === "team" ? state.homeTeam || "" : state.homeRole || "";
    openMenu(el, opts.map(([v, n]) => ({ id: v, label: n, checked: cur === v })), (o) => { if (k === "range") state.homeRange = o.id; else if (k === "team") state.homeTeam = o.id || null; else state.homeRole = o.id || null; render(); });
  },
  setThr: (el) => {
    const k = el.dataset.k, m = homeMetrics().find((x) => x.k === k), cur = state.thr[k];
    openForm({ title: m.label, sub: m.unit === "n" ? "Flag it when the count drops below this." : "Flag it when the typical time goes over this.", submit: "Save",
      body: `<div class="fm-row"><label class="fm-f"><span>${m.unit === "n" ? "Alert below" : "Target"}</span><input name="v" type="number" min="0" step="any" value="${cur == null ? "" : m.unit === "n" ? cur : cur >= 48 ? +(cur / 24).toFixed(1) : +cur.toFixed(1)}" placeholder="${m.unit === "n" ? "e.g. 20" : "e.g. 2"}"></label>
        ${m.unit === "n" ? "" : `<label class="fm-f"><span>Unit</span><select name="u"><option value="d" ${cur == null || cur >= 48 ? "selected" : ""}>Days</option><option value="h" ${cur != null && cur < 48 ? "selected" : ""}>Hours</option></select></label>`}</div>
        ${cur != null ? `<label class="fm-check"><input type="checkbox" name="clear"> Remove this target</label>` : ""}`,
      onSubmit: (v) => { if (v.clear || v.v === "") delete state.thr[k]; else state.thr[k] = m.unit === "n" ? +v.v : +v.v * (v.u === "h" ? 1 : 24); saveThr(); render(); } });
  },
  crmView: (el) => { state.crmView = el.dataset.v; state.crmPg = 0; render(); },
  crmSort: (el) => { const s = state.crmSort; s.dir = s.k === el.dataset.k ? -s.dir : ["last", "score"].includes(el.dataset.k) ? -1 : 1; s.k = el.dataset.k; state.crmPg = 0; render(); },
  crmPage: (el) => { state.crmPg = (state.crmPg || 0) + +el.dataset.d; render(); $("#scroller") && ($("#scroller").scrollTop = 0); },
  crmPick: (el) => { const p = state.crmPick; p.has(el.dataset.id) ? p.delete(el.dataset.id) : p.add(el.dataset.id); render(); },
  crmPickAll: () => { const p = state.crmPick; const ids = $$(".crm-r[data-id]").map((r) => r.dataset.id); const all = ids.every((id) => p.has(id)); ids.forEach((id) => (all ? p.delete(id) : p.add(id))); render(); },
  crmClear: () => { state.crmPick = new Set(); render(); },
  grpAll: (el) => { state.grpAll.add(el.dataset.k); render(); },
  openHist: (el) => openHist(el.dataset.id),

  sendInvite: (el) => sendInvite(A[el.dataset.id]),
  nudgeCand: (el) => nudgeCand(A[el.dataset.id]),
  remindIv: (el) => { const a = A[el.dataset.id]; ev(a, Date.now(), `bot:${a.iv}`, `Reminded ${nm(a.iv)} to send the invite`, { ch: chOf(a.iv) }); touch(a); toast(`Reminded ${first(a.iv)} to send the invite`); },
  ibBack: () => { state.ibSel = null; render(); },
  ibDone: (el) => ibDone(el.dataset.id),
  ibUnread: (el) => { seen.set(el.dataset.id, 0); state.ibSel = null; render(); },
  ibTab: (el) => { state.ibFilter = el.dataset.v; state.ibSel = null; render(); },
  ibClear: () => { state.ibFilter = "all"; state.ibSel = null; render(); },
  ibRestore: (el) => ibRestore(el.dataset.id),
  ibShowDone: () => { state.ibFilter = "done"; render(); },
  ibFilter: (el) => openMenu(el, Object.entries(IB_FILTERS).map(([k, n]) => ({ id: k, label: n, checked: (state.ibFilter || "all") === k })), (o) => { state.ibFilter = o.id; render(); }, { title: "Show" }),
  ibMore: (el) => openMenu(el, [{ id: "read", label: "Mark all as read", icon: ico("mail") }], () => {
    const ids = inboxRows().filter((x) => x.inInbox && !x.you).map((x) => x.a.id);
    ids.forEach((id) => seen.set(id, Date.now()));
    state.ibSel = null;
    render();
    toast(`${ids.length} update${ids.length === 1 ? "" : "s"} moved to Done. Decisions stay.`);
  }),
  emailCand: (el) => openEmail(A[el.dataset.id]),
  emailSugg: (el) => { const ta = $(".fm textarea[name=body]"); const a = A[state.route.name === "t" ? state.route.id : state.tri.sel]; if (ta && a) ta.value = EMAIL_SUGG[el.dataset.v](a); },
  openFile: (el) => openFile(A[el.dataset.id], el.dataset.k),
  newJob: (el) => newJob(el.dataset.team),
  editJob: (el) => { state.job = null; go(`jobs~${el.dataset.k}`); },
  jeTab: (el) => { state.job.tab = el.dataset.v; render(); },
  jePreview: (el) => { state.job.preview = el.dataset.v === "preview"; render(); },
  jeStatus: () => { state.job.status = state.job.status === "paused" ? "live" : "paused"; render(); },
  jeAdd: (el) => jeAdd(el.dataset.f),
  jeDel: (el) => { state.job[el.dataset.f].splice(+el.dataset.i, 1); render(); },
  jeSave: () => jeSave(),
  addBot: () => openAddBot(),
  openTicketPop: (el) => go(`t~${el.dataset.id}`),
  sbSec: (el) => { const k = el.dataset.k, c = (state.sbShut ||= new Set()); c.has(k) ? c.delete(k) : c.add(k); renderSide(); },
  policy: (el) => { const p = POLICY.find((x) => x.k === el.dataset.k); p.off = !p.off; render(); },
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !ACT[el.dataset.act]) return;
  if (el.tagName === "A") e.preventDefault();
  e.stopPropagation();
  ACT[el.dataset.act](el, e);
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "suAddForm") { e.preventDefault(); const f = new FormData(e.target); if (addPerson(f.get("name"), f.get("email"), f.get("role"))) render(); return; }
  if (e.target.id === "chatForm") { e.preventDefault(); const t = $("#chatIn"); chatSend(t.value); return; }
  if (e.target.id !== "crmAskForm") return;
  e.preventDefault();
  crmAsk($("#crmask").value);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "filter") { state.q = e.target.value; state.hpage = 0; state.crmPg = 0; render(); }
  if (e.target.classList && e.target.classList.contains("proc-in")) { state.process[+e.target.dataset.i] = e.target.value; saveProcess(); return; }
  if (e.target.id === "actq") { state.actQ = e.target.value; render(); }
  if (e.target.id === "calq") { state.calQ = e.target.value; render(); }
  if (e.target.id === "tri-draft") { e.target.dataset.dirty = 1; state.tri.draft = e.target.value; }
});
// Right-click a row or card for the same menu as S.
document.addEventListener("contextmenu", (e) => {
  const row = e.target.closest("[data-ctx]");
  if (!row) return;
  e.preventDefault();
  const a = A[row.dataset.ctx];
  state.focus = a.id;
  const anchor = { left: e.clientX, top: e.clientY, bottom: e.clientY, right: e.clientX, width: 0 };
  openMenu(anchor, [
    { id: "open", label: "Open", icon: ico("arrowR"), hint: "↵" },
    { id: "team", label: a.state === "judgment" ? "Next round with a team…" : "Send to a team…", icon: stIcon("routing"), hint: "A" },
    { id: "pri", label: "Priority…", icon: priIcon(a.pri), hint: "P" },
    { id: "status", label: "Status…", icon: stIcon(a.state), hint: "S" },
    { id: "labels", label: "Labels…", icon: `<i class="ldot" style="background:var(--faint)"></i>`, hint: "L" },
  ], (o) => {
    if (o.id === "open") go(`t~${a.id}`);
    if (o.id === "team") teamPick(anchor, [a.id]);
    if (o.id === "pri") priMenu(anchor, [a.id]);
    if (o.id === "status") statusMenu(anchor, a);
    if (o.id === "labels") labelMenu(anchor, a);
  });
});
// Board: drag a card to another column.
let dragged = null;
document.addEventListener("dragstart", (e) => { const c = e.target.closest && e.target.closest(".card"); if (c) { dragged = c.dataset.tid; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; } });
document.addEventListener("dragend", () => { $$(".card.dragging, .col.over").forEach((x) => x.classList.remove("dragging", "over")); });
document.addEventListener("dragover", (e) => { const col = e.target.closest && e.target.closest("[data-drop]"); if (col && dragged) { e.preventDefault(); $$(".col.over").forEach((x) => x !== col && x.classList.remove("over")); col.classList.add("over"); } });
document.addEventListener("drop", (e) => {
  const col = e.target.closest && e.target.closest("[data-drop]");
  if (!col || !dragged) return;
  e.preventDefault();
  const a = A[dragged]; dragged = null;
  const at = { left: e.clientX, top: e.clientY, bottom: e.clientY, width: 0 };
  const k = col.dataset.drop;
  if (k === "new") { cancel(a); a.state = "new"; a.iv = null; now(a, "me", "Moved back to Applicant Tickets"); touch(a); }
  else if (k === "testbench") { if (!a.tb) { sendTB(a); touch(a); } else toast(`${a.name} already took the Testbench`); }
  else if (k === "bots") teamPick(at, [a.id]);
  else if (k === "closed") openMenu(at, [{ id: "pass", label: "Pass", icon: stIcon("passed") }, { id: "reject", label: "Reject…", icon: stIcon("rejected") }], (o) => (o.id === "pass" ? openPass(a) : openReject(a)), { title: "Close as" });
  else toast(k === "judgment" ? "Applicants land here when the interviewer has weighed in" : "Applicants move here once an interview is booked");
  render();
});
function stepTicket(d) {
  const list = state.lastList.length ? state.lastList : APPLICANTS.map((a) => a.id);
  const cur = state.route.name === "t" ? state.route.id : state.focus;
  let i = list.indexOf(cur);
  i = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + d));
  if (state.route.name === "t") return go(`t~${list[i]}`);
  state.focus = list[i];
  render();
  $(`.trow[data-tid="${list[i]}"]`)?.scrollIntoView({ block: "nearest" });
}
let gPending = 0;
document.addEventListener("keydown", (e) => {
  if (e.target.id === "chatIn" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(e.target.value); return; }
  const k = e.key, lk = k.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && lk === "k") { e.preventDefault(); palette ? closeLayer() : openPalette(); return; }
  if (menu) {
    if (k === "Escape") { e.preventDefault(); const r = closeLayer(); if (r) r(); return; }
    if (k === "ArrowDown" || k === "ArrowUp" || (!mod && (lk === "j" || lk === "k"))) { e.preventDefault(); const dn = k === "ArrowDown" || lk === "j"; menu.hi = (menu.hi + (dn ? 1 : -1) + menu.opts.length) % menu.opts.length; menu.hl(); return; }
    if (k === "Enter") { e.preventDefault(); menu.opts[menu.hi]?.click(); return; }
    if (/^[0-9]$/.test(k)) { const o = menu.opts.find((b) => $(".hint", b)?.textContent === k) || menu.opts[+k - 1]; if (o) { e.preventDefault(); o.click(); } }
    return;
  }
  if (palette) {
    if (k === "Escape") { e.preventDefault(); closeLayer(); return; }
    if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); palette.hi = (palette.hi + (k === "ArrowDown" ? 1 : -1) + palette.items.length) % Math.max(1, palette.items.length); palette.draw(); return; }
    if (k === "Enter") { e.preventDefault(); const it = palette.items[palette.hi]; if (it) { closeLayer(); it.run(); } }
    return;
  }
  if (modal) {
    if (k === "Escape") { e.preventDefault(); closeLayer(); }
    if (mod && k === "Enter") { e.preventDefault(); modal.send(); }
    return;
  }
  const typing = e.target.closest && e.target.closest("input, textarea, [contenteditable='true']");
  if (typing) {
    if (mod && k === "Enter" && e.target.id === "tri-draft") { e.preventDefault(); triSend(); return; }
    if (mod && k === "Enter" && e.target.dataset.compose) { e.preventDefault(); comment(e.target.dataset.compose); return; }
    if (k === "Escape") e.target.blur();
    return;
  }
  if (e.altKey) return;
  const r = state.route.name;
  if (mod && k === "Enter" && r === "triage") { e.preventDefault(); triSend(); return; }
  if (mod) return;
  if (gPending && Date.now() - gPending < 900) {
    gPending = 0;
    const to = { i: "inbox", v: "views", t: "triage", a: "all", l: "calendar", b: "activity", j: "jobs" }[lk];
    if (to) { e.preventDefault(); go(to); return; }
  }
  if (lk === "g") { gPending = Date.now(); return; }
  if (k === "?") { e.preventDefault(); openHelp(); return; }
  if (k === "[") { e.preventDefault(); setSidebar(!state.sbCollapsed); return; }
  if (lk === "z" && toast.undo) { e.preventDefault(); toast.undo(); return; }
  if (r === "interviews") {
    if (lk === "e") { e.preventDefault(); const k = state.route.id || (recordings()[0] || {}).key; if (k) { const s2 = (state.ivReviewed ||= new Set()); s2.has(k) ? s2.delete(k) : s2.add(k); render(); } return; }
    if (lk === "j" || k === "ArrowDown") { e.preventDefault(); ivStep(1); return; }
    if (lk === "k" || k === "ArrowUp") { e.preventDefault(); ivStep(-1); return; }
  }
  if (r === "inbox") {
    if (lk === "j" || k === "ArrowDown") { e.preventDefault(); ibMove(1); return; }
    if (lk === "k" || k === "ArrowUp") { e.preventDefault(); ibMove(-1); return; }
    const id = state.ibSel;
    if (!id) return;
    if (lk === "e") { e.preventDefault(); ibDone(id); return; }
    const iss = issueOf(A[id]);
    if (lk === "f" && iss && iss.k !== "decide") { e.preventDefault(); ACT[iss.act.a]({ dataset: { id: iss.act.id } }); return; }
    if (k === "/") { e.preventDefault(); openPalette(id); return; }
    if (iss && iss.k === "decide" && ["a", "o", "r"].includes(lk)) { e.preventDefault(); ACT[{ a: "advance", o: "offer", r: "reject" }[lk]]({ dataset: { id } }); return; }
    if (k === "Enter") { e.preventDefault(); go(`t~${id}`); return; }
    return;
  }
  if (r === "triage") {
    if (lk === "j" || k === "ArrowDown") { e.preventDefault(); triMove(1); return; }
    if (lk === "k" || k === "ArrowUp") { e.preventDefault(); triMove(-1); return; }
    const m = { i: "interview", t: "testbench", d: "decline" }[lk];
    if (m) { e.preventDefault(); Object.assign(state.tri, { mode: m, draft: null }); render(); return; }
    if (k === "Enter" && state.tri && state.tri.sel) { e.preventDefault(); go(`t~${state.tri.sel}`); return; }
    if (k === "Escape") go("inbox");
    return;
  }
  if (r === "all") {
    if (lk === "j" || k === "ArrowDown") { e.preventDefault(); stepTicket(1); return; }
    if (lk === "k" || k === "ArrowUp") { e.preventDefault(); stepTicket(-1); return; }
    if (lk === "f" || k === "/") { e.preventDefault(); $("#filter")?.focus(); return; }
    if (lk === "b") { e.preventDefault(); state.view = (state.view || "board") === "board" ? "list" : "board"; render(); return; }
    if (k === "Escape" && picked.size) { picked.clear(); render(); return; }
    const a = A[state.focus];
    if (!a) return;
    const anchor = $(`.trow[data-tid="${a.id}"] .title`) || { left: innerWidth / 2 - 110, top: 160, bottom: 160 };
    const ids = picked.size ? [...picked] : [a.id];
    if (k === "Enter") { e.preventDefault(); go(`t~${a.id}`); return; }
    if (lk === "x") { e.preventDefault(); picked.has(a.id) ? picked.delete(a.id) : picked.add(a.id); render(); return; }
    if (lk === "a") { e.preventDefault(); teamPick(anchor, ids); return; }
    if (lk === "p") { e.preventDefault(); priMenu(anchor, ids); return; }
    if (lk === "s") { e.preventDefault(); statusMenu(anchor, a); return; }
    if (lk === "l") { e.preventDefault(); labelMenu(anchor, a); return; }
    return;
  }
  if (r === "calendar") {
    if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); state.calOff = (state.calOff || 0) + (k === "ArrowLeft" ? -1 : 1); render(); return; }
    const m = { d: "day", w: "week", m: "month" }[lk];
    if (m) { e.preventDefault(); state.calMode = m; state.calOff = 0; render(); return; }
    if (k === ".") { e.preventDefault(); state.calOff = 0; render(); return; }
  }
  if (lk === "t") { e.preventDefault(); go("triage"); return; }
  if (r === "t") {
    const a = A[state.route.id];
    const anchor = $(".chips") || { left: 300, top: 160, bottom: 160 };
    if (lk === "j" || k === "ArrowDown") { e.preventDefault(); stepTicket(1); return; }
    if (lk === "k" || k === "ArrowUp") { e.preventDefault(); stepTicket(-1); return; }
    if (lk === "a" && isOpen(a)) { e.preventDefault(); a.state === "judgment" ? ACT.advance($('[data-act="advance"]') || { dataset: { id: a.id }, getBoundingClientRect: () => anchor.getBoundingClientRect() }) : teamPick(anchor, [a.id]); return; }
    if (lk === "p") { e.preventDefault(); priMenu(anchor, [a.id]); return; }
    if (lk === "s") { e.preventDefault(); statusMenu(anchor, a); return; }
    if (lk === "l") { e.preventDefault(); labelMenu(anchor, a); return; }
    if (lk === "o" && a.state === "judgment") { e.preventDefault(); openOffer(a); return; }
    if (lk === "r" && a.state === "judgment") { e.preventDefault(); openReject(a); return; }
    if (lk === "c") { e.preventDefault(); $("#cmt")?.focus(); return; }
    if (k === "Escape") go(state.backTo && !state.backTo.startsWith("t~") && !state.backTo.startsWith("run~") ? state.backTo : "all");
  }
});

/* ---------------- hover cards: hover a name or avatar in any list to see who it is ---------------- */
function hcApplicant(a) {
  const t = a.team && TEAMS[a.team];
  const row = (k, v) => `<div class="hcard-r"><span>${k}</span><span>${v}</span></div>`;
  return `<div class="hcard-top">${candAv(a, "xl")}<div class="grow"><b>${esc(a.name)}</b><span>${esc(a.hl)} · ${esc(a.loc)}</span></div></div>
    <div class="hcard-state">${stIcon(a.state)}<span>${esc(STATES[a.state].name)}</span><span class="faint">· ${esc(headline(a))}</span></div>
    <div class="hcard-rows">
      ${row("Role", esc(ROLES[a.role].title))}
      ${row("Source", `${handle(a)}<span class="faint">${esc(srcLong(a))} · day ${dayN(a)}</span>`)}
      ${row("Team", t ? `${teamKey(a.team)}${esc(t.name)}` : `<span class="faint">Not sent to a team</span>`)}
      ${row("Testbench", a.tb && a.tb.state === "done" ? `<b>${tbScore(a)}</b><span class="faint">better than ${a.tb.pct}%</span>` : `<span class="faint">${a.tb ? "In progress" : "Not sent"}</span>`)}
      ${a.iv ? row("Interviewer", `${personAv(a.iv)}${esc(PEOPLE[a.iv].name)}`) : ""}
    </div>
    <div class="hcard-foot"><a class="btn sm" href="#t~${a.id}">Open ticket</a></div>`;
}
function hcPerson(id) {
  const p = PEOPLE[id], t = p.team && TEAMS[p.team];
  return `<div class="hcard-top">${personAv(id, "xl")}<div class="grow"><b>${esc(p.name)}</b><span>${esc(p.role)}${t ? ` · ${esc(t.name)}` : ""}</span></div></div>
    ${p.team ? `<div class="hcard-rows">
      <div class="hcard-r"><span>Interviews</span><span>${likesLabel(p)}<span class="faint">· ${p.quiet ? "away" : `${p.load} of ${p.cap} this week`}</span></span></div>
      <div class="hcard-r"><span>Knows</span><span>${esc(p.focus.join(", "))}</span></div>
      <div class="hcard-r"><span>Grokbot</span><span>${esc(possessive(first(id)))} assistant, over ${CH_NAME[p.ch]}</span></div>
      <div class="hcard-r"><span>Right now</span><span>${nowDoing(id)}</span></div>
    </div>
    <div class="hcard-foot"><a class="btn sm" href="#bots~people">See interviewers</a></div>` : ""}`;
}
let hc = null, hcShowT = 0, hcHideT = 0;
function hideHc() { clearTimeout(hcShowT); if (hc) { hc.el.remove(); hc = null; } }
function showHc(t) {
  const [kind, id] = t.dataset.hc.split(":");
  if ((kind === "a" && !A[id]) || (kind === "p" && !PEOPLE[id])) return;
  hideHc();
  const el = document.createElement("div");
  el.className = "hcard";
  el.setAttribute("role", "tooltip");
  el.innerHTML = kind === "a" ? hcApplicant(A[id]) : hcPerson(id);
  document.body.appendChild(el);
  const r = t.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  let x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let y = r.bottom + 6;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
  hc = { el, for: t };
}
// Show after a short rest on a name or avatar; stay open while the pointer moves into the card.
document.addEventListener("pointerover", (e) => {
  if (e.pointerType === "touch" || !e.target.closest) return;
  if (e.target.closest(".hcard")) { clearTimeout(hcHideT); return; }
  const t = e.target.closest("[data-hc]");
  if (!t || t.closest("#layer, .hcard") || menu || modal || palette || pop || document.body.classList.contains("dragging")) {
    clearTimeout(hcShowT);
    if (hc) { clearTimeout(hcHideT); hcHideT = setTimeout(hideHc, 160); }
    return;
  }
  clearTimeout(hcHideT);
  if (hc && hc.for === t) return;
  clearTimeout(hcShowT);
  hcShowT = setTimeout(() => showHc(t), hc ? 60 : 420);
});
document.addEventListener("pointerdown", (e) => { if (!e.target.closest || !e.target.closest(".hcard")) hideHc(); }, true);
document.addEventListener("scroll", () => hideHc(), true);

/* ---------------- sidebar: drag to resize, collapse to an icon rail ---------------- */
const SB_KEY = "tats.sidebar.v1";
function saveSidebar() { try { localStorage.setItem(SB_KEY, JSON.stringify({ w: state.sbWidth, c: state.sbCollapsed })); } catch {} }
function applySidebar() {
  const app = $("#app");
  app.classList.toggle("sb-collapsed", !!state.sbCollapsed);
  if (state.sbWidth) app.style.setProperty("--sbw", `${state.sbWidth}px`); else app.style.removeProperty("--sbw");
}
function setSidebar(collapsed) { state.sbCollapsed = collapsed; applySidebar(); saveSidebar(); renderSide(); fitCalendar(); }
try { const sv = JSON.parse(localStorage.getItem(SB_KEY) || "null"); if (sv) { state.sbWidth = sv.w || null; state.sbCollapsed = !!sv.c; } } catch {}
{
  const h = $("#sbResize");
  let drag = null;
  const clampW = (w) => Math.max(200, Math.min(380, Math.round(w)));
  h.addEventListener("pointerdown", (e) => {
    if (state.sbCollapsed) return;
    drag = { x: e.clientX, w: $("#side").getBoundingClientRect().width };
    document.body.classList.add("sb-dragging");
    try { h.setPointerCapture(e.pointerId); } catch {}
  });
  h.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const w = drag.w + e.clientX - drag.x;
    if (w < 140) { drag = null; document.body.classList.remove("sb-dragging"); return setSidebar(true); }
    state.sbWidth = clampW(w);
    applySidebar();
  });
  const end = () => { if (!drag) return; drag = null; document.body.classList.remove("sb-dragging"); saveSidebar(); fitCalendar(); };
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
  h.addEventListener("dblclick", () => { state.sbWidth = null; applySidebar(); saveSidebar(); fitCalendar(); });
  h.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    state.sbWidth = clampW(($("#side").getBoundingClientRect().width) + (e.key === "ArrowRight" ? 16 : -16));
    applySidebar(); saveSidebar();
  });
}
applySidebar();

/* ---------------- boot ---------------- */
APPLICANTS.forEach((a) => seen.set(a.id, Date.now() - 16 * HR));
// Anything quiet for two days that doesn't need you starts out cleared.
inboxItems("all").filter((x) => !x.you && Date.now() - x.oat > 2 * DAY).forEach((x) => archived.set(x.a.id, Date.now() - 16 * HR));
state.route = parseHash();
render();
// Two tickets keep moving on their own, so the board is visibly live.
setTimeout(() => {
  const a = A["APP-121"];
  if (a.state !== "routing") return;
  const pick = RUNS.find((r) => r.a === a.id && !r.end);
  book(a, pickInterviewer(a.team, a.role).best, 1, 0, pick);
}, 5000);
setTimeout(() => {
  const a = A["APP-120"];
  if (a.state !== "asked") return;
  const ask = RUNS.find((r) => r.a === a.id && !r.end);
  a.state = "scheduling"; a.slots = slotsFor(a);
  endRun(ask, now(a, a.iv, "Y", { ch: chOf(a.iv), bubble: true, run: ask }).at);
  const sch = startRun(a, "Schedule the interview", a.iv, Date.now(), "gmail");
  now(a, `bot:${a.iv}`, `Drafted the invite in ${nm(a.iv)}'s Gmail`, { ch: "gmail", draft: true, run: sch });
  waitOn(sch, a.iv);
  touch(a);
}, 14000);
setInterval(() => { if (!menu && !palette && !modal && state.route.name !== "triage" && !document.activeElement.closest("input, textarea, [contenteditable='true']")) render(); }, 30000);
