/* ---------------- Grokbot in a thread (?surface=thread) ----------------
   What tATS looks like when nobody opens tATS: someone asks the Grokbot in Slack, and it answers in the
   thread with three layers, each working without the next:
     1. a sentence that carries the answer (the number is in it), for notifications, phones and screen readers;
     2. one card, a 1200 x 675 PNG the server renders from the same spec as these, for the shape of it;
     3. Block Kit buttons: at most one primary action, then "Open in tATS".
   This page is the test bench for every case the Grokbot can hit: each one is drawn in a Slack frame you can
   switch between light and dark, desktop, the thread pane and a phone, and checked for type too small to
   read and anything that spills off the card. */
const TH_W = 1200, TH_H = 675;
const TH_DW = { desktop: 480, thread: 400, mobile: 320 }; // how wide Slack draws the image
const TH_MIN = 9; // smallest readable type, in screen px, at the narrowest width
const TH = { slack: "light", width: "desktop", card: "light" };
try { Object.assign(TH, JSON.parse(localStorage.getItem("tats.thread") || "{}")); } catch {}
const thSave = () => { try { localStorage.setItem("tats.thread", JSON.stringify(TH)); } catch {} };

/* ---------- data helpers: seeded, so every load draws the same ---------- */
const thRand = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const thSeries = (n, base, amp, seed, trend = 0) => { const r = thRand(seed); return Array.from({ length: n }, (_, i) => Math.max(0, Math.round(base + trend * i + (r() - 0.5) * amp + Math.sin(i / 2.2) * amp * 0.25))); };
const thDay = (ago) => { const d = new Date(NOW - ago * DAY); return `${d.getDate()} ${MO[d.getMonth()]}`; };
const thMon = (ago) => MO[new Date(NOW - ago * 30.4 * DAY).getMonth()];
const thStamp = (ago = 0) => { const d = new Date(NOW - ago); return `${d.getDate()} ${MO[d.getMonth()]}, ${fmtTime(d.getTime())}`; };
const thSum = (xs) => xs.reduce((a, b) => a + b, 0);
const thInit = (n) => n.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const thAv = (name, color = "#6b7a90") => `<span class="ac-av" style="background:${color}">${esc(thInit(name))}</span>`;
const thPAv = (id) => thAv(PEOPLE[id].name, PEOPLE[id].color);

