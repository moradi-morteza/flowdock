import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { NativeWindowService } from './native-window-service'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 240
const MAX_WIDTH = 420
let dock: BrowserWindow | null = null
let dockWidth = DEFAULT_WIDTH
let isQuitting = false
const windows = new NativeWindowService()

function nativeHandleString(window: BrowserWindow): string {
  const handle = window.getNativeWindowHandle()
  return handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE())
}

function positionDock(): void {
  if (!dock) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = {
    x: display.bounds.x + display.bounds.width - dockWidth,
    y: display.workArea.y,
    width: dockWidth,
    height: display.workArea.height
  }
  dock.setBounds(bounds, false)
  void windows.setAppBar(nativeHandleString(dock), bounds).catch((error: unknown) => {
    console.error('[appbar] unable to reserve desktop work area', error)
  })
}

function hideDock(): void {
  if (!dock) return
  void windows.removeAppBar().finally(() => dock?.hide())
}

function keepDockAboveWindows(): void {
  if (!dock?.isVisible()) return
  dock.setAlwaysOnTop(true, 'floating')
  dock.moveTop()
}

function toggleDock(): void {
  if (!dock) return
  if (dock.isVisible()) {
    hideDock()
  } else {
    positionDock()
    dock.show()
    dock.focus()
    dock.webContents.send('flowdock:focus-search')
  }
}

function createDock(): void {
  dock = new BrowserWindow({
    width: dockWidth,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    height: 800,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'FlowDock',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  dock.setAlwaysOnTop(true, 'floating')
  dock.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  dock.setMenuBarVisibility(false)
  windows.setExcludedHwnd(nativeHandleString(dock))
  windows.start()
  dock.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      hideDock()
    }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void dock.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void dock.loadFile(join(__dirname, '../renderer/index.html'))
  }

  dock.once('ready-to-show', () => {
    if (!dock) return
    positionDock()
    dock.show()
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.flowdock.app')
  createDock()

  if (!globalShortcut.register('Control+Alt+Space', toggleDock)) {
    console.error('[shortcut] Control+Alt+Space could not be registered')
  }
  screen.on('display-metrics-changed', positionDock)
  screen.on('display-removed', positionDock)
})

windows.on('snapshot', (snapshot) => {
  dock?.webContents.send('flowdock:snapshot', snapshot)
})
windows.on('error', () => undefined)

ipcMain.handle('flowdock:get-snapshot', () => windows.getSnapshot())
ipcMain.handle('flowdock:activate', async (_, hwnd: unknown, moveToPrimary: unknown) => {
  if (typeof hwnd !== 'string') return false
  const activated = await windows.activateWindow(hwnd, moveToPrimary === true)
  if (activated) keepDockAboveWindows()
  return activated
})
ipcMain.handle('flowdock:close-window', (_, hwnd: unknown) => {
  if (typeof hwnd !== 'string') return false
  return windows.closeWindow(hwnd)
})
ipcMain.handle('flowdock:hide', hideDock)
ipcMain.handle('flowdock:set-width', (_, requestedWidth: unknown) => {
  if (typeof requestedWidth !== 'number' || !Number.isFinite(requestedWidth)) return dockWidth
  dockWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, requestedWidth)))
  positionDock()
  return dockWidth
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  void windows.stop()
})

app.on('window-all-closed', () => {
  // FlowDock is Windows-only and exits when its sole UI window is explicitly destroyed.
  app.quit()
})
