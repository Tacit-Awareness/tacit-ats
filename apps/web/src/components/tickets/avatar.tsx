// design/tacit-tickets/src/ui.tsx's Avatar: a staff member's initials in a quiet
// circle, no colour, the name on hover. People on the team only, never an
// applicant in Triage (DESIGN.md). Server-safe.

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-chip font-medium text-body"
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.4), letterSpacing: 0 }}
    >
      {initials(name)}
    </span>
  );
}
