"use client";

import { useEffect, useRef } from "react";
import {
  BrainCircuit,
  Building2,
  ClipboardCheck,
  Code,
  Cog,
  Cpu,
  Database,
  FlaskConical,
  Globe,
  Handshake,
  HeartHandshake,
  Landmark,
  Layers,
  LifeBuoy,
  Megaphone,
  Package,
  Palette,
  PenTool,
  Rocket,
  Scale,
  Server,
  Shield,
  Smartphone,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

// A team's mark in the sidebar. Nobody has to choose one: a team is matched to
// an icon by its name the moment it exists (teamIconFor). Right-clicking a team
// opens the picker to choose another; that choice is kept in this browser, as
// the pins are, because a department has no icon column.

// Each icon has its own hue, so a team can be found by colour as well as shape. The hues are
// mid-tones that read on both the light and the dark sidebar, and the same icon is always the
// same colour. They mark teams only; red, amber, blue and green as status are the tokens.
const HUES = {
  slate: "#7c8494",
  pink: "#d0669c",
  rose: "#d9657a",
  orange: "#d98548",
  amber: "#c59a2e",
  lime: "#7fa83c",
  teal: "#2fa392",
  cyan: "#2f9fc4",
  sky: "#4a8fe0",
  indigo: "#6c79e0",
  violet: "#9a6fd8",
} as const;

export const TEAM_ICONS: { key: string; name: string; icon: LucideIcon; hue: keyof typeof HUES }[] = [
  { key: "users", name: "People", icon: Users, hue: "slate" },
  { key: "palette", name: "Design", icon: Palette, hue: "pink" },
  { key: "pen", name: "Writing", icon: PenTool, hue: "rose" },
  { key: "megaphone", name: "Marketing", icon: Megaphone, hue: "orange" },
  { key: "handshake", name: "Sales", icon: Handshake, hue: "amber" },
  { key: "trending", name: "Growth", icon: TrendingUp, hue: "lime" },
  { key: "package", name: "Product", icon: Package, hue: "violet" },
  { key: "code", name: "Engineering", icon: Code, hue: "indigo" },
  { key: "server", name: "Infrastructure", icon: Server, hue: "sky" },
  { key: "layers", name: "Platform", icon: Layers, hue: "teal" },
  { key: "rocket", name: "Serving", icon: Rocket, hue: "rose" },
  { key: "smartphone", name: "Mobile", icon: Smartphone, hue: "cyan" },
  { key: "cpu", name: "Hardware", icon: Cpu, hue: "slate" },
  { key: "database", name: "Data", icon: Database, hue: "cyan" },
  { key: "flask", name: "Research", icon: FlaskConical, hue: "indigo" },
  { key: "brain", name: "Training", icon: BrainCircuit, hue: "amber" },
  { key: "clipboard", name: "Evals", icon: ClipboardCheck, hue: "cyan" },
  { key: "sparkles", name: "Special Projects", icon: Sparkles, hue: "amber" },
  { key: "shield", name: "Security", icon: Shield, hue: "sky" },
  { key: "scale", name: "Legal", icon: Scale, hue: "slate" },
  { key: "landmark", name: "Finance", icon: Landmark, hue: "lime" },
  { key: "heart", name: "People Team", icon: HeartHandshake, hue: "rose" },
  { key: "lifebuoy", name: "Support", icon: LifeBuoy, hue: "orange" },
  { key: "cog", name: "Operations", icon: Cog, hue: "slate" },
  { key: "wrench", name: "Tools", icon: Wrench, hue: "violet" },
  { key: "truck", name: "Logistics", icon: Truck, hue: "amber" },
  { key: "globe", name: "International", icon: Globe, hue: "sky" },
  { key: "building", name: "Office", icon: Building2, hue: "violet" },
];

// First match wins, so the narrower words come before the broader ones:
// "Post-training" is training before it is anything else, and "Product Design"
// is design.
const RULES: [RegExp, string][] = [
  [/eval|quality|\bqa\b|test/, "clipboard"],
  [/train|\bml\b|model|\bai\b|machine learning/, "brain"],
  [/research|science|lab/, "flask"],
  [/design|brand|creative|\bux\b/, "palette"],
  [/content|writing|editorial|comms|communic/, "pen"],
  [/market|gtm|go[- ]to[- ]market|demand/, "megaphone"],
  [/sales|revenue|account exec|partnership|business dev/, "handshake"],
  [/growth/, "trending"],
  [/infra|devops|\bsre\b|reliab|cloud/, "server"],
  [/platform/, "layers"],
  [/serving|inference|deploy|release/, "rocket"],
  [/mobile|\bios\b|android/, "smartphone"],
  [/hardware|robot|chip|silicon/, "cpu"],
  [/data|analytic/, "database"],
  [/security|trust|safety/, "shield"],
  [/legal|compliance|policy/, "scale"],
  [/financ|accounting|treasury/, "landmark"],
  [/people|\bhr\b|talent|recruit/, "heart"],
  [/support|success|customer/, "lifebuoy"],
  [/operation|\bops\b/, "cog"],
  [/tool|internal|\bit\b/, "wrench"],
  [/logistic|supply|fulfil/, "truck"],
  [/international|global|localiz/, "globe"],
  [/workplace|office|facilit/, "building"],
  [/product/, "package"],
  [/engineer|\beng\b|software|backend|frontend|full[- ]stack/, "code"],
];

/** The icon a team gets from its name alone; the people mark when nothing in the name says more. */
export function teamIconFor(name: string): string {
  const n = name.toLowerCase();
  return RULES.find(([re]) => re.test(n))?.[1] ?? "users";
}

const byKey = new Map(TEAM_ICONS.map((i) => [i.key, i]));

/** A team's mark: the one chosen for it here, else the one its name matches. */
export function TeamIcon({ name, chosen, size = 14 }: { name: string; chosen?: string; size?: number }) {
  const { icon: Icon, hue } = byKey.get(chosen ?? "") ?? byKey.get(teamIconFor(name)) ?? TEAM_ICONS[0]!;
  return <Icon size={size} className="shrink-0" style={{ color: HUES[hue] }} />;
}

/** What is kept in this browser: team id to icon key. Anything else stored there is ignored. */
export const TEAM_ICONS_KEY = "tacit-team-icons";
export function readTeamIcons(raw: string | null): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(raw ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === "string" && byKey.has(e[1])));
  } catch {
    return {};
  }
}

