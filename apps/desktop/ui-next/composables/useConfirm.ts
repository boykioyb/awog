import { reactive } from 'vue'

// App-wide imperative confirm dialog (mirrors usePreview's singleton pattern). A
// single ConfirmDialogHost mounted in the layout reads this state, so ANY call
// site can gate a destructive action with `if (await confirm({…})) doIt()` —
// without prop-drilling a modal or wiring local pending state per component.
//
// Module-level singleton → one source of truth for every caller. Opening a second
// confirm while one is pending cancels the first (resolves it false).

export type ConfirmKind = 'danger' | 'primary'

export type ConfirmOptions = {
  title: string
  description: string
  // Confirm/cancel button labels; default to common.delete|confirm / common.cancel
  // (resolved inside the dialog) when omitted.
  confirmLabel?: string
  cancelLabel?: string
  // 'danger' (default) → red confirm button; 'primary' → accent confirm button.
  kind?: ConfirmKind
}

type ConfirmState = Required<ConfirmOptions> & { open: boolean }

const state = reactive<ConfirmState>({
  open: false,
  title: '',
  description: '',
  confirmLabel: '',
  cancelLabel: '',
  kind: 'danger',
})

let resolver: ((ok: boolean) => void) | null = null

export function useConfirm() {
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    // A pending confirm is implicitly cancelled when a new one opens.
    if (resolver) {
      resolver(false)
      resolver = null
    }
    state.title = opts.title
    state.description = opts.description
    state.confirmLabel = opts.confirmLabel ?? ''
    state.cancelLabel = opts.cancelLabel ?? ''
    state.kind = opts.kind ?? 'danger'
    state.open = true
    return new Promise<boolean>((res) => {
      resolver = res
    })
  }

  // Called by the host on confirm/cancel (or Esc). Closes the dialog and settles
  // the outstanding promise exactly once.
  function settle(ok: boolean) {
    if (!state.open) return
    state.open = false
    const r = resolver
    resolver = null
    r?.(ok)
  }

  return { state, confirm, settle }
}
