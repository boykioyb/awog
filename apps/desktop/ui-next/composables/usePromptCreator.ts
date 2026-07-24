import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import { useSettingsStore, type CreatorAccountKind, type ProviderName } from '~/stores/settings'
import { PROVIDER_DISPLAY } from '~/composables/useSessionsData'

// Generic streaming AI-creation base — drives the chat-driven "create an entity
// by describing it" flow shared by every library feature (skills, agents,
// commands, rules, hooks). Ported from the old UI's SkillPromptCreator streaming
// logic, generalised over an `<area>.author` RPC + its three stream events.
//
// The author RPC (e.g. `skills.author`) runs a mini-chat: the model writes the
// entity file to disk via its Write tool and streams text/step deltas back. This
// composable owns the transcript, the in-flight stream buffer, and the event
// subscription; the caller (LibraryCreatorPanel) supplies the method name +
// scope and renders `messages` / `streamingText`.
//
// SoC: orchestrates IPC + transcript state only. No fs/SDK import (everything
// goes through the sidecar). Browser-dev (no bridge) surfaces a friendly error
// instead of streaming.

export type CreatorRole = 'user' | 'agent'

// One step row surfaced during a turn (tool_use / tool_result). Kept structurally
// minimal — the panel only shows a label + state, never the sidecar's full type.
export type CreatorStep = {
  id: string
  label?: string
  [key: string]: unknown
}

export type CreatorMessage = {
  role: CreatorRole
  text: string
  steps?: CreatorStep[]
}

// Config the caller binds once. `method` is the author RPC (e.g. 'skills.author');
// the three event types are derived as `<method>.chunk|step|done`.
export type PromptCreatorConfig = {
  method: string
  // `scope` is resolved server-side: 'global' or a projectId. Reactive getter so
  // the panel's scope picker can change it before each send.
  scope: () => string
  // Resolved creator account (provider-agnostic, see settings.resolveCreatorAccount).
  // Reactive getter so it tracks live account/default-provider changes. A null
  // accountId (after the lazy hydrate guard) refuses the send with wording chosen
  // from `kind`.
  account: () => { accountId: string | null; provider: ProviderName; kind: CreatorAccountKind }
  // Extra params merged into every author RPC call (e.g. a source-edit context).
  // Reactive getter so the caller can vary it per turn. Optional.
  extraParams?: () => Record<string, unknown>
}

type AuthorChunkPayload = { messageId: string; delta: string }
type AuthorStepPayload = { messageId: string; step: CreatorStep }
type AuthorDonePayload = { messageId: string; text: string }

const isChunk = (raw: unknown): raw is AuthorChunkPayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return typeof p.messageId === 'string' && typeof p.delta === 'string'
}
const isStep = (raw: unknown): raw is AuthorStepPayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return typeof p.messageId === 'string' && !!p.step && typeof p.step === 'object'
}
const isDone = (raw: unknown): raw is AuthorDonePayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return typeof p.messageId === 'string' && typeof p.text === 'string'
}