/* ---------- card parts, drawn in card pixels (1200 wide) ---------- */
const AC_ICO = {
  lock: "M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9Z",
  check: "m3 8.5 3 3 7-7",
  clock: "M8 4.5V8l2.5 1.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z",
  up: "M8 13V3M4 7l4-4 4 4", down: "M8 3v10M4 9l4 4 4-4",
};
const acIco = (k) => `<svg class="ac-i" viewBox="0 0 16 16" aria-hidden="true"><path d="${AC_ICO[k]}"/></svg>`;
function acDelta(d) {
  if (!d) return "";
  if (d.none) return `<span class="ac-dl none">${esc(d.none)}</span>`;
  const up = d.pct >= 0, good = up === (d.good !== false);
  return `<span class="ac-dl ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(d.pct)}%<em>${esc(d.vs || "")}</em></span>`;
}
// A line: this period solid with a fade under it and a dot on today; the period before lighter behind it.
let acN = 0;
function acLine({ cur, prev, w, h, target, ann, xl, unit = "" }) {
  const n = cur.length, max = Math.max(...cur, ...(prev || []), target || 0, 1) * 1.14;
  const x = (i, k = n) => (k === 1 ? w / 2 : (i / (k - 1)) * w), y = (v) => h - 3 - (v / max) * (h - 14);
  const path = (vs) => vs.map((v, i) => `${i ? "L" : "M"}${x(i, vs.length).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const id = `acf${++acN}`, last = cur[n - 1];
  const grid = [0.25, 0.5, 0.75].map((f) => `<path class="ac-gl" d="M0 ${(h * f).toFixed(1)}H${w}"/>`).join("");
  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="ac-fs" stop-opacity=".22"/><stop offset="1" class="ac-fs" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="ac-base" d="M0 ${h - 1.5}H${w}"/>
    ${target != null ? `<path class="ac-tg" d="M0 ${y(target).toFixed(1)}H${w}"/>` : ""}
    ${prev ? `<path class="ac-l2" d="${path(prev)}"/>` : ""}
    ${n > 1 ? `<path d="${path(cur)}L${w} ${h}L0 ${h}Z" fill="url(#${id})"/><path class="ac-l1" d="${path(cur)}"/>` : `<path class="ac-l2 dash" d="M0 ${y(last).toFixed(1)}H${w}"/>`}
  </svg>`;
  const dot = `<i class="ac-dot" style="left:${x(n - 1)}px;top:${y(last)}px"></i>`;
  const tl = target != null ? `<span class="ac-tgl" style="top:${y(target)}px">${esc(target.l || `Target ${target}${unit}`)}</span>` : "";
  const an = ann ? `<span class="ac-ann ${x(ann.i) > w * 0.7 ? "r" : ""}" style="left:${x(ann.i)}px;top:${y(cur[ann.i])}px">${esc(ann.l)}</span>` : "";
  return `<div class="ac-chart"><div class="ac-plot" style="width:${w}px;height:${h}px">${svg}${dot}${tl}${an}</div>
    <div class="ac-xl" style="width:${w}px">${(xl || []).map((l) => `<span>${esc(l)}</span>`).join("")}</div></div>`;
}
// How long the open ones have waited: one bar per bucket, red past the target.
function acHist(bins, h = 300) {
  const max = Math.max(...bins.map((b) => b.n), 1);
  return `<div class="ac-hist" style="height:${h}px">${bins.map((b) => `<div><b>${b.n || ""}</b><i class="${b.over ? "over" : ""}" style="height:${b.n ? Math.max(4, (b.n / max) * 100) : 0}%"></i><span>${esc(b.l)}</span></div>`).join("")}</div>`;
}
// Ranked rows: name, bar, value. More than fit become one "+ N more" row.
function acBars(rows, { fit = 6, more, fmt = (v) => v } = {}) {
  const shown = rows.slice(0, fit), rest = rows.length - shown.length, max = Math.max(...rows.map((r) => r.v), 1);
  return `<div class="ac-bars">${shown.map((r) => `<div class="ac-br ${r.flag ? "flag" : ""}">${r.av || ""}<span class="ac-tr">${esc(r.l)}</span><span class="ac-bt"><i style="width:${Math.max(1.5, (r.v / max) * 100)}%"></i></span><b>${esc(fmt(r.v, r))}</b></div>`).join("")}
    ${rest > 0 || more ? `<div class="ac-more">${esc(more || `+ ${rest} more`)}</div>` : ""}</div>`;
}
const AC_VERD = { pass: ["Pass", "ok"], mixed: ["Mixed", "amber"], fail: ["Fail", "red"], pending: ["Read pending", "mut"] };
const acVerd = (k) => `<span class="ac-vd ${AC_VERD[k][1]}">${AC_VERD[k][0]}</span>`;
const acPriv = (what) => `<div class="ac-priv">${acIco("lock")}<span>${esc(what)}</span></div>`;

// One card: the header says whose data and what slice, the title is the question answered, the footer says when.
function acCard(c) {
  const body = AC_BODY[c.kind](c);
  return `<div class="ac ${c.kind} ${TH.card === "dark" ? "dk" : ""}" role="img" aria-label="${esc(c.alt)}">
    <div class="ac-top"><span class="ac-org"><i class="mark ac-mark"></i>${esc(ORG.name)}</span><span class="ac-scope ac-tr">${esc(c.scope || "")}</span></div>
    <div class="ac-t ac-tr">${esc(c.t)}</div>
    <div class="ac-b">${body}</div>
    <div class="ac-f"><span>${c.stale ? `<i class="ac-stale"></i>` : ""}${esc(c.asof || `As of ${thStamp()}`)}</span><span class="ac-tr">${esc(c.url || "ats.tacitawareness.com")}</span></div>
  </div>`;
}
const AC_BODY = {
  kpi: (c) => `<div class="ac-kpi"><div class="ac-hero"><div class="ac-v ${c.over ? "bad" : ""}">${esc(c.v)}${c.vu ? `<small>${esc(c.vu)}</small>` : ""}</div>
      <div class="ac-vl">${esc(c.vl)}</div>${acDelta(c.delta)}${c.note ? `<div class="ac-note ${c.over ? "bad" : ""}">${esc(c.note)}</div>` : ""}</div>
      <div class="ac-viz">${c.hist ? acHist(c.hist, 320) : acLine({ cur: c.cur, prev: c.prev, w: 640, h: 300, xl: c.xl, target: c.target, ann: c.ann })}</div></div>`,
  trend: (c) => `<div class="ac-trend"><div class="ac-row"><div class="ac-v sm">${esc(c.v)}</div>${acDelta(c.delta)}${c.legend ? `<span class="ac-leg"><i class="l1"></i>${esc(c.legend[0])}<i class="l2"></i>${esc(c.legend[1])}</span>` : ""}${c.note ? `<span class="ac-note r">${esc(c.note)}</span>` : ""}</div>
      ${acLine({ cur: c.cur, prev: c.prev, w: 1080, h: 216, xl: c.xl, ann: c.ann })}</div>`,
  stages: (c) => { const tot = thSum(c.parts.map((p) => p.n)) || 1;
    return `<div class="ac-stg"><div class="ac-row"><div class="ac-v sm">${c.v}</div><div class="ac-vl inl">${esc(c.vl)}</div></div>
      <div class="ac-seg">${c.parts.map((p, i) => `<i class="s${i} ${p.stuck ? "st" : ""}" style="flex:${p.n}"></i>`).join("")}</div>
      <div class="ac-sgl">${c.parts.map((p, i) => `<div><i class="s${i}"></i><span class="ac-tr">${esc(p.l)}</span><b>${p.n}</b><em>${Math.round((p.n / tot) * 100)}%</em>${p.stuck ? `<span class="ac-pill bad">${p.stuck} stuck</span>` : `<span></span>`}</div>`).join("")}</div></div>`; },
  bars: (c) => `<div class="ac-col">${c.sub ? `<div class="ac-sub">${esc(c.sub)}</div>` : ""}${acBars(c.rows, { fit: c.fit || 5, more: c.more, fmt: c.fmt })}</div>`,
  table: (c) => { const fit = 5, rest = c.total - Math.min(fit, c.rows.length);
    return `<div class="ac-col"><div class="ac-tbl"><div class="ac-tr-h">${c.cols.map((h) => `<span>${esc(h)}</span>`).join("")}</div>
      ${c.rows.slice(0, fit).map((r) => `<div class="ac-trw"><span class="ac-who">${thAv(r[0], r.color)}<b class="ac-tr">${esc(r[0])}</b></span>${r.slice(1).map((v) => `<span class="ac-tr">${esc(v)}</span>`).join("")}</div>`).join("")}</div>
      ${rest > 0 ? `<div class="ac-more">+ ${rest.toLocaleString()} more in tATS</div>` : ""}</div>`; },
  ticket: (c) => `<div class="ac-tk"><div class="ac-tkh">${thAv(c.name, c.color)}<div class="ac-tkn"><b class="ac-tr">${esc(c.name)}</b><span class="ac-tr">${esc(c.role)}</span></div>${c.tag ? `<span class="ac-pill">${esc(c.tag)}</span>` : ""}</div>
      <div class="ac-path">${c.path.map((p, i) => `<div class="${i < c.at ? "done" : i === c.at ? "now" : ""}"><i></i><span class="ac-tr">${esc(p)}</span></div>`).join("")}</div>
      <div class="ac-tks"><div><span>Waiting on</span><b class="ac-tr">${esc(c.waiting)}</b></div><div><span>In stage</span><b class="${c.over ? "bad" : ""}">${esc(c.time)}</b></div><div><span>Next</span><b class="ac-tr">${esc(c.next)}</b></div></div></div>`,
  read: (c) => `<div class="ac-rd"><div class="ac-rdh">${thPAv(c.iv)}<div class="ac-tkn"><b class="ac-tr">${esc(PEOPLE[c.iv].name)} on ${esc(c.cand)}</b><span class="ac-tr">${esc(c.round)}</span></div>${acVerd(c.verdict)}</div>
      <div class="ac-rdb"><div class="ac-skills">${c.skills.map(([l, v]) => `<div><span class="ac-tr">${esc(l)}</span><span class="ac-dots">${[1, 2, 3, 4].map((k) => `<i class="${k <= v ? "on" : ""}"></i>`).join("")}</span></div>`).join("")}</div>
      ${c.private ? acPriv("Notes stay private in channels. Sent to you directly.") : `<div class="ac-quote">${esc(c.summary)}</div>`}</div></div>`,
  compare: (c) => `<div class="ac-cmp">${c.who.map((w) => `<div class="ac-cmpc"><div class="ac-tkh">${thAv(w.name, w.color)}<div class="ac-tkn"><b class="ac-tr">${esc(w.name)}</b><span class="ac-tr">${esc(w.src)}</span></div></div>
      ${w.rows.map(([l, v, k]) => `<div class="ac-cmpr"><span>${esc(l)}</span>${k ? acVerd(k) : `<b class="ac-tr">${esc(v)}</b>`}</div>`).join("")}</div>`).join("")}</div>`,
  schedule: (c) => `<div class="ac-col"><div class="ac-ag">${c.rows.slice(0, 5).map((r) => `<div class="ac-agr ${r.now ? "now" : ""}"><b>${esc(r.t)}</b><span class="ac-ago">${thPAv(r.iv)}<span class="ac-tr"><b>${esc(r.cand)}</b> with ${esc(first(r.iv))}</span></span><em class="ac-tr">${esc(r.round)}</em></div>`).join("")}</div>
      ${c.rows.length > 5 ? `<div class="ac-more">+ ${c.rows.length - 5} more today</div>` : ""}</div>`,
  offer: (c) => `<div class="ac-col"><div class="ac-ag">${c.rows.map((r) => `<div class="ac-agr"><span class="ac-ago">${thAv(r.name, r.color)}<span class="ac-tr"><b>${esc(r.name)}</b> · ${esc(r.role)}</span></span><span class="ac-wt">${thPAv(r.by)}<em>${esc(r.wait)}</em></span></div>`).join("")}</div>
      ${acPriv("Offer terms are never posted to a channel. Approvers get them in a DM.")}</div>`,
  funnel: (c) => { const max = c.steps[0][1];
    return `<div class="ac-fun">${c.steps.map(([l, n], i) => `<div class="ac-fnr"><span class="ac-tr">${esc(l)}</span><span class="ac-fnb"><i style="width:${(n / max) * 100}%"></i></span><b>${n.toLocaleString()}</b><em>${i ? `${Math.round((n / c.steps[i - 1][1]) * 100)}%` : ""}</em></div>`).join("")}</div>`; },
  process: (c) => `<div class="ac-proc">${c.steps.map((s) => Array.isArray(s) ? `<div class="ac-split">${s.map((x) => `<span class="ac-pst">${esc(x)}</span>`).join("")}</div>` : `<span class="ac-pst ${s === c.new ? "new" : /Offer/.test(s) ? "end" : ""}">${esc(s)}</span>`).join(`<i class="ac-arr"></i>`)}</div>
      ${c.note ? `<div class="ac-note">${esc(c.note)}</div>` : ""}`,
  unfurl: (c) => AC_BODY.ticket(c),
};

/* ---------- the test cases ---------- */
// Each case: where it was asked, who asked, the Grokbot's reply (text, card, buttons, context), and what it tests.
const XL30 = [thDay(29), thDay(15), "Today"];
const C_APPS = thSeries(30, 14, 9, 7, 0.08), C_APPS_P = thSeries(30, 12, 8, 31);
const C_SPIKE = (() => { const s = thSeries(30, 11, 6, 19); s[21] = 96; s[22] = 41; return s; })();
const C_YEAR = thSeries(52, 60, 30, 5, 1.1);
const TH_CASES = [
  // Numbers
  { g: "Numbers", id: "kpi-up", name: "A number, going the right way", tests: "Hero number, green delta against the period before, line with last period behind it",
    where: "#hiring", asker: "daniel", ask: "how many applications this month?",
    text: `*${thSum(C_APPS)} applications* in the last 30 days, up 18% on the 30 before. Engineering brought in 61% of them.`,
    card: { kind: "kpi", t: "New applications", scope: "Last 30 days · All teams", v: String(thSum(C_APPS)), vl: "applications", delta: { pct: 18, vs: "vs the 30 days before" }, cur: C_APPS, prev: C_APPS_P, xl: XL30, alt: `Line chart of applications per day over the last 30 days: ${thSum(C_APPS)} in total, up 18%.` },
    btns: [["Open Analytics"]] },
  { g: "Numbers", id: "kpi-over", name: "A number past its target", tests: "Red value, red bars past the target, who's waiting longest in the text",
    where: "#hiring", asker: "daniel", ask: "how long are we taking to schedule interviews?",
    text: `Typical time to schedule is *2.6 days*, over your 2-day target. 14 candidates are waiting; the longest is Maya Chen at 6 days, on Wei's calendar.`,
    card: { kind: "kpi", t: "Time to schedule", scope: "Last 30 days · All teams", v: "2.6", vu: "days", vl: "typical, ready to booked", over: 1, note: "Target 2 days · 14 waiting",
      hist: [{ l: "<1d", n: 3 }, { l: "1–2d", n: 4 }, { l: "2–3d", n: 4, over: 1 }, { l: "3–5d", n: 2, over: 1 }, { l: "5d+", n: 1, over: 1 }], alt: "Bar chart of 14 candidates waiting to be scheduled, 7 past the 2-day target." },
    btns: [["Nudge Wei", 1], ["Open in tATS"]] },
  { g: "Numbers", id: "kpi-noprior", name: "Nothing to compare against", tests: "No delta arrow when there's no prior period: says so instead of showing 0%",
    where: "dm", ask: "how many people applied to the inference role?",
    text: `*38 applications* since Staff Engineer, Inference opened 9 days ago. It's the first period, so there's nothing to compare yet.`,
    card: { kind: "kpi", t: "Staff Engineer, Inference", scope: "Since it opened · 9 days", v: "38", vl: "applications", delta: { none: "First period · nothing to compare" }, cur: thSeries(9, 4, 5, 3), xl: [thDay(8), thDay(4), "Today"], alt: "Line chart of 38 applications over 9 days." },
    btns: [["Open the posting"]] },
  { g: "Numbers", id: "kpi-huge", name: "A very large number", tests: "Five and six figure values stay on one line: 128k on the card, the exact count in the text",
    where: "dm", ask: "how many applications have we had all time?",
    text: `*128,406 applications* since Meridian started on tATS in March 2024. 2,412 this year.`,
    card: { kind: "kpi", t: "Applications, all time", scope: "Since Mar 2024 · All teams", v: "128.4k", vl: "applications", delta: { pct: 42, vs: "vs the year before" }, cur: thSeries(32, 3500, 1400, 11, 60), xl: ["Mar 2024", thMon(16), thMon(0)], alt: "Line chart of 128,406 applications by month since March 2024." },
    btns: [["Open Analytics"]] },
  // Trends
  { g: "Trends", id: "trend-compare", name: "This period against the last", tests: "Two lines need a legend; the lighter one is the period before",
    where: "#hiring", asker: "lena", ask: "are we getting more applicants than last month?",
    text: `Yes. *${thSum(C_APPS)}* this month against *${thSum(C_APPS_P)}* the month before, up 18%. The gap opened in the last two weeks.`,
    card: { kind: "trend", t: "Applications over time", scope: "Last 30 days · All teams", v: String(thSum(C_APPS)), delta: { pct: 18, vs: "vs last period" }, legend: ["This period", "Last period"], cur: C_APPS, prev: C_APPS_P, xl: XL30, alt: "Two-line chart comparing applications per day this month and last month." },
    btns: [["Open Analytics"]] },
  { g: "Trends", id: "trend-one", name: "One day of data", tests: "A single point can't be a line: one dot, a dashed level, and a note",
    where: "dm", ask: "how's the evals posting doing?",
    text: `Research Engineer, Evals went live yesterday: *6 applications* so far. I'll have a trend after a few more days.`,
    card: { kind: "trend", t: "Research Engineer, Evals", scope: "Since yesterday · Research", v: "6", delta: { none: "1 day of data" }, cur: [6], xl: ["", "Yesterday", ""], note: "A trend shows once there are 3 days.", alt: "6 applications in the first day." },
    btns: [["Open the posting"]] },
  { g: "Trends", id: "trend-zero", name: "All zeros", tests: "A flat zero line still draws, and the text says why (the role is paused)",
    where: "dm", ask: "any designers applying?",
    text: `None in the last 30 days. Founding Product Designer has been *paused since ${thDay(34)}*, so it isn't on the careers page.`,
    card: { kind: "trend", t: "Founding Product Designer", scope: "Last 30 days · Product", v: "0", delta: { none: "Paused · not on the careers page" }, cur: Array(30).fill(0), xl: XL30, alt: "Flat line: no applications in 30 days, the role is paused." },
    btns: [["Unpause it", 1], ["Open the posting"]] },
  { g: "Trends", id: "trend-spike", name: "One huge day", tests: "An outlier keeps the scale honest and gets a label, so the rest doesn't read as flat by mistake",
    where: "#hiring", asker: "daniel", ask: "what happened with applications last week?",
    text: `The Hacker News post on ${thDay(8)} brought *96 applications in a day*, 8 times a normal day. 11 of them are in New Applicants.`,
    card: { kind: "trend", t: "Applications per day", scope: "Last 30 days · Engineering", v: String(thSum(C_SPIKE)), delta: { pct: 64, vs: "vs last period" }, cur: C_SPIKE, xl: XL30, ann: { i: 21, l: "HN post · 96" }, alt: "Line chart with one spike of 96 applications on the day of a Hacker News post." },
    btns: [["Review the 11", 1], ["Open Analytics"]] },
  { g: "Trends", id: "trend-year", name: "A year, week by week", tests: "52 points, month labels, a rising line that never touches the title",
    where: "dm", ask: "show me hiring volume for the year",
    text: `*${thSum(C_YEAR).toLocaleString()} applications* over the last 52 weeks, roughly doubling from ${thMon(12)} to now.`,
    card: { kind: "trend", t: "Applications per week", scope: "Last 12 months · All teams", v: thSum(C_YEAR).toLocaleString(), delta: { pct: 96, vs: "vs the year before" }, cur: C_YEAR, xl: [thMon(12), thMon(8), thMon(4), thMon(0)], alt: "Line chart of weekly applications over a year, rising." },
    btns: [["Open Analytics"]] },
  // Breakdowns
  { g: "Breakdowns", id: "stages", name: "Where everyone is", tests: "Stage split with counts, shares and a red stuck pill; stage names come from the company's process",
    where: "#hiring", asker: "daniel", ask: "where are candidates getting stuck?",
    text: `*9 of 62* active candidates are stuck. Most are *with Grokbots* (5), waiting on an interviewer to say yes. Wei and Noor are both heads-down this week.`,
    card: { kind: "stages", t: "Candidates in process", scope: "Now · All teams", v: "62", vl: "active candidates",
      parts: [{ l: "New", n: 11, stuck: 2 }, { l: "Testbench", n: 14 }, { l: "With Grokbots", n: 19, stuck: 5 }, { l: "Interviewing", n: 12 }, { l: "Your call", n: 6, stuck: 2 }], alt: "Stacked bar of 62 candidates by stage, 9 stuck." },
    btns: [["Show the 9 stuck", 1], ["Open Applicant Tickets"]] },
  { g: "Breakdowns", id: "sources-many", name: "Too many categories", tests: "14 sources: the top 5 drawn, the other 9 folded into one row",
    where: "dm", ask: "where do our applicants come from?",
    text: `Careers page leads with *42%*, then LinkedIn (20%) and referrals (14%). 9 smaller sources make up the last 8%.`,
    card: { kind: "bars", t: "Where applicants come from", scope: "Last 90 days · All teams", sub: "1,184 applications",
      rows: [["Careers page", 497], ["LinkedIn", 237], ["Referrals", 166], ["Sourced by Tacit", 142], ["Hacker News", 47], ...["Twitter", "GitHub", "Wellfound", "YC Work at a Startup", "Conference", "University", "Newsletter", "Discord", "Other"].map((l, i) => [l, 18 - i * 2])].map(([l, v]) => ({ l, v })),
      fmt: (v) => `${Math.round((v / 1184) * 100)}%`, more: "+ 9 more sources · 8%", alt: "Bar chart of applicant sources, careers page first at 42%." },
    btns: [["Open Analytics"]] },
  { g: "Breakdowns", id: "rank-iv", name: "Who's slowest", tests: "People ranked with faces; past the target turns the bar red",
    where: "#interviews", asker: "daniel", ask: "who takes longest to submit feedback?",
    text: `*Wei* (2.4 days) and *Theo* (1.9 days) are past the 1-day target. Wei owes 2 reads right now.`,
    card: { kind: "bars", t: "Time to submit feedback", scope: "Last 90 days · by interviewer", sub: "Typical, interview to read · target 1 day",
      rows: [["wei", 58, 1], ["theo", 46, 1], ["noor", 22], ["marcus", 17], ["daniel", 12], ["sam", 9], ["aisha", 6], ["lena", 5]].map(([id, v, f]) => ({ l: PEOPLE[id].name, v, flag: f, av: thPAv(id) })),
      fmt: (v) => (v >= 24 ? `${(v / 24).toFixed(1)}d` : `${v}h`), fit: 5, alt: "Bar chart of typical feedback time by interviewer, Wei slowest at 2.4 days." },
    btns: [["Nudge Wei and Theo", 1], ["Open Interview Judgement"]] },
  { g: "Breakdowns", id: "rank-long", name: "Long names and ties", tests: "A long name truncates with … before it touches the bar; tied values keep the same order every time",
    where: "dm", ask: "top referrers this year?",
    text: `*Sam Whitaker* leads with 4 hires from referrals. Three people are tied at 2.`,
    card: { kind: "bars", t: "Top referrers by hires", scope: "This year · All teams",
      rows: [["Sam Whitaker", 4], ["Alexandria Konstantinopoulou-Whitfield", 3], ["Aisha Karim", 2], ["Jonah Reyes", 2], ["Marcus Bell", 2], ["Li Na", 1]].map(([l, v]) => ({ l, v, av: thAv(l, "#6f7a8c") })), fit: 5, alt: "Bar chart of top referrers by hires." },
    btns: [["Open Referrals"]] },
  // Lists
  { g: "Lists", id: "list-crm", name: "A list from plain words", tests: "Table of candidates: one line each, columns that truncate, the rest counted",
    where: "#hiring", asker: "daniel", ask: "silver medalists on infra with Testbench over 85",
    text: `*7 silver medalists* on Engineering scored over 85 on the Testbench. 3 of them closed in the last 6 months.`,
    card: { kind: "table", t: "Silver medalists, Engineering", scope: "Testbench over 85 · 7 found", cols: ["Candidate", "Last role", "Testbench", "Closed"], total: 7,
      rows: [["Rohan Mehta", "Founding Engineer, Infra", "94", "Aug"], ["Clara Jensen", "Staff Engineer, Inference", "91", "Jun"], ["Tomás Ibarra", "Founding Engineer, Infra", "89", "May"], ["Hye-jin Seo", "Founding Engineer, Infra", "88", "Feb"], ["Ola Adeyemi", "Staff Engineer, Inference", "87", "Jan"]], alt: "Table of 7 silver medalists." },
    btns: [["Reach out to all 7", 1], ["Open in CRM"]] },
  { g: "Lists", id: "list-big", name: "A list too long for a card", tests: "240 matches: the top 5 on the card, the count, and a CSV in the thread",
    where: "dm", ask: "everyone who applied to research this quarter",
    text: `*240 applicants* to Research this quarter. The 5 most recent are below; the full list is attached as a CSV.`,
    card: { kind: "table", t: "Research applicants this quarter", scope: "CRM · 240 found", cols: ["Candidate", "Role", "Stage", "Applied"], total: 240,
      rows: [["Ines Duarte", "Research Scientist", "New", "Today"], ["Kwame Asante", "Research Eng., Evals", "Testbench", "Today"], ["Mei Tanaka", "Research Scientist", "New", "Yesterday"], ["Lior Ben-David", "Research Eng., Evals", "Rejected", "2 Nov"], ["Freya Holm", "Research Scientist", "Round 1", "1 Nov"]], alt: "Table of the 5 most recent of 240 Research applicants." },
    file: "research-applicants-q4.csv · 240 rows", btns: [["Open in CRM"]] },
  { g: "Lists", id: "list-empty", name: "Nothing matches", tests: "No card at all: an empty image is noise. The text says what it searched and offers a wider search",
    where: "dm", ask: "silver medalists on product with Testbench over 95",
    text: `No one matches. The closest are *2 Product silver medalists over 90*: Ana Ruiz (93) and Ben Cole (91).`,
    btns: [["Show those 2", 1], ["Open in CRM"]] },
  // People
  { g: "People", id: "ticket-stuck", name: "One candidate, stuck", tests: "Where it stands: the path, who has it, time over target in red, the one move",
    where: "#hiring", asker: "lena", ask: "where's Maya Chen at?",
    text: `Maya Chen is *waiting on Wei* to book round 2, *22h past* the 2-day target. Wei hasn't answered two asks; Sam is free Thursday.`,
    card: { kind: "ticket", t: "Where it stands", scope: "APP-118 · Engineering", name: "Maya Chen", role: "Founding Engineer, Infra · Testbench 92", color: "#7a5c3e", tag: "Stuck · 22h over",
      path: ["Applied", "Testbench", "Round 1", "Round 2", "Offer"], at: 3, waiting: "Wei to book round 2", time: "2d 22h", over: 1, next: "Move to Sam", alt: "Maya Chen: round 2, waiting on Wei, 22 hours over target." },
    btns: [["Move to Sam", 1], ["Nudge Wei"], ["Open ticket"]] },
  { g: "People", id: "ticket-long", name: "A long, accented name", tests: "Diacritics render, a long name truncates, a returning candidate is tagged",
    where: "dm", ask: "status on Nguyễn Thị Minh Khai-Vaswani",
    text: `*Nguyễn Thị Minh Khai-Vaswani* is in the Testbench, due back tomorrow. They applied before, in March, and reached round 2.`,
    card: { kind: "ticket", t: "Where it stands", scope: "APP-204 · Research", name: "Nguyễn Thị Minh Khai-Vaswani", role: "Research Scientist, Post-training", color: "#8a4f6e", tag: "Applied before",
      path: ["Applied", "Testbench", "Round 1", "Round 2", "Offer"], at: 1, waiting: "Candidate, Testbench due", time: "1d 4h", next: "Nothing yet", alt: "Candidate in the Testbench, due tomorrow." },
    btns: [["Open ticket"]] },
  { g: "People", id: "read-dm", name: "An interview read, in a DM", tests: "Verdict, skills and the interviewer's summary: fine in a DM to someone on the loop",
    where: "dm", ask: "what did Daniel think of Maya?",
    text: `Daniel's read on Maya Chen: *Pass*, recommends round 2. Strong on architecture, wants a second look at debugging.`,
    card: { kind: "read", t: "Interview read", scope: "Round 1 · Engineering", iv: "daniel", cand: "Maya Chen", round: "Founders' round · 45 min · yesterday", verdict: "pass",
      skills: [["Architecture", 4], ["Debugging", 2], ["Communication", 3], ["Ownership", 4]], summary: "Clear, fast thinker. Redrew the queue design twice without being asked. Wants another look at debugging under pressure.", alt: "Daniel's read on Maya Chen: pass." },
    btns: [["Move to round 2", 1], ["Open the read"]] },
  { g: "People", id: "read-channel", name: "The same read, in a channel", tests: "Feedback stays private: in #hiring the card keeps the verdict and hides the notes; the text sends the rest by DM",
    where: "#hiring", asker: "lena", ask: "what did Daniel think of Maya?",
    text: `Daniel's read on Maya Chen is *Pass*. Notes stay out of channels, so I've sent them to you directly.`,
    card: { kind: "read", t: "Interview read", scope: "Round 1 · Engineering", iv: "daniel", cand: "Maya Chen", round: "Founders' round · 45 min · yesterday", verdict: "pass", private: 1,
      skills: [["Architecture", 4], ["Debugging", 2], ["Communication", 3], ["Ownership", 4]], alt: "Daniel's verdict on Maya Chen: pass. Notes are private." },
    btns: [["Open the read"]], context: "Notes sent to Lena by DM" },
  { g: "People", id: "compare", name: "Two finalists side by side", tests: "Two columns that line up row by row, verdicts as colour, nothing that ranks them for you",
    where: "dm", ask: "compare Maya Chen and Rohan Mehta",
    text: `Both reached the final for Founding Engineer, Infra. Maya scored higher on the Testbench (92 to 88); Rohan has a mixed round 2.`,
    card: { kind: "compare", t: "Founding Engineer, Infra · finalists", scope: "Engineering",
      who: [{ name: "Maya Chen", src: "Careers page", color: "#7a5c3e", rows: [["Testbench", "92"], ["Round 1", "", "pass"], ["Round 2", "", "pass"], ["In process", "18 days"]] },
        { name: "Rohan Mehta", src: "Referral · Sam", color: "#3c6e8f", rows: [["Testbench", "88"], ["Round 1", "", "pass"], ["Round 2", "", "mixed"], ["In process", "24 days"]] }], alt: "Comparison of two finalists." },
    btns: [["Open both"]] },
  // Schedule, offers, process
  { g: "Schedule & offers", id: "schedule", name: "Today's interviews", tests: "An agenda: times aligned, the one in progress marked, more than 5 counted",
    where: "#interviews", asker: "daniel", ask: "what interviews are on today?",
    text: `*7 interviews* today. Aisha's with Kwame Asante is happening now; Daniel has two this afternoon.`,
    card: { kind: "schedule", t: "Interviews today", scope: `${thDay(0)} · All teams`,
      rows: [{ t: "10:00", cand: "Kwame Asante", iv: "aisha", round: "Round 1", now: 1 }, { t: "11:30", cand: "Freya Holm", iv: "marcus", round: "Round 2" }, { t: "13:00", cand: "Maya Chen", iv: "daniel", round: "Founders' round" }, { t: "14:30", cand: "Tomás Ibarra", iv: "sam", round: "Round 1" }, { t: "15:30", cand: "Jules Martin", iv: "daniel", round: "Round 2" }, { t: "16:00", cand: "Ana Ruiz", iv: "lena", round: "Portfolio" }, { t: "17:00", cand: "Ben Cole", iv: "jonah", round: "Round 1" }],
      alt: "Agenda of 7 interviews today." },
    btns: [["Open Interview Calendar"]] },
  { g: "Schedule & offers", id: "offers", name: "Offers waiting, in a channel", tests: "Offer terms never reach a channel: who and how long only, terms by DM to approvers",
    where: "#hiring", asker: "lena", ask: "which offers are waiting on approval?",
    text: `*3 offers* are waiting. Daniel has had Maya Chen's for 2 days. Terms go to approvers by DM, never here.`,
    card: { kind: "offer", t: "Offers awaiting approval", scope: "Now · All teams",
      rows: [{ name: "Maya Chen", role: "Founding Engineer, Infra", color: "#7a5c3e", by: "daniel", wait: "2d" }, { name: "Freya Holm", role: "Research Scientist", color: "#2f8a7e", by: "marcus", wait: "9h" }, { name: "Ana Ruiz", role: "Product Designer", color: "#c4663a", by: "lena", wait: "3h" }], alt: "3 offers awaiting approval." },
    btns: [["Remind Daniel", 1], ["Open in tATS"]] },
  { g: "Schedule & offers", id: "funnel", name: "Pass-through", tests: "Funnel bars shrink left to right with the step-to-step rate",
    where: "dm", ask: "what's our pass-through from Testbench to offer?",
    text: `Of *412* applicants this quarter, *9* reached an offer: 2.2%. The biggest drop is the Testbench (38% pass).`,
    card: { kind: "funnel", t: "Pass-through, this quarter", scope: "Closed and open · All teams", steps: [["Applied", 412], ["Reviewed", 268], ["Testbench", 102], ["Round 1", 39], ["Round 2", 21], ["Offer", 9]], alt: "Funnel from 412 applied to 9 offers." },
    btns: [["Open Analytics"]] },
  { g: "Schedule & offers", id: "process", name: "The interview process", tests: "A split draws as stacked steps; after an edit the card shows the new step",
    where: "dm", ask: "add a references check before the offer",
    text: `Done. *References* now sits before the offer for every team. 4 candidates already past round 2 will get it next.`,
    card: { kind: "process", t: "Interview process", scope: "Edited just now · every team", steps: ["Applied", "Review", ["Engineering", "Research", "Product"], "Testbench", "Round 1", "Round 2", "References", "Offer"], new: "References", note: "New: References, before the offer.", alt: "Process flowchart with a new References step." },
    btns: [["Undo"], ["Open the process"]] },
  // States
  { g: "States", id: "working", name: "Still working", tests: "Says what it's reading while it works, then edits this same message into the answer (no second post)",
    where: "#hiring", asker: "daniel", ask: "who owes us scorecards?", working: ["Reading 62 open tickets", "Checking Granola and Gmail for reads", "Drawing the chart"] },
  { g: "States", id: "stale", name: "A card from yesterday", tests: "Numbers move. The footer stamps the time; an amber dot and the edited text say it's been refreshed",
    where: "#hiring", asker: "daniel", ask: "how long are we taking to schedule interviews?",
    text: `_Updated ${fmtTime(NOW - 40 * MIN)}:_ now *2.1 days*, down from 2.6 yesterday after Sam took 3 of Wei's. 9 waiting.`, edited: 1,
    card: { kind: "kpi", t: "Time to schedule", scope: "Last 30 days · All teams", v: "2.1", vu: "days", vl: "typical, ready to booked", over: 1, note: "Target 2 days · 9 waiting", stale: 1, asof: `Updated ${thStamp(40 * MIN)} · first posted yesterday`,
      hist: [{ l: "<1d", n: 3 }, { l: "1–2d", n: 3 }, { l: "2–3d", n: 2, over: 1 }, { l: "3–5d", n: 1, over: 1 }, { l: "5d+", n: 0 }], alt: "Bar chart of 9 candidates waiting to be scheduled." },
    btns: [["Open in tATS"]] },
  { g: "States", id: "noaccess", name: "Not yours to see", tests: "Someone outside Research asks about it: an ephemeral reply only they see, no card, no names",
    where: "#hiring", asker: "jonah", ask: "how are the research candidates doing?", ephemeral: 1,
    text: `You're not on Research's hiring team, so I can't share their candidates. Marcus Bell leads it if you need something.`,
    btns: [["Ask Marcus"]] },
  { g: "States", id: "failed", name: "A source is down", tests: "Partial data never draws as if it were whole: no card, says what failed, one retry",
    where: "dm", ask: "what's on the interview calendar this week?",
    text: `I couldn't reach Google Calendar (it timed out twice), so I won't guess at the week. tATS shows 11 booked as of this morning.`,
    btns: [["Try again", 1], ["Open Interview Calendar"]] },
  { g: "States", id: "unfurl", name: "A pasted tATS link", tests: "Someone pastes a ticket link: Slack unfurls it with the same card, shrunk to the attachment",
    where: "#hiring", asker: "lena", ask: "@Daniel can you look at this one? https://ats.tacitawareness.com/t/APP-118", unfurl: 1,
    card: { kind: "unfurl", t: "Where it stands", scope: "APP-118 · Engineering", name: "Maya Chen", role: "Founding Engineer, Infra · Testbench 92", color: "#7a5c3e", tag: "Stuck · 22h over",
      path: ["Applied", "Testbench", "Round 1", "Round 2", "Offer"], at: 3, waiting: "Wei to book round 2", time: "2d 22h", over: 1, next: "Move to Sam", url: "ats.tacitawareness.com/t/APP-118", alt: "Maya Chen: round 2, waiting on Wei." } },
];
const TH_RULES = [
  ["The text answers on its own", "The number is in the sentence. Notifications, phones, screen readers and search only get the text."],
  ["One question, one card", "Never a dashboard. A card holds one number and one shape, or a list of five."],
  ["Readable on a phone", `Slack draws the card as narrow as ${TH_DW.mobile}px. Nothing smaller than ${TH_MIN}px there: 34px on the 1200px card.`],
  ["Says whose, what slice, and when", "Org and scope on top, the time it was drawn at the foot. A refreshed card is edited in place."],
  ["Nothing private in a channel", "Feedback notes and offer terms stay out of channels and go to the asker by DM. Someone off the team gets an ephemeral reply."],
  ["No card when there's nothing to draw", "Empty, failed or not-yours replies are text and a button. An empty chart is noise."],
];

/* ---------- Slack, drawn around them ---------- */
const thMrk = (s) => esc(s).replace(/\*([^*]+)\*/g, "<b>$1</b>").replace(/(^|\s)_([^_]+)_/g, "$1<i>$2</i>").replace(/https?:\/\/\S+/g, (u) => `<a>${u}</a>`);
const thTime = (i) => fmtTime(NOW - (TH_CASES.length - i) * 7 * MIN);
const thPerson = (id) => `<span class="sl-av" style="background:${PEOPLE[id].color}">${esc(thInit(PEOPLE[id].name))}</span>`;
const thBot = () => `<span class="sl-av grok"></span>`;
function thMsg({ who, text, t, html = "", edited, eph }) {
  const bot = who === "bot";
  return `<div class="sl-m">${bot ? thBot() : thPerson(who)}<div class="sl-c"><div class="sl-n"><b>${bot ? "Grokbot" : esc(PEOPLE[who].name)}</b>${bot ? `<em>APP</em>` : ""}<time>${t}</time></div>
    ${text ? `<p>${thMrk(text)}${edited ? ` <span class="sl-ed">(edited)</span>` : ""}</p>` : ""}${html}${eph ? `<div class="sl-eph">${ico("help")}Only visible to you · <a>Dismiss</a></div>` : ""}</div></div>`;
}
const thImg = (c) => `<div class="sl-img" style="--dw:${TH_DW[TH.width]}px"><div class="sl-it">${esc(c.t)}.png <span>▾</span></div><div class="sl-frame"><div class="sl-z" style="zoom:${TH_DW[TH.width] / TH_W}">${acCard(c)}</div></div></div>`;
const thBtns = (bs) => (bs && bs.length ? `<div class="sl-btns">${bs.map(([l, p]) => `<button class="${p ? "pri" : ""}">${esc(l)}</button>`).join("")}</div>` : "");
function thReply(x, i) {
  const t = thTime(i);
  if (x.working) return thMsg({ who: "bot", t, html: `<div class="sl-work">${x.working.map((s, k) => `<div class="${k < 2 ? "ok" : "go"}">${k < 2 ? ico("check") : `<i class="sl-spin"></i>`}${esc(s)}${k < 2 ? "" : "…"}</div>`).join("")}</div>` });
  if (x.unfurl) return "";
  const html = (x.card ? thImg(x.card) : "") + (x.file ? `<div class="sl-file">${ico("file")}<span><b>${esc(x.file.split(" · ")[0])}</b><em>${esc(x.file.split(" · ")[1])} · CSV</em></span></div>` : "") + thBtns(x.btns) + (x.context ? `<div class="sl-ctx">${esc(x.context)}</div>` : "");
  return thMsg({ who: "bot", text: x.text, t, html, edited: x.edited, eph: x.ephemeral });
}
function thCase(x, i) {
  const ch = x.where === "dm";
  const ask = ch ? x.ask : `<@Grokbot> ${x.ask}`;
  const parent = thMsg({ who: x.asker || ME, t: thTime(i), text: x.unfurl ? x.ask : ask.replace("<@Grokbot>", "@Grokbot"),
    html: x.unfurl ? `<div class="sl-unf"><div class="sl-unf-h"><span class="sl-unf-i"></span><b>tATS</b></div><a class="sl-unf-t">Maya Chen · Founding Engineer, Infra</a><p>Stuck 22h past target, waiting on Wei to book round 2.</p>${thImg(x.card)}</div>` : "" });
  return `<section class="th-case" id="c-${x.id}" data-id="${x.id}">
    <div class="th-meta"><div><b>${esc(x.name)}</b><span>${esc(x.tests)}</span></div><div class="th-chk" data-chk="${x.id}"></div></div>
    <div class="sl-win"><div class="sl-head">${ch ? `${thBot()}<b>Grokbot</b>` : `<b>Thread</b><span>${esc(x.where)}</span>`}</div>
      <div class="sl-body">${parent}${ch ? "" : x.unfurl ? "" : `<div class="sl-rep"><span>1 reply</span></div>`}${thReply(x, i)}</div></div>
  </section>`;
}

/* ---------- the checks: run on what's drawn, at the width picked ---------- */
function thCheck() {
  const k = TH_DW[TH.width] / TH_W, kMin = TH_DW.mobile / TH_W;
  let bad = 0;
  $$(".th-case").forEach((sec) => {
    const x = TH_CASES.find((c) => c.id === sec.dataset.id), card = $(".ac", sec), out = [];
    if (!card) out.push(["ok", x.working ? "Edits itself into the answer" : "Text only, by design"]);
    else {
      const cr = card.getBoundingClientRect();
      let min = Infinity, spill = 0, cut = 0;
      $$("*", card).forEach((el) => {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) return;
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
        const r = el.getBoundingClientRect(), tol = cr.width * 0.002;
        if (r.width && (r.right > cr.right + tol || r.bottom > cr.bottom + tol || r.left < cr.left - tol)) spill++;
        if (el.classList.contains("ac-tr") && el.scrollWidth > el.clientWidth + 1) cut++;
      });
      const px = min * kMin, now = min * k;
      out.push([px >= TH_MIN ? "ok" : "bad", `Smallest text ${now.toFixed(1)}px here, ${px.toFixed(1)}px on a phone`]);
      out.push([spill ? "bad" : "ok", spill ? `${spill} thing${spill > 1 ? "s" : ""} off the card` : "Nothing off the card"]);
      if (cut) out.push(["info", `${cut} truncated with …`]);
      out.push([card.getAttribute("aria-label") ? "ok" : "bad", "Alt text"]);
    }
    if (out.some(([s]) => s === "bad")) bad++;
    const html = out.map(([s, l]) => `<span class="${s}">${s === "ok" ? ico("check") : s === "bad" ? ico("x") : ico("help")}${esc(l)}</span>`).join("");
    $(`[data-chk="${x.id}"]`, sec).innerHTML = html;
    const nav = $(`.th-nav a[href="#c-${x.id}"]`);
    if (nav) nav.className = out.some(([s]) => s === "bad") ? "bad" : "";
  });
  $("#thSum").innerHTML = bad ? `<span class="bad">${ico("x")}${bad} of ${TH_CASES.length} need a fix</span>` : `<span class="ok">${ico("check")}All ${TH_CASES.length} pass at ${TH_DW[TH.width]}px</span>`;
}

