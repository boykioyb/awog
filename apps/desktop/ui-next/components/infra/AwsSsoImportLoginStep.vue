<template>
  <div class="asl">
    <p class="asl-sub">{{ t('infra.import.sso.subtitle') }}</p>

    <div v-if="needsLoginNotice" class="asl-notice">{{ needsLoginNotice }}</div>

    <!-- A7: nguồn SSO máy đã biết ([sso-session] / profile SSO cũ / cache của
         những lần `aws sso login` trước) — chỉ đọc file cục bộ MỘT LẦN lúc mở
         bước này, KHÔNG gọi mạng (khác hẳn nút "Đăng nhập" ở footer, luôn cần
         người dùng tự bấm — luật cứng #1 của bàn giao). Hỏng thì degrade êm
         về giao diện 3 ô gõ tay cũ, không chặn wizard. -->
    <p v-if="sourcesLoading" class="asl-src-note">{{ t('infra.import.sso.src.loading') }}</p>
    <AwsSsoImportLoginStepSourcePicker
      v-else-if="sources.length > 0"
      :sources="sources"
      :selected-key="selectedKey"
      :other-key="OTHER_KEY"
      :logging-in="loggingIn"
      @select="onPickSource"
    />
    <p v-else class="asl-src-note">
      {{ sourcesError ? t('infra.import.sso.src.loadFailed') : t('infra.import.sso.src.noneHint') }}
    </p>

    <div class="asl-field">
      <label class="asl-label">{{ t('infra.import.sso.login.sessionName') }}</label>
      <input
        v-model="sessionName"
        class="asl-input mono"
        :class="{ 'asl-invalid': showRequired && !sessionName.trim() }"
        :placeholder="t('infra.import.sso.login.sessionNamePh')"
        spellcheck="false"
        :disabled="loggingIn"
      />
      <div v-if="showRequired && !sessionName.trim()" class="asl-req">
        {{ t('infra.import.sso.login.required') }}
      </div>
    </div>
    <div class="asl-field">
      <label class="asl-label">{{ t('infra.import.sso.login.startUrl') }}</label>
      <input
        v-model="startUrl"
        class="asl-input mono"
        :class="{ 'asl-invalid': showRequired && !startUrl.trim() }"
        :placeholder="t('infra.import.sso.login.startUrlPh')"
        spellcheck="false"
        :disabled="loggingIn"
      />
      <div v-if="showRequired && !startUrl.trim()" class="asl-req">
        {{ t('infra.import.sso.login.required') }}
      </div>
    </div>
    <div class="asl-field">
      <label class="asl-label">{{ t('infra.import.sso.login.region') }}</label>
      <input
        v-model="ssoRegion"
        class="asl-input mono"
        :class="{ 'asl-invalid': showRequired && !ssoRegion.trim() }"
        :placeholder="t('infra.import.sso.login.regionPh')"
        spellcheck="false"
        :disabled="loggingIn"
      />
      <div v-if="showRequired && !ssoRegion.trim()" class="asl-req">
        {{ t('infra.import.sso.login.required') }}
      </div>
    </div>

    <!-- Hint MỀM — không hứa chắc là bỏ qua được bước đăng nhập: token cache
         có thể đã bị tổ chức thu hồi phía server dù đồng hồ nội bộ còn tính
         là "sống" (xem contract useAwsProfilesApi.ts, field hasLiveToken). -->
    <div v-if="liveTokenHint" class="asl-livehint">
      <Icon name="check" class="asl-livehint-icn" />
      {{ t('infra.import.sso.src.liveTokenHint') }}
    </div>

    <div v-if="loggingIn" class="asl-waiting">
      <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ t('infra.import.sso.login.waiting') }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Bước 1 (đăng nhập) của AwsSsoImport.vue, tách riêng để giữ file cha dưới
