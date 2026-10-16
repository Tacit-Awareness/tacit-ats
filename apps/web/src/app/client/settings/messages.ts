// What /client/settings says after an action. The actions redirect with a
// code and the page looks the sentence up here.
export const SETTINGS_NOTICES = {
  mode_saved: "Saved. Tacit's access to your jobs is updated.",
  job_saved: "Saved.",
  removed: "Removed. They can't submit to you any more; what they already submitted stays.",
} as const;

export const SETTINGS_ERRORS = {
  not_admin: "Only an admin can change this.",
  not_found: "That is no longer there.",
  failed: "That did not work. Nothing was changed.",
} as const;

export type SettingsNotice = keyof typeof SETTINGS_NOTICES;
export type SettingsError = keyof typeof SETTINGS_ERRORS;

export const isSettingsNotice = (v: unknown): v is SettingsNotice => typeof v === "string" && v in SETTINGS_NOTICES;
export const isSettingsError = (v: unknown): v is SettingsError => typeof v === "string" && v in SETTINGS_ERRORS;
