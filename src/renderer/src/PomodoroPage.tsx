import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Check,
  Circle,
  ListTodo,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  SkipForward,
  Target,
  Trash2
} from 'lucide-react'
import { useI18n } from './i18n'

type PomodoroMode = 'focus' | 'shortBreak' | 'longBreak'

interface PomodoroTask {
  id: string
  title: string
  completed: boolean
  pomodoros: number
}

interface TimerState {
  mode: PomodoroMode
  remainingSeconds: number
  running: boolean
  endsAt: number | null
}

interface PomodoroSettings {
  focus: number
  shortBreak: number
  longBreak: number
  longBreakEvery: number
}

interface DailyPomodoroStats {
  focusSessions: number
  focusMinutes: number
}

interface PomodoroStats {
  dailyGoal: number
  history: Record<string, DailyPomodoroStats>
}

export interface PomodoroSummary {
  active: boolean
  running: boolean
  mode: PomodoroMode
  remainingSeconds: number
  totalSeconds: number
  activeTaskTitle: string | null
}

interface StoredPomodoroState {
  timer: TimerState
  settings: PomodoroSettings
  tasks: PomodoroTask[]
  activeTaskId: string | null
  stats: PomodoroStats
}

const STORAGE_KEY = 'flowdock:pomodoro:v1'
const defaultSettings: PomodoroSettings = { focus: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 }

