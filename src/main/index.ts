import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Notification, screen, Tray } from 'electron'
import type { MenuItemConstructorOptions, MessageBoxOptions, OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import { NativeWindowService } from './native-window-service'
import { defaultPreferences, PreferencesService } from './preferences-service'
import { StartupProjectService } from './startup-project-service'
import type {
  DesktopWindow,
  DisplayInfo,
  FlowDockPreferences,
  PomodoroCommand,
  PomodoroStatus,
  PreferencesResult,
  StartupSettings
} from '../shared/window'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 240
const MAX_WIDTH = 420
const STARTUP_ARGUMENT = '--flowdock-startup'
const hasSingleInstanceLock = app.requestSingleInstanceLock()
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
let preferencesService: PreferencesService | null = null
let preferences: FlowDockPreferences = structuredClone(defaultPreferences)
let preferencesError: string | null = null
let tray: Tray | null = null
let trayLanguage: 'en' | 'fa' = 'en'
let pomodoroStatus: PomodoroStatus = { active: false, running: false, remainingSeconds: 0, taskTitle: null }
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
  if (preferences.dockDisplayMode === 'primary') {
    const primary = screen.getPrimaryDisplay()
    dockDisplayId = primary.id
    return primary
  }
  if (preferences.dockDisplayMode === 'fixed' && preferences.fixedDisplayId !== null) {
    const fixed = screen.getAllDisplays().find((display) => display.id === preferences.fixedDisplayId)
    if (fixed) {
      dockDisplayId = fixed.id
      return fixed
    }
  }
  const current = screen.getAllDisplays().find((display) => display.id === dockDisplayId)
  if (current) return current
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  dockDisplayId = display.id
  return display
}

function selectDockDisplayForShow(): void {
  if (preferences.dockDisplayMode === 'cursor') {
    dockDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  } else if (preferences.dockDisplayMode === 'primary') {
    dockDisplayId = screen.getPrimaryDisplay().id
  } else {
    dockDisplayId = preferences.fixedDisplayId
  }
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
  rebuildTrayMenu()
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
    showDock()
  }
}

function showDock(): void {
  if (!dock) return
  selectDockDisplayForShow()
  dockShouldBeVisible = true
  positionDock()
  dock.show()
  dock.focus()
  dock.webContents.send('flowdock:focus-search')
  rebuildTrayMenu()
}

function sendPomodoroCommand(command: PomodoroCommand): void {
  if (!dock) return
  if (dock.webContents.isLoading()) {
    dock.webContents.once('did-finish-load', () => dock?.webContents.send('flowdock:pomodoro-command', command))
  } else {
    dock.webContents.send('flowdock:pomodoro-command', command)
  }
}

function trayText(english: string, persian: string): string {
  return trayLanguage === 'fa' ? persian : english
}

function rebuildTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: dock?.isVisible()
        ? trayText('Hide FlowDock', 'مخفی‌کردن فلو‌داک')
        : trayText('Show FlowDock', 'نمایش فلو‌داک'),
      click: toggleDock
    },
    { type: 'separator' },
    {
      label: trayText('Pause Pomodoro', 'توقف پومودورو'),
      enabled: pomodoroStatus.active && pomodoroStatus.running,
      click: () => sendPomodoroCommand('pause')
    },
    {
      label: trayText('Start Focus', 'شروع تمرکز'),
      click: () => sendPomodoroCommand('start-focus')
    },
    { type: 'separator' },
    {
      label: trayText('Quit FlowDock', 'خروج از فلو‌داک'),
      click: () => void quitFlowDock()
    }
  ]))
}

async function createTray(): Promise<void> {
  try {
    const icon = await app.getFileIcon(process.execPath, { size: 'small' })
    tray = new Tray(icon.resize({ width: 16, height: 16 }))
    tray.setToolTip('FlowDock')
    tray.on('click', toggleDock)
    rebuildTrayMenu()
  } catch (error) {
    console.error('[tray] unable to create system tray icon', error)
  }
}

async function quitFlowDock(): Promise<void> {
  isQuitting = true
  dockShouldBeVisible = false
  try {
    await windows.removeAppBar()
  } catch (error) {
    console.warn('[appbar] unable to release before quit', error)
  }
  app.quit()
}

function displayOptions(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.label || `Monitor ${index + 1}`,
    primary: display.id === primaryId
  }))
}

async function activateNextWindow(): Promise<void> {
  const snapshot = windows.getSnapshot()
  if (snapshot.windows.length === 0) return
  const currentIndex = snapshot.windows.findIndex((item) => item.hwnd === snapshot.activeHwnd)
  const nextIndex = (currentIndex + 1 + snapshot.windows.length) % snapshot.windows.length
  await windows.activateWindow(snapshot.windows[nextIndex].hwnd)
}

async function moveActiveWindow(): Promise<void> {
  const snapshot = windows.getSnapshot()
  const active = snapshot.windows.find((item) => item.hwnd === snapshot.activeHwnd)
  if (!active) return
  const displays = [...screen.getAllDisplays()].sort((left, right) =>
    left.bounds.x === right.bounds.x ? left.bounds.y - right.bounds.y : left.bounds.x - right.bounds.x
  )
  if (displays.length < 2) return

  let target = preferences.targetDisplayId === null
    ? null
    : displays.find((display) => display.id === preferences.targetDisplayId) ?? null
  if (!target) {
    const currentNumber = Number(active.monitorDevice.match(/DISPLAY(\d+)$/i)?.[1] ?? '1') - 1
    target = displays[(Math.max(0, currentNumber) + 1) % displays.length]
  }
  const targetIndex = preferences.targetDisplayId === null
    ? null
    : displays.findIndex((display) => display.id === target?.id)
  await windows.moveWindowToDisplay(active.hwnd, targetIndex !== null && targetIndex >= 0 ? targetIndex : null)
}

