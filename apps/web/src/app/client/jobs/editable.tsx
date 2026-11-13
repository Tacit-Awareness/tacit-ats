"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Marked } from "@/components/marked";
import { hasMarks, toggleMark, type Mark } from "@/lib/inline-marks";
import { cn } from "@/lib/utils";

// design/tats's `.je-ed`: text that is edited where it sits. Plain text only:
// the element is `plaintext-only`, its value is read back as text and React
// never renders it as anything else. React leaves the element's text alone
// after the first paint (rewriting it would move the caret); only a value that
// really changed from outside (a row removed above it) is written in.
//
// With `formatting` (a question's label), ⌘B / ⌘I and the editor's B and I
// buttons put Markdown's marks round the selection, or the whole line with
// none (lib/inline-marks.ts). The marks show while it is being edited; away
// from it, the line is drawn bold and italic, and a click goes back to the
// place clicked.

export type EditableControls = { toggle: (mark: Mark) => void };

/** The selection inside `el`, as offsets in its text, or null when it is elsewhere. */
function selectionIn(el: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const offset = (node: Node, at: number) => {
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(node, at);
    return pre.toString().length;
  };
  return { start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) };
}

/** Select `start`..`end` of `el`'s text. */
function placeSelection(el: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const find = (target: number): [Node, number] => {
    let seen = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.textContent?.length ?? 0;
      if (target <= seen + len) return [n, target - seen];
      seen += len;
    }
    return [el, el.childNodes.length];
  };
  const [a, ao] = find(start);
  walker.currentNode = el;
  const [b, bo] = find(end);
  window.getSelection()?.setBaseAndExtent(a, ao, b, bo);
}

/** Where in the raw text a click on the drawn line landed, by the spans' `data-from`. */
function rawOffsetAt(x: number, y: number): number | null {
  let node: Node | null = null;
  let offset = 0;
  if ("caretPositionFromPoint" in document) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) [node, offset] = [p.offsetNode, p.offset];
  } else if ("caretRangeFromPoint" in document) {
    const r = (document as Document).caretRangeFromPoint(x, y);
    if (r) [node, offset] = [r.startContainer, r.startOffset];
  }
  const host = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null))?.closest<HTMLElement>("[data-from]");
  if (!host) return null;
  return Number(host.dataset.from) + (node?.nodeType === Node.TEXT_NODE ? offset : 0);
}

const read = (el: HTMLElement, multiline: boolean) => {
  const text = el.innerText.replace(/ /g, " ");
  return multiline ? text.replace(/\n$/, "") : text.replace(/\s*\n\s*/g, " ");
};

// In Testbench's look the text stays where it sits, and only shows it is a
// field when it matters: on hover a field's faint edge on the surface, while
// typing a field's raised face with its ink ring (ui/input.tsx's focus).
const placed =
  "cursor-text rounded-[6px] px-1.5 py-0.5 -mx-1.5 -my-0.5 whitespace-pre-wrap [overflow-wrap:anywhere] outline-none transition-[background-color,box-shadow] duration-150 hover:bg-[color:var(--surface)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)] focus:bg-card focus:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_color-mix(in_srgb,var(--ink)_12%,transparent)] focus-visible:outline-none empty:before:text-faint empty:before:content-[attr(data-ph)]";

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
  formatting = false,
  controls,
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
  /** Bold and italic, by ⌘B / ⌘I and `controls`. Single-line text only. */
  formatting?: boolean;
  /** For buttons beside it: toggles a mark on the selection, or the whole line. */
  controls?: Ref<EditableControls>;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(value);
  const [editing, setEditing] = useState(false);
  const caret = useRef<number | null>(null);
  const drawn = formatting && !editing && hasMarks(value);

  useEffect(() => {
    const el = ref.current;
    if (el && read(el, multiline) !== value) el.textContent = value;
  }, [value, multiline]);

  // Leaving the drawn line for the text: focus it at the place clicked.
  useEffect(() => {
    const el = ref.current;
    if (!editing || caret.current === null || !el) return;
    const at = Math.min(caret.current, el.textContent?.length ?? 0);
    caret.current = null;
    el.focus();
    placeSelection(el, at, at);
  }, [editing]);

  const toggle = (mark: Mark) => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent ?? "";
    const focused = document.activeElement === el;
    const picked = focused ? selectionIn(el) : null;
    const range = picked && picked.start !== picked.end ? picked : { start: 0, end: text.length };
    const next = toggleMark(text, range.start, range.end, mark);
    if (next.text === text) return;
    if (focused) {
      // Through the browser's own editing, so ⌘Z takes it back; the input event saves it.
      placeSelection(el, 0, text.length);
      document.execCommand("insertText", false, next.text);
      placeSelection(el, next.start, next.end);
    } else {
      el.textContent = next.text;
      onChange(next.text);
    }
  };
  useImperativeHandle(controls, () => ({ toggle }));

  return (
    <>
      {drawn ? (
        <span
          role="textbox"
          aria-label={label}
          tabIndex={0}
          className={cn(placed, className)}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            caret.current = rawOffsetAt(e.clientX, e.clientY) ?? value.length;
            setEditing(true);
          }}
          onFocus={() => {
            caret.current ??= value.length;
            setEditing(true);
          }}
        >
          <Marked text={value} offsets />
        </span>
      ) : null}
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
        className={cn(placed, className, drawn && "hidden")}
        onFocus={() => formatting && setEditing(true)}
        onBlur={() => formatting && setEditing(false)}
        onInput={(e) => {
          const el = e.currentTarget;
          const text = read(el, multiline);
          // A browser leaves a stray line break behind when everything is deleted, which hides the placeholder.
          if (!text.trim() && el.childNodes.length) el.textContent = "";
          onChange(text.trim() ? text : "");
        }}
        onKeyDown={(e) => {
          const key = e.key.toLowerCase();
          if (formatting && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (key === "b" || key === "i")) {
            e.preventDefault();
            toggle(key === "b" ? "bold" : "italic");
            return;
          }
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
    </>
  );
}
