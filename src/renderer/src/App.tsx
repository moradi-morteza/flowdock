import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Keyboard,
  Languages,
  Layers3,
  LogOut,
  MonitorUp,
  Palette,
  Power,
  Search,
  Settings,
  Sparkles,
  Timer,
  Type,
  X
} from 'lucide-react'
import type {
  DesktopWindow,
  DisplayInfo,
  FlowDockPreferences,
  PreferencesResult,
  StartupSettings,
  WindowSnapshot
} from '../../shared/window'
import {
  accentPresets,
  applyAppearance,
  fontPresets,
  loadAppearance,
  themePresets,
  type AppearanceSettings
} from './appearance'
import { PomodoroPage, type PomodoroSummary } from './PomodoroPage'
import { useI18n } from './i18n'

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

function displayMonitorName(device: string): string {
  const match = device.match(/DISPLAY(\d+)$/i)
  return match ? `M${match[1]}` : 'M?'
}

const emptySnapshot: WindowSnapshot = { windows: [], activeHwnd: null, error: null }
const initialStartupSettings: StartupSettings = { enabled: false, supported: true, error: null }

function acceleratorFromEvent(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') return null
  if (event.key === 'Backspace' || event.key === 'Delete') return ''
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')
  let key = event.key === ' ' ? 'Space' : event.key
  if (/^[a-z0-9]$/i.test(key)) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

function formatCompactTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = Math.max(0, totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

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
  return <AppWindow aria-hidden="true" className="size-5 shrink-0 text-slate-300" />
}

export default function App(): React.JSX.Element {
  const { language, setLanguage, t } = useI18n()
  const [page, setPage] = useState<'windows' | 'pomodoro' | 'settings'>('windows')
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [selectedHwnd, setSelectedHwnd] = useState<string | null>(null)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [startupSettings, setStartupSettings] = useState(initialStartupSettings)
  const [startupLoading, setStartupLoading] = useState(true)
  const [pomodoroSummary, setPomodoroSummary] = useState<PomodoroSummary | null>(null)
  const [appearance, setAppearance] = useState<AppearanceSettings>(loadAppearance)
  const [preferencesResult, setPreferencesResult] = useState<PreferencesResult | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => applyAppearance(appearance), [appearance])

  useEffect(() => {
    void Promise.all([window.flowDock.getPreferences(), window.flowDock.getDisplays()])
      .then(([result, displayList]) => {
        setPreferencesResult(result)
        setDisplays(displayList)
      })
      .catch((error: unknown) => {
        console.error('Unable to load FlowDock preferences', error)
      })
  }, [])

  const updatePreferences = useCallback(async (preferences: FlowDockPreferences): Promise<void> => {
    setPreferencesResult((current) => ({ preferences, error: current?.error ?? null }))
    setPreferencesResult(await window.flowDock.setPreferences(preferences))
  }, [])

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

  useEffect(() => {
    void window.flowDock.getStartupSettings()
      .then(setStartupSettings)
      .catch((error: unknown) => {
        setStartupSettings({
          enabled: false,
          supported: true,
          error: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => setStartupLoading(false))
  }, [])

  const updateStartup = useCallback(async (enabled: boolean) => {
    if (startupLoading) return
    setStartupLoading(true)
    setStartupSettings((current) => ({ ...current, error: null }))
    try {
      setStartupSettings(await window.flowDock.setStartupEnabled(enabled))
    } catch (error) {
      setStartupSettings((current) => ({
        ...current,
        error: error instanceof Error ? error.message : t('startupError')
      }))
    } finally {
      setStartupLoading(false)
    }
  }, [startupLoading, t])

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

  const activate = useCallback(async (hwnd: string, moveToPrimary = false) => {
    setActivationError(null)
    try {
      const activated = await window.flowDock.activateWindow(hwnd, moveToPrimary)
      if (!activated) setActivationError(t('activationBlocked'))
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : t('windowActivationFailed'))
    }
  }, [t])

  const closeWindow = useCallback(async (hwnd: string) => {
    setActivationError(null)
    try {
      const closeRequested = await window.flowDock.closeWindow(hwnd)
      if (!closeRequested) setActivationError(t('windowCloseFailed'))
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : t('windowCloseFailed'))
    }
  }, [t])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (page !== 'windows') {
          setPage('windows')
          return
        }
        void window.flowDock.hide()
        return
      }
      if (page !== 'windows') return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return
      if (visibleWindows.length === 0) return
      event.preventDefault()
      if (event.key === 'Enter') {
        if (selectedHwnd) void activate(selectedHwnd, event.shiftKey)
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
  }, [activate, page, selectedHwnd, visibleWindows])

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
      void window.flowDock.setWidth(pendingWidth, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <main className={`flowdock-shell relative flex h-screen min-w-0 overflow-hidden border border-r-0 border-white/10 bg-[rgb(var(--panel-bg)/var(--panel-opacity))] text-slate-100 shadow-dock ${appearance.glass ? 'backdrop-blur-xl' : ''}`}>
      <button
        type="button"
        aria-label={t('resize')}
        className="group absolute inset-y-0 left-0 z-20 flex w-2 cursor-ew-resize items-center justify-center outline-none"
        onPointerDown={startResize}
      >
        <span className="h-12 w-0.5 rounded-full bg-white/10 transition-colors group-hover:bg-[rgb(var(--accent)/0.6)]" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col pl-2">
        <header className={`border-b border-white/[0.07] px-3 pt-3.5 ${page === 'windows' ? 'pb-3' : 'pb-3.5'}`}>
          <div className="mb-3 flex items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 items-center gap-2.5">
              {page !== 'windows' && (
                <button
                  type="button"
                  aria-label={t('back')}
                  onClick={() => setPage('windows')}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-slate-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--accent))]"
                >
                  <ArrowLeft className={`size-4 ${language === 'fa' ? 'rotate-180' : ''}`} />
                </button>
              )}
              <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[rgb(var(--accent))] to-[rgb(var(--accent-2))] shadow-lg">
                {page === 'windows' && <Layers3 className="size-4 text-slate-950" strokeWidth={2.5} />}
                {page === 'pomodoro' && <Timer className="size-4 text-slate-950" strokeWidth={2.5} />}
                {page === 'settings' && <Settings className="size-4 text-slate-950" strokeWidth={2.5} />}
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-[13px] font-semibold tracking-wide text-white">
                  {page === 'windows' ? t('flowdock') : page === 'pomodoro' ? t('focus') : t('settings')}
                </h1>
                <p className="text-[10px] text-slate-300">
                  {page === 'windows'
                    ? t('openWindows', { count: snapshot.windows.length })
                    : page === 'pomodoro' ? t('pomodoroTasks') : t('preferences')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              {page === 'windows' && (
                <>
                  <button
                    type="button"
                    aria-label={t('openPomodoro')}
                    title={t('pomodoroTasks')}
                    onClick={() => setPage('pomodoro')}
                    className="grid size-7 place-items-center rounded-md text-slate-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--accent))]"
                  >
                    <Timer className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('openSettings')}
                    title={t('settings')}
                    onClick={() => setPage('settings')}
                    className="grid size-7 place-items-center rounded-md text-slate-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--accent))]"
                  >
                    <Settings className="size-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={t('hide')}
                onClick={() => void window.flowDock.hide()}
                className="grid size-7 place-items-center rounded-md text-slate-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--accent))]"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {page === 'windows' && <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 transition focus-within:border-[rgb(var(--accent)/0.5)] focus-within:bg-white/[0.055]">
            <Search className="size-3.5 shrink-0 text-slate-300" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('search')}
              className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-slate-400"
              autoFocus
            />
            <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-300">ESC</kbd>
          </label>}
        </header>

        {page === 'windows' && (snapshot.error || activationError) && (
          <div className="mx-3 mt-3 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] p-2.5 text-[11px] leading-relaxed text-amber-100">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
            <span>{activationError ?? snapshot.error}</span>
          </div>
        )}

        {page === 'windows' && pomodoroSummary?.active && (
          <button
            type="button"
            onClick={() => setPage('pomodoro')}
            className="group relative mx-3 mt-2.5 flex min-h-11 shrink-0 items-center gap-2.5 overflow-hidden rounded-lg border border-[rgb(var(--accent)/0.2)] bg-[rgb(var(--accent)/0.055)] px-2.5 text-left transition hover:border-[rgb(var(--accent)/0.35)] hover:bg-[rgb(var(--accent)/0.08)]"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent))]">
              <Timer className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-white">
                <span className={`size-1.5 rounded-full ${pomodoroSummary.running ? 'animate-pulse bg-[rgb(var(--accent))]' : 'bg-amber-300'}`} />
                {pomodoroSummary.mode === 'focus' ? t('focusSession') : pomodoroSummary.mode === 'shortBreak' ? t('shortBreak') : t('longBreak')}
              </span>
              <span className="mt-0.5 block truncate text-[9px] text-slate-300">
                {pomodoroSummary.activeTaskTitle ?? (pomodoroSummary.running ? t('sessionProgress') : t('paused'))}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-[rgb(var(--accent))]">
              {formatCompactTime(pomodoroSummary.remainingSeconds)}
            </span>
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-px origin-left bg-[rgb(var(--accent)/0.7)] transition-transform duration-500"
              style={{ transform: `scaleX(${Math.max(0, Math.min(1, pomodoroSummary.remainingSeconds / pomodoroSummary.totalSeconds))})` }}
            />
          </button>
        )}

        {page === 'windows' ? <section className="scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2" aria-label={t('windowList')}>
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key)
            return (
              <div key={group.key} className="mb-1.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-start text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-300 transition hover:bg-white/[0.035] hover:text-white"
                >
                  {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="font-mono text-[9px] text-slate-400">{group.windows.length}</span>
                </button>

                {!isCollapsed && group.windows.map((desktopWindow) => {
                  const isActive = desktopWindow.hwnd === snapshot.activeHwnd
                  const isSelected = desktopWindow.hwnd === selectedHwnd
                  return (
                    <div
                      key={desktopWindow.hwnd}
                      title={desktopWindow.title}
                      onMouseEnter={() => setSelectedHwnd(desktopWindow.hwnd)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setSelectedHwnd(desktopWindow.hwnd)
                        void window.flowDock.showWindowMenu(desktopWindow.hwnd)
                      }}
                      className={`group/window relative mb-0.5 flex min-h-11 w-full items-center rounded-lg border text-start transition-all duration-150 ${
                        isSelected
                          ? 'border-white/10 bg-white/[0.075] text-white'
                          : 'border-transparent text-slate-200 hover:bg-white/[0.04] hover:text-white'
                      }`}
                    >
                      {isActive && <span className="absolute inset-y-2 start-0 w-0.5 rounded-e bg-[rgb(var(--accent))] shadow-[0_0_8px_rgb(var(--accent)/0.8)]" />}
                      <button
                        type="button"
                        title={`${desktopWindow.title}\n${t('movePrimaryHint')}`}
                        onClick={(event) => void activate(desktopWindow.hwnd, event.shiftKey)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 ps-2.5 text-start focus:outline-none"
                      >
                        <WindowIcon window={desktopWindow} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium leading-4">{desktopWindow.title}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px] leading-3 text-slate-400">
                            <span className="min-w-0 flex-1 truncate">
                              {desktopWindow.minimized ? `${t('minimized')} · ` : ''}{desktopWindow.processName}
                            </span>
                            <span
                              title={desktopWindow.primaryMonitor ? t('primaryMonitor') : desktopWindow.monitorDevice}
                              className={`shrink-0 rounded px-1 py-px font-mono text-[8px] ${
                                desktopWindow.primaryMonitor
                                  ? 'bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent))]'
                                  : 'bg-white/[0.05] text-slate-300'
                              }`}
                            >
                              {displayMonitorName(desktopWindow.monitorDevice)}{desktopWindow.primaryMonitor ? '·P' : ''}
                            </span>
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={t('close', { name: desktopWindow.title })}
                        title={t('close', { name: desktopWindow.title })}
                        onClick={() => void closeWindow(desktopWindow.hwnd)}
                        className="me-1 grid size-7 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-red-400/10 hover:text-red-300 focus-visible:text-red-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-red-400/60 group-hover/window:text-slate-300"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {groups.length === 0 && !snapshot.error && (
            <div className="grid place-items-center px-5 py-16 text-center">
              <AppWindow className="mb-3 size-7 text-slate-400" />
              <p className="text-xs font-medium text-white">{query ? t('noMatches') : t('noWindows')}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-300">{query ? t('tryDifferent') : t('windowsAppear')}</p>
            </div>
          )}
        </section> : page === 'settings' ? (
          <section className="scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Settings">
            <div className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-300">
              {t('appearance')}
            </div>
            <div className="mb-4 rounded-xl border border-white/[0.08] bg-[rgb(var(--surface-bg)/0.42)] p-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-white">
                <Palette className="size-3.5 text-[rgb(var(--accent))]" /> {t('theme')}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {themePresets.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setAppearance((current) => ({ ...current, theme: theme.id }))}
                    className={`flex h-9 items-center gap-2 rounded-lg border px-2 text-start text-[9px] transition ${theme.id === 'light' ? 'col-span-2' : ''} ${
                      appearance.theme === theme.id
                        ? 'border-[rgb(var(--accent)/0.45)] bg-[rgb(var(--accent)/0.08)] text-white'
                        : 'border-white/[0.07] text-slate-300 hover:border-white/15 hover:bg-white/[0.035]'
                    }`}
                  >
                    <span className="size-3.5 rounded-full border border-white/15" style={{ backgroundColor: `rgb(${theme.panel.replaceAll(' ', ',')})` }} />
                    <span className="truncate">{theme.label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-3 text-[9px] text-slate-300">{t('accentColor')}</div>
              <div className="mt-2 flex items-center justify-between px-0.5">
                {accentPresets.map((accent) => (
                  <button
                    key={accent.id}
                    type="button"
                    title={accent.label}
                    aria-label={`${accent.label} accent`}
                    onClick={() => setAppearance((current) => ({ ...current, accent: accent.id }))}
                    className={`grid size-7 place-items-center rounded-full border transition ${appearance.accent === accent.id ? 'border-white/70 bg-white/10' : 'border-transparent hover:bg-white/[0.06]'}`}
                  >
                    <span className="size-3.5 rounded-full shadow-sm" style={{ backgroundColor: accent.hex }} />
                  </button>
                ))}
              </div>

              <label className="mt-3 flex items-center gap-2">
                <Type className="size-3.5 shrink-0 text-slate-400" />
                <span className="text-[9px] text-slate-300">{t('font')}</span>
                <select
                  value={appearance.font}
                  onChange={(event) => setAppearance((current) => ({ ...current, font: event.target.value as AppearanceSettings['font'] }))}
                  className="ms-auto h-7 min-w-28 rounded-md border border-white/[0.08] bg-[rgb(var(--surface-bg))] px-2 text-[9px] text-white outline-none focus:border-[rgb(var(--accent)/0.5)]"
                >
                  {fontPresets.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
                </select>
              </label>

              <label className="mt-3 block">
                <span className="flex items-center justify-between text-[9px] text-slate-300">
                  <span>{t('fontSize')}</span>
                  <span className="font-mono text-[9px] text-[rgb(var(--accent))]">{appearance.fontSize}%</span>
                </span>
                <input
                  type="range"
                  min="85"
                  max="120"
                  step="5"
                  value={appearance.fontSize}
                  onChange={(event) => setAppearance((current) => ({ ...current, fontSize: Number(event.target.value) }))}
                  className="mt-2 h-1.5 w-full cursor-pointer accent-[rgb(var(--accent))]"
                />
                <span className="mt-1 flex justify-between text-[8px] text-slate-500"><span>85%</span><span>120%</span></span>
              </label>

              <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-2">
                {([
                  ['glass', t('glassEffect'), Palette],
                  ['motion', t('animations'), Sparkles]
                ] as const).map(([key, label, Icon]) => (
                  <div key={key} className="flex h-8 items-center gap-2">
                    <Icon className="size-3.5 text-slate-400" />
                    <span className="min-w-0 flex-1 text-[10px] text-slate-200">{label}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={appearance[key]}
                      onClick={() => setAppearance((current) => ({ ...current, [key]: !current[key] }))}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${appearance[key] ? 'bg-[rgb(var(--accent))]' : 'bg-white/10'}`}
                    >
                      <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${appearance[key] ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2 border-t border-white/[0.06] pt-2.5">
                <Languages className="size-3.5 text-slate-400" />
                <span className="min-w-0 flex-1 text-[10px] text-slate-200">{t('language')}</span>
                <div className="flex rounded-md border border-white/[0.08] bg-black/15 p-0.5">
                  {(['en', 'fa'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setLanguage(item)
                        if (item === 'fa') {
                          setAppearance((current) => ({ ...current, font: 'vazir' }))
                        }
                      }}
                      className={`h-6 rounded px-2 text-[9px] transition ${language === item ? 'bg-[rgb(var(--accent))] font-medium text-slate-950' : 'text-slate-300 hover:text-white'}`}
                    >
                      {item === 'en' ? t('english') : t('persian')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {preferencesResult && (
              <>
                <div className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-300">
                  {t('shortcuts')}
                </div>
                <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
                  <div className="mb-2 flex items-center gap-2 text-[10px] text-slate-300">
                    <Keyboard className="size-3.5 text-[rgb(var(--accent))]" />
                    <span>{t('shortcutHint')}</span>
                  </div>
                  <div className="space-y-1.5">
                    {([
                      ['toggleDock', t('shortcutDock')],
                      ['togglePomodoro', t('shortcutPomodoro')],
                      ['nextWindow', t('shortcutNextWindow')],
                      ['moveWindow', t('shortcutMoveWindow')]
                    ] as Array<[keyof FlowDockPreferences['shortcuts'], string]>).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 text-[9px] text-slate-300">{label}</span>
                        <input
                          readOnly
                          value={preferencesResult.preferences.shortcuts[key]}
                          placeholder={t('shortcutDisabled')}
                          onKeyDown={(event) => {
                            event.preventDefault()
                            const accelerator = acceleratorFromEvent(event)
                            if (accelerator === null) return
                            void updatePreferences({
                              ...preferencesResult.preferences,
                              shortcuts: { ...preferencesResult.preferences.shortcuts, [key]: accelerator }
                            })
                          }}
                          className="h-7 w-32 rounded-md border border-white/[0.08] bg-black/20 px-2 text-center font-mono text-[9px] text-white outline-none focus:border-[rgb(var(--accent)/0.5)]"
                        />
                      </label>
                    ))}
                  </div>
                  {preferencesResult.error && (
                    <div className="mt-2 flex gap-1.5 border-t border-white/[0.06] pt-2 text-[9px] leading-4 text-amber-200">
                      <CircleAlert className="mt-0.5 size-3 shrink-0" />
                      <span>{preferencesResult.error}</span>
                    </div>
                  )}
                </div>

                <div className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-300">
                  {t('monitors')}
                </div>
                <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
                  <div className="flex items-center gap-2">
                    <MonitorUp className="size-4 shrink-0 text-[rgb(var(--accent))]" />
                    <label className="min-w-0 flex-1 text-[9px] text-slate-300">
                      <span className="mb-1 block">{t('dockMonitor')}</span>
                      <select
                        value={preferencesResult.preferences.dockDisplayMode}
                        onChange={(event) => void updatePreferences({
                          ...preferencesResult.preferences,
                          dockDisplayMode: event.target.value as FlowDockPreferences['dockDisplayMode'],
                          fixedDisplayId: event.target.value === 'fixed'
                            ? preferencesResult.preferences.fixedDisplayId ?? displays.find((display) => display.primary)?.id ?? displays[0]?.id ?? null
                            : preferencesResult.preferences.fixedDisplayId
                        })}
                        className="h-7 w-full rounded-md border border-white/[0.08] bg-[rgb(var(--surface-bg))] px-2 text-[9px] text-white outline-none focus:border-[rgb(var(--accent)/0.5)]"
                      >
                        <option value="cursor">{t('followCursor')}</option>
                        <option value="primary">{t('primaryMonitor')}</option>
                        <option value="fixed">{t('fixedMonitor')}</option>
                      </select>
                    </label>
                  </div>
                  {preferencesResult.preferences.dockDisplayMode === 'fixed' && (
                    <label className="mt-2 block text-[9px] text-slate-300">
                      <span className="mb-1 block">{t('chooseMonitor')}</span>
                      <select
                        value={preferencesResult.preferences.fixedDisplayId ?? ''}
                        onChange={(event) => void updatePreferences({
                          ...preferencesResult.preferences,
                          fixedDisplayId: Number(event.target.value)
                        })}
                        className="h-7 w-full rounded-md border border-white/[0.08] bg-[rgb(var(--surface-bg))] px-2 text-[9px] text-white outline-none focus:border-[rgb(var(--accent)/0.5)]"
                      >
                        {displays.map((display, index) => (
                          <option key={display.id} value={display.id}>{t('monitorNumber', { count: index + 1 })}{display.primary ? ` · ${t('primaryLabel')}` : ''}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="mt-2 block border-t border-white/[0.06] pt-2 text-[9px] text-slate-300">
                    <span className="mb-1 block">{t('moveTarget')}</span>
                    <select
                      value={preferencesResult.preferences.targetDisplayId ?? ''}
                      onChange={(event) => void updatePreferences({
                        ...preferencesResult.preferences,
                        targetDisplayId: event.target.value ? Number(event.target.value) : null
                      })}
                      className="h-7 w-full rounded-md border border-white/[0.08] bg-[rgb(var(--surface-bg))] px-2 text-[9px] text-white outline-none focus:border-[rgb(var(--accent)/0.5)]"
                    >
                      <option value="">{t('nextMonitor')}</option>
                      {displays.map((display, index) => (
                        <option key={display.id} value={display.id}>{t('monitorNumber', { count: index + 1 })}{display.primary ? ` · ${t('primaryLabel')}` : ''}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}

            <div className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-300">
              {t('windows')}
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="flex items-center gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[rgb(var(--accent)/0.08)] text-[rgb(var(--accent))]">
                  <Power className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-white">{t('startup')}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-slate-300">
                    {t('startupHelp')}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={startupSettings.enabled}
                  aria-label="Run FlowDock at Windows startup"
                  disabled={startupLoading || !startupSettings.supported}
                  onClick={() => void updateStartup(!startupSettings.enabled)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--accent))] disabled:cursor-not-allowed disabled:opacity-40 ${
                    startupSettings.enabled ? 'bg-[rgb(var(--accent))]' : 'bg-white/10'
                  }`}
                >
                  <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${
                    startupSettings.enabled ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>
              {startupSettings.error && (
                <div className="mt-3 flex gap-2 border-t border-white/[0.06] pt-2.5 text-[10px] leading-4 text-amber-200">
                  <CircleAlert className="mt-0.5 size-3 shrink-0" />
                  <span>{startupSettings.error}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => void window.flowDock.quit()}
                className="mt-3 flex h-8 w-full items-center justify-center gap-2 border-t border-white/[0.06] pt-2 text-[10px] text-red-300 transition hover:text-red-200"
              >
                <LogOut className="size-3.5" /> {t('quitFlowDock')}
              </button>
            </div>
            <p className="px-1 pt-2 text-[9px] leading-4 text-slate-400">
              {t('startupStored')}
            </p>
          </section>
        ) : null}

        <PomodoroPage visible={page === 'pomodoro'} onSummaryChange={setPomodoroSummary} />

        <footer className="flex h-8 shrink-0 items-center justify-between border-t border-white/[0.06] px-3 text-[9px] text-slate-400">
          {page === 'windows' ? (
            <>
              <span><kbd>↑</kbd> <kbd>↓</kbd> {t('navigate')}</span>
              <span><kbd>⇧</kbd> {t('primary')}</span>
            </>
          ) : page === 'pomodoro' ? (
            <><span><kbd>ESC</kbd> {t('windows')}</span><span>{t('stayFocused')}</span></>
          ) : (
            <><span><kbd>ESC</kbd> {t('back')}</span><span>FlowDock v1.3.0</span></>
          )}
        </footer>
      </div>
    </main>
  )
}
