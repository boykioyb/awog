<template>
  <!-- mono-ok (các ô font-mono dưới đây): tên session / start URL / region — copy được
       thẳng vào ~/.aws/config hoặc dán vào trình duyệt. -->
  <div class="flex flex-col gap-3.5">
    <p class="m-0 text-sm text-dim">{{ t('infra.import.sso.subtitle') }}</p>

    <div
      v-if="needsLoginNotice"
      class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
    >
      {{ needsLoginNotice }}
    </div>

    <!-- A7: nguồn SSO máy đã biết ([sso-session] / profile SSO cũ / cache của
         những lần `aws sso login` trước) — chỉ đọc file cục bộ MỘT LẦN lúc mở
         bước này, KHÔNG gọi mạng (khác hẳn nút "Đăng nhập" ở footer, luôn cần
         người dùng tự bấm — luật cứng #1 của bàn giao). Hỏng thì degrade êm
         về giao diện 3 ô gõ tay cũ, không chặn wizard. -->
    <p v-if="sourcesLoading" class="m-0 text-sm leading-relaxed text-dim">
      {{ t('infra.import.sso.src.loading') }}
    </p>
    <AwsSsoImportLoginStepSourcePicker
      v-else-if="sources.length > 0"
      :sources="sources"
      :selected-key="selectedKey"
      :other-key="OTHER_KEY"
      :logging-in="loggingIn"
      @select="onPickSource"
    />
    <p v-else class="m-0 text-sm leading-relaxed text-dim">
      {{ sourcesError ? t('infra.import.sso.src.loadFailed') : t('infra.import.sso.src.noneHint') }}
    </p>

    <div class="flex flex-col gap-1.5">
      <Label class="text-xs font-semibold text-foreground">
        {{ t('infra.import.sso.login.sessionName') }}
      </Label>
      <Input
        v-model="sessionName"
        :class="{ 'border-destructive': showRequired && !sessionName.trim() }"
        :placeholder="t('infra.import.sso.login.sessionNamePh')"
        spellcheck="false"
        :disabled="loggingIn"
        class="font-mono"
      />
      <div v-if="showRequired && !sessionName.trim()" class="text-xs text-destructive">
        {{ t('infra.import.sso.login.required') }}
      </div>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label class="text-xs font-semibold text-foreground">
        {{ t('infra.import.sso.login.startUrl') }}
      </Label>
      <Input
        v-model="startUrl"
        :class="{ 'border-destructive': showRequired && !startUrl.trim() }"
        :placeholder="t('infra.import.sso.login.startUrlPh')"
        spellcheck="false"
        :disabled="loggingIn"
        class="font-mono"
      />
      <div v-if="showRequired && !startUrl.trim()" class="text-xs text-destructive">
        {{ t('infra.import.sso.login.required') }}
      </div>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label class="text-xs font-semibold text-foreground">
        {{ t('infra.import.sso.login.region') }}
      </Label>
      <Input
        v-model="ssoRegion"
        :class="{ 'border-destructive': showRequired && !ssoRegion.trim() }"
        :placeholder="t('infra.import.sso.login.regionPh')"
        spellcheck="false"
        :disabled="loggingIn"
        class="font-mono"
      />
      <div v-if="showRequired && !ssoRegion.trim()" class="text-xs text-destructive">
        {{ t('infra.import.sso.login.required') }}
      </div>
    </div>

    <!-- Hint MỀM — không hứa chắc là bỏ qua được bước đăng nhập: token cache
         có thể đã bị tổ chức thu hồi phía server dù đồng hồ nội bộ còn tính
         là "sống" (xem contract useAwsProfilesApi.ts, field hasLiveToken). -->
    <div
      v-if="liveTokenHint"
      class="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary"
    >
      <Icon name="check" class="size-3.5 flex-none" />
      {{ t('infra.import.sso.src.liveTokenHint') }}
    </div>

    <div
      v-if="loggingIn"
      class="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm text-primary"
    >
      <Icon name="globe" class="size-3.5" />
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
import Input from '~/components/ui/input/Input.vue'

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
