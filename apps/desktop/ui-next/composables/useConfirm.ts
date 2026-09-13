import { reactive } from 'vue'

// App-wide imperative confirm dialog (mirrors usePreview's singleton pattern). A
// single ConfirmDialogHost mounted in the layout reads this state, so ANY call
// site can gate a destructive action with `if (await confirm({…})) doIt()` —
// without prop-drilling a modal or wiring local pending state per component.
//
// Module-level singleton → one source of truth for every caller. Opening a second
// confirm while one is pending cancels the first (resolves it false).
//
// TWO SHAPES, ONE PROMISE. `confirm()` takes a discriminated union:
//   • the plain confirm (title + description + labels) — unchanged, every existing
//     call site keeps working verbatim;
//   • `kind: 'infra'` — the shared infrastructure confirmation of ADR 0088 §5 /
//     infra-explorer "Hành động ghi: luật chung": consequence in plain language
//     FIRST, context chips second, the full command tucked into a collapsed
//     "technical details" block, and a footer that changes with the command class.
// Both resolve `Promise<boolean>`, so an infra caller reads exactly like any other
// guard: `if (!(await confirm({ kind: 'infra', … }))) return`.

export type ConfirmKind = 'danger' | 'primary'

export type BasicConfirmOptions = {
  title: string
  description: string
  // Confirm/cancel button labels; default to common.delete|confirm / common.cancel
  // (resolved inside the dialog) when omitted.
  confirmLabel?: string
  cancelLabel?: string
  // 'danger' (default) → red confirm button; 'primary' → accent confirm button.
  kind?: ConfirmKind
}

// Command class of ADR 0088 §5. It is an AXIS, not a verdict: the permission
// matrix decides whether we even get here, this only picks the dialog's footer.
export type InfraActionClass = 'read' | 'write' | 'destructive'

// An account/cluster flagged as production gets a red chip + a red card border.
export type InfraAccountKind = 'normal' | 'production'

// Pinned context, rendered as chips. Every field optional because the three tools
// name different things: aws → profile/accountId/region, kubectl → cluster/namespace.
export type InfraConfirmContext = {
  profile?: string
  accountId?: string
  region?: string
  cluster?: string
  namespace?: string
}

export type InfraConfirmOptions = {
  kind: 'infra'
  // Title = action + target ("Terminate instance" + "web-prod-1").
  action: string
  target: string
  // ONE sentence, plain language, about what happens — never the command line.
  consequence: string
  // The full command, shown inside the collapsed "technical details" block.
  command: string
  context: InfraConfirmContext
  accountKind: InfraAccountKind
  class: InfraActionClass
  // The matrix said "Chặn": no run button at all, only copy-the-command + close.
  blocked?: boolean
  // Word the user must retype before a destructive action unlocks. Omitted ⇒ the
  // host falls back to `target`, so a destructive action is never ungated.
  typeToConfirm?: string
}

export type ConfirmOptions = BasicConfirmOptions | InfraConfirmOptions

type ConfirmState = Required<BasicConfirmOptions> & {
  open: boolean
  // null ⇒ plain confirm; set ⇒ the host renders the infra card instead.
  infra: InfraConfirmOptions | null
}

const state = reactive<ConfirmState>({
  open: false,
  title: '',
  description: '',
  confirmLabel: '',
  cancelLabel: '',
  kind: 'danger',
  infra: null,
})

let resolver: ((ok: boolean) => void) | null = null

export function useConfirm() {
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    // A pending confirm is implicitly cancelled when a new one opens.
    if (resolver) {
      resolver(false)
      resolver = null
    }
    if (opts.kind === 'infra') {
      // Copy the payload (callers build it from live store state; the dialog must
      // show what was true at the moment it was asked).
      state.infra = { ...opts, context: { ...opts.context } }
      // The plain-confirm fields stay empty: the host composes title/labels from
      // the payload so every infra surface words the dialog identically.
      state.title = ''
      state.description = ''
      state.confirmLabel = ''
      state.cancelLabel = ''
      state.kind = opts.class === 'destructive' ? 'danger' : 'primary'
    } else {
      state.infra = null
      state.title = opts.title
      state.description = opts.description
      state.confirmLabel = opts.confirmLabel ?? ''
      state.cancelLabel = opts.cancelLabel ?? ''
      state.kind = opts.kind ?? 'danger'
    }
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
    state.infra = null
    const r = resolver
    resolver = null
    r?.(ok)
  }

  return { state, confirm, settle }
}
