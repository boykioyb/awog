<template>
  <div class="alp">
    <div class="alp-label">{{ t('infra.import.sso.src.pickerLabel') }}</div>
    <div class="alp-list">
      <button
        v-for="(src, i) in sources"
        :key="i"
        type="button"
        class="alp-row"
        :class="{ on: selectedKey === String(i) }"
        :disabled="loggingIn"
        @click="emit('select', String(i))"
      >
        <Icon :name="originIcon(src.origin)" class="alp-icn" />
        <div class="alp-main">
          <span class="alp-url mono">{{ shortUrl(src.startUrl) }}</span>
          <div class="alp-meta">
            <span class="tag">{{ originLabel(src.origin) }}</span>
            <span v-if="src.profileCount > 0" class="tag">
              {{ t('infra.import.sso.src.profileCount', { n: src.profileCount }) }}
            </span>
            <span v-if="src.hasLiveToken" class="tag alp-live">
              {{ t('infra.import.sso.src.liveToken') }}
            </span>
          </div>
        </div>
        <Icon v-if="selectedKey === String(i)" name="check" class="alp-tick" />
      </button>

      <button
        type="button"
        class="alp-row alp-other"
        :class="{ on: selectedKey === otherKey }"
        :disabled="loggingIn"
        @click="emit('select', otherKey)"
      >
        <Icon name="edit" class="alp-icn" />
        <span class="alp-other-lbl">{{ t('infra.import.sso.src.other') }}</span>
        <Icon v-if="selectedKey === otherKey" name="check" class="alp-tick" />
      </button>
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

<style scoped>
.alp {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.alp-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
}
.alp-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.alp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--r-btn);
  border: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--text);
}
.alp-row:hover:not(:disabled) {
  background: var(--bgHover);
}
.alp-row:disabled {
  cursor: default;
  opacity: 0.6;
}
/* Selection state = accent-tint (KHÔNG nền xám --bgActive), + thanh accent
   2px bên trái — quy ước chọn hàng dùng chung của repo (.claude/rules/nuxt-vue.md). */
.alp-row.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  box-shadow: inset 2px 0 0 0 var(--accent);
}
.alp-icn {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textDim);
}
.alp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.alp-url {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alp-url.mono {
  /* mono-ok: start URL — người dùng có thể copy để dán lại chỗ khác */
  font-family: var(--code);
}
.alp-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.alp-live {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.alp-tick {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--accent);
}
.alp-other-lbl {
  flex: 1;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
</style>
