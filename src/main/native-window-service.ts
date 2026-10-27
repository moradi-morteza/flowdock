import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { DesktopWindow, WindowSnapshot } from '../shared/window'

interface RawWindow extends Omit<DesktopWindow, 'iconDataUrl'> {}

interface NativeSnapshotMessage {
  type: 'snapshot'
  requestId?: string
  windows: RawWindow[]
  activeHwnd: string | null
}

interface NativeResultMessage {
  type: 'result'
  requestId: string
  ok: boolean
}

interface NativeErrorMessage {
  type: 'error'
  message: string
}

type NativeMessage = NativeSnapshotMessage | NativeResultMessage | NativeErrorMessage

type PendingRequest = {
  resolve: (value: NativeMessage) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export declare interface NativeWindowService {
  on(event: 'snapshot', listener: (snapshot: WindowSnapshot) => void): this
  on(event: 'error', listener: (error: Error) => void): this
}

export class NativeWindowService extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private helperPath: string | null = null
  private requestSequence = 0
  private readonly pending = new Map<string, PendingRequest>()
  private readonly iconCache = new Map<string, Promise<string | null>>()
  private snapshot: WindowSnapshot = { windows: [], activeHwnd: null, error: null }
  private excludedHwnd: string | null = null
  private enrichmentGeneration = 0
  private shuttingDown = false
  private appBarSpec: string | null = null

  setExcludedHwnd(hwnd: string): void {
    this.excludedHwnd = hwnd
  }

  getSnapshot(): WindowSnapshot {
    return this.snapshot
  }

  start(): void {
    if (process.platform !== 'win32') {
      this.reportError(new Error('FlowDock window integration is available only on Windows.'))
      return
    }

    const helperPath = app.isPackaged
      ? join(process.resourcesPath, 'native', 'flowdock-native.exe')
      : join(app.getAppPath(), 'native', 'build', 'bin', 'Release', 'flowdock-native.exe')

    if (!existsSync(helperPath)) {
      this.reportError(new Error(`Native helper not found at ${helperPath}. Run npm run build:native first.`))
      return
    }

    this.helperPath = helperPath
    console.info(`[native] starting ${helperPath}`)
    this.child = spawn(helperPath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (data: string) => console.error(`[native] ${data.trim()}`))
    this.child.on('error', (error) => this.reportError(error))
    this.child.on('exit', (code, signal) => {
      this.child = null
      if (!this.shuttingDown) {
        this.reportError(new Error(`Native helper exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`))
      }
      this.rejectPending(new Error('Native helper is not running.'))
    })

    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => this.handleLine(line))
  }

  async listWindows(): Promise<WindowSnapshot> {
    const message = await this.request('LIST')
    if (message.type !== 'snapshot') throw new Error('Unexpected native response to LIST.')
    await this.applySnapshot(message)
    return this.snapshot
  }

  async activateWindow(hwnd: string, moveToPrimary = false): Promise<boolean> {
    if (!/^\d+$/.test(hwnd) || !this.helperPath) return false

    // Spawn at the moment of the user gesture. Windows permits a process that
    // was started by the current foreground process to request foreground focus.
    return new Promise((resolve) => {
      const activator = spawn(this.helperPath!, [moveToPrimary ? '--move-primary' : '--activate', hwnd], {
        windowsHide: true,
        stdio: 'ignore'
      })
      let settled = false
      let timeout: NodeJS.Timeout | undefined
      const finish = (result: boolean): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        resolve(result)
      }
      timeout = setTimeout(() => {
        activator.kill()
        finish(false)
      }, 1500)
      activator.once('error', () => finish(false))
      activator.once('exit', (code) => finish(code === 0))
    })
  }

  async restoreWindow(hwnd: string): Promise<boolean> {
    if (!/^\d+$/.test(hwnd)) return false
    const message = await this.request('RESTORE', hwnd)
    return message.type === 'result' && message.ok
  }

  async closeWindow(hwnd: string): Promise<boolean> {
    if (!/^\d+$/.test(hwnd)) return false
    const message = await this.request('CLOSE', hwnd)
    return message.type === 'result' && message.ok
  }

  async setAppBar(
    hwnd: string,
    bounds: { x: number; y: number; width: number; height: number }
  ): Promise<boolean> {
    if (!/^\d+$/.test(hwnd)) return false
    const spec = `${hwnd},${bounds.x},${bounds.y},${bounds.x + bounds.width},${bounds.y + bounds.height}`
    if (spec === this.appBarSpec) return true
    const message = await this.request('APPBAR', spec)
    const ok = message.type === 'result' && message.ok
    if (ok) this.appBarSpec = spec
    return ok
  }

  async removeAppBar(): Promise<void> {
    if (!this.child || !this.appBarSpec) return
    await this.request('UNAPPBAR', undefined, 800)
    this.appBarSpec = null
  }

  async stop(): Promise<void> {
    this.shuttingDown = true
    if (!this.child) return
    try {
      await this.removeAppBar()
      await this.request('QUIT', undefined, 800)
    } catch {
      this.child.kill()
    }
    this.child = null
  }

  private request(verb: string, argument?: string, timeoutMs = 2500): Promise<NativeMessage> {
    if (!this.child?.stdin.writable) return Promise.reject(new Error('Native helper is unavailable.'))
    const requestId = String(++this.requestSequence)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Native ${verb} request timed out.`))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
      this.child?.stdin.write(`${verb} ${requestId}${argument ? ` ${argument}` : ''}\n`)
    })
  }

  private handleLine(line: string): void {
    let message: NativeMessage
    try {
      message = JSON.parse(line) as NativeMessage
    } catch (error) {
      this.reportError(new Error(`Invalid native response: ${line}`, { cause: error }))
      return
    }

    if (message.type === 'error') {
      this.reportError(new Error(message.message))
      return
    }

    if (message.requestId) {
      const pending = this.pending.get(message.requestId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pending.delete(message.requestId)
        pending.resolve(message)
      }
    }

    if (message.type === 'snapshot') void this.applySnapshot(message)
  }

  private async applySnapshot(message: NativeSnapshotMessage): Promise<void> {
    const generation = ++this.enrichmentGeneration
    const visibleWindows = message.windows.filter((window) => window.hwnd !== this.excludedHwnd)
    const previousOrder = new Map(
      this.snapshot.windows.map((window, index) => [window.hwnd, index])
    )
    visibleWindows.sort((left, right) => {
      const leftIndex = previousOrder.get(left.hwnd) ?? Number.MAX_SAFE_INTEGER
      const rightIndex = previousOrder.get(right.hwnd) ?? Number.MAX_SAFE_INTEGER
      return leftIndex - rightIndex
    })
    const windows = await Promise.all(
      visibleWindows.map(async (window): Promise<DesktopWindow> => ({
        ...window,
        iconDataUrl: await this.getIcon(window.executablePath)
      }))
    )
    if (generation !== this.enrichmentGeneration) return

    const activeHwnd = message.activeHwnd === this.excludedHwnd
      ? this.snapshot.activeHwnd
      : message.activeHwnd
    this.snapshot = { windows, activeHwnd, error: null }
    this.emit('snapshot', this.snapshot)
  }

  private getIcon(executablePath: string): Promise<string | null> {
    if (!executablePath) return Promise.resolve(null)
    const cached = this.iconCache.get(executablePath)
    if (cached) return cached
    const icon = app.getFileIcon(executablePath, { size: 'small' })
      .then((image) => image.isEmpty() ? null : image.toDataURL())
      .catch((error: unknown) => {
        console.warn(`[native] unable to load icon for ${executablePath}`, error)
        return null
      })
    this.iconCache.set(executablePath, icon)
    return icon
  }

  private reportError(error: Error): void {
    console.error('[native]', error)
    this.snapshot = { ...this.snapshot, error: error.message }
    this.emit('error', error)
    this.emit('snapshot', this.snapshot)
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.pending.clear()
  }
}