function todayKey(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function durationSeconds(mode: PomodoroMode, settings: PomodoroSettings): number {
  return settings[mode] * 60
}

function initialState(): StoredPomodoroState {
  const fallback: StoredPomodoroState = {
    timer: { mode: 'focus', remainingSeconds: defaultSettings.focus * 60, running: false, endsAt: null },
    settings: defaultSettings,
    tasks: [],
    activeTaskId: null,
    stats: { dailyGoal: 8, history: {} }
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<StoredPomodoroState>
    const settings = { ...defaultSettings, ...parsed.settings }
    const timer = { ...fallback.timer, ...parsed.timer }
    if (timer.running && timer.endsAt) {
      timer.remainingSeconds = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000))
    }
    const legacyStats = parsed.stats as unknown as { date?: string; focusSessions?: number; dailyGoal?: number; history?: Record<string, DailyPomodoroStats> } | undefined
    const history = legacyStats?.history && typeof legacyStats.history === 'object'
      ? legacyStats.history
      : legacyStats?.date
        ? { [legacyStats.date]: { focusSessions: Number(legacyStats.focusSessions) || 0, focusMinutes: 0 } }
        : {}
    return {
      timer,
      settings,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      activeTaskId: typeof parsed.activeTaskId === 'string' ? parsed.activeTaskId : null,
      stats: {
        dailyGoal: Math.max(1, Math.min(24, Number(legacyStats?.dailyGoal) || 8)),
        history
      }
    }
  } catch {
    return fallback
  }
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = Math.max(0, totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

const modeKeys: Record<PomodoroMode, string> = {
  focus: 'focusSession',
  shortBreak: 'short',
  longBreak: 'long'
}

export function PomodoroPage({
  visible,
  onSummaryChange
}: {
  visible: boolean
  onSummaryChange: (summary: PomodoroSummary) => void
}): React.JSX.Element {
  const { language, t } = useI18n()
  const loaded = useRef<StoredPomodoroState | null>(null)
  if (!loaded.current) loaded.current = initialState()
  const [timer, setTimer] = useState(loaded.current.timer)
  const [settings, setSettings] = useState(loaded.current.settings)
  const [tasks, setTasks] = useState(loaded.current.tasks)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(loaded.current.activeTaskId)
  const [stats, setStats] = useState(loaded.current.stats)
  const [newTask, setNewTask] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const finishingRef = useRef(false)

  const activeTask = tasks.find((task) => task.id === activeTaskId && !task.completed) ?? null
  const modeDuration = durationSeconds(timer.mode, settings)
  const progress = Math.max(0, Math.min(1, timer.remainingSeconds / modeDuration))
  const circumference = 2 * Math.PI * 54
  const pomodoroActive = timer.running || timer.remainingSeconds < modeDuration
  const todayStats = stats.history[todayKey()] ?? { focusSessions: 0, focusMinutes: 0 }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timer, settings, tasks, activeTaskId, stats }))
  }, [activeTaskId, settings, stats, tasks, timer])

  useEffect(() => {
    onSummaryChange({
      active: pomodoroActive,
      running: timer.running,
      mode: timer.mode,
      remainingSeconds: timer.remainingSeconds,
      totalSeconds: modeDuration,
      activeTaskTitle: activeTask?.title ?? null
    })
  }, [activeTask?.title, modeDuration, onSummaryChange, pomodoroActive, timer.mode, timer.remainingSeconds, timer.running])

  useEffect(() => {
    void window.flowDock.updatePomodoroStatus({
      active: pomodoroActive,
      running: timer.running,
      remainingSeconds: timer.remainingSeconds,
      taskTitle: activeTask?.title ?? null
    })
  }, [activeTask?.title, pomodoroActive, timer.running])

  useEffect(() => {
    document.title = timer.running ? `${formatTime(timer.remainingSeconds)} · FlowDock` : 'FlowDock'
    return () => { document.title = 'FlowDock' }
  }, [timer.remainingSeconds, timer.running])

  const finishSession = useCallback((): void => {
    if (!timer.running || finishingRef.current) return
    finishingRef.current = true
    const completedFocus = timer.mode === 'focus'
    const currentDate = todayKey()
    const currentStats = stats.history[currentDate] ?? { focusSessions: 0, focusMinutes: 0 }
    const nextFocusCount = completedFocus ? currentStats.focusSessions + 1 : currentStats.focusSessions
    const nextMode: PomodoroMode = completedFocus
      ? (nextFocusCount % settings.longBreakEvery === 0 ? 'longBreak' : 'shortBreak')
      : 'focus'

    if (completedFocus) {
      setStats((current) => ({
        ...current,
        history: {
          ...current.history,
          [currentDate]: {
            focusSessions: nextFocusCount,
            focusMinutes: currentStats.focusMinutes + settings.focus
          }
        }
      }))
      if (activeTask) {
        setTasks((current) => current.map((task) =>
          task.id === activeTask.id ? { ...task, pomodoros: task.pomodoros + 1 } : task
        ))
      }
    }
    setTimer({ mode: nextMode, remainingSeconds: durationSeconds(nextMode, settings), running: false, endsAt: null })
    void window.flowDock.showNotification(
      completedFocus ? t('focusComplete') : t('breakComplete'),
      completedFocus
        ? t('timeForBreak', {
            task: activeTask?.title ?? t('greatWork'),
            kind: nextMode === 'longBreak' ? t('longKind') : t('shortKind')
          })
        : t('readyFocus')
    )
  }, [activeTask, settings, stats.history, t, timer.mode, timer.running])

  useEffect(() => {
    if (!timer.running || !timer.endsAt) {
      finishingRef.current = false
      return
    }
    const tick = (): void => {
      const remainingSeconds = Math.max(0, Math.ceil((timer.endsAt! - Date.now()) / 1000))
      setTimer((current) => current.remainingSeconds === remainingSeconds
        ? current
        : { ...current, remainingSeconds })
      if (remainingSeconds === 0) finishSession()
    }
    tick()
    const interval = window.setInterval(tick, 500)
    return () => window.clearInterval(interval)
  }, [finishSession, timer.endsAt, timer.running])

  const chooseMode = (mode: PomodoroMode): void => {
    setTimer({ mode, remainingSeconds: durationSeconds(mode, settings), running: false, endsAt: null })
  }

  const toggleTimer = (): void => {
    if (timer.running) {
      const remainingSeconds = timer.endsAt
        ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000))
        : timer.remainingSeconds
      setTimer({ ...timer, remainingSeconds, running: false, endsAt: null })
      return
    }
    const remainingSeconds = timer.remainingSeconds || modeDuration
    setTimer({ ...timer, remainingSeconds, running: true, endsAt: Date.now() + remainingSeconds * 1000 })
  }

  const resetTimer = (): void => {
    setTimer({ ...timer, remainingSeconds: modeDuration, running: false, endsAt: null })
  }

  const skipTimer = (): void => {
    const nextMode: PomodoroMode = timer.mode === 'focus' ? 'shortBreak' : 'focus'
    setTimer({ mode: nextMode, remainingSeconds: durationSeconds(nextMode, settings), running: false, endsAt: null })
  }

  const addTask = (): void => {
    const title = newTask.trim()
    if (!title) return
    const task: PomodoroTask = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      title,
      completed: false,
      pomodoros: 0
    }
    setTasks((current) => [...current, task])
    setActiveTaskId(task.id)
    setNewTask('')
  }

  const updateDuration = (key: keyof PomodoroSettings, value: number): void => {
    const limits = key === 'longBreakEvery' ? [2, 10] : [1, 120]
    const safeValue = Math.max(limits[0], Math.min(limits[1], Math.round(value || limits[0])))
    setSettings((current) => ({ ...current, [key]: safeValue }))
    if (!timer.running && key === timer.mode) {
      setTimer((current) => ({ ...current, remainingSeconds: safeValue * 60 }))
    }
  }

  useEffect(() => window.flowDock.onPomodoroCommand((command) => {
    setTimer((current) => {
      if (command === 'pause') {
        if (!current.running) return current
        const remainingSeconds = current.endsAt
          ? Math.max(0, Math.ceil((current.endsAt - Date.now()) / 1000))
          : current.remainingSeconds
        return { ...current, remainingSeconds, running: false, endsAt: null }
      }
      if (command === 'start-focus') {
        const remainingSeconds = settings.focus * 60
        return { mode: 'focus', remainingSeconds, running: true, endsAt: Date.now() + remainingSeconds * 1000 }
      }
      if (current.running) {
        const remainingSeconds = current.endsAt
          ? Math.max(0, Math.ceil((current.endsAt - Date.now()) / 1000))
          : current.remainingSeconds
        return { ...current, remainingSeconds, running: false, endsAt: null }
      }
      const remainingSeconds = current.remainingSeconds || durationSeconds(current.mode, settings)
      return { ...current, remainingSeconds, running: true, endsAt: Date.now() + remainingSeconds * 1000 }
    })
  }), [settings])

  const pendingTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - index))
    const key = todayKey(date)
    return {
      key,
      label: new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', { weekday: 'narrow' }).format(date),
      stats: stats.history[key] ?? { focusSessions: 0, focusMinutes: 0 }
    }
  }), [language, stats.history])
  const weekSessions = weekDays.reduce((total, day) => total + day.stats.focusSessions, 0)
  const weekMinutes = weekDays.reduce((total, day) => total + day.stats.focusMinutes, 0)

  return (
    <section className={`scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3 ${visible ? '' : 'hidden'}`} aria-label={t('pomodoroTimer')}>
      <div className="flex rounded-lg border border-white/[0.07] bg-white/[0.025] p-1">
        {(Object.keys(modeKeys) as PomodoroMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => chooseMode(mode)}
            className={`h-7 min-w-0 flex-1 rounded-md text-[10px] font-medium transition ${
              timer.mode === mode ? 'bg-[rgb(var(--accent))] text-slate-950 shadow-sm' : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'
            }`}
          >
            {t(modeKeys[mode])}
          </button>
        ))}
      </div>

      <div className="relative mx-auto mt-4 grid size-36 place-items-center">
        <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="54" fill="none" stroke="rgb(var(--ring-track))" strokeWidth="5" />
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke={timer.mode === 'focus' ? 'rgb(var(--accent))' : 'rgb(var(--accent-2))'}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="text-center">
          <div className="font-mono text-[30px] font-semibold tracking-[-0.05em] text-white">{formatTime(timer.remainingSeconds)}</div>
          <div className="mt-0.5 max-w-24 truncate text-[9px] uppercase tracking-[0.14em] text-slate-300">
            {activeTask?.title ?? t(modeKeys[timer.mode])}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <button type="button" title={t('resetTimer')} onClick={resetTimer} className="grid size-8 place-items-center rounded-lg text-slate-300 transition hover:bg-white/[0.06] hover:text-white">
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={toggleTimer}
          className="flex h-9 min-w-24 items-center justify-center gap-2 rounded-lg bg-[rgb(var(--accent))] px-4 text-[11px] font-semibold text-slate-950 shadow-lg transition hover:brightness-110 active:scale-[0.98]"
        >
          {timer.running ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4" fill="currentColor" />}
          {timer.running ? t('pause') : t('start')}
        </button>
        <button type="button" title={t('skipSession')} onClick={skipTimer} className="grid size-8 place-items-center rounded-lg text-slate-300 transition hover:bg-white/[0.06] hover:text-white">
          <SkipForward className="size-3.5" />
        </button>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div>
          <h2 className="text-[11px] font-semibold text-white">{t('todaysTasks')}</h2>
          <p className="mt-0.5 text-[9px] text-slate-400">{t('focusSessions', { count: todayStats.focusSessions })} · {t('remaining', { count: pendingTasks.length })}</p>
        </div>
        <div className="flex gap-0.5">
          <button
            type="button"
            title={t('focusStats')}
            onClick={() => setShowStats((current) => !current)}
            className={`grid size-7 place-items-center rounded-md transition ${showStats ? 'bg-white/[0.08] text-[rgb(var(--accent))]' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}
          >
            <BarChart3 className="size-3.5" />
          </button>
          <button
            type="button"
            title={t('timerSettings')}
            onClick={() => setShowSettings((current) => !current)}
            className={`grid size-7 place-items-center rounded-md transition ${showSettings ? 'bg-white/[0.08] text-[rgb(var(--accent))]' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}
          >
            <Settings2 className="size-3.5" />
          </button>
        </div>
      </div>

      {showStats && (
        <div className="mt-2 rounded-lg border border-white/[0.07] bg-white/[0.025] p-2.5">
          <div className="flex items-center gap-2">
            <Target className="size-3.5 text-[rgb(var(--accent))]" />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between text-[9px] text-slate-300">
                <span>{t('todayProgress')}</span>
                <span>{todayStats.focusSessions}/{stats.dailyGoal}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full origin-left rounded-full bg-[rgb(var(--accent))] transition-transform"
                  style={{ transform: `scaleX(${Math.min(1, todayStats.focusSessions / stats.dailyGoal)})` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex h-14 items-end justify-between gap-1.5 border-b border-white/[0.07] pb-1">
            {weekDays.map((day) => (
              <div key={day.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <div
                  title={t('daySessions', { count: day.stats.focusSessions })}
                  className="w-full max-w-4 rounded-t bg-[rgb(var(--accent)/0.65)]"
                  style={{ height: `${Math.max(3, Math.min(100, day.stats.focusSessions / stats.dailyGoal * 100))}%` }}
                />
                <span className="text-[8px] text-slate-400">{day.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[9px] text-slate-400">
            <span>{t('weekSessions', { count: weekSessions })}</span>
            <span>{t('focusMinutes', { count: weekMinutes })}</span>
          </div>
          <label className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[9px] text-slate-300">
            <span>{t('dailyGoal')}</span>
            <input
              type="number"
              min="1"
              max="24"
              value={stats.dailyGoal}
              onChange={(event) => setStats((current) => ({
                ...current,
                dailyGoal: Math.max(1, Math.min(24, Number(event.target.value) || 1))
              }))}
              className="h-7 w-14 rounded-md border border-white/[0.08] bg-black/20 px-2 text-center text-[10px] text-white outline-none focus:border-[rgb(var(--accent)/0.5)]"
            />
          </label>
        </div>
      )}

      {showSettings && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] p-2.5">
          {([
            ['focus', t('focusMin')],
            ['shortBreak', t('shortMin')],
            ['longBreak', t('longMin')],
            ['longBreakEvery', t('longEvery')]
          ] as Array<[keyof PomodoroSettings, string]>).map(([key, label]) => (
            <label key={key} className="text-[9px] text-slate-300">
              <span className="mb-1 block">{label}</span>
              <input
                type="number"
                min={key === 'longBreakEvery' ? 2 : 1}
                max={key === 'longBreakEvery' ? 10 : 120}
                value={settings[key]}
                onChange={(event) => updateDuration(key, Number(event.target.value))}
                className="h-7 w-full rounded-md border border-white/[0.08] bg-black/20 px-2 text-[10px] text-white outline-none focus:border-[rgb(var(--accent)/0.5)]"
              />
            </label>
          ))}
        </div>
      )}

      <form
        className="mt-2 flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.025] px-2 focus-within:border-[rgb(var(--accent)/0.4)]"
        onSubmit={(event) => { event.preventDefault(); addTask() }}
      >
        <Plus className="size-3.5 shrink-0 text-slate-400" />
        <input
          value={newTask}
          onChange={(event) => setNewTask(event.target.value)}
          placeholder={t('addTask')}
          maxLength={120}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-slate-500"
        />
        <button type="submit" className="rounded px-1.5 py-1 text-[9px] font-medium text-[rgb(var(--accent))] transition hover:bg-[rgb(var(--accent)/0.1)]">{t('add')}</button>
      </form>

      <div className="mt-2 space-y-1">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`group flex min-h-10 items-center gap-2 rounded-lg border px-2 transition ${
              activeTaskId === task.id && !task.completed
                ? 'border-[rgb(var(--accent)/0.25)] bg-[rgb(var(--accent)/0.06)]'
                : 'border-transparent hover:bg-white/[0.035]'
            } ${task.completed ? 'opacity-55' : ''}`}
          >
            <button
              type="button"
              aria-label={t(task.completed ? 'reopenTask' : 'completeTask', { name: task.title })}
              onClick={() => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed: !item.completed } : item))}
              className="shrink-0 text-slate-400 hover:text-[rgb(var(--accent))]"
            >
              {task.completed ? <Check className="size-4 text-[rgb(var(--accent))]" /> : <Circle className="size-4" />}
            </button>
            <button
              type="button"
              disabled={task.completed}
              onClick={() => setActiveTaskId(task.id)}
              className="min-w-0 flex-1 py-1 text-start disabled:cursor-default"
            >
              <span className={`block truncate text-[11px] text-white ${task.completed ? 'line-through' : ''}`}>{task.title}</span>
              <span className="mt-0.5 block text-[9px] text-slate-400">{t('sessions', { count: task.pomodoros })}{activeTaskId === task.id && !task.completed ? ` · ${t('active')}` : ''}</span>
            </button>
            <button
              type="button"
              title={t('deleteTask')}
              onClick={() => {
                setTasks((current) => current.filter((item) => item.id !== task.id))
                if (activeTaskId === task.id) setActiveTaskId(null)
              }}
              className="grid size-6 shrink-0 place-items-center rounded text-slate-500 opacity-0 transition hover:bg-red-400/10 hover:text-red-300 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="grid place-items-center py-7 text-center text-slate-400">
            <ListTodo className="mb-2 size-5" />
            <p className="text-[10px] text-slate-300">{t('taskEmpty')}</p>
          </div>
        )}
      </div>
    </section>
  )
}
