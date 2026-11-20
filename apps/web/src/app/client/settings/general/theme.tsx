"use client";

import { useEffect, useState } from "react";
import { applyAppearance } from "@/components/app-shell/account-menu";
import { APPEARANCES, appearanceOf, type Appearance } from "@/lib/theme";

// The look, as the sidebar's menu offers it (lib/theme.ts's APPEARANCES):
// Classic Dark, Dark, Light, Max Light or System. Each says what it is on hover.

export function ThemeChoice() {
  const [value, setValue] = useState<Appearance>("system");
  useEffect(() => {
    const root = document.documentElement;
    setValue(appearanceOf(root.dataset.theme, root.dataset.look));
  }, []);
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-well p-0.5" role="radiogroup" aria-label="Theme">
      {APPEARANCES.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          title={o.means}
          onClick={() => {
            applyAppearance(o.key);
            setValue(o.key);
          }}
          className={`flex h-7 items-center rounded-md px-2.5 whitespace-nowrap transition-colors ${value === o.key ? "bg-panel text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-mute hover:text-ink"}`}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}
