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
