<template>
  <PreviewModal window-mode @close="closeWindow" />
  <div v-if="!requested" class="pvwmiss">{{ t('common.preview.windowMissingFile') }}</div>
</template>

<script setup lang="ts">
// Preview popout window (docs/features/preview-popout-window.md) — the SPA route an
// Electron popout loads (electron/src/preview-window.ts). No app chrome: the shared
// PreviewModal fills the whole window in `window-mode` and reads the file through the
// sidecar exactly like the in-app preview, so there is ONE preview implementation.
//
// The file arrives as QUERY PARAMS, not in-memory state: a popout is a fresh renderer with
// its own stores, so root/path/name are all it can be handed — which is also why only real
// workspace files can pop out.
//
// The item is pushed into the usePreview() store (module-level refs, per renderer) rather
// than passed as the modal's `item` prop: the store is what the modal's file actions
// repoint (rename/move) and what its in-document link navigation pushes onto, so driving
// the popout through it makes every one of those work here too.
import { computed, onMounted, watch } from 'vue'
import PreviewModal from '~/components/common/PreviewModal.vue'
import { previewKindFromPath, usePreview, type PreviewRef } from '~/composables/usePreview'

definePageMeta({ layout: false, keepalive: false })
defineOptions({ name: 'PreviewWindowPage' })

const { t } = useI18n()
const route = useRoute()
const sc = useSidecar()
const preview = usePreview()

// Query values are single strings here; an array (?root=a&root=b) is treated as absent.
const param = (key: string): string => {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}

const requested = computed<PreviewRef | null>(() => {
  const workspaceRoot = param('root')
  const path = param('path')
  if (!workspaceRoot || !path) return null
  const name = param('name') || path.split('/').pop() || path
  return { name, kind: previewKindFromPath(name), workspaceRoot, path }
})

// Open on mount, and again if the URL is ever re-pointed at another file (main reuses one
// window per file, so this is a safety net rather than a normal flow).
const openRequested = () => {
  if (requested.value) preview.open(requested.value)
}
onMounted(openRequested)
watch(requested, openRequested)

// Native window title = the file being shown (it follows a rename or a link the user
// navigated into), so several popouts are tellable apart in the window list.
useHead({
  title: computed(() => (preview.current.value ? `${preview.current.value.name} — AWOG` : 'AWOG')),
})

// The modal's ✕ / Esc close the OS window — there is no app behind it to return to.
const closeWindow = () => void sc.closeSelf()
</script>

<style scoped>
/* Only reachable when the window was opened without a file (a malformed URL). */
.pvwmiss {
  display: grid;
  place-items: center;
  height: 100vh;
  color: var(--textFaint);
}
</style>
