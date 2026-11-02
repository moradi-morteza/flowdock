import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, screen } from 'electron'
import type { MenuItemConstructorOptions, MessageBoxOptions, OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import { NativeWindowService } from './native-window-service'
import { StartupProjectService } from './startup-project-service'
import type { DesktopWindow, StartupSettings } from '../shared/window'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 240
const MAX_WIDTH = 420
const STARTUP_ARGUMENT = '--flowdock-startup'
const projectApplications = new Set([
  'phpstorm64',
  'webstorm64',
  'idea64',
  'pycharm64',
  'rider64',
  'goland64',
  'clion64',
  'rubymine64',
  'code'
])
let dock: BrowserWindow | null = null
let dockWidth = DEFAULT_WIDTH
let dockDisplayId: number | null = null
let dockShouldBeVisible = false
let appBarUpdateTimer: NodeJS.Timeout | null = null
let isQuitting = false
let startupProjects: StartupProjectService | null = null
const windows = new NativeWindowService()

interface LoginItemIdentity {
  path: string
  args: string[]
}

function getExecutableIdentity(): LoginItemIdentity {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE
  if (portableExecutable) return { path: portableExecutable, args: [] }
  if (app.isPackaged) return { path: process.execPath, args: [] }
  return { path: process.execPath, args: [app.getAppPath()] }
}

function getLoginItemIdentity(): LoginItemIdentity {
  const identity = getExecutableIdentity()
  return { ...identity, args: [...identity.args, STARTUP_ARGUMENT] }
}

function migrateLegacyStartupSetting(): void {
  if (process.platform !== 'win32' || !readStartupSettings().enabled) return
  try {
    // Rewriting an existing enabled entry upgrades older releases to include
    // STARTUP_ARGUMENT without changing the user's preference.
    setStartupEnabled(true)
  } catch (error) {
    console.warn('[startup] unable to migrate the previous startup entry', error)
  }
}

function readStartupSettings(): StartupSettings {
  if (process.platform !== 'win32') {
    return { enabled: false, supported: false, error: 'Startup is only available on Windows.' }
  }

  try {
    const identity = getLoginItemIdentity()
    const settings = app.getLoginItemSettings(identity)
    const launchItem = settings.launchItems.find((item) =>
      item.name === 'FlowDock' &&
      item.path.localeCompare(identity.path, undefined, { sensitivity: 'accent' }) === 0
    )
    return {
      enabled: launchItem?.enabled ?? settings.openAtLogin,
      supported: true,
      error: null
    }
  } catch (error) {
    console.error('[startup] unable to read login item settings', error)
    return {
      enabled: false,
      supported: true,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function setStartupEnabled(enabled: boolean): StartupSettings {
  if (process.platform !== 'win32') return readStartupSettings()

  try {
    const identity = getLoginItemIdentity()
    app.setLoginItemSettings({ ...identity, name: 'FlowDock', openAtLogin: enabled, enabled })
    const updated = readStartupSettings()
    if (updated.enabled !== enabled && !updated.error) {
      console.warn('[startup] Windows has not reported the updated login item yet')
      return { enabled, supported: true, error: null }
    }
    console.info(`[startup] launch at login ${enabled ? 'enabled' : 'disabled'}`)
    return updated
  } catch (error) {
    console.error('[startup] unable to update login item settings', error)
    return {
      ...readStartupSettings(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function nativeHandleString(window: BrowserWindow): string {
  const handle = window.getNativeWindowHandle()
  return handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE())
}

function getDockDisplay(): Electron.Display {
  const current = screen.getAllDisplays().find((display) => display.id === dockDisplayId)
  if (current) return current
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  dockDisplayId = display.id
  return display
}

function reserveDockSpace(bounds: Electron.Rectangle): void {
  if (!dock || !dockShouldBeVisible) return
  void windows.setAppBar(nativeHandleString(dock), bounds).catch((error: unknown) => {
    console.error('[appbar] unable to reserve desktop work area', error)
  })
}

function scheduleDockReservation(delay = 160): void {
  if (appBarUpdateTimer) clearTimeout(appBarUpdateTimer)
  if (!dockShouldBeVisible) return
  appBarUpdateTimer = setTimeout(() => {
    appBarUpdateTimer = null
    positionDock(true)
  }, delay)
}

function positionDock(updateAppBar = true): void {
  if (!dock) return
  const display = getDockDisplay()
  const bounds = {
    x: display.bounds.x + display.bounds.width - dockWidth,
    y: display.workArea.y,
    width: dockWidth,
    height: display.workArea.height
  }
  const currentBounds = dock.getBounds()
  if (currentBounds.x !== bounds.x || currentBounds.y !== bounds.y ||
      currentBounds.width !== bounds.width || currentBounds.height !== bounds.height) {
    dock.setBounds(bounds, false)
  }
  if (updateAppBar) reserveDockSpace(bounds)
}

function hideDock(): void {
  if (!dock) return
  dockShouldBeVisible = false
  if (appBarUpdateTimer) {
    clearTimeout(appBarUpdateTimer)
    appBarUpdateTimer = null
  }
  dock.hide()
  void windows.removeAppBar().catch((error: unknown) => {
    console.error('[appbar] unable to release desktop work area', error)
  })
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
    dockDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    dockShouldBeVisible = true
    positionDock()
    dock.show()
    dock.focus()
    dock.webContents.send('flowdock:focus-search')
  }
}

function isProjectApplication(processName: string): boolean {
  return projectApplications.has(processName.toLocaleLowerCase())
}

async function showStartupProjectError(message: string): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'error',
    title: 'FlowDock',
    message: 'Startup project could not be saved',
    detail: message
  }
  if (dock) await dialog.showMessageBox(dock, options)
  else await dialog.showMessageBox(options)
}

async function toggleStartupProject(desktopWindow: DesktopWindow): Promise<void> {
  if (!startupProjects) return
  const existing = startupProjects.findForWindow(desktopWindow)
  try {
    if (existing) {
      await startupProjects.remove(existing.id)
      return
    }

    let projectPath: string | null = null
    if (isProjectApplication(desktopWindow.processName)) {
      projectPath = await startupProjects.resolveProjectPath(desktopWindow)
      if (!projectPath) {
        const options: OpenDialogOptions = {
          title: `Project path was not detected — select it once for ${desktopWindow.title}`,
          buttonLabel: 'Open at startup',
          properties: ['openDirectory']
        }
        const selection = dock
          ? await dialog.showOpenDialog(dock, options)
          : await dialog.showOpenDialog(options)
        if (selection.canceled || selection.filePaths.length === 0) return
        projectPath = selection.filePaths[0]
      }
    }

    await startupProjects.add(desktopWindow, projectPath)
    const startup = setStartupEnabled(true)
    if (!startup.enabled) {
      await showStartupProjectError(startup.error ?? 'Windows startup could not be enabled.')
    }
  } catch (error) {
    await showStartupProjectError(error instanceof Error ? error.message : String(error))
  }
}

function showWindowMenu(hwnd: string): boolean {
  if (!dock || !startupProjects) return false
  const desktopWindow = windows.getSnapshot().windows.find((item) => item.hwnd === hwnd)
  if (!desktopWindow) return false

  const startupEntry = startupProjects.findForWindow(desktopWindow)
  const projectApp = isProjectApplication(desktopWindow.processName)
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Activate window',
      click: () => void windows.activateWindow(hwnd, false).then((activated) => {
        if (activated) keepDockAboveWindows()
      })
    },
    {
      label: 'Move to primary monitor',
      click: () => void windows.activateWindow(hwnd, true).then((activated) => {
        if (activated) keepDockAboveWindows()
      })
    },
    { type: 'separator' },
    {
      label: projectApp ? 'Open project at Windows startup…' : 'Open app at Windows startup',
      type: 'checkbox',
      checked: Boolean(startupEntry),
      enabled: Boolean(desktopWindow.executablePath),
      click: () => void toggleStartupProject(desktopWindow)
    },
    { type: 'separator' },
    {
      label: 'Close window',
      click: () => void windows.closeWindow(hwnd)
    }
  ]
  Menu.buildFromTemplate(template).popup({ window: dock })
  return true
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
    dockDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    dockShouldBeVisible = true
    positionDock()
    dock.show()
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.flowdock.app')
  startupProjects = new StartupProjectService(
    join(app.getPath('userData'), 'startup-projects.json'),
    join(app.getPath('appData'), 'JetBrains'),
    app.getPath('home')
  )
  await startupProjects.load()
  migrateLegacyStartupSetting()
  createDock()

  if (process.argv.includes(STARTUP_ARGUMENT)) {
    setTimeout(() => void startupProjects?.launchAll(windows.getSnapshot()), 2500)
  }

  if (!globalShortcut.register('Control+Alt+Space', toggleDock)) {
    console.error('[shortcut] Control+Alt+Space could not be registered')
  }
  screen.on('display-metrics-changed', () => {
    if (!dockShouldBeVisible) return
    positionDock(false)
    scheduleDockReservation()
  })
  screen.on('display-removed', () => {
    if (!screen.getAllDisplays().some((display) => display.id === dockDisplayId)) dockDisplayId = null
    if (!dockShouldBeVisible) return
    positionDock(false)
    scheduleDockReservation(0)
  })
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
ipcMain.handle('flowdock:set-width', (_, requestedWidth: unknown, final: unknown) => {
  if (typeof requestedWidth !== 'number' || !Number.isFinite(requestedWidth)) return dockWidth
  dockWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, requestedWidth)))
  positionDock(false)
  if (final === true) {
    if (appBarUpdateTimer) {
      clearTimeout(appBarUpdateTimer)
      appBarUpdateTimer = null
    }
    positionDock(true)
  } else {
    scheduleDockReservation()
  }
  return dockWidth
})
ipcMain.handle('flowdock:get-startup-settings', readStartupSettings)
ipcMain.handle('flowdock:set-startup-enabled', (_, enabled: unknown) => {
  if (typeof enabled !== 'boolean') return readStartupSettings()
  return setStartupEnabled(enabled)
})
ipcMain.handle('flowdock:show-window-menu', (_, hwnd: unknown) => {
  if (typeof hwnd !== 'string') return false
  return showWindowMenu(hwnd)
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  if (appBarUpdateTimer) clearTimeout(appBarUpdateTimer)
  globalShortcut.unregisterAll()
  void windows.stop()
})

app.on('window-all-closed', () => {
  // FlowDock is Windows-only and exits when its sole UI window is explicitly destroyed.
  app.quit()
})
