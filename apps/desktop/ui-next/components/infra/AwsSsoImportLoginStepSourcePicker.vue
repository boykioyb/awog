<template>
  <div class="flex flex-col gap-2">
    <div class="text-xs font-semibold text-dim">{{ t('infra.import.sso.src.pickerLabel') }}</div>
    <div class="flex flex-col gap-1.5">
      <!-- Hàng đang chọn = accent-tint + thanh accent bên trái (KHÔNG nền xám) — quy ước
           chọn hàng dùng chung của repo (.claude/rules/nuxt-vue.md). -->
      <Button
        v-for="(src, i) in sources"
        :key="i"
        type="button"
        variant="outline"
        class="h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left font-normal whitespace-normal text-foreground shadow-none"
        :class="{
          'border-selected-border bg-selected shadow-[inset_2px_0_0_var(--color-primary)]':
            selectedKey === String(i),
        }"
        :disabled="loggingIn"
        @click="emit('select', String(i))"
      >
        <Icon :name="originIcon(src.origin)" class="size-3.5 flex-none text-dim" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <!-- mono-ok: start URL — người dùng có thể copy để dán lại chỗ khác -->
          <span class="truncate font-mono text-sm text-foreground">
            {{ shortUrl(src.startUrl) }}
          </span>
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" class="rounded-sm font-normal text-muted-foreground">
              {{ originLabel(src.origin) }}
            </Badge>
            <Badge
              v-if="src.profileCount > 0"
              variant="outline"
              class="rounded-sm font-normal text-muted-foreground"
            >
              {{ t('infra.import.sso.src.profileCount', { n: src.profileCount }) }}
            </Badge>
            <Badge
              v-if="src.hasLiveToken"
              variant="outline"
              class="rounded-sm border-selected-border bg-selected font-normal text-primary"
            >
              {{ t('infra.import.sso.src.liveToken') }}
            </Badge>
          </div>
        </div>
        <Icon
          v-if="selectedKey === String(i)"
          name="check"
          class="size-3.5 flex-none text-primary"
        />
      </Button>

      <Button
        type="button"
        variant="outline"
        class="h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left font-normal text-foreground shadow-none"
        :class="{
          'border-selected-border bg-selected shadow-[inset_2px_0_0_var(--color-primary)]':
            selectedKey === otherKey,
        }"
        :disabled="loggingIn"
        @click="emit('select', otherKey)"
      >
        <Icon name="edit" class="size-3.5 flex-none text-dim" />
        <span class="flex-1 text-sm text-foreground">{{ t('infra.import.sso.src.other') }}</span>
        <Icon
          v-if="selectedKey === otherKey"
          name="check"
          class="size-3.5 flex-none text-primary"
        />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Danh sách chọn nguồn SSO máy đã biết (A7 — [sso-session]/profile SSO cũ/cache
// những lần đăng nhập trước, xem sidecar `infra/aws/sso-sources.ts`). Thuần
// trình bày: KHÔNG gọi RPC, KHÔNG giữ state chọn — cha (AwsSsoImportLoginStep.vue)
// sở hữu `selectedKey` + việc điền 3 field khi một hàng được bấm. Tách riêng
// component này để giữ file cha dưới ngưỡng ~250 dòng (docs/coding/nuxt-frontend.md).
import type { AwsSsoSource, AwsSsoSourceOrigin } from '~/composables/useAwsProfilesApi'

defineProps<{
  sources: AwsSsoSource[]
  /** `String(index)` của hàng đang tô sáng, `otherKey`, hoặc null (chưa chọn gì). */
  selectedKey: string | null
  /** Sentinel cho hàng "Nguồn khác…" — cha định nghĩa để không trùng `String(i)`. */
  otherKey: string
  loggingIn: boolean
}>()

const emit = defineEmits<{ select: [key: string] }>()

const { t } = useI18n()

function originLabel(origin: AwsSsoSourceOrigin): string {
  if (origin === 'sso-session') return t('infra.import.sso.src.originSession')
  if (origin === 'profile') return t('infra.import.sso.src.originProfile')
  return t('infra.import.sso.src.originCache')
}
function originIcon(origin: AwsSsoSourceOrigin): string {
  if (origin === 'sso-session') return 'link'
  if (origin === 'profile') return 'layers'
  return 'clock'
}
// Rút gọn cho dễ đọc trong một dòng: bỏ scheme, giữ host + path (nếu có gì
// ngoài "/"). Không parse được (chuỗi lạ trong cache) thì trả nguyên văn.
function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url
  }
}
</script>
