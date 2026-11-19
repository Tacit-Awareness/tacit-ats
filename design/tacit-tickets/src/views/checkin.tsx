import { useState } from "react"
import { CalendarClock, MoreHorizontal } from "lucide-react"
import type { CheckIn } from "../org"
import { Empty, IconButton, Menu } from "../kit"
import { useStore } from "../store"

/*
 * Check In: people worth another look later. Each row says who they were to you, where they work
 * now, whether that has changed since you last looked, and when to look again.
 */

const AGAIN: [string, string][] = [
  ["In 1 Month", "Dec 18"],
  ["In 3 Months", "Feb 18"],
  ["In 6 Months", "May 18"],
]
const COLS = "grid grid-cols-[minmax(200px,1.1fr)_minmax(200px,1fr)_96px_32px] @max-2xl:grid-cols-[minmax(0,1fr)_80px_32px] items-center gap-4"

export function CheckIns() {
  const s = useStore()
  const [editing, setEditing] = useState<string | null>(null)
  const patch = (id: string, fn: (c: CheckIn) => CheckIn) => s.setCheckins((all) => all.map((c) => (c.id === id ? fn(c) : c)))
  const groups: [string, CheckIn[]][] = [
    ["Due", s.checkins.filter((c) => c.late)],
    ["Coming Up", s.checkins.filter((c) => !c.late)],
  ]

  if (!s.checkins.length) {
    return (
      <Empty icon={<CalendarClock size={18} />} title="Nobody to check in on">
        Add someone from the menu on their candidate view, and they are kept here with a date to look again.
      </Empty>
    )
  }

  return (
    <>
      <div className={`${COLS} h-9 shrink-0 border-b border-line pr-4 pl-5 text-xs text-faint`}>
        <span>Name</span>
        <span className="@max-2xl:hidden">Now</span>
        <span>Check In</span>
        <span />
      </div>
      <div className="scroll-quiet flex-1 overflow-y-auto">
        {groups.map(
          ([name, rows]) =>
            rows.length > 0 && (
              <section key={name}>
                <div className="sticky top-0 z-10 flex h-9 items-center gap-2.5 bg-panel pt-1 pr-3 pl-5">
                  <span className="font-medium text-ink">{name}</span>
                  <span className="text-faint tabular-nums">{rows.length}</span>
                </div>
                {rows.map((c) => (
                  <div key={c.id} className={`${COLS} anim-rise min-h-14 py-2 pr-4 pl-5 transition-colors hover:bg-hover ${c.late ? "wash-needs" : ""}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{c.name}</span>
                      <span className="block truncate text-mute" title={c.last}>
                        {c.was}
                      </span>
                    </span>
                    <span className="min-w-0 @max-2xl:hidden">
                      {editing === c.id ? (
                        <input
                          autoFocus
                          defaultValue={c.now}
                          aria-label={`Where ${c.name} works now`}
                          onBlur={() => setEditing(null)}
                          onKeyDown={(e) => {
                            const next = e.currentTarget.value.trim()
                            if (e.key === "Escape") setEditing(null)
                            if (e.key !== "Enter" || !next) return
                            if (next !== c.now) {
                              patch(c.id, (x) => ({ ...x, now: next, moved: { from: x.now, when: "Nov" } }))
                              s.setToast(`${c.name.split(" ")[0]}'s job updated`)
                            }
                            setEditing(null)
                          }}
                          className="doc-line h-7 w-full rounded-md bg-raised px-2 text-ink outline-none"
                        />
                      ) : (
                        <>
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-ink">{c.now}</span>
                            {c.moved && <span className="shrink-0 rounded-md bg-s-scheduled/15 px-1.5 py-px text-xs text-s-scheduled">New job, {c.moved.when}</span>}
                          </span>
                          <span className="block truncate text-mute">{c.moved ? `Was ${c.moved.from}` : (c.last ?? "No change since you last looked")}</span>
                        </>
                      )}
                    </span>
                    <span className={`tabular-nums ${c.late ? "font-medium text-ink" : "text-mute"}`}>{c.due}</span>
                    <Menu
                      align="right"
                      width={220}
                      trigger={() => (
                        <IconButton label={`Actions for ${c.name}`}>
                          <MoreHorizontal size={16} />
                        </IconButton>
                      )}
                      items={[
                        { heading: "Checked In, Look Again" },
                        ...AGAIN.map(([label, due]) => ({
                          label,
                          onPick: () => {
                            patch(c.id, (x) => ({ ...x, due, late: false, moved: undefined }))
                            s.setToast(`Next check-in ${due}`)
                          },
                        })),
                        "sep",
                        { label: "Update Their Job", onPick: () => setEditing(c.id) },
                        {
                          label: "Bring Back Into Triage",
                          onPick: () => {
                            s.setCheckins((all) => all.filter((x) => x.id !== c.id))
                            s.addCandidate(c.name, "No email yet", s.roles[0].id)
                          },
                        },
                        { label: "Stop Tracking", danger: true, onPick: () => s.setCheckins((all) => all.filter((x) => x.id !== c.id)) },
                      ]}
                    />
                  </div>
                ))}
              </section>
            )
        )}
      </div>
    </>
  )
}
