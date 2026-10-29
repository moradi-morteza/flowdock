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

export interface FlowDockApi {
  getSnapshot(): Promise<WindowSnapshot>
  activateWindow(hwnd: string, moveToPrimary?: boolean): Promise<boolean>
  closeWindow(hwnd: string): Promise<boolean>
  hide(): Promise<void>
  setWidth(width: number): Promise<number>
  getStartupSettings(): Promise<StartupSettings>
  setStartupEnabled(enabled: boolean): Promise<StartupSettings>
  showWindowMenu(hwnd: string): Promise<boolean>
  onSnapshot(listener: (snapshot: WindowSnapshot) => void): () => void
  onFocusSearch(listener: () => void): () => void
}
