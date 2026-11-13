// @tacit-ats/auth-ui: Tacit's sign-in screens, lifted from tacit-testbench's staff sign-in so the ATS and testbench
// draw the same thing. Render a screen inside <AuthFrame>; every call and destination is a prop, so nothing here knows
// which app or auth backend it is in. Importing any of it brings the stylesheet (auth.css) and its fonts.
export { AuthFrame, useAuthTheme } from "./frame";
export type { AuthFrameProps, AuthLink } from "./frame";
export { AUTH_THEME_ATTRIBUTE, DEFAULT_AUTH_THEME_KEY, authThemeScript } from "./theme";
export type { AuthTheme } from "./theme";
export { AuthScreen, Busy, ErrorNotice, Field, errorMessage, useFocusAfterError } from "./parts";
export type { Navigate } from "./parts";
export { SignIn } from "./sign-in";
export type { Credentials, SignInProps } from "./sign-in";
export { ForgotPassword, LinkExpired, SetPassword } from "./password";
export type { ForgotPasswordProps, SetPasswordProps } from "./password";
export { CompanyPicker } from "./company-picker";
export type { Company, CompanyPickerProps } from "./company-picker";
export { ConnectorConsent } from "./connector-consent";
export type { ConnectorConsentProps, ConsentRequest } from "./connector-consent";
export { TacitMark } from "./icons";
