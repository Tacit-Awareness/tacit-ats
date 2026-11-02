import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("../calendar/actions", () => ({ disconnectCalendarAction: async () => {} }));
vi.mock("../integrations/actions", () => ({ disconnectGranolaAction: async () => {} }));
vi.mock("../mailbox/actions", () => ({ disconnectMailboxAction: async () => {} }));
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
});
