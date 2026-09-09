<script setup lang="ts">
import { computed } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import {
  AGENT_MODES,
  RESPONSE_STYLES,
  catalogError,
  isModeAvailable,
  isUngatedMode,
  THINKING_LABELS,
  THINKING_LEVELS,
  accountsFor,
  activeAccountFor,
  modelsForAccount,
  providers,
} from '../catalog'
import type { AgentMode, SessionConfig } from '../types'

// The desktop's session config (provider · account · model · effort · mode ·
// response style) as one form, shared by "New session" and the session sheet.
//
// `inheritable` (create) adds an empty "theo mặc định" option to provider / model
// / effort: leaving them empty is what lets the project's LLM defaults win —
// the gateway resolves them server-side. An existing session always has concrete
// values, so there the only inheritable field is the account (unpin).

const props = defineProps<{ modelValue: SessionConfig; inheritable?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: SessionConfig): void }>()

const providerNames = computed(() => providers.value.map((p) => p.provider))
const accounts = computed(() => accountsFor(props.modelValue.provider))
const models = computed(() =>
  modelsForAccount(props.modelValue.provider, props.modelValue.accountId),
)
const modeHint = computed(() => AGENT_MODES.find((m) => m.id === props.modelValue.mode)?.hint ?? '')
// `accept-edits`/`execute` run tools without asking — the phone is unattended by
// definition, so the choice gets a standing warning rather than a silent option.
const modeUngated = computed(() => isUngatedMode(props.modelValue.mode))
// Công tắc "chạy không cần duyệt" trên desktop đang tắt ⇒ hai mode ungated bị
// gateway kẹp về `ask`. Nói thẳng ở đây, đừng để người dùng chọn một thứ không
// chạy (và cũng đừng cho họ tin là agent đang chạy không cần duyệt).
const modeBlocked = computed(() => !isModeAvailable(props.modelValue.mode))

const defaultAccountLabel = computed(() => {
  const active = activeAccountFor(props.modelValue.provider)
  const label = accounts.value.find((a) => a.id === active)?.label
  return label ? `Mặc định (${label})` : 'Mặc định của provider'
})

function patch(part: Partial<SessionConfig>): void {
  emit('update:modelValue', { ...props.modelValue, ...part })
}

// Switching provider invalidates both the account and the model: an account
// belongs to one provider, and the model ids come from that provider's catalog.
function onProvider(value: string): void {
  const first = value ? (modelsForAccount(value, '')[0]?.id ?? '') : ''
  patch({ provider: value, accountId: '', modelId: props.inheritable ? '' : first })
}

// A custom-endpoint account serves its own models — reset when it no longer does.
function onAccount(value: string): void {
  const list = modelsForAccount(props.modelValue.provider, value)
  const keep = list.some((m) => m.id === props.modelValue.modelId)
  patch({ accountId: value, ...(keep ? {} : { modelId: list[0]?.id ?? '' }) })
}

function target(e: Event): string {
  return (e.target as HTMLSelectElement).value
}
</script>

<template>
  <p v-if="!providers.length" class="stale">
    Không tải được danh mục provider/account từ desktop{{ catalogError ? ` (${catalogError})` : '' }}.
    Desktop cần build lại bản mới (Electron main) rồi mở lại app.
  </p>

  <div class="row">
    <label class="field grow">
      <span>Provider</span>
      <select :value="modelValue.provider" @change="onProvider(target($event))">
        <option v-if="inheritable" value="">Mặc định</option>
        <option v-for="p in providerNames" :key="p" :value="p">{{ p }}</option>
      </select>
    </label>
    <label class="field grow">
      <span>Mode</span>
      <select :value="modelValue.mode" @change="patch({ mode: target($event) as AgentMode })">
        <option
          v-for="m in AGENT_MODES"
          :key="m.id"
          :value="m.id"
          :disabled="!isModeAvailable(m.id)"
        >
          {{ m.label }}{{ isModeAvailable(m.id) ? '' : ' · đã tắt' }}
        </option>
      </select>
    </label>
  </div>

  <p v-if="modeBlocked" class="mode-hint warn">
    <TriangleAlert class="icn-xs" />
    Mode này bị chặn cho thiết bị từ xa. Bật "chạy không cần duyệt" ở Settings →
    Devices trên máy desktop, hoặc dùng Ask và duyệt từng lệnh ngay tại đây.
  </p>
  <p v-else class="mode-hint" :class="{ warn: modeUngated }">
    <TriangleAlert v-if="modeUngated" class="icn-xs" />{{ modeHint }}
  </p>

  <label v-if="modelValue.provider" class="field">
    <span>Account</span>
    <select :value="modelValue.accountId" @change="onAccount(target($event))">
      <option value="">{{ defaultAccountLabel }}</option>
      <option v-for="a in accounts" :key="a.id" :value="a.id">
        {{ a.label }}{{ a.status && a.status !== 'ok' ? ` · ${a.status}` : '' }}
      </option>
    </select>
  </label>

  <label class="field">
    <span>Model</span>
    <select :value="modelValue.modelId" @change="patch({ modelId: target($event) })">
      <option v-if="inheritable" value="">Mặc định</option>
      <option
        v-if="modelValue.modelId && !models.some((m) => m.id === modelValue.modelId)"
        :value="modelValue.modelId"
      >
        {{ modelValue.modelId }}
      </option>
      <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
    </select>
  </label>

  <div class="row">
    <label class="field grow">
      <span>Thinking</span>
      <select :value="modelValue.level" @change="patch({ level: target($event) })">
        <option v-if="inheritable" value="">Mặc định</option>
        <option v-for="lv in THINKING_LEVELS" :key="lv" :value="lv">
          {{ THINKING_LABELS[lv] }}
        </option>
      </select>
    </label>
    <label class="field grow">
      <span>Response style</span>
      <select :value="modelValue.responseStyle" @change="patch({ responseStyle: target($event) })">
        <optgroup v-for="g in RESPONSE_STYLES" :key="g.group" :label="g.group">
          <option v-for="r in g.rows" :key="r.id" :value="r.id">{{ r.label }}</option>
        </optgroup>
      </select>
    </label>
  </div>

  <label class="check">
    <input
      type="checkbox"
      :checked="modelValue.responseStyleNoMarkdown"
      @change="patch({ responseStyleNoMarkdown: (($event.target as HTMLInputElement).checked) })"
    />
    <span>Trả lời không dùng markdown</span>
  </label>
</template>

<style scoped>
.mode-hint {
  margin: -8px 0 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
}
/* Inline with the sentence it qualifies, so it must sit on the text baseline
   rather than the line box's top. */
.mode-hint .lucide {
  vertical-align: -2px;
  margin-right: 4px;
}
.mode-hint.warn {
  color: var(--warn);
}
.stale {
  margin: 0 0 14px;
  padding: 9px 11px;
  border: 1px solid var(--warn);
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--warn) 10%, transparent);
  color: var(--warn);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.field {
  display: block;
  margin-bottom: 14px;
}
.field > span {
  display: block;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
  margin-bottom: 6px;
}
.field select {
  width: 100%;
  min-height: var(--tap);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px 12px;
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.field select:focus {
  border-color: var(--accent);
}
.row {
  display: flex;
  gap: 10px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.check {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: var(--tap);
  margin-bottom: 14px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text-dim);
}
.check:active {
  color: var(--text);
}
.check input {
  width: 20px;
  height: 20px;
  accent-color: var(--accent);
}
</style>
