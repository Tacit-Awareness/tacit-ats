// What /client/integrations says after connecting or disconnecting Granola.
// The routes and actions redirect with a code and the page looks the sentence
// up here, so nothing else (least of all a token) rides in a URL.
export const INTEGRATION_NOTICES = {
  granola_connected: "Granola is connected.",
  granola_disconnected: "Granola is disconnected. Tacit no longer has access to it.",
} as const;

export const INTEGRATION_ERRORS = {
  granola_denied: "Granola didn't grant access, so nothing was connected.",
  granola_expired: "That took too long or came from another tab. Try connecting again.",
  granola_no_refresh_token: "Granola didn't give Tacit lasting access. Try connecting again.",
  granola_unreachable: "Couldn't reach Granola. Nothing was connected; try again in a minute.",
  failed: "That didn't work. Nothing was changed.",
} as const;

export type IntegrationNotice = keyof typeof INTEGRATION_NOTICES;
export type IntegrationError = keyof typeof INTEGRATION_ERRORS;

export const isIntegrationNotice = (v: unknown): v is IntegrationNotice => typeof v === "string" && Object.hasOwn(INTEGRATION_NOTICES, v);
export const isIntegrationError = (v: unknown): v is IntegrationError => typeof v === "string" && Object.hasOwn(INTEGRATION_ERRORS, v);
