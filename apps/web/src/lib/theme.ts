// The theme choice: "light", "dark", or "system" (follow the OS), which is
// nothing stored. Kept in a cookie rather than localStorage so the server
// renders <html data-theme> on the first paint and the page never flashes the
// other theme; with no cookie there is no attribute and globals.css's
// prefers-color-scheme decides, also before the first paint.
export const THEME_COOKIE = "tacit-theme";
export type Theme = "light" | "dark";
export type ThemeChoice = Theme | "system";

export function parseTheme(value: string | undefined | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** What the account menu shows as chosen, from the cookie or <html data-theme>. */
export const themeChoice = (value: string | undefined | null): ThemeChoice => parseTheme(value) ?? "system";

/** The document.cookie assignment that keeps a choice. System clears it: same path, expired now. */
export function themeCookie(choice: ThemeChoice): string {
  return choice === "system" ? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax` : `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;
}

// The look: a variant of the theme, kept in its own cookie so <html data-theme>
// stays "light" or "dark" and every colour rule keyed on it still holds. "soft"
// is a charcoal for dark; "max" is white throughout for light. No look is the
// theme as it always was. A look that does not belong to the theme on the page
// matches no rule in globals.css, so it shows as none.
export const LOOK_COOKIE = "tacit-look";
export type Look = "soft" | "max";

export function parseLook(value: string | undefined | null): Look | null {
  return value === "soft" || value === "max" ? value : null;
}

/** What you pick from: four looks and System, in the order the menu lists them, with a line on each. */
export type Appearance = "classic-dark" | "dark" | "light" | "max-light" | "system";
export const APPEARANCES: { key: Appearance; name: string; means: string }[] = [
  { key: "classic-dark", name: "Classic Dark", means: "Near black, the original look" },
  { key: "dark", name: "Dark", means: "Softer charcoal, easier for long sessions" },
  { key: "light", name: "Light", means: "Cool greys on white" },
  { key: "max-light", name: "Max Light", means: "Pure white, the strongest contrast" },
  { key: "system", name: "System", means: "Follows your computer" },
];

/** A pick as the two things stored: the theme and its look. */
export function appearanceParts(a: Appearance): { theme: ThemeChoice; look: Look | null } {
  if (a === "classic-dark") return { theme: "dark", look: null };
  if (a === "dark") return { theme: "dark", look: "soft" };
  if (a === "max-light") return { theme: "light", look: "max" };
  return { theme: a, look: null };
}

/** The pick on the page, from <html data-theme> and <html data-look>. A look of the other theme counts as none. */
export function appearanceOf(theme: string | undefined | null, look: string | undefined | null): Appearance {
  const t = parseTheme(theme);
  const l = parseLook(look);
  if (t === "dark") return l === "soft" ? "dark" : "classic-dark";
  if (t === "light") return l === "max" ? "max-light" : "light";
  return "system";
}

/** The document.cookie assignment that keeps a look. None clears it: same path, expired now. */
export function lookCookie(look: Look | null): string {
  return look === null ? `${LOOK_COOKIE}=; path=/; max-age=0; samesite=lax` : `${LOOK_COOKIE}=${look}; path=/; max-age=31536000; samesite=lax`;
}
