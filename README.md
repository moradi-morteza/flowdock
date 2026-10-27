# FlowDock

FlowDock is a Windows 10/11 desktop sidebar for finding and activating real top-level application windows. Each entry is keyed by its `HWND`, so independent PhpStorm projects appear and switch separately even when they belong to the same process/application group.

## What is implemented

- Frameless, always-on-top right sidebar with adjustable width and no taskbar entry
- Event-driven Win32 enumeration via `EnumWindows` and `SetWinEventHook`
- Real window activation via `ShowWindowAsync(SW_RESTORE)` and `SetForegroundWindow`
- Per-window title, executable/process name, icon, minimized state, and active indicator
- Per-window monitor badges; Shift+Click or Shift+Enter moves a window to the primary monitor
- App grouping, collapsible groups, full-title tooltips, search, and compact dark UI
- Global `Ctrl+Alt+Space` show/hide shortcut
- `Up` / `Down`, `Enter`, and `Escape` keyboard controls while the sidebar is active
- Sandboxed renderer with `contextIsolation`, a narrow preload API, and typed IPC
- Reproducible CMake/MSVC native build and Electron Builder NSIS packaging

FlowDock deliberately does not fall back to mocked window data. If the native helper is unavailable or fails, the sidebar displays the integration error.

## Requirements

- Windows 10 or Windows 11, x64
- Node.js 22+
- CMake 3.24+
- Visual Studio 2022 Build Tools with **Desktop development with C++** and a Windows SDK

Run all commands below from Windows PowerShell (not WSL):

```powershell
npm install
npm run build:native
```

## Verify native Windows integration

List the real windows discovered by the helper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-native.ps1
```

To verify restore/foreground activation, copy an HWND from that output and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-native.ps1 -Hwnd 123456
```

Windows can reject foreground activation according to its foreground-lock rules. FlowDock intentionally does not use thread-input attachment or other unsafe focus-stealing workarounds.

## Development

Build the native helper once, then start Electron with Vite hot reload:

```powershell
npm run build:native
npm run dev
```

Useful checks:

```powershell
npm run typecheck
npm run build
```

Open three projects with **File → Open → New Window** in PhpStorm. Each top-level project window should have a different HWND and appear as a separate row in the PhpStorm group. The list updates after windows open, close, minimize, restore, change title, or become active.

## Package for Windows

Create an unpacked test build:

```powershell
npm run pack:win
```

Create both the NSIS installer and portable executable:

```powershell
npm run build:win
```

Artifacts are written to `release/`:

- `FlowDock-1.0.0-x64-Setup.exe`
- `FlowDock-1.0.0-x64-Portable.exe`

Build only one target when needed:

```powershell
npm run build:win:installer
npm run build:win:portable
```

## Architecture

```text
React renderer (sandboxed)
        │ typed contextBridge API
Electron main process
        │ line-delimited command/JSON protocol
flowdock-native.exe
        │ EnumWindows / SetWinEventHook / SetForegroundWindow
Windows desktop
```

The helper remains independent of the UI. It owns WinEvent hooks and enumeration; Electron enriches executable paths with Windows file icons and publishes immutable snapshots to React. Event bursts are debounced for 90 ms, and executable icons are cached to keep idle CPU and update cost low.

## Native protocol

Commands on standard input include `LIST <id>`, `ACTIVATE <id> <hwnd>`, `RESTORE <id> <hwnd>`, `CLOSE <id> <hwnd>`, and `QUIT <id>`. Responses are one-line JSON objects. Window handles are decimal strings so 64-bit HWND values are never truncated by JavaScript number conversion.
