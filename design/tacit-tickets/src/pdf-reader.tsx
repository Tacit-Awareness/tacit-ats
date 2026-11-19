import { useEffect, useRef, useState, type ReactNode } from "react"
import { Download, Minus, Plus } from "lucide-react"
import * as pdfjs from "pdfjs-dist"
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { Bone, Loading } from "./kit"

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOMS = [1, 1.25, 1.5, 2]

/*
 * A file opened where you are reading: every page of the PDF drawn to the pane's width, with
 * zoom and a download. `url` is whatever the file link resolves to (in tATS, the signed link
 * get_file_link returns). `bare` drops the bar, for a preview inside another document.
 * Give it a `key` of the url: a different file is a different reader.
 */
export function PdfReader({ url, name, bare, onOpen, title }: { url: string; name: string; bare?: boolean; onOpen?: () => void; title?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null)
  const pagesEl = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(0)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    let live = true
    // A superseded load is left to finish and is then ignored. Destroying it, even after it
    // resolves, tears down the worker the load that replaced it is using, and that one hangs.
    pdfjs.getDocument({ url }).promise.then(
      (d) => { if (live) setDoc(d) },
      (err) => { if (live) { console.warn("PDF failed to open:", err); setFailed(true) } },
    )
    return () => { live = false }
  }, [url])

  /* Redraw at the pane's width, so the page stays sharp when the pane is resized */
  useEffect(() => {
    const el = pagesEl.current
    if (!el) return
    const measure = () => setWidth(Math.floor(el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const host = pagesEl.current
    if (!doc || !host || !width) return
    let live = true
    const tasks: RenderTask[] = []
    host.replaceChildren()
    const draw = async () => {
      for (let n = 1; n <= (bare ? 1 : doc.numPages); n++) {
        const page = await doc.getPage(n)
        if (!live) return
        const base = page.getViewport({ scale: 1 })
        const css = (width / base.width) * ZOOMS[zoom]
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: css * ratio })
        const canvas = document.createElement("canvas")
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${viewport.width / ratio}px`
        canvas.style.height = `${viewport.height / ratio}px`
        canvas.className = "block bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_10px_-2px_rgba(0,0,0,0.25)]"
        canvas.setAttribute("role", "img")
        canvas.setAttribute("aria-label", `${name}, page ${n}`)
        host.appendChild(canvas)
        const task = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport })
        tasks.push(task)
        await task.promise.catch(() => {})
      }
    }
    void draw()
    return () => { live = false; tasks.forEach((t) => t.cancel()) }
  }, [doc, width, zoom, bare, name])

  const body = (
    <div ref={wrap} className={bare ? "" : "scroll-quiet min-h-0 flex-1 overflow-auto bg-well px-6 py-5"}>
      {failed ? (
        <div className="flex h-40 items-center justify-center text-faint">This file could not be opened</div>
      ) : !doc ? (
        <Loading label={`Opening ${name}`}>
          <Bone className="mx-auto aspect-[612/792] w-full max-w-[760px] !rounded" />
        </Loading>
      ) : null}
      <div ref={pagesEl} className="mx-auto flex w-full max-w-[760px] flex-col items-start gap-4" />
    </div>
  )

  if (bare) {
    return (
      <button onClick={onOpen} aria-label={`Open ${name}`} className="relative block max-h-[300px] w-full overflow-hidden rounded-lg border border-line-strong text-left transition-colors hover:border-mute">
        {body}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-panel to-transparent" />
      </button>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-2 pl-5 text-mute">
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
          {title}
          <span className="shrink-0 text-faint">{doc ? `${doc.numPages} ${doc.numPages === 1 ? "page" : "pages"}` : "Opening"}</span>
        </span>
        <button aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)} className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-raised hover:text-ink disabled:opacity-30"><Minus size={14} /></button>
        <span className="w-10 text-center text-xs tabular-nums">{Math.round(ZOOMS[zoom] * 100)}%</span>
        <button aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)} className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-raised hover:text-ink disabled:opacity-30"><Plus size={14} /></button>
        <a href={url} download={name} aria-label={`Download ${name}`} title="Download" className="ml-1 flex size-7 items-center justify-center rounded-md transition-colors hover:bg-raised hover:text-ink"><Download size={14} /></a>
      </div>
      {body}
    </div>
  )
}
