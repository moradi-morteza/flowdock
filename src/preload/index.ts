import { contextBridge, ipcRenderer } from 'electron'
import type { FlowDockApi, WindowSnapshot } from '../shared/window'

const api: FlowDockApi = {
  getSnapshot: () => ipcRenderer.invoke('flowdock:get-snapshot') as Promise<WindowSnapshot>,
  activateWindow: (hwnd, moveToPrimary = false) =>
    ipcRenderer.invoke('flowdock:activate', hwnd, moveToPrimary) as Promise<boolean>,
  closeWindow: (hwnd) => ipcRenderer.invoke('flowdock:close-window', hwnd) as Promise<boolean>,
  hide: () => ipcRenderer.invoke('flowdock:hide') as Promise<void>,
  setWidth: (width) => ipcRenderer.invoke('flowdock:set-width', width) as Promise<number>,
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: WindowSnapshot): void => listener(snapshot)
    ipcRenderer.on('flowdock:snapshot', handler)
    return () => ipcRenderer.removeListener('flowdock:snapshot', handler)
  },
  onFocusSearch: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on('flowdock:focus-search', handler)
    return () => ipcRenderer.removeListener('flowdock:focus-search', handler)
  }
}

contextBridge.exposeInMainWorld('flowDock', api)
