export type Theme = "system" | "classic-dark" | "dark" | "light" | "max-light"
/* The looks you can pick, in the order the menu lists them, each with a line saying what it is */
export const THEMES: { key: Theme; name: string; means: string }[] = [
  { key: "classic-dark", name: "Classic Dark", means: "Near black, the original look" },
  { key: "dark", name: "Dark", means: "Softer charcoal, easier for long sessions" },
  { key: "light", name: "Light", means: "Cool greys on white" },
  { key: "max-light", name: "Max Light", means: "Pure white, the strongest contrast" },
  { key: "system", name: "System", means: "Follows your computer" },
]
/* What a choice means on the page: the base theme every colour rule keys on, and the variant of it */
export const resolveTheme = (theme: Theme, systemLight: boolean): { base: "dark" | "light"; variant: "classic" | "plain" | "max" } => {
  const t = THEMES.some((x) => x.key === theme) ? theme : "system"
  if (t === "system") return systemLight ? { base: "light", variant: "plain" } : { base: "dark", variant: "classic" }
  return t === "classic-dark" ? { base: "dark", variant: "classic" } : t === "dark" ? { base: "dark", variant: "plain" } : t === "max-light" ? { base: "light", variant: "max" } : { base: "light", variant: "plain" }
}
export type Routing = { move: "interview" | "testbench" | "decline"; roleId?: string; reason?: string; to?: string; grade?: { confidence?: number; note: string } }
/* Someone passed on for now, kept with the grade so they can be looked at again */
export type Passed = { a: import("./data").Applicant; reason: string; confidence?: number; note: string }
export type View = "home" | "triage" | "tickets" | "people" | "interviews" | "offers" | "asks" | "insights" | "settings"
/* Go-to keys: press G, then the letter, from anywhere you are not typing. K is left alone: it belongs to the command menu. Tickets is W, for the work. */
export const GO_KEYS: Record<View, string> = { home: "H", triage: "T", tickets: "W", people: "P", interviews: "I", offers: "O", asks: "L", insights: "N", settings: "S" }
export type TeamStat = { attn: number; stuck: boolean; triage: number }
