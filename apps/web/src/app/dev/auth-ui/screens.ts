// The screens the development preview renders, one per URL so each can be compared full-page against testbench's.
export const SCREENS = {
  "sign-in": "Sign in (ATS)",
  "sign-in-testbench": "Sign in, as testbench draws it (for comparison with its /login)",
  "forgot-password": "Forgot password",
  "set-password": "Set password, from an invitation",
  "reset-password": "Choose a new password, from a recovery link",
  "link-expired": "Link expired",
  "company-picker": "Company picker",
  "company-picker-empty": "Company picker, no companies",
  "consent-sign-in": "Connector consent: sign in",
  "consent": "Connector consent: allow",
  "consent-missing": "Connector consent: link incomplete",
} as const;

export type Screen = keyof typeof SCREENS;

export const isScreen = (value: string): value is Screen => Object.hasOwn(SCREENS, value);
