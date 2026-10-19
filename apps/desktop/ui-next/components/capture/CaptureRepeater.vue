<template>
  <div class="grid min-h-0 flex-auto grid-cols-2">
    <div class="flex min-h-0 min-w-0 flex-col overflow-auto">
      <div :class="CAP_BAR">
        <span class="text-dim">{{ t('capture.repeater.request') }}</span>
        <span class="flex-auto" />
        <label
          class="inline-flex cursor-pointer items-center gap-1.5 text-dim"
          :title="t('capture.repeater.followHint')"
        >
          <Switch v-model:checked="cap.repeaterFollow.value" />
          <span>{{ t('capture.repeater.follow') }}</span>
        </label>
        <Button
          size="sm"
          :disabled="cap.repeaterSending.value || !cap.repeaterDraft.value.trim()"
          :title="t('capture.repeater.sendHint')"
          @click="cap.sendRepeater()"
        >
          <Icon
            :name="cap.repeaterSending.value ? 'refresh' : 'send'"
            :class="cap.repeaterSending.value && 'animate-spin'"
          />
          {{
            cap.repeaterSending.value ? t('capture.repeater.sending') : t('capture.repeater.send')
          }}
        </Button>
      </div>
      <Textarea
        v-model="cap.repeaterDraft.value"
        class="mx-2 min-h-55 w-auto flex-none resize-y overflow-auto font-mono text-sm whitespace-pre"
        spellcheck="false"
        :placeholder="t('capture.repeater.placeholder')"
        @keydown.meta.enter.prevent="cap.sendRepeater()"
        @keydown.ctrl.enter.prevent="cap.sendRepeater()"
      />
      <div :class="CAP_NOTE">{{ t('capture.repeater.note') }}</div>

      <div :class="CAP_BAR">
        <span class="text-dim">
          {{ t('capture.repeater.history', { n: cap.repeaterHistory.value.length }) }}
        </span>
      </div>
      <div class="flex flex-col">
        <!-- Cả dòng là một vùng bấm; đang xem = accent-tint + thanh accent 2px. -->
        <Button
          v-for="h in cap.repeaterHistory.value"
          :key="h.n"
          variant="ghost"
          class="grid h-auto grid-cols-[auto_auto_1fr_auto] justify-normal gap-2 rounded-none px-2 py-1 text-left font-normal text-foreground"
          :class="toRaw(h.result) === toRaw(result) && CAP_ROW_SEL"
          @click="cap.loadHistory(h)"
        >
          <Badge variant="outline" class="min-w-13 justify-center">{{ h.method }}</Badge>
          <Badge
            :variant="h.result.ok ? statusVariant(h.result.status) : 'destructive'"
            class="tnum"
          >
            {{ h.result.ok ? h.result.status : t('capture.status.failed') }}
          </Badge>
          <span class="min-w-0 truncate font-mono" :title="h.url">{{ h.url }}</span>
          <span class="tnum text-dim">
            {{ h.result.ok ? `${Math.round(h.result.timeMs)} ms` : '' }}
          </span>
        </Button>
      </div>
    </div>

    <div
      class="flex min-h-0 min-w-0 flex-col overflow-auto shadow-[inset_1px_0_0_var(--color-border)]"
    >
      <div :class="CAP_BAR">
        <span class="text-dim">{{ t('capture.repeater.response') }}</span>
        <template v-if="result && result.ok">
          <Badge :variant="statusVariant(result.status)" class="tnum">
            {{ result.status }} {{ result.statusText }}
          </Badge>
          <span class="tnum text-dim">{{ Math.round(result.timeMs) }} ms</span>
        </template>
      </div>
      <div v-if="!result" :class="CAP_EMPTY">{{ t('capture.repeater.empty') }}</div>
      <div v-else-if="!result.ok" :class="CAP_NOTE_BAD">{{ result.error }}</div>
      <div v-else :class="CAP_TAB">
        <section :class="CAP_SEC">
          <h4 :class="CAP_SEC_TITLE">
            {{ t('capture.headers.response', { n: result.headers.length }) }}
            <Button
              variant="ghost"
              size="iconSm"
              :title="copy.labelFor('rep-headers', t('capture.headers.copy'))"
              :aria-label="copy.labelFor('rep-headers', t('capture.headers.copy'))"
              @click="copy.copy('rep-headers', headersText)"
            >
              <Icon
                :name="copy.iconFor('rep-headers')"
                :class="copy.copiedKey.value === 'rep-headers' && 'text-success'"
              />
            </Button>
            <span class="sr-only" aria-live="polite">
              {{ copy.copiedKey.value === 'rep-headers' ? t('capture.toast.copied') : '' }}
            </span>
          </h4>
          <Table :class="CAP_KV">
            <TableBody>
              <TableRow v-for="(h, i) in result.headers" :key="i">
                <TableHead class="font-mono">{{ h[0] }}</TableHead>
                <TableCell class="font-mono whitespace-pre-wrap wrap-anywhere">
                  {{ h[1] }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>
        <section :class="CAP_SEC">
          <h4 :class="CAP_SEC_TITLE">{{ t('capture.tab.response') }}</h4>
          <CaptureBodyView :body="result.body" :mime-type="resultMime" />
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRaw } from 'vue'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import Switch from '~/components/ui/switch/Switch.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'
import { useNetworkCaptureContext } from '~/composables/useNetworkCapture'
import CaptureBodyView from './CaptureBodyView.vue'
import {
  CAP_BAR,
  CAP_EMPTY,
  CAP_KV,
  CAP_NOTE,
  CAP_NOTE_BAD,
  CAP_ROW_SEL,
  CAP_SEC,
  CAP_SEC_TITLE,
  CAP_TAB,
} from './capture-ui'

const { t } = useI18n()
const cap = useNetworkCaptureContext()
const copy = useCopyFeedback()
const result = computed(() => cap.repeaterResult.value)

const resultMime = computed(() => {
  const r = result.value
  if (!r || !r.ok) return ''
  return r.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
})

const headersText = computed(() => {
  const r = result.value
  return r && r.ok ? r.headers.map(([k, v]) => `${k}: ${v}`).join('\n') : ''
})

const statusVariant = (status: number) =>
  status >= 500 ? 'destructive' : status >= 400 ? 'warning' : status >= 300 ? 'info' : 'success'
</script>
