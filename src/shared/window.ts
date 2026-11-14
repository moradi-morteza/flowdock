export interface DesktopWindow {
  hwnd: string
  title: string
  processId: number
  processName: string
  executablePath: string
  iconDataUrl: string | null
  minimized: boolean
  monitorDevice: string
  primaryMonitor: boolean
}

export interface WindowSnapshot {
  windows: DesktopWindow[]
  activeHwnd: string | null
  error: string | null
}

export interface StartupSettings {
  enabled: boolean
  supported: boolean
  error: string | null
}

export type DockDisplayMode = 'cursor' | 'primary' | 'fixed'

export interface ShortcutSettings {
  toggleDock: string
  togglePomodoro: string
  nextWindow: string
  moveWindow: string
}

export interface FlowDockPreferences {
  shortcuts: ShortcutSettings
  dockDisplayMode: DockDisplayMode
  fixedDisplayId: number | null
  targetDisplayId: number | null
}

export interface PreferencesResult {
  preferences: FlowDockPreferences
  error: string | null
}

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
}

export type PomodoroCommand = 'toggle' | 'pause' | 'start-focus'

export interface PomodoroStatus {
  active: boolean
  running: boolean
  remainingSeconds: number
  taskTitle: string | null
}

export interface FlowDockApi {
  getSnapshot(): Promise<WindowSnapshot>
  activateWindow(hwnd: string, moveToPrimary?: boolean): Promise<boolean>
  closeWindow(hwnd: string): Promise<boolean>
  hide(): Promise<void>
  setWidth(width: number, final?: boolean): Promise<number>
  getStartupSettings(): Promise<StartupSettings>
  setStartupEnabled(enabled: boolean): Promise<StartupSettings>
  getPreferences(): Promise<PreferencesResult>
  setPreferences(preferences: FlowDockPreferences): Promise<PreferencesResult>
  getDisplays(): Promise<DisplayInfo[]>
  quit(): Promise<void>
  showNotification(title: string, body: string): Promise<boolean>
  updatePomodoroStatus(status: PomodoroStatus): Promise<void>
  setLanguage(language: 'en' | 'fa'): Promise<void>
  showWindowMenu(hwnd: string): Promise<boolean>
  onSnapshot(listener: (snapshot: WindowSnapshot) => void): () => void
  onFocusSearch(listener: () => void): () => void
  onPomodoroCommand(listener: (command: PomodoroCommand) => void): () => void
}