export function usePromptCreator(config: PromptCreatorConfig) {
  const sc = useSidecar()
  const settings = useSettingsStore()

  const messages = ref<CreatorMessage[]>([])
  const streamingText = ref('')
  const streamingSteps = ref<CreatorStep[]>([])
  const error = ref<string | null>(null)
  const isStreaming = ref(false)
  // Raw payload of the last `<method>.done` event — carries any author-specific
  // extras (e.g. the written source slug) the caller acts on after a turn.
  const lastDone = ref<Record<string, unknown> | null>(null)

  const currentMessageId = ref<string | null>(null)
  let unlisten: UnlistenFn | null = null

  const chunkEvent = `${config.method}.chunk`
  const stepEvent = `${config.method}.step`
  const doneEvent = `${config.method}.done`

  const canSend = computed(() => !isStreaming.value)

  const upsertStreamingStep = (step: CreatorStep): void => {
    const idx = streamingSteps.value.findIndex((s) => s.id === step.id)
    if (idx >= 0) {
      streamingSteps.value = [
        ...streamingSteps.value.slice(0, idx),
        { ...streamingSteps.value[idx], ...step },
        ...streamingSteps.value.slice(idx + 1),
      ]
    } else {
      streamingSteps.value = [...streamingSteps.value, step]
    }
  }

  const handleEvent = (evt: { type: string; payload: unknown }): void => {
    if (!currentMessageId.value) return
    if (evt.type === chunkEvent && isChunk(evt.payload)) {
      if (evt.payload.messageId !== currentMessageId.value) return
      streamingText.value += evt.payload.delta
    } else if (evt.type === stepEvent && isStep(evt.payload)) {
      if (evt.payload.messageId !== currentMessageId.value) return
      upsertStreamingStep(evt.payload.step)
    } else if (evt.type === doneEvent && isDone(evt.payload)) {
      if (evt.payload.messageId !== currentMessageId.value) return
      // Server-authoritative text overrides the accumulated stream (handles
      // runtimes that skip partial deltas for short replies).
      if (evt.payload.text) streamingText.value = evt.payload.text
      lastDone.value = evt.payload as Record<string, unknown>
    }
  }

  // Subscribe lazily on first mount so the panel can `await subscribe()`. Safe to
  // call repeatedly — only one listener is registered.
  async function subscribe(): Promise<void> {
    if (!sc.available || unlisten) return
    try {
      unlisten = await sc.onEvent(handleEvent)
    } catch {
      unlisten = null
    }
  }

  function teardown(): void {
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  }

  // Send one user turn. Pushes the user message immediately, streams the agent
  // reply, then folds the buffer into a permanent agent message. Resolves once
  // the turn completes (the panel may re-hydrate the entity list afterwards).
  async function send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || isStreaming.value) return

    // Offline stays a hard stop without touching the sidecar (AC-GUARD.3).
    if (!sc.available) {
      error.value = 'Engine offline — chat unavailable. Run the desktop app.'
      return
    }
    let { accountId, provider, kind } = config.account()
    if (!accountId) {
      // Lazy guard: boot hydrate may not have finished yet. Re-fetch (deduped) then
      // re-read the reactive resolver before deciding it's really empty (AC-GUARD.1).
      await settings.hydrateFromSidecar()
      ;({ accountId, provider, kind } = config.account())
    }
    if (!accountId) {
      error.value =
        kind === 'none'
          ? 'No account connected. Connect a provider in Settings.'
          : `No active account for ${PROVIDER_DISPLAY[provider] ?? provider}. Set one active in Settings.`
      return
    }

    error.value = null
    messages.value = [...messages.value, { role: 'user', text: trimmed }]
    streamingText.value = ''
    streamingSteps.value = []
    lastDone.value = null
    isStreaming.value = true

    const messageId = `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    currentMessageId.value = messageId

    // History sent to the model = everything EXCEPT the turn we just pushed.
    const history = messages.value.slice(0, -1).map((m) => ({ role: m.role, text: m.text }))

    try {
      await sc.request(config.method, {
        messageId,
        history,
        userText: trimmed,
        accountId,
        scope: config.scope(),
        ...(config.extraParams?.() ?? {}),
      })
      messages.value = [
        ...messages.value,
        { role: 'agent', text: streamingText.value, steps: [...streamingSteps.value] },
      ]
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      isStreaming.value = false
      currentMessageId.value = null
      streamingText.value = ''
      streamingSteps.value = []
    }
  }

  // Drop the in-flight turn marker so late events are ignored (best-effort
  // cancel — the sidecar one-shot call still runs to completion server-side).
  function abort(): void {
    currentMessageId.value = null
    isStreaming.value = false
  }

  return {
    // state
    messages,
    streamingText,
    streamingSteps,
    error,
    isStreaming,
    canSend,
    lastDone,
    // lifecycle
    subscribe,
    teardown,
    // actions
    send,
    abort,
  }
}
