<template>
  <div>
    <SettingsPaneHeader :title="t('browser.profiles.settings.heading')" />
    <p class="sb-intro">{{ t('browser.profiles.settings.intro') }}</p>

    <div v-if="!hasEngine" class="sb-intro">{{ t('browser.profiles.settings.unavailable') }}</div>

    <template v-else>
      <div v-for="p in profiles" :key="p.id" class="sb-row">
        <div class="sb-head">
          <span class="sb-dot" :style="{ background: p.color }" />
          <span class="sb-name">{{ p.name }}</span>
          <span v-if="p.id === defaultProfileId" class="chip">
            {{ t('browser.profiles.settings.default') }}
          </span>
          <span v-if="p.proxy" class="chip" :title="t('browser.profiles.proxy.chipTitle')">
            {{ proxyChip(p) }}
          </span>
          <span class="flex-1" />
        </div>

        <!-- Sửa tên + màu tại chỗ — mở bằng nút "Đổi tên", không modal. -->
        <div v-if="editingId === p.id" class="sb-edit">
          <Input
            v-model="draftName"
            type="text"
            :placeholder="t('browser.profiles.settings.namePlaceholder')"
            @keydown.enter.prevent="saveEdit(p.id)"
          />
          <div
            class="sb-swatches"
            role="radiogroup"
            :aria-label="t('browser.profiles.settings.color')"
          >
            <button
              v-for="c in PROFILE_COLORS"
              :key="c"
              type="button"
              class="sb-swatch"
              :class="{ on: c === draftColor }"
              :style="{ background: c }"
              :title="c"
              role="radio"
              :aria-checked="c === draftColor"
              @click="draftColor = c"
            />
          </div>
          <div class="sb-actions">
            <Button
              size="sm"
              variant="default"
              :disabled="!draftName.trim()"
              @click="saveEdit(p.id)"
            >
              {{ t('common.save') }}
            </Button>
            <Button size="sm" variant="outline" @click="editingId = null">
              {{ t('common.cancel') }}
            </Button>
          </div>
        </div>

        <div v-else class="sb-actions">
          <Button size="sm" variant="outline" @click="startEdit(p)">
            {{ t('browser.profiles.settings.rename') }}
          </Button>
          <Button
            v-if="p.id !== defaultProfileId"
            size="sm"
            variant="outline"
            @click="run(() => setDefault(p.id))"
          >
            {{ t('browser.profiles.settings.setDefault') }}
          </Button>
          <template v-if="hasBridge">
            <Button size="sm" variant="outline" @click="importFor = p.id">
              {{ t('browser.profiles.settings.import') }}
            </Button>
            <Button size="sm" variant="outline" @click="clearData(p)">
              {{ t('browser.menu.clearData') }}
            </Button>
          </template>
          <Button size="sm" variant="outline" @click="proxyFor = proxyFor === p.id ? null : p.id">
            {{ t('browser.profiles.proxy.button') }}
          </Button>
          <Button
            v-if="p.id !== 'default'"
            size="sm"
            variant="outline"
            class="sb-del"
            @click="onDelete(p)"
          >
            {{ t('browser.profiles.settings.delete') }}
          </Button>
        </div>

        <SettingsBrowserProxy v-if="proxyFor === p.id" :profile="p" @close="proxyFor = null" />
      </div>

      <div class="sb-new">
        <Input
          v-model="newName"
          type="text"
          :placeholder="t('browser.profiles.settings.namePlaceholder')"
          @keydown.enter.prevent="onCreate"
        />
        <Button size="sm" variant="default" :disabled="!newName.trim()" @click="onCreate">
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('browser.profiles.settings.create') }}
        </Button>
      </div>
    </template>

    <WorkspaceBrowserImport
      :open="importFor !== null"
      :profile-id="importFor ?? 'default'"
      @close="importFor = null"
    />
  </div>
</template>

