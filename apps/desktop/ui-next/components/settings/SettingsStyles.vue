<template>
  <div>
    <SettingsPaneHeader :title="t('settingsStyles.heading')" />

    <p class="styintro" :style="{ color: 'var(--textDim)' }">
      {{ t('settingsStyles.intro') }}
      <span class="stypath">{{ globalDir }}</span>
    </p>

    <div class="styhead">
      <div class="sech">{{ t('settingsStyles.mine.heading') }}</div>
      <button class="btn sm" @click="startCreate()">
        <Icon name="plus" />
        {{ t('settingsStyles.mine.add') }}
      </button>
    </div>

    <div v-if="lastError" class="styerr" :style="{ color: 'var(--danger)' }">{{ lastError }}</div>

    <div v-if="styles.length === 0" class="styempty" :style="{ color: 'var(--textFaint)' }">
      {{ t('settingsStyles.mine.empty') }}
    </div>

    <div v-for="style in sortedStyles" :key="outputStyleKey(style)" class="styrow">
      <button
        class="styexpand"
        :title="t('settingsStyles.preview')"
        @click="toggle(outputStyleKey(style))"
      >
        <Icon :name="expandedKey === outputStyleKey(style) ? 'eye-off' : 'eye'" />
      </button>
      <div class="stytext">
        <div class="styname">
          {{ style.name }}
          <span class="tag">{{ style.id }}</span>
          <span v-if="style.source === 'project'" class="tag acc" style="padding: 1px 6px">
            {{ projectLabel(style.projectId) }}
          </span>
          <span
            v-if="shadowedBuiltInIds.has(style.id)"
            class="tag"
            :title="t('settingsStyles.overrides.hint')"
          >
            {{ t('settingsStyles.overrides.tag') }}
          </span>
        </div>
        <div class="stydesc" :style="{ color: 'var(--textDim)' }">{{ style.description }}</div>
        <pre v-if="expandedKey === outputStyleKey(style)" class="stybody">{{ style.body }}</pre>
      </div>
      <button class="stybtn" :title="t('common.edit')" @click="startEdit(style)">
        <Icon name="edit" />
      </button>
      <button class="stybtn danger" :title="t('common.delete')" @click="onDelete(style)">
        <Icon name="trash" />
      </button>
    </div>

    <!-- Trình soạn dùng chung cho tạo mới + sửa. -->
    <div v-if="draft" class="styeditor">
      <div class="styfields">
        <label class="styfield">
          <span class="sech">{{ t('settingsStyles.editor.id') }}</span>
          <input v-model="draft.id" class="keyinp" :disabled="draft.mode === 'update'" />
        </label>
        <label class="styfield">
          <span class="sech">{{ t('settingsStyles.editor.name') }}</span>
          <input v-model="draft.name" class="keyinp" />
        </label>
      </div>
      <label v-if="draft.mode === 'create'" class="styfield">
        <span class="sech">{{ t('settingsStyles.editor.scope') }}</span>
        <AppSelect v-model="draft.scope" :options="scopeOptions" />
      </label>
      <label class="styfield">
        <span class="sech">{{ t('settingsStyles.editor.description') }}</span>
        <input
          v-model="draft.description"
          class="keyinp"
          :placeholder="t('settingsStyles.editor.descriptionHint')"
        />
      </label>
      <label class="styfield">
        <span class="sech">{{ t('settingsStyles.editor.body') }}</span>
        <textarea
          v-model="draft.body"
          class="keyinp stybodyinput resize-y min-h-[8rem]"
          :placeholder="t('settingsStyles.editor.bodyHint')"
        />
      </label>
      <div class="styeditor-actions">
        <span v-if="idError" :style="{ color: 'var(--danger)' }">{{ idError }}</span>
        <span v-else-if="idTaken" :style="{ color: 'var(--textDim)' }">
          {{ t('settingsStyles.editor.overrideNote') }}
        </span>
        <button class="btn sm" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn sm pri" :disabled="!canSave" @click="onSave">
          {{ t('common.save') }}
        </button>
      </div>
    </div>

    <div class="styhead">
      <div class="sech">{{ t('settingsStyles.builtIn.heading') }}</div>
    </div>
    <p class="styintro" :style="{ color: 'var(--textFaint)' }">
      {{ t('settingsStyles.builtIn.desc') }}
    </p>

    <div v-for="style in builtIn" :key="style.id" class="styrow">
      <button class="styexpand" :title="t('settingsStyles.preview')" @click="toggle(style.id)">
        <Icon :name="expandedKey === style.id ? 'eye-off' : 'eye'" />
      </button>
      <div class="stytext">
        <div class="styname">
          <span class="tag">{{ style.id }}</span>
          <span
            v-if="shadowedBuiltInIds.has(style.id)"
            class="tag acc"
            :title="t('settingsStyles.overrides.hint')"
          >
            {{ t('settingsStyles.builtIn.shadowed') }}
          </span>
        </div>
        <div v-if="expandedKey !== style.id" class="stydesc" :style="{ color: 'var(--textDim)' }">
          {{ style.directive }}
        </div>
        <pre v-else class="stybody">{{ style.directive }}</pre>
      </div>
      <button
        class="stybtn"
        :title="t('settingsStyles.builtIn.copy')"
        @click="startCopy(style.id, style.directive)"
      >
        <Icon name="copy" />
      </button>
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

<style scoped>
.styintro {
  margin: 6px 0 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}
.stypath {
  /* mono-ok: đường dẫn thư mục, người dùng copy thẳng vào terminal */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.styhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0 6px;
}
.styerr {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  padding: 4px 0;
}
.styempty {
  padding: 10px 2px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.styrow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--border);
}
.stytext {
  flex: 1;
  min-width: 0;
}
.styname {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.stydesc {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stybody {
  margin: 6px 0 2px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--textDim);
  /* mono-ok: directive là văn bản prompt thô, người dùng copy vào file style */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-md);
  white-space: pre-wrap;
  word-break: break-word;
}
.stybtn,
.styexpand {
  padding: 5px;
  border: 0;
  background: transparent;
  border-radius: var(--r-sm);
  color: var(--textDim);
  cursor: pointer;
}
.stybtn:hover,
.styexpand:hover {
  background: var(--bgHover);
  color: var(--text);
}
.stybtn.danger:hover {
  background: var(--dangerBg);
  color: var(--danger);
}
.styeditor {
  margin-top: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.styfields {
  display: flex;
  gap: 8px;
}
.styfield {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.styeditor-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.stybodyinput {
  line-height: var(--lh-md);
}
</style>
