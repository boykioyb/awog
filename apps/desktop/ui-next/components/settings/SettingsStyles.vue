<template>
  <div>
    <SettingsPaneHeader :title="t('settingsStyles.heading')" />

    <p class="mt-1.5 mb-2.5 text-sm text-dim">
      {{ t('settingsStyles.intro') }}
      <!-- mono-ok: đường dẫn thư mục, người dùng copy thẳng vào terminal -->
      <span class="font-mono text-xs">{{ globalDir }}</span>
    </p>

    <div class="mt-4.5 mb-1.5 flex items-center justify-between">
      <div data-set-label class="text-xs font-medium text-muted-foreground">
        {{ t('settingsStyles.mine.heading') }}
      </div>
      <Button variant="outline" size="sm" @click="startCreate()">
        <Icon name="plus" />
        {{ t('settingsStyles.mine.add') }}
      </Button>
    </div>

    <div v-if="lastError" class="py-1 text-sm text-destructive">{{ lastError }}</div>

    <div v-if="styles.length === 0" class="px-0.5 py-2.5 text-base text-faint">
      {{ t('settingsStyles.mine.empty') }}
    </div>

    <div
      v-for="style in sortedStyles"
      :key="outputStyleKey(style)"
      class="flex items-start gap-2 border-t py-1.5"
    >
      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-dim"
        :title="t('settingsStyles.preview')"
        :aria-label="t('settingsStyles.preview')"
        @click="toggle(outputStyleKey(style))"
      >
        <Icon :name="expandedKey === outputStyleKey(style) ? 'eye-off' : 'eye'" />
      </Button>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5 text-base">
          {{ style.name }}
          <Badge variant="outline" class="text-muted-foreground">{{ style.id }}</Badge>
          <Badge
            v-if="style.source === 'project'"
            variant="outline"
            class="border-primary/45 bg-primary/10 text-primary"
          >
            {{ projectLabel(style.projectId) }}
          </Badge>
          <Badge
            v-if="shadowedBuiltInIds.has(style.id)"
            variant="outline"
            class="text-muted-foreground"
            :title="t('settingsStyles.overrides.hint')"
          >
            {{ t('settingsStyles.overrides.tag') }}
          </Badge>
        </div>
        <div class="truncate text-sm text-dim">{{ style.description }}</div>
        <!-- mono-ok: nội dung style là prompt thô, người dùng copy vào file style -->
        <pre
          v-if="expandedKey === outputStyleKey(style)"
          class="mt-1.5 mb-0.5 rounded-md border bg-background p-2 font-mono text-xs break-words whitespace-pre-wrap text-dim"
          >{{ style.body }}</pre
        >
      </div>
      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-dim"
        :title="t('common.edit')"
        :aria-label="t('common.edit')"
        @click="startEdit(style)"
      >
        <Icon name="edit" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-dim hover:bg-destructive/10 hover:text-destructive"
        :title="t('common.delete')"
        :aria-label="t('common.delete')"
        @click="onDelete(style)"
      >
        <Icon name="trash" />
      </Button>
    </div>

    <!-- Trình soạn dùng chung cho tạo mới + sửa. -->
    <div v-if="draft" class="mt-3 flex flex-col gap-2 rounded-md border p-2.5">
      <div class="flex gap-2">
        <label class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs font-medium text-muted-foreground">
            {{ t('settingsStyles.editor.id') }}
          </span>
          <Input v-model="draft.id" :disabled="draft.mode === 'update'" class="flex-1" />
        </label>
        <label class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs font-medium text-muted-foreground">
            {{ t('settingsStyles.editor.name') }}
          </span>
          <Input v-model="draft.name" class="flex-1" />
        </label>
      </div>
      <label v-if="draft.mode === 'create'" class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-xs font-medium text-muted-foreground">
          {{ t('settingsStyles.editor.scope') }}
        </span>
        <AppSelect v-model="draft.scope" :options="scopeOptions" />
      </label>
      <label class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-xs font-medium text-muted-foreground">
          {{ t('settingsStyles.editor.description') }}
        </span>
        <Input
          v-model="draft.description"
          :placeholder="t('settingsStyles.editor.descriptionHint')"
          class="flex-1"
        />
      </label>
      <label class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-xs font-medium text-muted-foreground">
          {{ t('settingsStyles.editor.body') }}
        </span>
        <Textarea
          v-model="draft.body"
          class="min-h-32 resize-y text-sm"
          :placeholder="t('settingsStyles.editor.bodyHint')"
        />
      </label>
      <div class="flex items-center justify-end gap-2 text-sm">
        <span v-if="idError" class="text-destructive">{{ idError }}</span>
        <span v-else-if="idTaken" class="text-dim">
          {{ t('settingsStyles.editor.overrideNote') }}
        </span>
        <Button variant="outline" size="sm" @click="draft = null">{{ t('common.cancel') }}</Button>
        <Button :disabled="!canSave" variant="default" size="sm" @click="onSave">
          {{ t('common.save') }}
        </Button>
      </div>
    </div>

    <div class="mt-4.5 mb-1.5 flex items-center justify-between">
      <div data-set-label class="text-xs font-medium text-muted-foreground">
        {{ t('settingsStyles.builtIn.heading') }}
      </div>
    </div>
    <p class="mt-1.5 mb-2.5 text-sm text-faint">
      {{ t('settingsStyles.builtIn.desc') }}
    </p>

    <div v-for="style in builtIn" :key="style.id" class="flex items-start gap-2 border-t py-1.5">
      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-dim"
        :title="t('settingsStyles.preview')"
        :aria-label="t('settingsStyles.preview')"
        @click="toggle(style.id)"
      >
        <Icon :name="expandedKey === style.id ? 'eye-off' : 'eye'" />
      </Button>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5 text-base">
          <Badge variant="outline" class="text-muted-foreground">{{ style.id }}</Badge>
          <Badge
            v-if="shadowedBuiltInIds.has(style.id)"
            variant="outline"
            class="border-primary/45 bg-primary/10 text-primary"
            :title="t('settingsStyles.overrides.hint')"
          >
            {{ t('settingsStyles.builtIn.shadowed') }}
          </Badge>
        </div>
        <div v-if="expandedKey !== style.id" class="truncate text-sm text-dim">
          {{ style.directive }}
        </div>
        <!-- mono-ok: directive là văn bản prompt thô, người dùng copy vào file style -->
        <pre
          v-else
          class="mt-1.5 mb-0.5 rounded-md border bg-background p-2 font-mono text-xs break-words whitespace-pre-wrap text-dim"
          >{{ style.directive }}</pre
        >
      </div>
      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-dim"
        :title="t('settingsStyles.builtIn.copy')"
        :aria-label="t('settingsStyles.builtIn.copy')"
        @click="startCopy(style.id, style.directive)"
      >
        <Icon name="copy" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Settings → Styles (WP11): người dùng tự viết Output Style thay vì phải sửa
