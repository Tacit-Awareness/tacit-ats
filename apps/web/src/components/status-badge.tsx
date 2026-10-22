import { Pill } from "@/components/page";
import type { Database } from "@tacit/db";

type RoleStatus = Database["public"]["Tables"]["roles"]["Row"]["status"];

// Colour only for meaning (the 2026-10 redesign): "open" is the one live
// state and reads green, like the mockup's Open pill; every other status is
// the grey pill.
export function StatusBadge({ status }: { status: RoleStatus }) {
  return (
    <Pill tone={status === "open" ? "green" : "grey"} className="capitalize">
      {status.replace(/_/g, " ")}
    </Pill>
  );
}
