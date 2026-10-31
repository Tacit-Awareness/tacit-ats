# WorkOS sign-in branding

The settings for AuthKit's hosted pages, so they read as Tacit and match the ATS. Members sign in on our own screen (`apps/web/src/app/sign-in`); AuthKit's pages are what is left: email sign-in, invitations, MFA, company selection and the connector's sign-in. All of it is set in the WorkOS dashboard, in the **client environment** the web app uses (the one behind `keen-sketch-56-staging.authkit.app`). Branding is per environment; WorkOS can copy it to production later.

Colors are the tokens in `apps/web/src/app/globals.css`, with the two exceptions noted.

## Branding

| Setting | Value |
|---|---|
| Display name | `Tacit` (also shown in AuthKit emails and the Admin Portal) |
| Logo icon | `apps/web/src/app/icon.png` (512 x 512, 64 KB) |
| Favicon | `apps/web/src/app/icon.png` |
| Logo display | Icon only |
| Font | Inter |
| Appearance | Follow the user's OS setting |
| Corner radius | Medium: AuthKit's card is 16px today, a little rounder than the ATS's 12px |
| Page layout | One column, centered, like the ATS's own "Your account is ready" and refusal screens |
| Sign-in title | `Sign in to Tacit` |
| Legal links | Tacit's privacy policy and terms, once they have URLs |

| Color | Light | Dark |
|---|---|---|
| Page background | `#ededea` | `#0e0e10` |
| Button background | `#5e6ad2` | `#5e6ad2` |
| Button text | `#ffffff` | `#ffffff` |
| Link | `#4a55bd` | `#7170ff` |

The two exceptions, both for contrast. The dark button keeps the light accent, as white on the ATS's dark `#7170ff` is only 3.84:1 against 4.7:1 here. The light link is darker than `#5e6ad2`, which is 4.0:1 on the page background.

## Custom CSS

Paste `authkit.css` into Branding > Custom CSS. It styles the card, adds a line under the sign-in heading and hides the "Sign up" link on the sign-in page. The class names beyond WorkOS's documented ones (`[data-hak-footer]`) come from the live page, so check sign-in after any WorkOS change.

Hiding the link does not close sign-up: `/sign-up` still answers. Turn sign-up off in the dashboard as well if it has a setting for it. Keep it working for invitations, and send a test one to Tacit Test Co (`docs/client-sandbox.md`) after changing it.

## Sign-in methods

In the dashboard's authentication settings, turn off **GitHub** and **Apple** and leave email, Google and Microsoft. Hiring teams sign in with work accounts, and our sign-in screen offers Google, Microsoft and email. Before turning them off, check in WorkOS whether any member signs in that way; they would have to use email or Google instead.

## After saving

1. Open `https://ats.tacitawareness.com/client` signed out, in light and dark and at phone width.
2. Accept a test invitation from Tacit Test Co, which runs AuthKit's `invite` and sign-up pages.
3. Read the invitation email, which picks up the display name, logo and colors.