// source rồi build lại app. Hai danh sách tách bạch — style dựng sẵn (chỉ đọc,
// xem trước được directive) và style của tôi (tạo/sửa/xoá) — vì luật hợp nhất là
// "trùng id thì bản của tôi thắng", và luật đó chỉ có nghĩa khi nhìn thấy cả hai.
import { computed, onMounted, ref } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import { useProjectsStore } from '~/stores/projects'
import { useConfirm } from '~/composables/useConfirm'
import { outputStyleKey, useOutputStyles, type OutputStyle } from '~/composables/useOutputStyles'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()
const { confirm } = useConfirm()
const projectsStore = useProjectsStore()
const {
  builtIn,
  styles,
  reports,
  lastError,
  shadowedBuiltInIds,
  loadStyles,
  saveStyle,
  deleteStyle,
} = useOutputStyles()

// Scope = 'global' hoặc id project — gộp vào một chuỗi để AppSelect (một chiều
// value/label) không phải mang hai trường.
const GLOBAL_SCOPE = 'global'

type Draft = {
  mode: 'create' | 'update'
  id: string
  name: string
  description: string
  body: string
  scope: string
  source: 'global' | 'project'
  projectId?: string
}

const draft = ref<Draft | null>(null)
const expandedKey = ref<string | null>(null)