function thSeg(k, opts) { return `<div class="th-seg" role="group">${opts.map(([v, l]) => `<button class="${TH[k] === v ? "on" : ""}" data-k="${k}" data-v="${v}">${l}</button>`).join("")}</div>`; }
function thRender() {
  const groups = [...new Set(TH_CASES.map((c) => c.g))];
  document.body.dataset.slack = TH.slack;
  document.body.dataset.w = TH.width;
  $("#thRoot").innerHTML = `<aside class="th-nav"><div class="th-brand"><i class="mark"></i><b>Grokbot in a thread</b></div>
      <p>Every reply the Grokbot can post in Slack, drawn and checked.</p><div id="thSum" class="th-sum"></div>
      <a href="#rules" class="rules">Rules every reply follows</a>
      ${groups.map((g) => `<div class="th-g">${esc(g)}</div>${TH_CASES.filter((c) => c.g === g).map((c) => `<a href="#c-${c.id}">${esc(c.name)}</a>`).join("")}`).join("")}
      <a class="th-back" href="./">${ico("arrowL")}Back to tATS</a></aside>
    <main class="th-main" id="thMain"><div class="th-bar">${thSeg("slack", [["light", "Slack light"], ["dark", "Slack dark"]])}${thSeg("width", [["desktop", "Desktop"], ["thread", "Thread pane"], ["mobile", "Phone"]])}${thSeg("card", [["light", "Light card"], ["dark", "Dark card"]])}</div>
      <section class="th-rules" id="rules"><h1>Grokbot in a thread</h1><p>Nobody has to open tATS to get an answer. The Grokbot replies where it was asked: a sentence with the answer, one card for the shape of it, and buttons. The card is a ${TH_W} × ${TH_H} image rendered from the same spec as here, so it reads the same in Slack's light and dark themes, on desktop and on a phone.</p>
        <ol>${TH_RULES.map(([h, p]) => `<li><b>${esc(h)}</b><span>${esc(p)}</span></li>`).join("")}</ol></section>
      ${TH_CASES.map(thCase).join("")}</main>`;
  requestAnimationFrame(() => requestAnimationFrame(thCheck));
}
function mountThread() {
  document.title = "Grokbot in a thread · tATS";
  [...document.body.children].forEach((c) => { if (!/^(STYLE|LINK|SCRIPT)$/.test(c.tagName)) c.remove(); });
  document.body.className = "surface thread";
  const root = document.createElement("div");
  root.id = "thRoot"; root.className = "th";
  document.body.appendChild(root);
  root.addEventListener("click", (e) => {
    const b = e.target.closest(".th-seg button");
    if (b) { TH[b.dataset.k] = b.dataset.v; thSave(); const y = $("#thMain").scrollTop; thRender(); $("#thMain").scrollTop = y; return; }
    const a = e.target.closest(".th-nav a[href^='#']");
    if (a) { e.preventDefault(); const t = $(a.getAttribute("href")); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  thRender();
  if (document.fonts) document.fonts.ready.then(thCheck);
}
if (SURFACE === "thread") mountThread();
