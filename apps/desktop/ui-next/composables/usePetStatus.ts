import { computed, onScopeDispose, watch } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import { useSettingsStore } from '~/stores/settings'
import type { AssistantBlock, SessionMessage } from '~/composables/useSessionsData'
import type { AwogPetCommand, AwogPetItem, AwogPetStatus } from '~/types/awog-bridge'
import { bucketOfState, effectiveQuipLines } from '~/utils/pet-quips'

// ── Desktop pet: the MAIN WINDOW half (docs/features/desktop-pet.md) ─────────
// The pet is a passive renderer in its own transparent always-on-top window. This
// composable is what makes it useful: it owns the prefs push (main creates/destroys
// the window from them), computes the status model, and executes the commands the
// pet sends back.
//
// Why the model is computed HERE and not in the pet: `streaming` status and the
// parked permission are live main-window state that never reaches a snapshot RPC,
// and putting the pet on the engine event stream would make it a second driver of
// the same turn (the bug ipc.ts calls out for the tray popover). Call once globally
// (in the layout). No-op when the bridge is absent (browser dev / older shell).

// Keep the HUD to three rows — it is a glance surface, not a list.
const MAX_ITEMS = 3
const TITLE_MAX = 48
// This window floats above every app, including whatever the user is screen-sharing.
// Long targets are truncated to a hint, never the full command.
const TARGET_MAX = 64

// One line, no markdown noise — the HUD row is ~40 characters wide.
const PREVIEW_MAX = 70

const trim = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const oneLine = (text: string, max: number): string =>
  trim(
    text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    max,
  )

// What the session is saying/doing RIGHT NOW: walk back from the newest message
// and take the first thing with content — the live text, else the running tool
// step, else the thinking. Falls back to the user's own last prompt when the turn
// has only just started and the assistant bubble is still empty.
function previewOf(session: { msgs: SessionMessage[] }): string | undefined {
  for (let i = session.msgs.length - 1; i >= 0; i--) {
    const message = session.msgs[i]
    if (!message) continue
    if (message.role !== 'assistant') {
      const text = oneLine(message.text ?? '', PREVIEW_MAX)
      if (text) return text
      continue
    }
    for (let j = message.blocks.length - 1; j >= 0; j--) {
      const block = message.blocks[j]
      if (!block) continue
      if (block.kind === 'text' || block.kind === 'thinking') {
        const text = oneLine(block.text, PREVIEW_MAX)
        if (text) return text
      }
      if (block.kind === 'step') {
        return oneLine(`${block.tool} ${block.target}`.trim(), PREVIEW_MAX)
      }
    }
  }
  return undefined
}

// TEMP DIAGNOSTIC (remove once the "An object could not be cloned" report is closed):
// Electron's console-message carries no stack, so an IPC clone failure is reported
// with an empty source and a meaningless line number. Naming the call site and
// dumping the payload turns that into an actionable log line. Re-throws — this
// observes, it does not swallow.
function traceSend(label: string, payload: unknown, send: () => void): void {
  try {
    send()
  } catch (err) {
    console.error(
      `[pet] IPC ${label} failed:`,
      err instanceof Error ? err.message : String(err),
      'payload=',
      (() => {
        try {
          return JSON.stringify(payload)
        } catch {
          return '<unstringifiable>'
        }
      })(),
      (err as Error)?.stack ?? '',
    )
    throw err
  }
}

