/* eslint-disable max-classes-per-file -- error subclasses live next to the composable that throws them */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export class SidecarError extends Error {
  code: number

  data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'SidecarError'
    this.code = code
    this.data = data
  }
}

export class SidecarUnavailableError extends Error {
  constructor() {
    super('Sidecar unavailable: app is not running inside Tauri shell')
    this.name = 'SidecarUnavailableError'
  }
}

export type SidecarEvent = { type: string; payload: unknown }
export type SidecarEventHandler = (event: SidecarEvent) => void

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const parseError = (raw: unknown): SidecarError => {
  if (typeof raw === 'string') {
    try {
      const obj = JSON.parse(raw) as { code?: number; message?: string; data?: unknown }
      if (typeof obj?.code === 'number' && typeof obj?.message === 'string') {
        return new SidecarError(obj.code, obj.message, obj.data)
      }
      return new SidecarError(-32603, raw)
    } catch {
      return new SidecarError(-32603, raw)
    }
  }
  return new SidecarError(-32603, 'Unknown sidecar error', raw)
}

export function useSidecar() {
  const request = async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    if (!isTauri()) throw new SidecarUnavailableError()
    try {
      return await invoke<T>('sidecar_request', { method, params: params ?? null })
    } catch (err) {
      throw parseError(err)
    }
  }

  const onEvent = async (handler: SidecarEventHandler): Promise<UnlistenFn> => {
    if (!isTauri()) throw new SidecarUnavailableError()
    // Tauri 2 rejects dots in event names; Rust side emits `sidecar-event`.
    return listen<SidecarEvent>('sidecar-event', (e) => handler(e.payload))
  }

  const openExternal = async (url: string): Promise<void> => {
    if (!isTauri()) throw new SidecarUnavailableError()
    try {
      await invoke<void>('open_external', { url })
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : 'open_external failed')
    }
  }

  return {
    available: isTauri(),
    request,
    onEvent,
    openExternal,
  }
}
