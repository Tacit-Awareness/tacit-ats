"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// design/tats's `.je-ed`: text that is edited where it sits. Plain text only:
// the element is `plaintext-only`, its value is read back as text and React
// never renders it as anything else. React leaves the element's text alone
// after the first paint (rewriting it would move the caret); only a value that
// really changed from outside (a row removed above it) is written in.

const read = (el: HTMLElement, multiline: boolean) => {
  const text = el.innerText.replace(/ /g, " ");
  return multiline ? text.replace(/\n$/, "") : text.replace(/\s*\n\s*/g, " ");
};

const placed = "cursor-text rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 whitespace-pre-wrap [overflow-wrap:anywhere] outline-none transition-[background-color,box-shadow] hover:bg-[color:var(--hover)] focus:bg-card focus:shadow-[0_0_0_1.5px_var(--accent)] empty:before:text-faint empty:before:content-[attr(data-ph)]";

export function Editable({
  value,
  onChange,
  label,
  placeholder,
  path,
  multiline = false,
  onEnter,
  onBackspaceEmpty,
  onPasteLines,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  /** Where the editor finds it again to move focus (`data-ed`). */
  path: string;
  multiline?: boolean;
  onEnter?: () => void;
  onBackspaceEmpty?: () => void;
  /** Several lines pasted into one line of a list. */
  onPasteLines?: (lines: string[]) => void;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (el && read(el, multiline) !== value) el.textContent = value;
  }, [value, multiline]);

  return (
    <span
      ref={ref}
      role="textbox"
      aria-label={label}
      aria-multiline={multiline}
      tabIndex={0}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-ed={path}
      data-ph={placeholder}
      className={cn(placed, className)}
      onInput={(e) => {
        const el = e.currentTarget;
        const text = read(el, multiline);
        // A browser leaves a stray line break behind when everything is deleted, which hides the placeholder.
        if (!text.trim() && el.childNodes.length) el.textContent = "";
        onChange(text.trim() ? text : "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !multiline) {
          e.preventDefault();
          if (onEnter) onEnter();
          else e.currentTarget.blur();
        }
        if (e.key === "Backspace" && onBackspaceEmpty && !e.currentTarget.textContent) {
          e.preventDefault();
          onBackspaceEmpty();
        }
      }}
      onPaste={(e) => {
        if (multiline) return;
        e.preventDefault();
        const pasted = e.clipboardData.getData("text/plain");
        const lines = pasted.split(/\r?\n/).map((l) => l.trim().replace(/^[-•*]\s+/, "")).filter(Boolean);
        if (onPasteLines && lines.length > 1) onPasteLines(lines);
        else document.execCommand("insertText", false, pasted.replace(/\s*\n\s*/g, " "));
      }}
    >
      {first.current}
    </span>
  );
}
