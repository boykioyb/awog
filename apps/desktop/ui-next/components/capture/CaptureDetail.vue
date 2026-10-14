<template>
  <div class="cap-detail">
    <div v-if="!cap.selectedSummary.value" class="cap-empty">{{ t('capture.detail.select') }}</div>
    <div v-else-if="!entry" class="cap-empty">{{ t('capture.detail.loading') }}</div>
    <template v-else>
      <div class="cap-dhead">
        <span class="cap-meth">{{ entry.method }}</span>
        <span class="cap-cut cap-code" :title="entry.url">{{ entry.url }}</span>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('capture.detail.close')"
          :aria-label="t('capture.detail.close')"
          @click="cap.select(null)"
        >
          <Icon name="x" />
        </Button>
      </div>
      <div class="cap-actions" aria-live="polite">
        <Button
          v-for="a in ACTIONS"
          :key="a.kind"
          variant="outline"
          size="xs"
          class="gap-1.5 [&_svg]:size-3"
          :class="copiedKey === a.kind && 'text-success'"
          :title="labelFor(a.kind, t(`capture.action.${a.kind}Hint`))"
          @click="copy(a.kind, cap.entryText(a.kind, entry))"
        >
          <Icon :name="iconFor(a.kind)" />
          {{ t(`capture.action.${a.kind}`) }}
        </Button>
        <Button
          variant="outline"
          size="xs"
          class="cap-on gap-1.5 [&_svg]:size-3"
          :title="t('capture.action.repeaterHint')"
          @click="cap.sendToRepeater(entry)"
        >
          <Icon name="send" />
          {{ t('capture.action.repeater') }}
        </Button>
      </div>

      <Tabs v-model="active">
        <TabsList
          class="h-auto min-h-8 w-full flex-wrap justify-start gap-0 rounded-none border-b border-border bg-transparent p-0 px-2"
        >
          <TabsTrigger
            v-for="tb in tabs"
            :key="tb"
            :value="tb"
            class="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-2.5 text-xs text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {{ t(`capture.tab.${tb}`) }}
            <Badge v-if="tb === 'jwt'" variant="secondary" class="tnum px-1.5 py-0">
              {{ jwtCount }}
            </Badge>
            <Badge v-else-if="tb === 'ws'" variant="secondary" class="tnum px-1.5 py-0">
              {{ entry.wsFrames?.length ?? 0 }}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div class="cap-tabbody">
        <CaptureHeadersTab v-if="active === 'headers'" :entry="entry" />
        <CapturePayloadTab v-else-if="active === 'payload'" :entry="entry" />
        <CaptureResponseTab v-else-if="active === 'response'" :entry="entry" />
        <CaptureCookiesTab v-else-if="active === 'cookies'" :entry="entry" />
        <CaptureTimingTab v-else-if="active === 'timing'" :entry="entry" />
        <CaptureSecurityTab v-else-if="active === 'security'" :entry="entry" />
        <CaptureInitiatorTab v-else-if="active === 'initiator'" :entry="entry" />
        <CaptureWsTab v-else-if="active === 'ws'" :entry="entry" />
        <CaptureJwtTab v-else-if="active === 'jwt'" :entry="entry" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useNetworkCaptureContext, type CopyKind } from '~/composables/useNetworkCapture'
import { jwtsInEntry } from '~/utils/capture-jwt-scan'
import CaptureCookiesTab from './CaptureCookiesTab.vue'
import CaptureHeadersTab from './CaptureHeadersTab.vue'
import CaptureInitiatorTab from './CaptureInitiatorTab.vue'
import CaptureJwtTab from './CaptureJwtTab.vue'
import CapturePayloadTab from './CapturePayloadTab.vue'
import CaptureResponseTab from './CaptureResponseTab.vue'
import CaptureSecurityTab from './CaptureSecurityTab.vue'
import CaptureTimingTab from './CaptureTimingTab.vue'
import CaptureWsTab from './CaptureWsTab.vue'

type TabId =
  | 'headers'
  | 'payload'
  | 'response'
  | 'cookies'
  | 'timing'
  | 'security'
  | 'initiator'
  | 'ws'
  | 'jwt'

const ACTIONS: { kind: CopyKind }[] = [
  { kind: 'url' },
  { kind: 'curl' },
  { kind: 'curlCmd' },
  { kind: 'fetch' },
  { kind: 'rawRequest' },
  { kind: 'rawResponse' },
]

const { t } = useI18n()
const cap = useNetworkCaptureContext()
const { copy, iconFor, labelFor, copiedKey } = useCopyFeedback()
const entry = computed(() => cap.selectedEntry.value)

const jwtCount = computed(() => (entry.value ? jwtsInEntry(entry.value).length : 0))
const isWs = computed(
  () => entry.value?.resourceType === 'WebSocket' || (entry.value?.wsFrames?.length ?? 0) > 0,
)

const tabs = computed<TabId[]>(() => {
  const out: TabId[] = [
    'headers',
    'payload',
    'response',
    'cookies',
    'timing',
    'security',
    'initiator',
  ]
  if (isWs.value) out.push('ws')
  if (jwtCount.value > 0) out.push('jwt')
  return out
})

const active = ref<TabId>('headers')
// Tab đang mở biến mất ở entry mới (WS/JWT chỉ có khi entry đó có) → về Headers.
watch(tabs, (list) => {
  if (!list.includes(active.value)) active.value = 'headers'
})
</script>
