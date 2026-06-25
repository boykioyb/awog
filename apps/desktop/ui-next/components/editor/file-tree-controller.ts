import type { ComputedRef } from 'vue'
import type { WorkspaceTreeNode } from '~/composables/useWorkspaceFiles'

// Imperative interface EditorFileTree + EditorFileTreeNodes use to render the lazy
// tree and route expand/select back to useWorkspaceFiles. Kept in a .ts module so
// both the parent and the recursive child can import the type without a circular
// SFC import.
export interface FileTreeController {
  // Sorted children for a directory path ('' = root). Empty until loaded.
  childrenFor: (dir: string) => WorkspaceTreeNode[]
  isExpanded: (dir: string) => boolean
  // Expand/collapse a directory (loads its children on first expand).
  toggle: (dir: string) => void
  // Open a file (workspace-relative path) in the editor.
  openFile: (path: string) => void
  loading: ComputedRef<boolean>
}
