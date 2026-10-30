import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("./actions", () => ({ saveTargetAction: vi.fn() }));

import { TargetDialog, type TargetChipProps } from "./home-target";

const props: TargetChipProps = {
  metric: "schedule",
  card: "Waiting to be scheduled",
  label: "Target",
  shown: "5h",
  off: false,
  offNote: "Over target",
  sub: "Flag it when the typical wait goes over this.",
  kind: "time",
  field: { value: "5", unit: "h" },
  canEdit: true,
};

// React resets a <form action={fn}> when the action settles, and a controlled
// <select> has no default to go back to, so it lands on its first option with
// the state still saying Hours. Seen in a browser: 5 Hours refused, the field
// then read 5 Days, and a second Save stored 120h.
test("the dialog submits by hand, so a refusal leaves the unit that was picked", () => {
  const html = renderToStaticMarkup(<TargetDialog {...props} close={() => {}} />);
  expect(html).toContain("<form");
  expect(html).not.toMatch(/<form[^>]*\baction=/);
});
