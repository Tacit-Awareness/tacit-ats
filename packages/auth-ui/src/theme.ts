// The theme's attribute and its pre-paint script. Not a client module, so a server component can render the
// script into <head>.
export type AuthTheme = "light" | "dark";

/** The theme lives on <html data-auth-theme>, so `authThemeScript` can set it before first paint. */
export const AUTH_THEME_ATTRIBUTE = "data-auth-theme";
export const DEFAULT_AUTH_THEME_KEY = "tacit-auth-theme";

/** An inline <head> script that applies the remembered theme before first paint, so dark never flashes light. */
export function authThemeScript(storageKey: string = DEFAULT_AUTH_THEME_KEY): string {
  const key = JSON.stringify(storageKey);
  return `try{document.documentElement.setAttribute('${AUTH_THEME_ATTRIBUTE}',localStorage.getItem(${key})==='dark'?'dark':'light')}catch(e){document.documentElement.setAttribute('${AUTH_THEME_ATTRIBUTE}','light')}`;
}
