<template>
  <div>
    <SettingsPaneHeader :title="t('browser.profiles.settings.heading')" />
    <p class="mt-0 mb-3 text-sm text-dim">{{ t('browser.profiles.settings.intro') }}</p>

    <div v-if="!hasEngine" class="mb-3 text-sm text-dim">
      {{ t('browser.profiles.settings.unavailable') }}
    </div>

    <template v-else>
      <div
        v-for="p in profiles"
        :key="p.id"
        class="mb-2 flex flex-col gap-2 rounded-xl border px-3 py-2.5"
      >
        <div class="flex items-center gap-2">
          <!-- Chấm màu = màu dữ liệu người dùng chọn cho hồ sơ, không phải token theme. -->
          <span class="size-2.5 shrink-0 rounded-full" :style="{ background: p.color }" />
          <span class="text-base text-foreground">{{ p.name }}</span>
          <Badge v-if="p.id === defaultProfileId" variant="outline" class="text-muted-foreground">
            {{ t('browser.profiles.settings.default') }}
          </Badge>
          <Badge
            v-if="p.proxy"
            variant="outline"
            class="text-muted-foreground"
            :title="t('browser.profiles.proxy.chipTitle')"
          >
            {{ proxyChip(p) }}
          </Badge>
          <span class="flex-1" />
        </div>

        <!-- Sửa tên + màu tại chỗ — mở bằng nút "Đổi tên", không modal. -->
        <div v-if="editingId === p.id" class="flex flex-col gap-2">
          <Input
            v-model="draftName"
            type="text"
            :placeholder="t('browser.profiles.settings.namePlaceholder')"
            @keydown.enter.prevent="saveEdit(p.id)"
          />
          <div
            class="flex gap-1.5"
            role="radiogroup"
            :aria-label="t('browser.profiles.settings.color')"
          >
            <!-- Ô màu: nền inline là màu dữ liệu của hồ sơ (bảng PROFILE_COLORS). -->
            <Button
              v-for="c in PROFILE_COLORS"
              :key="c"
              type="button"
              variant="ghost"
              size="iconSm"
              class="size-5 rounded-full border-2 border-transparent p-0"
              :class="{ 'border-foreground': c === draftColor }"
              :style="{ background: c }"
              :title="c"
              role="radio"
              :aria-checked="c === draftColor"
              @click="draftColor = c"
            />
          </div>
          <div class="flex flex-wrap gap-1.5">
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

        <div v-else class="flex flex-wrap gap-1.5">
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
            class="text-destructive hover:text-destructive"
            @click="onDelete(p)"
          >
            {{ t('browser.profiles.settings.delete') }}
          </Button>
        </div>

        <SettingsBrowserProxy v-if="proxyFor === p.id" :profile="p" @close="proxyFor = null" />
      </div>

      <div class="mt-3 flex gap-2">
        <Input
          v-model="newName"
          type="text"
          :placeholder="t('browser.profiles.settings.namePlaceholder')"
          @keydown.enter.prevent="onCreate"
        />
        <Button size="sm" variant="default" :disabled="!newName.trim()" @click="onCreate">
          <Icon name="plus" class="size-3.5" />
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