<script setup lang="ts">
// Settings → Hồ sơ trình duyệt (ADR 0101): tạo / đổi tên / đổi màu / xoá hồ sơ, đặt hồ
// sơ mặc định, và các thao tác theo-hồ-sơ của trình duyệt nhúng (nhập từ Chrome, xoá dữ
// liệu duyệt web) — trước đây chỉ có ở menu ⋮ và luôn đánh vào MỘT jar duy nhất.
//
// Xoá hồ sơ là thao tác phá huỷ: partition (login/cookie) và bookmark mất vĩnh viễn,
// nên đi qua confirm() nói rõ hậu quả. Hồ sơ `default` không xoá được (nút không hiện;
// sidecar cũng từ chối).
import type { BrowserProfile } from '~/types'
import { PROFILE_COLORS, useBrowserProfiles } from '~/composables/useBrowserProfiles'
import { useConfirm } from '~/composables/useConfirm'
import { sidecarErrorText, useSidecar } from '~/composables/useSidecar'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import WorkspaceBrowserImport from '~/components/session/workspace/WorkspaceBrowserImport.vue'
import SettingsBrowserProxy from '~/components/settings/SettingsBrowserProxy.vue'

const { t } = useI18n()
const { confirm } = useConfirm()
const hasEngine = useSidecar().available
const api = useBrowserProfiles()
const { profiles, defaultProfileId } = api
const { setDefault } = api

const hasBridge = computed(() => typeof window !== 'undefined' && !!window.awog?.browser)

const editingId = ref<string | null>(null)
const draftName = ref('')
const draftColor = ref<string>(PROFILE_COLORS[0])
const newName = ref('')
const importFor = ref<string | null>(null)
const proxyFor = ref<string | null>(null)

const proxyChip = (p: BrowserProfile): string =>
  p.proxy ? `${p.proxy.type.toUpperCase()} ${p.proxy.host}:${p.proxy.port}` : ''

const fail = (err: unknown): void => {
  useToast().add({
    title: t('browser.toast.failed', { message: sidecarErrorText(err) }),
    color: 'error',
  })
}

const run = async (fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn()
  } catch (err) {
    fail(err)
  }
}

const startEdit = (p: BrowserProfile): void => {
  editingId.value = p.id
  draftName.value = p.name
  draftColor.value = p.color
}

const saveEdit = async (id: string): Promise<void> => {
  const name = draftName.value.trim()
  if (!name) return
  await run(() => api.update(id, { name, color: draftColor.value }))
  editingId.value = null
}

const onCreate = async (): Promise<void> => {
  const name = newName.value.trim()
  if (!name) return
  // Màu xoay vòng theo số hồ sơ hiện có để các hồ sơ liền nhau không trùng màu.
  const color = PROFILE_COLORS[profiles.value.length % PROFILE_COLORS.length]
  await run(() => api.create(name, color))
  newName.value = ''
}

const onDelete = async (p: BrowserProfile): Promise<void> => {
  const ok = await confirm({
    title: t('browser.profiles.settings.deleteTitle', { name: p.name }),
    description: t('browser.profiles.settings.deleteDesc'),
    confirmLabel: t('browser.profiles.settings.delete'),
  })
  if (ok) await run(() => api.remove(p.id))
}

const clearData = async (p: BrowserProfile): Promise<void> => {
  const bridge = window.awog?.browser
  if (!bridge) return
  const ok = await confirm({
    title: t('browser.profiles.clearTitle', { name: p.name }),
    description: t('browser.profiles.clearDesc'),
    confirmLabel: t('browser.menu.clearData'),
  })
  if (!ok) return
  try {
    await bridge.clearData(p.id)
    useToast().add({ title: t('browser.toast.cleared'), color: 'success' })
  } catch (err) {
    fail(err)
  }
}
</script>

<style scoped>
.sb-intro {
  margin: 0 0 12px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.sb-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
}
.sb-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sb-dot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.sb-name {
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.sb-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sb-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sb-swatches {
  display: flex;
  gap: 6px;
}
.sb-swatch {
  width: 20px;
  height: 20px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}
.sb-swatch.on {
  border-color: var(--text);
}
.sb-swatch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.sb-new {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.sb-del {
  color: var(--danger);
}
</style>
