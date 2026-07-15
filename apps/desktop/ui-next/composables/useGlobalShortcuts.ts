import { onBeforeUnmount, onMounted } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useCommandPalette } from '~/composables/useCommandPalette'
import { useGitModal } from '~/composables/useGitModal'
import { usePrSummaryModal } from '~/composables/usePrSummaryModal'
import { useGlobalTerminal } from '~/composables/useGlobalTerminal'
import { useKeymap, type KeymapActionId } from '~/composables/useKeymap'
import { useWorkspacePanel } from '~/composables/useWorkspacePanel'

// App-lifetime global keyboard shortcuts (§9 globals). Mounted once via the
// default layout. The bindings are user-editable (Settings → Keymap) and live in
// useKeymap; this composable only owns the window listener + the dispatch table:
//
//   commandPalette → toggle the ⌘K palette
//   toggleTerminal → toggle the app-wide terminal dock
//   openGit        → open the Git Manager modal (scoped to the active session's
//                    project when there is one; else GitManager's own default)
//   openPrSummary  → open the PR summary modal directly (scoped to the active
//                    session's project; head = that repo's current branch)
//   newSession     → new session + jump to Sessions
//   toggleFiles    → toggle the session Files workspace view (no-op unless a
//                    session is active)
//
// Esc handling stays in the layout (it also closes the palette / responsive
// drawers). Matching is done by useKeymap against event.code, so it is layout-
// independent and only fires the platform-appropriate modifier by default.
export function useGlobalShortcuts(): void {
  const sessions = useSessionsStore()
  const palette = useCommandPalette()
  const terminal = useGlobalTerminal()
  const gitModal = useGitModal()
  const prSummary = usePrSummaryModal()
  const workspace = useWorkspacePanel()
  const keymap = useKeymap()

  const dispatch: Record<KeymapActionId, () => void> = {
    commandPalette: () => palette.toggle(),
    toggleTerminal: () => terminal.toggle(),
    openGit: () => gitModal.open(sessions.active?.project || null),
    // Open the PR summary for the active session's project — head defaults to that
    // repo's current branch (resolved in the host). No need to open Git Manager.
    openPrSummary: () => prSummary.open(sessions.active?.project || null),
    newSession: () => {
      // Scope the new session to the current project — the active Sessions tab,
      // exactly like the "+" buttons on the Sessions page. activeTab stays synced
      // with the active session's project, so this also covers "I'm inside a
      // project's session"; empty tab ('' = All) falls back to a global session.
      sessions.create(sessions.activeTab || undefined)
      void navigateTo('/sessions')
    },
    toggleFiles: () => workspace.toggleView('Files'),
  }

  function onKeydown(e: KeyboardEvent): void {
    const action = keymap.matchEvent(e)
    if (!action) return
    e.preventDefault()
    dispatch[action]()
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
