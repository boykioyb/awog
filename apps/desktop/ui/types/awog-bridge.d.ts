// Ambient type for the Electron preload bridge exposed as `window.awog`
// (apps/desktop/electron/src/preload.ts). The renderer talks to the engine + a
// narrow set of shell/dialog ops ONLY through this object — never Node directly.

export type AwogEngineEvent = { type: string; payload: unknown }
export type AwogFileFilter = { name: string; extensions: string[] }
export type AwogDialogOpts = { title?: string; defaultPath?: string }
export type AwogSavePathOpts = AwogDialogOpts & { filters?: AwogFileFilter[] }

export interface AwogBridge {
  // Resolves with the JSON-RPC result, or rejects with { code, message, data }.
  request(method: string, params?: unknown): Promise<unknown>
  // Subscribe to engine events; returns an unsubscribe function.
  onEvent(handler: (event: AwogEngineEvent) => void): () => void
  openExternal(url: string): Promise<void>
  revealPath(root: string, path: string): Promise<void>
  openPath(root: string, path: string): Promise<void>
  pickFolder(opts?: AwogDialogOpts): Promise<string | null>
  savePath(opts?: AwogSavePathOpts): Promise<string | null>
}

declare global {
  interface Window {
    awog?: AwogBridge
  }
}
