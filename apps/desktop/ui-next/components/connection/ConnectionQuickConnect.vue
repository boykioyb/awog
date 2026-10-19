<template>
  <LibraryEntityModal :open="open" :title="title" :width="520" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <!-- REVIEW — tóm tắt thứ sắp cấu hình (preset tĩnh chưa qua màn đồng ý).
           Entry registry đã xem chi tiết ở ConnectionDiscoverDetail nên nhảy
           thẳng sang secrets/working, không qua phase này. -->
      <template v-if="phase === 'review'">
        <div class="flex items-center gap-3">
          <SourceAvatar v-if="draft" :source="draft" size="md" />
          <div class="min-w-0">
            <div class="text-base font-semibold text-foreground">
              {{ draft?.name || draft?.slug }}
            </div>
            <div v-if="draft?.tagline" class="mt-0.5 text-xs text-muted-foreground">
              {{ draft.tagline }}
            </div>
          </div>
        </div>
        <!-- Lệnh / URL là chuỗi người dùng copy được ⇒ mono. -->
        <div v-if="commandLine" class="grid grid-cols-[7.5rem_1fr] items-baseline gap-2.5">
          <span class="text-xs text-muted-foreground">
            {{ t('connections.quick.review.command') }}
          </span>
          <span class="font-mono text-sm break-all text-foreground">{{ commandLine }}</span>
        </div>
        <div v-else-if="draft?.mcp.url" class="grid grid-cols-[7.5rem_1fr] items-baseline gap-2.5">
          <span class="text-xs text-muted-foreground">{{ t('connections.quick.review.url') }}</span>
          <span class="font-mono text-sm break-all text-foreground">{{ draft.mcp.url }}</span>
        </div>
        <div class="grid grid-cols-[7.5rem_1fr] items-baseline gap-2.5">
          <span class="text-xs text-muted-foreground">
            {{ t('connections.quick.review.auth') }}
          </span>
          <span class="text-sm break-all text-foreground">{{ authLabel }}</span>
        </div>
        <p v-if="meta?.setupHint" class="m-0 text-xs leading-relaxed text-muted-foreground">
          {{ meta.setupHint }}
        </p>
        <div class="flex items-center gap-2.5 pt-1.5">
          <Button variant="default" class="[&_svg]:size-3.5" @click="emit('advance')">
            <Icon name="link" />
            {{ t('connections.quick.connect') }}
          </Button>
          <Button
            variant="link"
            size="xs"
            class="h-auto p-0 font-normal"
            @click="emit('open-in-editor')"
          >
            {{ t('connections.quick.customize') }}
          </Button>
        </div>
      </template>

      <!-- SECRETS — chỉ đúng các ô còn thiếu, không phải full form. Giá trị đi
           thẳng vào OS keychain (source.setSecret); config giữ secret:KEY. -->
      <template v-else-if="phase === 'secrets'">
        <p
          v-if="secretNoteKey"
          class="m-0 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning"
        >
          {{ t(`connections.quick.note.${secretNoteKey}`) }}
        </p>
        <div v-for="f in secretFields" :key="f.target + ':' + f.key" class="flex flex-col gap-1">
          <!-- Tên env var / header là identifier thật của config ⇒ mono. -->
          <Label
            class="flex items-center gap-2 text-xs font-semibold text-muted-foreground"
            :class="(f.target === 'env' || f.target === 'headers') && 'font-mono'"
          >
            {{ fieldLabel(f) }}
            <Badge v-if="f.required" variant="warning" class="font-sans">
              {{ t('connections.quick.required') }}
            </Badge>
          </Label>
          <Input
            v-model="secretValues[f.key]"
            :type="f.masked ? 'password' : 'text'"
            spellcheck="false"
          />
        </div>
        <p class="m-0 text-xs leading-relaxed text-muted-foreground">
          {{ t('connections.quick.secretsHint') }}
        </p>
        <div class="flex items-center gap-2.5 pt-1.5">
          <Button
            variant="default"
            class="[&_svg]:size-3.5"
            :disabled="!canSubmit"
            @click="submitSecrets"
          >
            <Icon name="shield" />
            {{ t('connections.quick.secretsSubmit') }}
          </Button>
        </div>
      </template>

      <!-- WORKING — upsert / test đang chạy -->
      <template v-else-if="phase === 'working'">
        <div class="flex items-center gap-3 py-2.5">
          <span
            class="size-4 flex-none animate-spin rounded-full border-2 border-selected border-t-primary"
          />
          <span class="text-sm font-semibold text-foreground">
            {{ t(`connections.quick.working.${busyKey}`) }}
          </span>
        </div>
      </template>

      <!-- OAUTH — trình duyệt đang mở, chờ user authorize -->
      <template v-else-if="phase === 'oauth'">
        <div class="flex items-center gap-3 py-2.5">
          <span
            class="size-4 flex-none animate-spin rounded-full border-2 border-selected border-t-primary"
          />
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-sm font-semibold text-foreground">
              {{ t('connections.quick.oauthWaitingTitle') }}
            </span>
            <span class="m-0 text-xs leading-relaxed text-muted-foreground">
              {{ t('connections.quick.oauthWaiting') }}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2.5 pt-1.5">
          <Button variant="outline" @click="emit('close')">
            {{ t('connections.quick.oauthCancel') }}
          </Button>
        </div>
      </template>

      <!-- DONE -->
      <template v-else-if="phase === 'done'">
        <div class="flex items-center gap-3 py-2.5">
          <span
            class="grid size-8.5 flex-none place-items-center rounded-lg bg-success/15 text-success"
          >
            <Icon name="check" class="size-4.5" />
          </span>
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-sm font-semibold text-foreground">
              {{ t('connections.quick.doneTitle') }}
            </span>
            <span
              v-if="doneTools !== null"
              class="m-0 text-xs leading-relaxed text-muted-foreground"
            >
              {{ t('connections.quick.doneTools', { n: doneTools }) }}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2.5 pt-1.5">
          <Button variant="default" @click="emit('close')">{{ t('common.close') }}</Button>
        </div>
      </template>

      <!-- ERROR -->
      <template v-else>
        <div class="flex items-center gap-3 py-2.5">
          <span
            class="grid size-8.5 flex-none place-items-center rounded-lg bg-destructive/15 text-destructive"
          >
            <Icon name="alert" class="size-4.5" />
          </span>
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-sm font-semibold text-foreground">
              {{ t('connections.quick.errorTitle') }}
            </span>
            <span class="text-xs leading-relaxed break-words text-muted-foreground">
              {{ errorText }}
            </span>
          </div>
        </div>
        <!-- stderr thô của MCP server — output thật của tiến trình ⇒ mono. -->
        <pre
          v-if="errorStderr.length"
          class="m-0 max-h-35 overflow-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground"
          >{{ errorStderr.join('\n') }}</pre
        >
        <div class="flex items-center gap-2.5 pt-1.5">
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
