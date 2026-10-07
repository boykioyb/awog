<template>
  <LibraryEntityModal :open="open" :title="title" :width="520" @close="emit('close')">
    <div class="cqc">
      <!-- REVIEW — tóm tắt thứ sắp cấu hình (preset tĩnh chưa qua màn đồng ý).
           Entry registry đã xem chi tiết ở ConnectionDiscoverDetail nên nhảy
           thẳng sang secrets/working, không qua phase này. -->
      <template v-if="phase === 'review'">
        <div class="cqc-hero">
          <SourceAvatar v-if="draft" :source="draft" size="md" />
          <div class="cqc-hero-tx">
            <div class="cqc-name">{{ draft?.name || draft?.slug }}</div>
            <div v-if="draft?.tagline" class="cqc-sub">{{ draft.tagline }}</div>
          </div>
        </div>
        <div v-if="commandLine" class="cqc-row">
          <span class="cqc-k">{{ t('connections.quick.review.command') }}</span>
          <span class="cqc-v mono">{{ commandLine }}</span>
        </div>
        <div v-else-if="draft?.mcp.url" class="cqc-row">
          <span class="cqc-k">{{ t('connections.quick.review.url') }}</span>
          <span class="cqc-v mono">{{ draft.mcp.url }}</span>
        </div>
        <div class="cqc-row">
          <span class="cqc-k">{{ t('connections.quick.review.auth') }}</span>
          <span class="cqc-v">{{ authLabel }}</span>
        </div>
        <p v-if="meta?.setupHint" class="cqc-hint">{{ meta.setupHint }}</p>
        <div class="cqc-actions">
          <Button variant="default" @click="emit('advance')">
            <Icon name="link" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('connections.quick.connect') }}
          </Button>
          <button type="button" class="cqc-link" @click="emit('open-in-editor')">
            {{ t('connections.quick.customize') }}
          </button>
        </div>
      </template>

      <!-- SECRETS — chỉ đúng các ô còn thiếu, không phải full form. Giá trị đi
           thẳng vào OS keychain (source.setSecret); config giữ secret:KEY. -->
      <template v-else-if="phase === 'secrets'">
        <p v-if="secretNoteKey" class="cqc-note">
          {{ t(`connections.quick.note.${secretNoteKey}`) }}
        </p>
        <div v-for="f in secretFields" :key="f.target + ':' + f.key" class="cqc-field">
          <label
            class="cqc-label"
            :class="{ 'cqc-label-id': f.target === 'env' || f.target === 'headers' }"
          >
            {{ fieldLabel(f) }}
            <span v-if="f.required" class="tag warn">{{ t('connections.quick.required') }}</span>
          </label>
          <Input
            v-model="secretValues[f.key]"
            :type="f.masked ? 'password' : 'text'"
            spellcheck="false"
          />
        </div>
        <p class="cqc-hint">{{ t('connections.quick.secretsHint') }}</p>
        <div class="cqc-actions">
          <Button variant="default" :disabled="!canSubmit" @click="submitSecrets">
            <Icon name="shield" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('connections.quick.secretsSubmit') }}
          </Button>
        </div>
      </template>

      <!-- WORKING — upsert / test đang chạy -->
      <template v-else-if="phase === 'working'">
        <div class="cqc-center">
          <span class="cqc-spin" />
          <span class="cqc-status">{{ t(`connections.quick.working.${busyKey}`) }}</span>
        </div>
      </template>

      <!-- OAUTH — trình duyệt đang mở, chờ user authorize -->
      <template v-else-if="phase === 'oauth'">
        <div class="cqc-center">
          <span class="cqc-spin" />
          <div class="cqc-center-tx">
            <span class="cqc-status">{{ t('connections.quick.oauthWaitingTitle') }}</span>
            <span class="cqc-hint">{{ t('connections.quick.oauthWaiting') }}</span>
          </div>
        </div>
        <div class="cqc-actions">
          <Button variant="outline" @click="emit('close')">
            {{ t('connections.quick.oauthCancel') }}
          </Button>
        </div>
      </template>

      <!-- DONE -->
      <template v-else-if="phase === 'done'">
        <div class="cqc-center">
          <span class="cqc-done-ic"><Icon name="check" style="width: 18px; height: 18px" /></span>
          <div class="cqc-center-tx">
            <span class="cqc-status">{{ t('connections.quick.doneTitle') }}</span>
            <span v-if="doneTools !== null" class="cqc-hint">
              {{ t('connections.quick.doneTools', { n: doneTools }) }}
            </span>
          </div>
        </div>
        <div class="cqc-actions">
          <Button variant="default" @click="emit('close')">{{ t('common.close') }}</Button>
        </div>
      </template>

      <!-- ERROR -->
      <template v-else>
        <div class="cqc-center">
          <span class="cqc-err-ic"><Icon name="alert" style="width: 18px; height: 18px" /></span>
          <div class="cqc-center-tx">
            <span class="cqc-status">{{ t('connections.quick.errorTitle') }}</span>
            <span class="cqc-errmsg">{{ errorText }}</span>
          </div>
        </div>
        <pre v-if="errorStderr.length" class="cqc-stderr">{{ errorStderr.join('\n') }}</pre>
        <div class="cqc-actions">
          <Button variant="outline" @click="emit('retry')">
            {{ t('connections.quick.retry') }}
          </Button>
          <Button variant="outline" @click="emit('open-in-editor')">
            {{ t('connections.quick.openEditor') }}
          </Button>
          <Button variant="ghost" @click="emit('close')">{{ t('common.close') }}</Button>
        </div>
      </template>
    </div>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Modal "Kết nối nhanh" — mặt trình bày của useQuickConnect (state machine nằm
// ở composable, file này chỉ render phase + gom input secret). Luồng: review →
// (secrets) → working → (oauth) → done/error, mọi bước nặng đều là RPC source.*
// sẵn có — không có đường tắt nào bỏ qua upsert/test/keychain.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import SourceAvatar from '~/components/connection/SourceAvatar.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import type { QuickPhase, QuickSecretField } from '~/composables/useQuickConnect'
import type { McpSource, SourcePresetMeta } from '~/stores/connections'

const props = defineProps<{
  open: boolean
  phase: QuickPhase
  draft: McpSource | null
  meta: SourcePresetMeta | null
  secretFields: QuickSecretField[]
  secretNoteKey: string
  busyKey: string
  errorText: string
  errorStderr: string[]
  doneTools: number | null
}>()

const emit = defineEmits<{
  close: []
  advance: []
  'open-in-editor': []
  retry: []
  'submit-secrets': [values: Record<string, string>]
}>()

const { t } = useI18n()

const title = computed(() => props.draft?.name || t('connections.quick.title'))

// Giá trị secret là state local của modal — chỉ đi lên khi submit, composable
// ghi keychain xong là xoay. Reset mỗi lần phase quay về secrets để không giữ
// plaintext qua các vòng retry.
const secretValues = ref<Record<string, string>>({})
watch(
  () => props.phase,
  (p) => {
    if (p === 'secrets') secretValues.value = {}
  },
)
const canSubmit = computed(() =>
  props.secretFields.filter((f) => f.required).every((f) => !!secretValues.value[f.key]?.trim()),
)
const submitSecrets = () => emit('submit-secrets', { ...secretValues.value })

// env/header target → label là identifier thật (mono); ô BYO OAuth app → prose
// i18n, không phải identifier nên không dùng font code.
const fieldLabel = (f: QuickSecretField): string => {
  if (f.target === 'clientId') return t('connections.quick.field.clientId')
  if (f.target === 'clientSecret') return t('connections.quick.field.clientSecret')
  return f.key
}

const commandLine = computed(() => {
  const d = props.draft
  if (!d || (d.mcp.transport ?? 'http') !== 'stdio' || !d.mcp.command) return ''
  return [d.mcp.command, ...(d.mcp.args ?? [])].join(' ')
})

const authLabel = computed(() => {
  const a = props.draft?.mcp.authType ?? 'none'
  return t(`connections.quick.auth.${a}`)
})
</script>

<style scoped>
.cqc {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cqc-hero {
  display: flex;
  align-items: center;
  gap: 11px;
}
.cqc-hero-tx {
  min-width: 0;
}
.cqc-name {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 650;
  color: var(--text);
}
.cqc-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  margin-top: 2px;
}
.cqc-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px;
  align-items: baseline;
}
.cqc-k {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.cqc-v {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  word-break: break-all;
}
.cqc-hint {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.cqc-note {
  margin: 0;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
}
.cqc-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cqc-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
}
.cqc-label-id {
  /* mono-ok: tên env var / header — identifier thật của config */
  font-family: var(--code);
}
.cqc-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
}
.cqc-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.cqc-link:hover {
  text-decoration: underline;
}
.cqc-center {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}
.cqc-center-tx {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.cqc-status {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.cqc-spin {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 2px solid var(--accentDim);
  border-top-color: var(--accent);
  animation: cqc-rotate 0.9s linear infinite;
}
.cqc-done-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: var(--r-btn);
  background: var(--addBg);
  color: var(--green);
}
.cqc-err-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: var(--r-btn);
  background: var(--dangerDim);
  color: var(--danger);
}
.cqc-errmsg {
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
  word-break: break-word;
}
.cqc-stderr {
  margin: 0;
  padding: 9px 11px;
  max-height: 140px;
  overflow: auto;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textDim);
  /* mono-ok: stderr thô của MCP server — output thật của tiến trình */
  font-family: var(--code);
  font-size: var(--fs-xs);
  white-space: pre-wrap;
  word-break: break-all;
}
@keyframes cqc-rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
