import { contextBridge, ipcRenderer } from 'electron'
import type {
  DisplayInfo,
  FlowDockApi,
  FlowDockPreferences,
  PomodoroCommand,
  PomodoroStatus,
  PreferencesResult,
  StartupSettings,
  WindowSnapshot
} from '../shared/window'

const api: FlowDockApi = {
  getSnapshot: () => ipcRenderer.invoke('flowdock:get-snapshot') as Promise<WindowSnapshot>,
  activateWindow: (hwnd, moveToPrimary = false) =>
    ipcRenderer.invoke('flowdock:activate', hwnd, moveToPrimary) as Promise<boolean>,
  closeWindow: (hwnd) => ipcRenderer.invoke('flowdock:close-window', hwnd) as Promise<boolean>,
  hide: () => ipcRenderer.invoke('flowdock:hide') as Promise<void>,
  setWidth: (width, final = false) =>
    ipcRenderer.invoke('flowdock:set-width', width, final) as Promise<number>,
  getStartupSettings: () =>
    ipcRenderer.invoke('flowdock:get-startup-settings') as Promise<StartupSettings>,
  setStartupEnabled: (enabled) =>
    ipcRenderer.invoke('flowdock:set-startup-enabled', enabled) as Promise<StartupSettings>,
  getPreferences: () => ipcRenderer.invoke('flowdock:get-preferences') as Promise<PreferencesResult>,
  setPreferences: (preferences: FlowDockPreferences) =>
    ipcRenderer.invoke('flowdock:set-preferences', preferences) as Promise<PreferencesResult>,
  getDisplays: () => ipcRenderer.invoke('flowdock:get-displays') as Promise<DisplayInfo[]>,
  quit: () => ipcRenderer.invoke('flowdock:quit') as Promise<void>,
  showNotification: (title, body) =>
    ipcRenderer.invoke('flowdock:show-notification', title, body) as Promise<boolean>,
  updatePomodoroStatus: (status: PomodoroStatus) =>
    ipcRenderer.invoke('flowdock:update-pomodoro-status', status) as Promise<void>,
  setLanguage: (language) => ipcRenderer.invoke('flowdock:set-language', language) as Promise<void>,
  showWindowMenu: (hwnd) => ipcRenderer.invoke('flowdock:show-window-menu', hwnd) as Promise<boolean>,
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: WindowSnapshot): void => listener(snapshot)
    ipcRenderer.on('flowdock:snapshot', handler)
    return () => ipcRenderer.removeListener('flowdock:snapshot', handler)
  },
  onFocusSearch: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on('flowdock:focus-search', handler)
    return () => ipcRenderer.removeListener('flowdock:focus-search', handler)
  },
  onPomodoroCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: PomodoroCommand): void => listener(command)
    ipcRenderer.on('flowdock:pomodoro-command', handler)
    return () => ipcRenderer.removeListener('flowdock:pomodoro-command', handler)
  }
}

contextBridge.exposeInMainWorld('flowDock', api)
