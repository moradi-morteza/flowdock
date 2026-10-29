import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { DesktopWindow, WindowSnapshot } from '../shared/window'

interface StartupProject {
  id: string
  name: string
  executablePath: string
  projectPath: string | null
  sourceTitle: string
}

function isStartupProject(value: unknown): value is StartupProject {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StartupProject>
  return typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.executablePath === 'string' &&
    (typeof item.projectPath === 'string' || item.projectPath === null) &&
    typeof item.sourceTitle === 'string'
}

function samePath(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

export class StartupProjectService {
  private items: StartupProject[] = []

  constructor(private readonly settingsPath: string) {}

  async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.settingsPath, 'utf8'))
      this.items = Array.isArray(parsed) ? parsed.filter(isStartupProject) : []
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') console.error('[startup-projects] unable to load settings', error)
      this.items = []
    }
  }

  findForWindow(desktopWindow: DesktopWindow): StartupProject | undefined {
    return this.items.find((item) =>
      samePath(item.executablePath, desktopWindow.executablePath) &&
      (item.sourceTitle === desktopWindow.title ||
        (Boolean(item.projectPath) && desktopWindow.title.toLocaleLowerCase().includes(item.name.toLocaleLowerCase())))
    )
  }

  async add(desktopWindow: DesktopWindow, projectPath: string | null): Promise<void> {
    const duplicate = this.items.find((item) =>
      samePath(item.executablePath, desktopWindow.executablePath) &&
      item.projectPath === projectPath
    )
    if (duplicate) {
      duplicate.sourceTitle = desktopWindow.title
      await this.save()
      return
    }

    this.items.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: projectPath ? basename(projectPath) : desktopWindow.processName,
      executablePath: desktopWindow.executablePath,
      projectPath,
      sourceTitle: desktopWindow.title
    })
    await this.save()
  }

  async remove(id: string): Promise<void> {
    this.items = this.items.filter((item) => item.id !== id)
    await this.save()
  }

  async launchAll(snapshot: WindowSnapshot): Promise<void> {
    for (const item of this.items) {
      const alreadyOpen = snapshot.windows.some((desktopWindow) => {
        if (!samePath(desktopWindow.executablePath, item.executablePath)) return false
        if (!item.projectPath) return true
        return desktopWindow.title.toLocaleLowerCase().includes(item.name.toLocaleLowerCase())
      })
      if (alreadyOpen) continue

      try {
        await access(item.executablePath)
        const child = spawn(item.executablePath, item.projectPath ? [item.projectPath] : [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
        child.unref()
        console.info(`[startup-projects] launched ${item.name}`)
      } catch (error) {
        console.error(`[startup-projects] unable to launch ${item.name}`, error)
      }
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true })
    await writeFile(this.settingsPath, JSON.stringify(this.items, null, 2), 'utf8')
  }
}
