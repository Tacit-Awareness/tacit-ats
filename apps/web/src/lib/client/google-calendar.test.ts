import { describe, expect, test } from "vitest";

import {
  CALENDAR_SCOPES, CalendarConnectError, calendarConsentUrl, calendarRedirectUri, exchangeCalendarCode, googleCalendarConfig,
} from "./google-calendar";

const config = { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret" };
const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const ALL = CALENDAR_SCOPES.join(" ");

function google(status: number, json: unknown) {
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: Object.fromEntries(init?.body as URLSearchParams) });
    return Response.json(json, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("googleCalendarConfig", () => {
  test("needs both the client id and secret", () => {
    expect(googleCalendarConfig({ CLIENT_GOOGLE_CLIENT_ID: "a" })).toBeNull();
    expect(googleCalendarConfig({ CLIENT_GOOGLE_CLIENT_ID: " a ", CLIENT_GOOGLE_CLIENT_SECRET: "b" })).toEqual({ clientId: "a", clientSecret: "b" });
  });
});

describe("calendarConsentUrl", () => {
  test("asks for busy times and events only, offline, with the state", () => {
    const url = new URL(calendarConsentUrl(config, calendarRedirectUri("https://ats.test"), "st4te", "me@co.test"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ats.test/client/calendar/callback");
    expect(url.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("login_hint")).toBe("me@co.test");
  });
});

describe("exchangeCalendarCode", () => {
  test("returns the refresh token, the account and the scopes granted", async () => {
    const g = google(200, { refresh_token: "rt", scope: ALL, id_token: idToken({ email: "Me@Co.test", email_verified: true }) });
    expect(await exchangeCalendarCode(config, "https://ats.test/client/calendar/callback", "code-1", g.fetchImpl))
      .toEqual({ refreshToken: "rt", accountEmail: "me@co.test", scopes: ALL });
    expect(g.calls[0].body).toMatchObject({ grant_type: "authorization_code", code: "code-1", client_secret: "secret" });
  });

  const refused = async (status: number, json: unknown) => {
    const err = await exchangeCalendarCode(config, "r", "c", google(status, json).fetchImpl).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(CalendarConnectError);
    return (err as CalendarConnectError).code;
  };

  test("refuses a grant missing a calendar scope, a refresh token or an account", async () => {
    expect(await refused(400, { error: "invalid_grant" })).toBe("exchange_failed");
    expect(await refused(200, { refresh_token: "rt", scope: "openid email https://www.googleapis.com/auth/calendar.events.freebusy", id_token: idToken({ email: "a@b.test" }) }))
      .toBe("missing_scopes");
    expect(await refused(200, { scope: ALL, id_token: idToken({ email: "a@b.test" }) })).toBe("no_refresh_token");
    expect(await refused(200, { refresh_token: "rt", scope: ALL, id_token: idToken({ email: "a@b.test", email_verified: false }) })).toBe("no_email");
  });
});
