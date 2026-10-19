// What /client/integrations says after connecting or disconnecting Granola.
// The actions redirect with a code and the page looks the sentence up here,
// so nothing else (least of all the key) rides in a URL.
export const INTEGRATION_NOTICES = {
  granola_connected: "Granola is connected.",
  granola_disconnected: "Granola is disconnected and your key is deleted from Tacit.",
} as const;

export const INTEGRATION_ERRORS = {
  granola_malformed: "That doesn't look like a Granola API key. Copy the whole key from Granola and paste it again.",
  granola_invalid: "Granola didn't accept that key. Check it is still active in Granola and try again.",
  granola_unreachable: "Couldn't reach Granola to check the key. Nothing was saved; try again in a minute.",
  failed: "That didn't work. Nothing was changed.",
} as const;

export type IntegrationNotice = keyof typeof INTEGRATION_NOTICES;
export type IntegrationError = keyof typeof INTEGRATION_ERRORS;

export const isIntegrationNotice = (v: unknown): v is IntegrationNotice => typeof v === "string" && Object.hasOwn(INTEGRATION_NOTICES, v);
export const isIntegrationError = (v: unknown): v is IntegrationError => typeof v === "string" && Object.hasOwn(INTEGRATION_ERRORS, v);
