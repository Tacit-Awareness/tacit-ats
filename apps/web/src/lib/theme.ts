// The theme choice: "light", "dark", or nothing (follow the system). Kept in
// a cookie rather than localStorage so the server renders <html data-theme>
// on the first paint and the page never flashes the other theme.
export const THEME_COOKIE = "tacit-theme";
export type Theme = "light" | "dark";

export function parseTheme(value: string | undefined | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

// What a click on the toggle moves to, given the explicit choice (if any) and
// what the system shows now: always the opposite of what is on screen.
export function nextTheme(current: Theme | null, systemDark: boolean): Theme {
  const showing = current ?? (systemDark ? "dark" : "light");
  return showing === "dark" ? "light" : "dark";
}
