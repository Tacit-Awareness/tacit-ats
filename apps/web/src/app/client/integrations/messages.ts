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

// The company's bot (bot.tsx, bot-actions.ts).
export const BOT_NOTICES = {
  bot_verified: "Your bot answered. Interview reminders and check-ins go to it from now on.",
  bot_on: "Your bot is on again.",
  bot_off: "Your bot is off. Nothing is sent to it until you turn it back on.",
  bot_removed: "Your bot is removed. Nothing is sent to it any more.",
} as const;

export const BOT_ERRORS = {
  bot_bad_url: "That isn't an https address Tacit can call (no port, no username or password in it).",
  bot_bad_key: "That key can't be used: it has to be 16 to 512 characters with no spaces.",
  bot_not_admin: "Only an admin can change your company's bot.",
  bot_missing: "Your company has no bot set yet.",
  bot_unreachable: "Tacit couldn't reach your bot at that address, or it didn't answer with a success. Nothing was verified.",
  bot_wrong_answer: "Your bot answered, but not with the challenge Tacit sent. Nothing was verified.",
  bot_failed: "That didn't work. Nothing was changed.",
} as const;

export type BotNotice = keyof typeof BOT_NOTICES;
export type BotError = keyof typeof BOT_ERRORS;

export const isBotNotice = (v: unknown): v is BotNotice => typeof v === "string" && Object.hasOwn(BOT_NOTICES, v);
export const isBotError = (v: unknown): v is BotError => typeof v === "string" && Object.hasOwn(BOT_ERRORS, v);

export type IntegrationNotice = keyof typeof INTEGRATION_NOTICES;
export type IntegrationError = keyof typeof INTEGRATION_ERRORS;

export const isIntegrationNotice = (v: unknown): v is IntegrationNotice => typeof v === "string" && Object.hasOwn(INTEGRATION_NOTICES, v);
export const isIntegrationError = (v: unknown): v is IntegrationError => typeof v === "string" && Object.hasOwn(INTEGRATION_ERRORS, v);
