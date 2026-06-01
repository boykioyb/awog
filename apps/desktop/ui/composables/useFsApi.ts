// Thin typed wrapper around the sidecar read-only fs RPCs used by the Session
// workspace Files / Preview tabs. Shape mirrors sidecar src/types/shared.ts.
import type { FsEntry, FsFileContent } from '~/types'
import { useSidecar } from './useSidecar'

export function useFsApi() {
  const sidecar = useSidecar()
  return {
    listDir: (workspaceRoot: string, path?: string) =>
      sidecar.request<{ entries: FsEntry[] }>('fs.listDir', {
        workspaceRoot,
        ...(path !== undefined ? { path } : {}),
      }),
    readFile: (workspaceRoot: string, path: string, maxBytes?: number) =>
      sidecar.request<FsFileContent>('fs.readFile', {
        workspaceRoot,
        path,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      }),
  }
}