const shortcutActions: Record<keyof FlowDockPreferences['shortcuts'], () => void> = {
  toggleDock,
  togglePomodoro: () => sendPomodoroCommand('toggle'),
  nextWindow: () => void activateNextWindow(),
  moveWindow: () => void moveActiveWindow()
}

function registerShortcuts(candidate: FlowDockPreferences): string | null {
  globalShortcut.unregisterAll()
  const registered = new Set<string>()
  try {
    for (const [name, accelerator] of Object.entries(candidate.shortcuts) as Array<[
      keyof FlowDockPreferences['shortcuts'], string
    ]>) {
      if (!accelerator) continue
      const normalized = accelerator.toLocaleLowerCase()
      if (registered.has(normalized)) throw new Error(`Shortcut ${accelerator} is assigned more than once.`)
      if (!globalShortcut.register(accelerator, shortcutActions[name])) {
        throw new Error(`Shortcut ${accelerator} is unavailable or already used by another application.`)
      }
      registered.add(normalized)
    }
    return null
  } catch (error) {
    globalShortcut.unregisterAll()
    return error instanceof Error ? error.message : String(error)
  }
}

function currentPreferencesResult(): PreferencesResult {
  return { preferences: structuredClone(preferences), error: preferencesError }
}

async function updatePreferences(candidate: FlowDockPreferences): Promise<PreferencesResult> {
  if (!preferencesService) return currentPreferencesResult()
  const previous = preferences
  const registrationError = registerShortcuts(candidate)
  if (registrationError) {
    preferencesError = registrationError
    registerShortcuts(previous)
    return currentPreferencesResult()
  }
  try {
    preferences = await preferencesService.save(candidate)
    preferencesError = null
    if (dockShouldBeVisible) {
      selectDockDisplayForShow()
      positionDock(false)
      scheduleDockReservation(0)
    }
  } catch (error) {
    preferences = previous
    registerShortcuts(previous)
    preferencesError = error instanceof Error ? error.message : String(error)
  }
  return currentPreferencesResult()
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
      nodeIntegration: false,
      backgroundThrottling: false
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
    selectDockDisplayForShow()
    dockShouldBeVisible = true
    positionDock()
    dock.show()
    rebuildTrayMenu()
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (!dock) return
  showDock()
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  app.setAppUserModelId('com.flowdock.app')
  startupProjects = new StartupProjectService(
    join(app.getPath('userData'), 'startup-projects.json'),
    join(app.getPath('appData'), 'JetBrains'),
    app.getPath('home')
  )
  preferencesService = new PreferencesService(join(app.getPath('userData'), 'preferences.json'))
  await preferencesService.load()
  preferences = preferencesService.get()
  await startupProjects.load()
  migrateLegacyStartupSetting()
  createDock()
  await createTray()

  if (process.argv.includes(STARTUP_ARGUMENT)) {
    setTimeout(() => void startupProjects?.launchAll(windows.getSnapshot()), 2500)
  }

  preferencesError = registerShortcuts(preferences)
  if (preferencesError) console.error('[shortcut]', preferencesError)
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
ipcMain.handle('flowdock:get-preferences', currentPreferencesResult)
ipcMain.handle('flowdock:set-preferences', (_, candidate: unknown) => {
  if (!candidate || typeof candidate !== 'object' || !('shortcuts' in candidate)) return currentPreferencesResult()
  return updatePreferences(candidate as FlowDockPreferences)
})
ipcMain.handle('flowdock:get-displays', displayOptions)
ipcMain.handle('flowdock:quit', () => quitFlowDock())
ipcMain.handle('flowdock:show-notification', (_, title: unknown, body: unknown) => {
  if (typeof title !== 'string' || typeof body !== 'string' || !Notification.isSupported()) return false
  const notification = new Notification({
    title: title.slice(0, 80),
    body: body.slice(0, 240),
    silent: false
  })
  notification.on('click', showDock)
  notification.show()
  return true
})
ipcMain.handle('flowdock:update-pomodoro-status', (_, status: unknown) => {
  if (!status || typeof status !== 'object') return
  const input = status as Partial<PomodoroStatus>
  pomodoroStatus = {
    active: input.active === true,
    running: input.running === true,
    remainingSeconds: typeof input.remainingSeconds === 'number' ? Math.max(0, input.remainingSeconds) : 0,
    taskTitle: typeof input.taskTitle === 'string' ? input.taskTitle : null
  }
  rebuildTrayMenu()
})
ipcMain.handle('flowdock:set-language', (_, language: unknown) => {
  trayLanguage = language === 'fa' ? 'fa' : 'en'
  rebuildTrayMenu()
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
  tray?.destroy()
  tray = null
  void windows.stop()
})

app.on('window-all-closed', () => {
  // FlowDock is Windows-only and exits when its sole UI window is explicitly destroyed.
  app.quit()
})
