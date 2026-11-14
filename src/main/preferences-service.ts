import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FlowDockPreferences } from '../shared/window'

export const defaultPreferences: FlowDockPreferences = {
  shortcuts: {
    toggleDock: 'Control+Alt+Space',
    togglePomodoro: 'Control+Alt+P',
    nextWindow: 'Control+Alt+Down',
    moveWindow: 'Control+Alt+M'
  },
  dockDisplayMode: 'cursor',
  fixedDisplayId: null,
  targetDisplayId: null
}

function shortcut(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length <= 64 ? value.trim() : fallback
}

function sanitize(value: unknown): FlowDockPreferences {
  if (!value || typeof value !== 'object') return structuredClone(defaultPreferences)
  const input = value as Partial<FlowDockPreferences>
  const shortcuts = input.shortcuts ?? defaultPreferences.shortcuts
  return {
    shortcuts: {
      toggleDock: shortcut(shortcuts.toggleDock, defaultPreferences.shortcuts.toggleDock),
      togglePomodoro: shortcut(shortcuts.togglePomodoro, defaultPreferences.shortcuts.togglePomodoro),
      nextWindow: shortcut(shortcuts.nextWindow, defaultPreferences.shortcuts.nextWindow),
      moveWindow: shortcut(shortcuts.moveWindow, defaultPreferences.shortcuts.moveWindow)
    },
    dockDisplayMode: input.dockDisplayMode === 'primary' || input.dockDisplayMode === 'fixed'
      ? input.dockDisplayMode
      : 'cursor',
    fixedDisplayId: typeof input.fixedDisplayId === 'number' ? input.fixedDisplayId : null,
    targetDisplayId: typeof input.targetDisplayId === 'number' ? input.targetDisplayId : null
  }
}

export class PreferencesService {
  private preferences = structuredClone(defaultPreferences)

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      this.preferences = sanitize(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[preferences] unable to load settings', error)
      }
    }
  }

  get(): FlowDockPreferences {
    return structuredClone(this.preferences)
  }

  async save(preferences: FlowDockPreferences): Promise<FlowDockPreferences> {
    this.preferences = sanitize(preferences)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(this.preferences, null, 2)}\n`, 'utf8')
    return this.get()
  }
}
