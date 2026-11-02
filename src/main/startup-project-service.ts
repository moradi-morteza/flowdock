import { spawn } from 'node:child_process'
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, win32 } from 'node:path'
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

const jetBrainsProducts: Record<string, string> = {
  phpstorm64: 'PhpStorm',
  webstorm64: 'WebStorm',
  idea64: 'IntelliJIdea',
  pycharm64: 'PyCharm',
  rider64: 'Rider',
  goland64: 'GoLand',
  clion64: 'CLion',
  rubymine64: 'RubyMine',
  datagrip64: 'DataGrip'
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function xmlAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? decodeXml(match[1]) : null
}

function projectNameFromPath(projectPath: string): string {
  return win32.basename(projectPath.replaceAll('/', '\\')) || basename(projectPath)
}

function matchProjectScore(windowTitle: string, frameTitle: string | null, projectName: string): number {
  const title = windowTitle.trim().toLocaleLowerCase()
  const frame = frameTitle?.trim().toLocaleLowerCase() ?? ''
  const name = projectName.trim().toLocaleLowerCase()
  if (frame && title === frame) return 1000
  if (name && title === name) return 950
  if (frame && title.startsWith(frame)) return 900
  if (name && new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*[–—-]|\\s*\\[)`).test(title)) return 850
  return 0
}

export class StartupProjectService {
  private items: StartupProject[] = []

  constructor(
    private readonly settingsPath: string,
    private readonly jetBrainsConfigRoot: string,
    private readonly userHome: string
  ) {}

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

  async resolveProjectPath(desktopWindow: DesktopWindow): Promise<string | null> {
    const product = jetBrainsProducts[desktopWindow.processName.toLocaleLowerCase()]
    if (!product) return null

    try {
      const directories = (await readdir(this.jetBrainsConfigRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.toLocaleLowerCase().startsWith(product.toLocaleLowerCase()))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))

      let bestMatch: { path: string; score: number } | null = null
      for (const directory of directories) {
        const filePath = join(this.jetBrainsConfigRoot, directory, 'options', 'recentProjects.xml')
        let xml: string
        try {
          xml = await readFile(filePath, 'utf8')
        } catch {
          continue
        }

        const entries = xml.matchAll(/<entry\s+key="([^"]+)"[^>]*>([\s\S]*?)<\/entry>/g)
        for (const entry of entries) {
          let projectPath = decodeXml(entry[1])
          if (projectPath.includes('$APPLICATION_CONFIG_DIR$')) continue
          projectPath = projectPath.replace('$USER_HOME$', this.userHome.replaceAll('\\', '/'))

          const meta = entry[2].match(/<RecentProjectMetaInfo\b([^>]*)>/)
          const attributes = meta?.[1] ?? ''
          const frameTitle = xmlAttribute(attributes, 'frameTitle')
          const projectName = projectNameFromPath(projectPath)
          let score = matchProjectScore(desktopWindow.title, frameTitle, projectName)
          if (score === 0) continue
          if (xmlAttribute(attributes, 'opened') === 'true') score += 25
          if (!bestMatch || score > bestMatch.score) bestMatch = { path: projectPath, score }
        }
        if (bestMatch?.score && bestMatch.score >= 1000) break
      }

      if (bestMatch) {
        console.info(`[startup-projects] detected project path for ${desktopWindow.title}: ${bestMatch.path}`)
        return bestMatch.path
      }
    } catch (error) {
      console.warn('[startup-projects] unable to inspect JetBrains recent projects', error)
    }
    return null
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
