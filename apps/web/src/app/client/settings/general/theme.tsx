"use client";

import { useEffect, useState } from "react";
import { applyTheme } from "@/components/app-shell/account-menu";
import { themeChoice, type ThemeChoice as Choice } from "@/lib/theme";

// The theme as Light, Dark or System (design/tacit-tickets's Segmented), the
// same choice the account menu makes.

const OPTIONS: { key: Choice; label: string }[] = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "system", label: "System" },
];

export function ThemeChoice() {
  const [value, setValue] = useState<Choice>("system");
  useEffect(() => setValue(themeChoice(document.documentElement.dataset.theme)), []);
  return (
    <div className="inline-flex rounded-lg bg-well p-0.5" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => {
            applyTheme(o.key);
            setValue(o.key);
          }}
          className={`flex h-7 items-center rounded-md px-2.5 whitespace-nowrap transition-colors ${value === o.key ? "bg-panel text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-mute hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