const globalDir = computed(
  () => reports.value.find((r) => r.source === 'global')?.dir ?? '~/.awog/styles',
)

const sortedStyles = computed(() => [...styles.value].sort((a, b) => a.name.localeCompare(b.name)))

const scopeOptions = computed(() => [
  { value: GLOBAL_SCOPE, label: t('settingsStyles.scope.global') },
  ...[...projectsStore.projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: t('settingsStyles.scope.project', { name: p.name }) })),
])

function projectLabel(projectId: string | undefined): string {
  if (!projectId) return t('settingsStyles.scope.global')
  return projectsStore.projects.find((p) => p.id === projectId)?.name ?? projectId
}

// Id đang trùng với một style dựng sẵn ⇒ nói trước cho người dùng biết bản của
// họ sẽ đè lên bản dựng sẵn, thay vì để họ tự phát hiện sau.
const idTaken = computed(
  () => !!draft.value && builtIn.value.some((b) => b.id === draft.value?.id.trim()),
)

// Id là TÊN FILE, nên hình dạng phải khớp luật của sidecar (style/store.ts).
// Kiểm ngay tại chỗ gõ thay vì để RPC ném lỗi sau khi bấm Lưu.
const STYLE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const RESERVED_STYLE_IDS = new Set(['auto', 'default', 'normal'])

const idError = computed<string>(() => {
  const id = draft.value?.id.trim() ?? ''
  if (id === '') return ''
  if (RESERVED_STYLE_IDS.has(id)) return t('settingsStyles.error.idReserved')
  if (!STYLE_ID_RE.test(id)) return t('settingsStyles.error.idInvalid')
  return ''
})

const canSave = computed(() => {
  const d = draft.value
  if (!d) return false
  return d.id.trim() !== '' && d.name.trim() !== '' && d.body.trim() !== '' && idError.value === ''
})

function toggle(key: string): void {
  expandedKey.value = expandedKey.value === key ? null : key
}

function startCreate(seed?: Partial<Draft>): void {
  draft.value = {
    mode: 'create',
    id: '',
    name: '',
    description: '',
    body: '',
    scope: GLOBAL_SCOPE,
    source: 'global',
    ...seed,
  }
}

function startCopy(id: string, directive: string): void {
  startCreate({ id, name: id, body: directive })
}

function startEdit(style: OutputStyle): void {
  draft.value = {
    mode: 'update',
    id: style.id,
    name: style.name,
    description: style.description,
    body: style.body,
    scope: style.projectId ?? GLOBAL_SCOPE,
    source: style.source,
    ...(style.projectId ? { projectId: style.projectId } : {}),
  }
}

async function onSave(): Promise<void> {
  const d = draft.value
  if (!d) return
  const isProject = d.mode === 'create' ? d.scope !== GLOBAL_SCOPE : d.source === 'project'
  const projectId = d.mode === 'create' ? (isProject ? d.scope : undefined) : d.projectId
  const saved = await saveStyle(
    {
      id: d.id.trim(),
      name: d.name.trim(),
      description: d.description.trim(),
      body: d.body.trim(),
      source: isProject ? 'project' : 'global',
      ...(projectId ? { projectId } : {}),
    },
    d.mode,
  )
  if (saved) draft.value = null
}

async function onDelete(style: OutputStyle): Promise<void> {
  const ok = await confirm({
    title: t('settingsStyles.delete.title'),
    description: t('settingsStyles.delete.body', { name: style.name }),
    confirmLabel: t('common.delete'),
  })
  if (ok) await deleteStyle(style)
}

// Nạp lại mỗi lần mở pane (không chỉ lần đầu): thư mục `styles` chưa được
// watcher theo dõi, nên đây là chỗ bắt kịp file người dùng sửa bằng editor ngoài.
// Phải chờ projects hydrate xong mới biết cần quét thư mục project nào.
onMounted(async () => {
  if (!projectsStore.loaded) await projectsStore.hydrate()
  await loadStyles(projectsStore.projects.map((p) => p.id))
})
</script>