// ngưỡng ~250 dòng (docs/coding/nuxt-frontend.md). Cha giữ toàn bộ logic gọi
// `ssoLogin`; component này giờ CŨNG tự dò nguồn SSO máy đã biết (A7) qua
// `ssoSources()` và tự điền 3 field khi người dùng chọn một hàng — máy đã
// biết thì không bắt gõ lại, nhưng KHÔNG hứa "không bao giờ phải gõ": một máy
// chưa từng dùng SSO thì `sources` rỗng và 3 ô gõ tay cũ vẫn còn nguyên.
import { computed, onMounted, ref } from 'vue'
import AwsSsoImportLoginStepSourcePicker from '~/components/infra/AwsSsoImportLoginStepSourcePicker.vue'
import { useAwsProfilesApi } from '~/composables/useAwsProfilesApi'
import type { AwsSsoSource } from '~/composables/useAwsProfilesApi'
import { AWS_PROFILE_NAME_RE } from '~/utils/aws-profile-view'
import type { AwsProfile } from '~/types'

const props = withDefaults(
  defineProps<{
    loggingIn: boolean
    needsLoginNotice: string
    /**
     * Người dùng đã bấm "Đăng nhập bằng trình duyệt" trong lúc còn ô trống.
     *
     * Nút chính CỐ Ý không bị `disabled` khi thiếu ô (xem AwsSsoImport.vue) —
     * nhưng như thế thì phải NÓI RA thiếu gì, nếu không cú bấm vẫn "không có gì
     * xảy ra" y như trước. Cờ này bật phần chỉ lỗi dưới từng ô.
     */
    showRequired?: boolean
    /**
     * Danh sách profile hiện có trên máy — CHỈ dùng để đoán sso region khi
     * nguồn A7 không tự mang theo (fallback cuối: region của profile
     * `default`, nếu có — xem `fallbackRegion`).
     * Không truyền ⇒ fallback đơn giản là không có, KHÔNG vỡ gì (mảng rỗng
     * mặc định).
     */
    profiles?: AwsProfile[]
  }>(),
  { profiles: () => [], showRequired: false },
)

const sessionName = defineModel<string>('sessionName', { required: true })
const startUrl = defineModel<string>('startUrl', { required: true })
const ssoRegion = defineModel<string>('ssoRegion', { required: true })
/**
 * Nguồn đang chọn còn token sống hay không. `AwsSsoImport.vue` dùng giá trị này
 * để đổi nhãn nút chính thành "Dùng phiên đang có" và bỏ qua `aws sso login`
 * (A7) — nhưng CHỈ khi chưa có `needsLoginNotice`, xem `useExistingSession` ở
 * cha. Trong chính step này nó còn bật hint mềm `liveTokenHint` dưới field.
 */
const hasLiveToken = defineModel<boolean>('hasLiveToken', { default: false })

const { t } = useI18n()
const api = useAwsProfilesApi()

// Sentinel cho hàng "Nguồn khác…" trong picker — không phải index thật nên
// không bao giờ trùng `String(i)` của một nguồn hợp lệ.
const OTHER_KEY = 'other'

const sources = ref<AwsSsoSource[]>([])
const sourcesLoading = ref(false)
const sourcesError = ref(false)
const selectedKey = ref<string | null>(null)

onMounted(async () => {
  sourcesLoading.value = true
  try {
    const res = await api.ssoSources()
    sources.value = res.sources
    reconcileSelection()
  } catch (err) {
    // Đọc file cục bộ hỏng (quyền, JSON méo…) — degrade êm, không chặn wizard.
    console.error('[infra] sso sources failed', err)
    sourcesError.value = true
  } finally {
    sourcesLoading.value = false
  }
})

