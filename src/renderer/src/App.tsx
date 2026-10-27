import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  GripVertical,
  Layers3,
  Search,
  X
} from 'lucide-react'
import type { DesktopWindow, WindowSnapshot } from '../../shared/window'

interface WindowGroup {
  key: string
  name: string
  windows: DesktopWindow[]
}

const friendlyProcessNames: Record<string, string> = {
  phpstorm64: 'PhpStorm',
  webstorm64: 'WebStorm',
  idea64: 'IntelliJ IDEA',
  pycharm64: 'PyCharm',
  rider64: 'Rider',
  code: 'Visual Studio Code'
}

function displayProcessName(processName: string): string {
  return friendlyProcessNames[processName.toLocaleLowerCase()] ?? processName
}

const emptySnapshot: WindowSnapshot = { windows: [], activeHwnd: null, error: null }

function groupWindows(windows: DesktopWindow[]): WindowGroup[] {
  const groups = new Map<string, WindowGroup>()
  for (const desktopWindow of windows) {
    const key = desktopWindow.processName.toLocaleLowerCase()
    const group = groups.get(key) ?? { key, name: displayProcessName(desktopWindow.processName), windows: [] }
    group.windows.push(desktopWindow)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function WindowIcon({ window: desktopWindow }: { window: DesktopWindow }): React.JSX.Element {
  if (desktopWindow.iconDataUrl) {
    return <img src={desktopWindow.iconDataUrl} alt="" className="size-5 shrink-0 object-contain" />
  }
  return <AppWindow aria-hidden="true" className="size-5 shrink-0 text-slate-500" />
}

export default function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [selectedHwnd, setSelectedHwnd] = useState<string | null>(null)
  const [activationError, setActivationError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.flowDock.getSnapshot().then(setSnapshot).catch((error: unknown) => {
      setSnapshot({ ...emptySnapshot, error: error instanceof Error ? error.message : String(error) })
    })
    const unsubscribeSnapshot = window.flowDock.onSnapshot(setSnapshot)
    const unsubscribeFocus = window.flowDock.onFocusSearch(() => searchRef.current?.focus())
    return () => {
      unsubscribeSnapshot()
      unsubscribeFocus()
    }
  }, [])

  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const filtered = normalizedQuery
      ? snapshot.windows.filter((desktopWindow) =>
          desktopWindow.title.toLocaleLowerCase().includes(normalizedQuery) ||
          desktopWindow.processName.toLocaleLowerCase().includes(normalizedQuery)
        )
      : snapshot.windows
    return groupWindows(filtered)
  }, [query, snapshot.windows])

  const visibleWindows = useMemo(
    () => groups.flatMap((group) => collapsed.has(group.key) ? [] : group.windows),
    [collapsed, groups]
  )

  useEffect(() => {
    if (visibleWindows.length === 0) {
      setSelectedHwnd(null)
      return
    }
    const currentExists = visibleWindows.some((desktopWindow) => desktopWindow.hwnd === selectedHwnd)
    if (!currentExists) {
      const active = visibleWindows.find((desktopWindow) => desktopWindow.hwnd === snapshot.activeHwnd)
      setSelectedHwnd(active?.hwnd ?? visibleWindows[0].hwnd)
    }
  }, [selectedHwnd, snapshot.activeHwnd, visibleWindows])

  const activate = useCallback(async (hwnd: string) => {
    setActivationError(null)
    try {
      const activated = await window.flowDock.activateWindow(hwnd)
      if (!activated) setActivationError('Windows prevented this app from taking foreground focus.')
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : 'Window activation failed.')
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void window.flowDock.hide()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return
      if (visibleWindows.length === 0) return
      event.preventDefault()
      if (event.key === 'Enter') {
        if (selectedHwnd) void activate(selectedHwnd)
        return
      }
      const currentIndex = visibleWindows.findIndex((item) => item.hwnd === selectedHwnd)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const baseIndex = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex
      const nextIndex = (baseIndex + direction + visibleWindows.length) % visibleWindows.length
      setSelectedHwnd(visibleWindows[nextIndex].hwnd)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activate, selectedHwnd, visibleWindows])

  const toggleGroup = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const startResize = (event: React.PointerEvent): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.screenX
    const startWidth = window.innerWidth
    let pendingWidth = startWidth
    let animationFrame: number | null = null

    const commit = (): void => {
      animationFrame = null
      void window.flowDock.setWidth(pendingWidth)
    }
    const move = (moveEvent: PointerEvent): void => {
      pendingWidth = startWidth + startX - moveEvent.screenX
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(commit)
    }
    const stop = (): void => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      void window.flowDock.setWidth(pendingWidth)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <main className="relative flex h-screen min-w-0 overflow-hidden border border-r-0 border-white/10 bg-[#0b0e14]/[0.97] text-slate-200 shadow-dock backdrop-blur-xl">
      <button
        type="button"
        aria-label="Resize sidebar"
        className="group absolute inset-y-0 left-0 z-20 flex w-2 cursor-ew-resize items-center justify-center outline-none"
        onPointerDown={startResize}
      >
        <span className="h-12 w-0.5 rounded-full bg-white/10 transition-colors group-hover:bg-cyan-400/60" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col pl-2">
        <header className="border-b border-white/[0.07] px-3 pb-3 pt-3.5">
          <div className="mb-3 flex items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 shadow-lg shadow-cyan-500/15">
                <Layers3 className="size-4 text-slate-950" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-[13px] font-semibold tracking-wide text-white">FlowDock</h1>
                <p className="text-[10px] text-slate-500">{snapshot.windows.length} open windows</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Hide FlowDock"
              onClick={() => void window.flowDock.hide()}
              className="grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <X className="size-4" />
            </button>
          </div>

          <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 transition focus-within:border-cyan-400/50 focus-within:bg-white/[0.055]">
            <Search className="size-3.5 shrink-0 text-slate-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a window…"
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
              autoFocus
            />
            <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-600">ESC</kbd>
          </label>
        </header>

        {(snapshot.error || activationError) && (
          <div className="mx-3 mt-3 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] p-2.5 text-[11px] leading-relaxed text-amber-200/80">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
            <span>{activationError ?? snapshot.error}</span>
          </div>
        )}

        <section className="scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2" aria-label="Open windows">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key)
            return (
              <div key={group.key} className="mb-1.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 transition hover:bg-white/[0.035] hover:text-slate-400"
                >
                  {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="font-mono text-[9px] text-slate-600">{group.windows.length}</span>
                </button>

                {!isCollapsed && group.windows.map((desktopWindow) => {
                  const isActive = desktopWindow.hwnd === snapshot.activeHwnd
                  const isSelected = desktopWindow.hwnd === selectedHwnd
                  return (
                    <button
                      type="button"
                      key={desktopWindow.hwnd}
                      title={desktopWindow.title}
                      onMouseEnter={() => setSelectedHwnd(desktopWindow.hwnd)}
                      onClick={() => void activate(desktopWindow.hwnd)}
                      className={`group/window relative mb-0.5 flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition-all duration-150 focus:outline-none ${
                        isSelected
                          ? 'border-white/10 bg-white/[0.075] text-white'
                          : 'border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                      }`}
                    >
                      {isActive && <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />}
                      <WindowIcon window={desktopWindow} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium leading-4">{desktopWindow.title}</span>
                        <span className="mt-0.5 block truncate text-[9px] leading-3 text-slate-600">
                          {desktopWindow.minimized ? 'Minimized · ' : ''}{desktopWindow.processName}
                        </span>
                      </span>
                      <GripVertical className="size-3 shrink-0 text-transparent transition group-hover/window:text-slate-700" />
                    </button>
                  )
                })}
              </div>
            )
          })}

          {groups.length === 0 && !snapshot.error && (
            <div className="grid place-items-center px-5 py-16 text-center">
              <AppWindow className="mb-3 size-7 text-slate-700" />
              <p className="text-xs font-medium text-slate-500">{query ? 'No matching windows' : 'No open windows found'}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-700">{query ? 'Try a different title or app name.' : 'New windows will appear automatically.'}</p>
            </div>
          )}
        </section>

        <footer className="flex h-8 shrink-0 items-center justify-between border-t border-white/[0.06] px-3 text-[9px] text-slate-600">
          <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> switch</span>
        </footer>
      </div>
    </main>
  )
}
