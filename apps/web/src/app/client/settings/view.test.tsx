import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("../calendar/actions", () => ({ disconnectCalendarAction: async () => {} }));
vi.mock("../integrations/actions", () => ({ disconnectGranolaAction: async () => {} }));
vi.mock("../mailbox/actions", () => ({ disconnectMailboxAction: async () => {}, disconnectWorkspaceAction: async () => {}, setMailboxSyncAction: async () => {}, verifyWorkspaceAction: async () => {} }));
vi.mock("../integrations/bot", () => ({ BotSection: () => null }));

import { SettingsView } from "./view";

const html = renderToStaticMarkup(
  <SettingsView calendar={null} granola={null} calendarConfigured bot={null} orgName="Acme" botCallbackUrl={null} />,
);

describe("SettingsView", () => {
  test("links to where people and the process are set", () => {
    expect(html).toContain('href="/client/onboarding/people"');
    expect(html).toContain('href="/client/onboarding/process"');
  });

  test("links Email templates only when asked to", () => {
    expect(html).not.toContain('href="/client/settings/templates"');
    const withTemplates = renderToStaticMarkup(
      <SettingsView calendar={null} granola={null} calendarConfigured bot={null} orgName="Acme" botCallbackUrl={null} templates />,
    );
    expect(withTemplates).toContain('href="/client/settings/templates"');
  });

  test("has design/tats's Routing Rules, every selection rule on, above the integrations", () => {
    expect(html.match(/role="switch" aria-checked="true"/g)).toHaveLength(4);
    expect(html).toContain("Escalation");
    expect(html.indexOf("Routing Rules")).toBeLessThan(html.indexOf("Integrations"));
  });

  test("says the rules change nothing yet", () => {
    expect(html).toContain("A preview");
  });

  test("offers Gmail to anyone who emails candidates, and says where replies go once connected", () => {
    expect(html).not.toContain('href="/client/mailbox/connect"');
    const offered = renderToStaticMarkup(
      <SettingsView calendar={null} granola={null} mailbox={null} calendarConfigured bot={null} orgName="Acme" botCallbackUrl={null} />,
    );
    expect(offered).toContain('href="/client/mailbox/connect"');
    const sendOnly = renderToStaticMarkup(
      <SettingsView calendar={null} granola={null} mailbox={{ accountEmail: "ada@acme.test", readsReplies: false }} calendarConfigured bot={null} orgName="Acme" botCallbackUrl={null} />,
    );
    expect(sendOnly).toContain("goes out from ada@acme.test; replies stay in your Gmail");
  });

  test("an admin gets the Google Workspace setup with the client ID and scopes, then Verify", () => {
    expect(html).not.toContain("Google Workspace");
    const setup = renderToStaticMarkup(
      <SettingsView calendar={null} granola={null} mailbox={null} calendarConfigured bot={null} orgName="Acme" botCallbackUrl={null}
        workspace={{ configured: true, clientId: "1234567890", connected: null }} />,
    );
    expect(setup).toContain("1234567890");
    expect(setup).toContain(
      "gmail.send,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/calendar.events,https://www.googleapis.com/auth/calendar.events.freebusy",
    );
    expect(setup).toContain(">Verify<");
    const connected = renderToStaticMarkup(
      <SettingsView calendar={null} granola={null} mailbox={null} calendarConfigured bot={null} orgName="Acme" botCallbackUrl={null}
        workspace={{ configured: true, clientId: "1234567890", connected: { domain: "acme.test", verifiedAt: "2026-11-02T00:00:00Z" } }} />,
    );
    expect(connected).toContain("Connected for <strong>acme.test</strong>");
    expect(connected).toContain("Disconnect");
  });

  test("a member covered by the Workspace has nothing to connect, only their own sync switch", () => {
    const covered = renderToStaticMarkup(
      <SettingsView calendar={null} granola={null} mailbox={null} calendarConfigured bot={null} orgName="Acme" botCallbackUrl={null}
        throughWorkspace={{ accountEmail: "ada@acme.test", syncOn: true }} />,
    );
    expect(covered).toContain("as ada@acme.test");
    expect(covered).toContain("Turn off sync");
    expect(covered).not.toContain('href="/client/mailbox/connect"');
  });

  test("a member the Workspace books for has no calendar to connect", () => {
    const covered = renderToStaticMarkup(
      <SettingsView calendar={null} granola={null} calendarConfigured bot={null} orgName="Acme" botCallbackUrl={null}
        calendarThroughWorkspace={{ accountEmail: "ada@acme.test" }} />,
    );
    expect(covered).toContain("Through your company&#x27;s Google Workspace, as ada@acme.test");
    expect(covered).not.toContain('href="/client/calendar/connect"');
    expect(html).toContain('href="/client/calendar/connect"');
  });

});