// Đồng bộ hàng đang tô sáng với giá trị field HIỆN CÓ, chạy đúng một lần sau
// khi nạp xong nguồn. Cả 3 ô trống (mở wizard lần đầu) ⇒ tự chọn nguồn tốt
// nhất — mảng do sidecar trả về đã xếp token sống trước, N profile giảm dần,
// rồi tên (xem `listSsoSources()`). Có sẵn giá trị (quay lại bước 1 bằng nút
// "Back" từ bước 2 — component này bị `v-if` gỡ/gắn lại nên mount lại từ đầu)
// ⇒ CHỈ tô sáng đúng hàng khớp `startUrl`, KHÔNG ghi đè field người dùng đã
// chọn/gõ; không khớp hàng nào thì tô "Nguồn khác" thay vì bỏ trống, để rõ là
// giá trị đang có là do người dùng tự gõ, không phải máy quên gợi ý.
function reconcileSelection(): void {
  if (sources.value.length === 0) return
  const allEmpty = !sessionName.value.trim() && !startUrl.value.trim() && !ssoRegion.value.trim()
  if (allEmpty) {
    selectSource(0)
    return
  }
  const idx = sources.value.findIndex((s) => s.startUrl === startUrl.value.trim())
  if (idx >= 0) {
    selectedKey.value = String(idx)
    hasLiveToken.value = sources.value[idx]?.hasLiveToken ?? false
  } else {
    selectedKey.value = OTHER_KEY
    hasLiveToken.value = false
  }
}

const fallbackRegion = computed<string>(() => {
  // "profile đang chọn" không có nghĩa trong wizard KHÁM PHÁ SSO này (chưa
  // có profile cụ thể nào đang mở) — diễn giải hẹp nhất còn dùng được: region
  // của profile `default`, nếu có trong danh sách được truyền vào.
  return props.profiles.find((p) => p.name === 'default')?.region ?? ''
})

// Tên `[sso-session <name>]` suy từ host của start URL (vd
// `d-9xx7a.awsapps.com` → `d-9xx7a`), lọc theo đúng bộ ký tự sidecar chấp
// nhận cho tên profile/session (`AWS_PROFILE_NAME_RE`, dùng lại nguyên văn —
// KHÔNG định nghĩa regex thứ hai cho cùng một allowlist), và không trùng
// `sessionName` của một nguồn khác đã biết trên máy.
function deriveSessionName(url: string): string {
  let base = 'sso'
  try {
    const host = new URL(url).host.split('.')[0]
    if (host) base = host
  } catch {
    // URL không parse được (người dùng gõ dở/dán thiếu) — giữ 'sso', tự sửa được.
  }
  base = base.replace(/[^A-Za-z0-9._@:/+=-]/g, '-').slice(0, 100)
  if (!AWS_PROFILE_NAME_RE.test(base)) base = 'sso'

  const taken = new Set(
    sources.value.map((s) => s.sessionName).filter((n): n is string => Boolean(n)),
  )
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return base
}

function selectSource(i: number): void {
  const src = sources.value[i]
  if (!src) return
  selectedKey.value = String(i)
  startUrl.value = src.startUrl
  sessionName.value = src.sessionName ?? deriveSessionName(src.startUrl)
  ssoRegion.value = src.ssoRegion || fallbackRegion.value
  hasLiveToken.value = src.hasLiveToken
}

function onPickSource(key: string): void {
  if (key === OTHER_KEY) {
    selectedKey.value = OTHER_KEY
    hasLiveToken.value = false
    return
  }
  const i = Number(key)
  if (Number.isInteger(i)) selectSource(i)
}

// Chỉ hiện hint khi đang bám vào MỘT nguồn cụ thể (không phải "Nguồn khác",
// không phải lúc chưa chọn gì) — tránh nói quá khi người dùng đang tự gõ tay.
const liveTokenHint = computed(
  () => selectedKey.value !== null && selectedKey.value !== OTHER_KEY && hasLiveToken.value,
)
</script>

<style scoped>
.asl {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.asl-sub {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.asl-notice {
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.asl-src-note {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.asl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.asl-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
.asl-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.asl-input:focus {
  border-color: var(--accent);
}
.asl-input.asl-invalid {
  border-color: var(--danger);
}
.asl-req {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--danger);
}
.asl-input.mono {
  /* mono-ok: tên session / start URL / region — copy được thẳng vào
     ~/.aws/config hoặc dán vào trình duyệt */
  font-family: var(--code);
}
.asl-input:disabled {
  opacity: 0.6;
}
.asl-livehint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.asl-livehint-icn {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.asl-waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--r-btn);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
  color: var(--accent);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
