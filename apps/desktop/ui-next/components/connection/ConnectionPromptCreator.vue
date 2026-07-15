<template>
  <LibraryCreatorPanel
    :open="open"
    method="source.author"
    :account-id="accountId"
    :title="isEdit ? t('connections.creator.editTitle') : t('connections.creator.title')"
    :subtitle="isEdit ? t('connections.creator.editSubtitle') : t('connections.creator.subtitle')"
    :hint="isEdit ? t('connections.creator.editHint') : t('connections.creator.hint')"
    :placeholder="
      isEdit ? t('connections.creator.editPlaceholder') : t('connections.creator.placeholder')
    "
    :iterate-placeholder="t('connections.creator.iterate')"
    :extra-params="extraParams"
    @close="onClose"
    @turn="onTurn"
  >
    <!-- Secure secret-entry step: shown after the model writes a config that
         references credentials as `secret:<KEY>` — the value goes to the OS
         keychain, never through the chat. -->
    <template #below-log>
      <ConnectionSecretPanel
        v-if="pendingSecrets.length"
        :secrets="pendingSecrets"
        :saving="savingSecrets"
        @save="onSaveSecrets"
        @skip="clearSecrets"
      />
    </template>
  </LibraryCreatorPanel>
</template>

<script setup lang="ts">
// Source creation panel — thin wrapper over the generic LibraryCreatorPanel,
// configured for the `source.author` streaming RPC (ADR 0060 P1). The model writes
// a sources/<slug>/config.json + guide.md via the Write tool.
//
// Two source-specific additions on top of the generic panel:
//   1. EDIT MODE (`editSource`) — passes the current config as an `editConfig`
//      extra param so the model refines that slug in place instead of creating one.
//   2. SECRET STEP — after a turn writes a config, we fetch its pending
//      `secret:<KEY>` refs and (if any) show a masked panel that persists each value
//      to the OS keychain via source.setSecret, then re-tests. No token ever enters
//      the chat transcript or config.json.
import { computed, ref, watch } from 'vue'
import LibraryCreatorPanel from '~/components/library/LibraryCreatorPanel.vue'
import ConnectionSecretPanel from '~/components/connection/ConnectionSecretPanel.vue'
import { useConnectionsStore, type Source, type SourcePendingSecret } from '~/stores/connections'

const props = defineProps<{
  open: boolean
  accountId: string | null
  // When set, the creator refines this existing source in place (edit mode).
  editSource?: Source | null
}>()

const emit = defineEmits<{ close: []; turn: [] }>()

const { t } = useI18n()
const store = useConnectionsStore()

const isEdit = computed(() => !!props.editSource)

// Edit mode threads the current config to the author RPC so the model updates the
// same slug. Blank object for a fresh create (no effect on the RPC).
const extraParams = computed<Record<string, unknown>>(() =>
  props.editSource ? { editConfig: JSON.stringify(props.editSource, null, 2) } : {},
)

// --- secret step ----------------------------------------------------------
const pendingSlug = ref<string | null>(null)
const pendingSecrets = ref<SourcePendingSecret[]>([])
const savingSecrets = ref(false)

const clearSecrets = () => {
  pendingSlug.value = null
  pendingSecrets.value = []
}

// After each turn, the done payload carries the slug the model wrote (null if it
// only asked a question). Fetch the secrets that source still needs a value for.
const onTurn = async (meta?: Record<string, unknown> | null) => {
  emit('turn')
  const slug = typeof meta?.slug === 'string' ? meta.slug : null
  if (!slug) return
  try {
    const secrets = await store.fetchPendingSecrets(slug)
    pendingSlug.value = slug
    pendingSecrets.value = secrets
  } catch (err) {
    console.warn('[connections] fetchPendingSecrets failed', err)
    clearSecrets()
  }
}

const onSaveSecrets = async (values: Record<string, string>) => {
  const slug = pendingSlug.value
  if (!slug || savingSecrets.value) return
  const source = store.sourceBySlug(slug)
  if (!source) {
    clearSecrets()
    return
  }
  savingSecrets.value = true
  try {
    for (const [key, value] of Object.entries(values)) {
      await store.setSecret(source.id, key, value)
    }
    // Re-test now that the keychain has the token, so status/enabled refresh.
    await store.testSource(slug)
    emit('turn')
    clearSecrets()
  } catch (err) {
    console.warn('[connections] setSecret failed', err)
  } finally {
    savingSecrets.value = false
  }
}

const onClose = () => {
  clearSecrets()
  emit('close')
}

// Reset the secret step whenever the panel opens (a stale one must not leak into
// a fresh session).
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) clearSecrets()
  },
)
</script>
