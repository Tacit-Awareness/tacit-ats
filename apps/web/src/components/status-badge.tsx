import { Pill } from "@/components/page";
import type { Database } from "@tacit/db";

type RoleStatus = Database["public"]["Tables"]["roles"]["Row"]["status"];

// Colour only for meaning: "open" is the one live state and reads green, as
// Testbench's green tag; every other status is the grey tag. Sentence case:
// "On hold", not "On Hold".
export function StatusBadge({ status }: { status: RoleStatus }) {
  const words = status.replace(/_/g, " ");
  return <Pill tone={status === "open" ? "green" : "grey"}>{words.charAt(0).toUpperCase() + words.slice(1)}</Pill>;
}
