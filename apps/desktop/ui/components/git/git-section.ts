// Sidebar selection state. Drives which view the main pane renders and which
// item in the sidebar tree is highlighted. `string` payloads namespace the
// section (`branch:main`, `remote:origin`, `stash:0`) so two unrelated rows
// can't collide.
export type GitSection =
  | { kind: 'local-changes' }
  | { kind: 'all-commits' }
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'tag'; name: string }
  | { kind: 'stash'; index: number }
  | { kind: 'submodule'; name: string }

export const sectionKey = (s: GitSection): string => {
  switch (s.kind) {
    case 'local-changes':
    case 'all-commits':
      return s.kind
    case 'branch':
    case 'remote':
    case 'tag':
    case 'submodule':
      return `${s.kind}:${s.name}`
    case 'stash':
      return `stash:${s.index}`
    default:
      return 'unknown'
  }
}
