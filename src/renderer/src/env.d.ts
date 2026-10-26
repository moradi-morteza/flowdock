/// <reference types="vite/client" />

import type { FlowDockApi } from '../../shared/window'

declare global {
  interface Window {
    flowDock: FlowDockApi
  }
}

export {}
