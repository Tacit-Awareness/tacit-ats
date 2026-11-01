import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("../calendar/actions", () => ({ disconnectCalendarAction: async () => {} }));
vi.mock("../integrations/actions", () => ({ disconnectGranolaAction: async () => {} }));
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

  test("has design/tats's Routing Rules, every selection rule on, above the integrations", () => {
    expect(html.match(/role="switch" aria-checked="true"/g)).toHaveLength(4);
    expect(html).toContain("Escalation");
    expect(html.indexOf("Routing Rules")).toBeLessThan(html.indexOf("Integrations"));
  });

  test("says the rules change nothing yet", () => {
    expect(html).toContain("A preview");
  });
});
