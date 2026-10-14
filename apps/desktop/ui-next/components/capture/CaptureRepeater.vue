<template>
  <div class="cap-repeater">
    <div class="cap-rep-col">
      <div class="cap-bar">
        <span class="cap-dim">{{ t('capture.repeater.request') }}</span>
        <span class="cap-grow" />
        <label class="rep-follow" :title="t('capture.repeater.followHint')">
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
            :class="{ 'rep-spin': cap.repeaterSending.value }"
          />
          {{
            cap.repeaterSending.value ? t('capture.repeater.sending') : t('capture.repeater.send')
          }}
        </Button>
      </div>
      <Textarea
        v-model="cap.repeaterDraft.value"
        class="rep-editor cap-code"
        spellcheck="false"
        :placeholder="t('capture.repeater.placeholder')"
        @keydown.meta.enter.prevent="cap.sendRepeater()"
        @keydown.ctrl.enter.prevent="cap.sendRepeater()"
      />
      <div class="cap-note">{{ t('capture.repeater.note') }}</div>

      <div class="cap-bar">
        <span class="cap-dim">
          {{ t('capture.repeater.history', { n: cap.repeaterHistory.value.length }) }}
        </span>
      </div>
      <div class="rep-hist">
        <button
          v-for="h in cap.repeaterHistory.value"
          :key="h.n"
          type="button"
          class="rep-hist-row"
          :class="{ on: toRaw(h.result) === toRaw(result) }"
          @click="cap.loadHistory(h)"
        >
          <Badge variant="outline" class="rep-meth">{{ h.method }}</Badge>
          <Badge
            :variant="h.result.ok ? statusVariant(h.result.status) : 'destructive'"
            class="tnum"
          >
            {{ h.result.ok ? h.result.status : t('capture.status.failed') }}
          </Badge>
          <span class="cap-cut cap-code" :title="h.url">{{ h.url }}</span>
          <span class="cap-dim tnum">
            {{ h.result.ok ? `${Math.round(h.result.timeMs)} ms` : '' }}
          </span>
        </button>
      </div>
    </div>

    <div class="cap-rep-col">
      <div class="cap-bar">
        <span class="cap-dim">{{ t('capture.repeater.response') }}</span>
        <template v-if="result && result.ok">
          <Badge :variant="statusVariant(result.status)" class="tnum">
            {{ result.status }} {{ result.statusText }}
          </Badge>
          <span class="cap-dim tnum">{{ Math.round(result.timeMs) }} ms</span>
        </template>
      </div>
      <div v-if="!result" class="cap-empty">{{ t('capture.repeater.empty') }}</div>
      <div v-else-if="!result.ok" class="cap-note bad">{{ result.error }}</div>
      <div v-else class="cap-tab">
        <section class="cap-sec">
          <h4>
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
                :style="
                  copy.copiedKey.value === 'rep-headers' ? { color: 'var(--green)' } : undefined
                "
              />
            </Button>
            <span class="rep-live" aria-live="polite">
              {{ copy.copiedKey.value === 'rep-headers' ? t('capture.toast.copied') : '' }}
            </span>
          </h4>
          <table class="cap-kv">
            <tbody>
              <tr v-for="(h, i) in result.headers" :key="i">
                <th class="cap-code">{{ h[0] }}</th>
                <td class="cap-code cap-wrap">{{ h[1] }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="cap-sec">
          <h4>{{ t('capture.tab.response') }}</h4>
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

<style scoped>
.rep-follow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--textDim);
  cursor: pointer;
}
.rep-editor {
  flex: 0 0 auto;
  width: auto;
  min-height: 220px;
  margin: 0 8px;
  resize: vertical;
  background: var(--bgInput);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre;
  overflow: auto;
}
.rep-hist {
  display: flex;
  flex-direction: column;
}
.rep-hist-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.rep-hist-row:hover {
  background: var(--bgHover);
}
.rep-hist-row.on {
  background: var(--accentDim);
  box-shadow: inset 2px 0 0 var(--accent);
}
.rep-meth {
  min-width: 52px;
  justify-content: center;
}
.rep-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.rep-spin {
  animation: rep-spin 1s linear infinite;
}
@keyframes rep-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
