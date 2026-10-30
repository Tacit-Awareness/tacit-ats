import type { AccessLevel } from "./session";

// What each access level is called in the client area.
export const LEVELS: Record<AccessLevel, string> = { limited: "Interviewer", elevated: "Hiring team", admin: "Admin" };

/** Lowest first, the order a picker lists them. */
export const ACCESS_LEVELS: readonly AccessLevel[] = ["limited", "elevated", "admin"];

export const isAccessLevel = (v: unknown): v is AccessLevel => typeof v === "string" && (ACCESS_LEVELS as readonly string[]).includes(v);

export const levelName = (v: string | null | undefined) => (v && v in LEVELS ? LEVELS[v as AccessLevel] : "");
