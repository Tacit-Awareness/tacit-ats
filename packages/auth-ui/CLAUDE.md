# @tacit-ats/auth-ui

Tacit's sign-in screens, lifted from tacit-testbench's staff sign-in (`apps/web/src/components/login.tsx`, `portal/auth.tsx`'s `StaffAuthFrame`, `portal/portal.css`'s `.auth` rules and `portal/auth.css`, on `codex/build-tacit-testbench` at `6f43b42`) so the ATS's sign-in is the same screen, and so testbench can later use this package and the two cannot drift. Email and password in a centered card on the sky, no Google button.

Not wired into anything yet (2026-11-12): `apps/web` still signs in through WorkOS. The move to Supabase Auth on `tacit-ats` will render these.

## What is here

- `AuthFrame`: the sky, the lockup ("Tacit" + `product`), an optional top-right `switchLink`, the stage, the theme moon, "© year Tacit Awareness" and optional `footerLinks`. Every screen renders inside it.
- Screens, each the big title over one card: `SignIn` (testbench's `Login`; `forgotPasswordHref` adds the mockup's "Forgot password?", `demo` testbench's local "Explore the demo"), `ForgotPassword`, `SetPassword` (from an invitation or a recovery link), `LinkExpired`, `CompanyPicker` (`{id, name, slug}[]`), `ConnectorConsent` (testbench's MCP consent page).
- Pieces for another screen in the same style: `AuthScreen`, `Field`, `ErrorNotice`, `Busy`, `useFocusAfterError`, `errorMessage`.
- `authThemeScript(key)` (server-safe, `theme.ts`): an inline `<head>` script so dark mode never flashes; the moon writes `<html data-auth-theme>` and `localStorage[key]`.

## Rules

- **Nothing app-specific.** No `next/*`, no fetch, no env, no auth library: every call (`onSignIn`, `onRequestReset`, `onSetPassword`, `onPick`, `onSignIn`/`onDecide` for consent) and every destination (`redirectTo`, hrefs) is a prop. A callback rejects with an `Error` whose message the screen shows, and may resolve to a destination that replaces `redirectTo`. `navigate` defaults to a full page load; a Next host passes its router. Never depends on `apps/*`.
- **The look is testbench's, to the pixel.** `src/auth.css` is testbench's cascade folded into one file under `.tacit-auth`, including what testbench's `globals.css` gives these elements (the label's `.006em` tracking, a big button's 14px gap from `.tbp .big`), so a host's resets don't matter. It is unlayered, so a Tailwind preflight (`@layer base`) never wins. On 2026-11-12 testbench's `/login` and `apps/web`'s `/dev/auth-ui/sign-in-testbench` were compared in Chromium at 1280×800 (light, dark, error, busy) and 375×740: 0 differing pixels. Change the look in both places, or in testbench first and copy it here.
- **Fonts ship here** (`src/fonts/`, Mona Sans and Geist Mono, OFL), under their own family names so they never clash with a host's.
- **Source, not a build.** `exports` points at `src/index.ts`; a Next host lists it in `transpilePackages`. The CSS comes in with `frame.tsx`.
- The consent screen is drawn in this frame, not testbench's flat `LoginFrame` (`tb-auth-company`): one frame for every Tacit sign-in screen.

## Seeing it

`pnpm dev`, then `http://localhost:3100/dev/auth-ui` (development only) lists every screen with stand-in callbacks. `src/screens.test.tsx` renders each.