export function usePetStatus() {
  const bridge = typeof window !== 'undefined' ? window.awog : undefined
  if (!bridge?.sendPetPrefs || !bridge.sendPetUpdate) return // no pet in this shell

  const { t } = useI18n()
  const sessions = useSessionsStore()
  const tasks = useTasksStore()
  const settings = useSettingsStore()
  const { running, attention, unread } = useStatusCounts()
  const { openTarget } = useStatusRouting()

  // Prefs → main. The store stays the single source of truth: main only ever
  // reacts (create / resize / move / destroy), never flips the pref itself.
  const stopPrefs = watch(
    () => ({
      enabled: settings.pet.enabled,
      scale: settings.pet.scale,
      pos: settings.pet.pos,
    }),
    // Explicit primitive pick rather than passing the watched object through: every
    // value that goes over IPC must be plainly cloneable, and a spread of whatever
    // the store happens to hold is not a guarantee of that.
    (prefs) => {
      const payload = {
        enabled: !!prefs.enabled,
        scale: Number(prefs.scale),
        pos: prefs.pos ? { x: Number(prefs.pos.x), y: Number(prefs.pos.y) } : null,
      }
      traceSend('sendPetPrefs', payload, () => bridge.sendPetPrefs?.(payload))
    },
    { immediate: true, deep: true },
  )

  // At most three, ordered the way a human triages: what needs me → what is
  // running → what finished and I haven't read.
  const items = computed<AwogPetItem[]>(() => {
    const out: AwogPetItem[] = []
    const pushSessions = (
      match: (s: (typeof sessions.sessions)[number]) => boolean,
      hint: AwogPetItem['hint'],
    ): void => {
      for (const s of sessions.sessions) {
        if (out.length >= MAX_ITEMS) return
        // No engineId = a never-hydrated row; clicking it could not resolve.
        if (!s.engineId || !match(s)) continue
        out.push({
          kind: 'session',
          id: s.engineId,
          title: trim(s.title, TITLE_MAX),
          hint,
          preview: previewOf(s),
        })
      }
    }

    pushSessions((s) => s.status === 'awaiting', 'awaiting')
    for (const task of tasks.awaitingTasks) {
      if (out.length >= MAX_ITEMS) break
      out.push({ kind: 'task', id: task.id, title: trim(task.title, TITLE_MAX), hint: 'awaiting' })
    }
    pushSessions((s) => s.status === 'streaming', 'running')
    for (const task of tasks.runningTasks) {
      if (out.length >= MAX_ITEMS) break
      const progress = tasks.progressOf(task)
      out.push({
        kind: 'task',
        id: task.id,
        title: trim(task.title, TITLE_MAX),
        hint: 'running',
        percent: progress.pct,
        preview: progress.currentSkill ? oneLine(progress.currentSkill, PREVIEW_MAX) : undefined,
      })
    }
    pushSessions((s) => !!s.unread, 'unread')
    return out
  })

  const model = computed<AwogPetStatus>(() => {
    const pending = sessions.pendingPermission
    // 'offline' is main's to set (it knows when this window is gone).
    const state: AwogPetStatus['state'] =
      attention.value > 0
        ? 'awaiting'
        : running.value > 0
          ? 'working'
          : unread.value > 0
            ? 'done'
            : 'idle'
    return {
      state,
      counts: { running: running.value, attention: attention.value, unread: unread.value },
      items: items.value,
      permission: pending
        ? {
            requestId: pending.requestId,
            toolName: pending.toolName,
            target: trim(pending.target, TARGET_MAX),
          }
        : null,
      autoPeek: settings.pet.autoPeek,
      quips: settings.pet.quips,
      // Resolved HERE, not in the pet: the lines are settings data, and the pet is a
      // passive renderer that owns no store. Only the current state's bucket travels.
      quipLines: effectiveQuipLines(t, settings.pet.quipLines, bucketOfState(state)),
      reminders: effectiveQuipLines(t, settings.pet.quipLines, 'reminder'),
      reminderMs: Math.max(0, settings.pet.reminderMinutes) * 60_000,
      sprite: settings.pet.sprite,
      scale: settings.pet.scale,
    }
  })

  let pushTimer: ReturnType<typeof setTimeout> | null = null
  // `enabled` is part of the source, not just a guard inside: turning the pet ON has
  // to push the CURRENT state. Watching the model alone would leave a freshly-opened
  // pet showing main's cached placeholder until something else happened to change.
  const stopModel = watch(
    [model, () => settings.pet.enabled],
    ([m]) => {
      if (!settings.pet.enabled) return
      if (pushTimer) clearTimeout(pushTimer)
      // Same debounce as the tray: a running turn churns the store constantly and
      // the pet only needs to look right, not to be frame-accurate.
      // Field-by-field copy, not the reactive proxy: structured-clone chokes on Vue
      // proxies, and an explicit pick is also what keeps stray store fields from
      // riding along to a window that floats over every app.
      pushTimer = setTimeout(() => {
        const payload = {
          state: m.state,
          counts: { ...m.counts },
          items: m.items.map((it) => ({ ...it })),
          permission: m.permission ? { ...m.permission } : null,
          autoPeek: m.autoPeek,
          quips: m.quips,
          quipLines: [...m.quipLines],
          reminders: [...m.reminders],
          reminderMs: m.reminderMs,
          sprite: m.sprite,
          scale: m.scale,
        }
        traceSend('sendPetUpdate', payload, () => bridge.sendPetUpdate?.(payload))
      }, 300)
    },
    { immediate: true },
  )

  // Resolve a permission the user approved from the pet. The pet only carries the
  // requestId, so everything else is re-derived here — and a request that has since
  // been replaced or resolved is dropped rather than answered blind (the user would
  // be approving something they never saw).
  function resolvePermission(requestId: string, decision: 'allow' | 'deny'): void {
    const pending = sessions.pendingPermission
    if (!pending || pending.requestId !== requestId) return
    const session = sessions.sessions.find((s) => s.id === pending.sessionId)
    // Locate the transcript card so it flips to allowed/denied like an in-app click.
    // -1 is safe: setPermission still resolves the request, it just skips the flip.
    const msgIndex =
      session?.msgs.findIndex(
        (m) =>
          m.role === 'assistant' &&
          (m.blocks as AssistantBlock[]).some((b) => b.kind === 'perm' && b.eid === requestId),
      ) ?? -1
    sessions.setPermission(pending.sessionId, msgIndex, decision)
  }

  const offCommand = bridge.onPetCommand?.((cmd: AwogPetCommand) => {
    if (cmd.kind === 'toggle') {
      settings.updatePet({ enabled: !settings.pet.enabled })
      return
    }
    if (cmd.kind === 'open') {
      openTarget(cmd.target)
      return
    }
    resolvePermission(cmd.requestId, cmd.decision)
  })

  // Main reports where the pet came to rest after a drag; the position belongs to
  // the prefs blob, so it round-trips through the store like every other setting.
  //
  // Rebuilt field-by-field, NOT stored as delivered: this object crossed the
  // contextBridge, and what lands here is not a plain renderer object. Keeping it
  // would poison the store — the very next prefs push sends it BACK over IPC and
  // structured-clone throws "An object could not be cloned". Normalising at the
  // boundary is also just the IPC rule (payloads are untrusted input).
  const offMoved = bridge.onPetMoved?.((pos) => {
    // TEMP DIAGNOSTIC: prove what actually arrives here (plain object? proxy?).
    console.warn('[pet] pet:moved received', typeof pos, Object.prototype.toString.call(pos), {
      x: pos?.x,
      y: pos?.y,
    })
    settings.updatePet({ pos: { x: Number(pos?.x) || 0, y: Number(pos?.y) || 0 } })
  })

  onScopeDispose(() => {
    if (pushTimer) clearTimeout(pushTimer)
    stopPrefs()
    stopModel()
    offCommand?.()
    offMoved?.()
  })
}