/** The picker a right-click on a team opens, at the pointer: every icon with its name, and the way back to the match. */
export function TeamIconPicker({ team, at, chosen, onPick, onClose }: { team: string; at: { x: number; y: number }; chosen?: string; onPick: (key: string | null) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const current = chosen ?? teamIconFor(team);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div
        ref={box}
        role="menu"
        aria-label={`Icon for ${team}`}
        className="anim-rise fixed z-50 w-[236px] rounded-xl border border-line-strong bg-panel p-2 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)]"
        // Kept on the page: the picker is about 250px tall and 236px wide
        style={{ left: Math.max(8, Math.min(at.x, innerWidth - 244)), top: Math.max(8, Math.min(at.y, innerHeight - 262)) }}
      >
        <div className="px-1 pb-1.5 text-xs text-dim">Icon for {team}</div>
        <div className="grid grid-cols-7 gap-0.5">
          {TEAM_ICONS.map(({ key, name, icon: Icon, hue }) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={current === key}
              aria-label={name}
              title={name}
              onClick={() => onPick(key)}
              className={`flex size-[30px] items-center justify-center rounded-md transition-colors hover:bg-hover ${current === key ? "bg-sel" : ""}`}
            >
              <Icon size={15} style={{ color: HUES[hue] }} />
            </button>
          ))}
        </div>
        {chosen && (
          <button type="button" role="menuitem" onClick={() => onPick(null)} className="mt-1.5 flex h-7 w-full items-center rounded-md px-1.5 text-left text-body transition-colors hover:bg-hover hover:text-ink">
            Match It To The Name Again
          </button>
        )}
      </div>
    </>
  );
}
