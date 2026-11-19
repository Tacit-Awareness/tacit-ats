import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { X } from "lucide-react"
import type { Block } from "../data"

/*
 * A post's description, written like a page: click anywhere and type. Enter starts a new line,
 * "- " starts a list, "# " a heading, and a pasted or imported job description is split into
 * the same three kinds of line. Nothing here is more than text; it saves as one document.
 */

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const BULLET = /^(?:[-*•–]|\d+[.)])\s+(.*)$/

/* Plain text or Markdown, from a paste or a file, into lines */
export function parseDoc(text: string): Block[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.map((raw, i): Block => {
    const line = raw.replace(/\*\*/g, "")
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) return { id: uid(), kind: "h", text: heading[1] }
    const bullet = BULLET.exec(line)
    if (bullet) return { id: uid(), kind: "li", text: bullet[1] }
    /* A short line with no full stop, sitting right above a list, is that list's heading */
    const leads = line.length <= 60 && !/[.!?,;]$/.test(line) && BULLET.test(lines[i + 1] ?? "")
    return leads || /^\*\*.+\*\*:?$/.test(raw) ? { id: uid(), kind: "h", text: line.replace(/:$/, "") } : { id: uid(), kind: "p", text: line }
  })
}

export const hasText = (blocks: Block[]) => blocks.some((b) => b.text.trim())

const Bullet = () => <span className="mt-[10px] size-[5px] shrink-0 bg-faint" aria-hidden="true" />
const TEXT: Record<Block["kind"], string> = {
  p: "text-[15px] leading-[1.6] text-body",
  h: "text-[15px] leading-[1.6] font-semibold tracking-[-0.01em] text-ink",
  li: "text-[15px] leading-[1.6] text-body",
}
const GAP: Record<Block["kind"], string> = { p: "mt-2.5", h: "mt-8", li: "mt-1.5" }

export function DocView({ blocks }: { blocks: Block[] }) {
  return (
    <div>
      {blocks
        .filter((b) => b.text.trim())
        .map((b, i) =>
          b.kind === "h" ? (
            <h3 key={b.id} className={`${TEXT.h} ${i ? GAP.h : ""}`}>
              {b.text}
            </h3>
          ) : b.kind === "li" ? (
            <div key={b.id} role="listitem" className={`flex gap-3 ${i ? GAP.li : ""}`}>
              <Bullet />
              <span className={TEXT.li}>{b.text}</span>
            </div>
          ) : (
            <p key={b.id} className={`${TEXT.p} ${i ? GAP.p : ""}`}>
              {b.text}
            </p>
          )
        )}
    </div>
  )
}

export function DocEditor({ blocks, onChange }: { blocks: Block[]; onChange: (next: Block[]) => void }) {
  const [blank] = useState<Block>(() => ({ id: uid(), kind: "p", text: "" }))
  const rows = blocks.length ? blocks : [blank]
  const els = useRef(new Map<string, HTMLTextAreaElement>())
  const want = useRef<{ id: string; at: number } | null>(null)
  const empty = !hasText(rows) && rows.length === 1

  /* Each line is as tall as its text, and the caret lands where the last edit left it */
  useLayoutEffect(() => {
    els.current.forEach((el) => {
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    })
    const w = want.current
    const el = w && els.current.get(w.id)
    if (w && el) {
      el.focus()
      el.setSelectionRange(w.at, w.at)
      want.current = null
    }
  })

  const put = (next: Block[], focus?: { id: string; at: number }) => {
    if (focus) want.current = focus
    onChange(next)
  }
  const swap = (i: number, ...with_: Block[]) => [...rows.slice(0, i), ...with_, ...rows.slice(i + 1)]

  const type = (i: number, text: string, caret: number) => {
    const at = Math.max(caret - 2, 0)
    const b = rows[i]
    if (b.kind === "p" && /^[-*]\s/.test(text)) return put(swap(i, { ...b, kind: "li", text: text.slice(2) }), { id: b.id, at })
    if (b.kind === "p" && /^#\s/.test(text)) return put(swap(i, { ...b, kind: "h", text: text.slice(2) }), { id: b.id, at })
    put(swap(i, { ...b, text }))
  }

  const key = (i: number, e: KeyboardEvent<HTMLTextAreaElement>) => {
    const b = rows[i]
    const el = e.currentTarget
    const [a, z] = [el.selectionStart, el.selectionEnd]
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (b.kind !== "p" && !b.text) return put(swap(i, { ...b, kind: "p" }), { id: b.id, at: 0 })
      const next: Block = { id: uid(), kind: b.kind === "li" ? "li" : "p", text: b.text.slice(z) }
      put(swap(i, { ...b, text: b.text.slice(0, a) }, next), { id: next.id, at: 0 })
    } else if (e.key === "Backspace" && a === 0 && z === 0) {
      if (b.kind !== "p") {
        e.preventDefault()
        put(swap(i, { ...b, kind: "p" }), { id: b.id, at: 0 })
      } else if (i > 0) {
        e.preventDefault()
        const prev = rows[i - 1]
        put([...rows.slice(0, i - 1), { ...prev, text: prev.text + b.text }, ...rows.slice(i + 1)], { id: prev.id, at: prev.text.length })
      }
    } else if (e.key === "ArrowUp" && a === 0 && z === 0 && i > 0) {
      e.preventDefault()
      const prev = els.current.get(rows[i - 1].id)
      prev?.focus()
      prev?.setSelectionRange(prev.value.length, prev.value.length)
    } else if (e.key === "ArrowDown" && a === b.text.length && i < rows.length - 1) {
      e.preventDefault()
      const next = els.current.get(rows[i + 1].id)
      next?.focus()
      next?.setSelectionRange(0, 0)
    }
  }

  /* Clicking the empty space under the text carries on from the last line */
  const tail = () => {
    const last = rows[rows.length - 1]
    if (!last.text) return els.current.get(last.id)?.focus()
    const next: Block = { id: uid(), kind: "p", text: "" }
    put([...rows, next], { id: next.id, at: 0 })
  }

  return (
    <div>
      {rows.map((b, i) => (
        <div key={b.id} className={`flex gap-3 ${i ? GAP[b.kind] : ""}`}>
          {b.kind === "li" && <Bullet />}
          <textarea
            ref={(el) => {
              if (el) els.current.set(b.id, el)
              else els.current.delete(b.id)
            }}
            rows={1}
            value={b.text}
            aria-label={b.kind === "h" ? "Heading" : b.kind === "li" ? "List item" : "Paragraph"}
            placeholder={empty ? "Write about the role, or paste a job description" : b.kind === "h" ? "Heading" : b.kind === "li" ? "List item" : "Type - for a list, # for a heading"}
            onChange={(e) => type(i, e.target.value.replace(/\n/g, " "), e.target.selectionStart)}
            onKeyDown={(e) => key(i, e)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text/plain")
              if (!text.includes("\n")) return
              e.preventDefault()
              const pasted = parseDoc(text)
              if (!pasted.length) return
              const last = pasted[pasted.length - 1]
              put(b.text ? [...rows.slice(0, i + 1), ...pasted, ...rows.slice(i + 1)] : swap(i, ...pasted), { id: last.id, at: last.text.length })
            }}
            className={`doc-line block min-w-0 flex-1 resize-none overflow-hidden bg-transparent outline-none ${TEXT[b.kind]} ${empty ? "placeholder:text-faint" : "placeholder:text-transparent focus:placeholder:text-faint"}`}
          />
        </div>
      ))}
      <div className="h-24 cursor-text" onClick={tail} aria-hidden="true" />
    </div>
  )
}

