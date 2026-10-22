import type { AccessLevel } from "./session";

// What each access level is called in the client area.
export const LEVELS: Record<AccessLevel, string> = { limited: "Interviewer", elevated: "Hiring team", admin: "Admin" };

export const levelName = (v: string | null | undefined) => (v && v in LEVELS ? LEVELS[v as AccessLevel] : "");
