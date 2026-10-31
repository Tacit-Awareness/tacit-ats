"use client";

import { useEffect } from "react";
import { GLASS_CLASS, PILL_TRACK, followsPointer, glassBox, takesGlass, type GlassItem } from "@/lib/pill-glass";

// design/tats's liquid glass hover (`i.pill-glass`), the React half: mounted once
// in the shell, it listens on the document, so every pill track has it with
// nothing to wire up. The first hover puts one <i> in the track, as the
// prototype does: the glass has to sit under the labels and over the track, so
// it can't live anywhere else, and React leaves a node it doesn't know about
// alone. It only follows a pointer, so the keys and a phone never see it. The
// look is `.pill-glass` in globals.css, which also turns the motion off.

type Item = HTMLElement & GlassItem;

const place = (glass: HTMLElement, item: Item) => Object.assign(glass.style, glassBox(item));

export function PillGlass() {
  useEffect(() => {
    const onOver = (e: PointerEvent) => {
      if (!followsPointer(e.pointerType)) return;
      const item = (e.target as Element | null)?.closest?.(`${PILL_TRACK} > :not(.${GLASS_CLASS})`) as Item | null;
      const track = item?.parentElement;
      if (!item || !track || !takesGlass(item)) return;
      let glass = track.querySelector<HTMLElement>(`:scope > .${GLASS_CLASS}`);
      if (!glass) {
        glass = document.createElement("i");
        glass.className = GLASS_CLASS;
        glass.setAttribute("aria-hidden", "true");
        track.prepend(glass);
      }
      if (glass.classList.contains("show")) {
        place(glass, item);
      } else {
        // Coming in from outside it appears in place, and only then slides.
        glass.style.transition = "none";
        place(glass, item);
        void glass.offsetWidth;
        glass.style.transition = "";
      }
      glass.classList.add("show");
    };
    const onOut = (e: PointerEvent) => {
      const track = (e.target as Element | null)?.closest?.(PILL_TRACK);
      if (track && !track.contains(e.relatedTarget as Node | null)) track.querySelector(`:scope > .${GLASS_CLASS}`)?.classList.remove("show");
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
    };
  }, []);
  return null;
}