/*
 * A short list you edit in place: click a line to change it, type on the last, empty line to add
 * one, clear a line to remove it. The first `locked` lines are fixed.
 */
export function Lines({
  items, onEdit, onAdd, onRemove, placeholder, label, marker, after, locked = 0,
}: {
  items: string[]
  onEdit: (i: number, text: string) => void
  onAdd: (text: string) => void
  onRemove: (i: number) => void
  placeholder: string
  label: string
  marker?: (i: number) => ReactNode
  after?: (i: number) => ReactNode
  locked?: number
}) {
  const [ids, setIds] = useState(() => items.map(uid))
  const [ghost, setGhost] = useState(uid)
  const keys = ids.length === items.length ? ids : items.map((_, i) => ids[i] ?? uid())
  if (keys !== ids) setIds(keys)
  const els = useRef(new Map<string, HTMLInputElement>())
  const rows = [...keys, ghost]
  const focus = (id?: string) => {
    const el = id ? els.current.get(id) : undefined
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }
  const remove = (i: number) => {
    setIds(keys.filter((_, n) => n !== i))
    onRemove(i)
  }

  return (
    <ul>
      {rows.map((id, i) => {
        const last = i === items.length
        const fixed = i < locked
        const tail = last ? null : after?.(i)
        return (
          <li key={id} className="group flex min-h-9 items-center gap-3">
            {marker?.(i)}
            <input
              ref={(el) => {
                if (el) els.current.set(id, el)
                else els.current.delete(id)
              }}
              value={last ? "" : items[i]}
              readOnly={fixed}
              placeholder={last ? placeholder : ""}
              aria-label={last ? placeholder : label}
              onChange={(e) => {
                const text = e.target.value
                if (!last) return onEdit(i, text)
                if (!text.trim()) return
                setIds([...keys, ghost])
                setGhost(uid())
                onAdd(text)
              }}
              onBlur={() => !last && !fixed && !items[i].trim() && remove(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "ArrowDown") {
                  e.preventDefault()
                  focus(rows[i + 1])
                } else if (e.key === "ArrowUp" || (e.key === "Backspace" && !fixed && !e.currentTarget.value && i > 0)) {
                  e.preventDefault()
                  focus(rows[i - 1])
                }
              }}
              className={`doc-line h-9 min-w-0 bg-transparent text-[14px] outline-none placeholder:text-faint ${tail ? "w-[38%] shrink-0" : "flex-1"} ${fixed ? "cursor-default text-body" : "text-ink"}`}
            />
            {tail}
            {!last && !fixed && (
              <button aria-label={`Remove ${items[i]}`} onClick={() => remove(i)} className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100">
                <X size={14} />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
