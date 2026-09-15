<template>
  <LibraryEntityModal
    :open="open"
    :title="
      profile
        ? t('infra.acc.editor.editTitle', { name: profile.name })
        : t('infra.acc.editor.newTitle')
    "
    :width="560"
    :lock-scrim="saving"
    @close="onRequestClose"
  >
    <div class="ape">
      <!-- credential_process CHỈ ĐỌC ở v1 (luật cứng #3) — không có đường ghi
           nào cho lệnh này, nên form không hiện ra, chỉ chỉ dẫn sửa trực tiếp. -->
      <AwsProfileEditorProcessView v-if="isProcessProfile" />

      <!-- Sau khi lưu xong: đề nghị NGAY kiểm tra danh tính (STS) thay vì cho
           sửa tiếp trong cùng modal — tránh đè một lần ghi khác lên bản vừa
           commit trước khi người dùng kịp xem kết quả. -->
      <div v-else-if="savedProfile" class="ape-post">
        <div class="ape-post-head">
          <Icon
            name="check"
            style="width: var(--icon-sm); height: var(--icon-sm); color: var(--accent)"
          />
          <span>{{ t('infra.editor.saved', { name: savedProfile.name }) }}</span>
        </div>

        <AwsProfileEditorIdentityCheck
          :checking="identityChecking"
          :result="identityResult"
          @retry="runIdentityCheck(savedProfile.name)"
        />
      </div>

      <!-- Form theo kiểu (static/sso/assume-role) — process không tới được
           đây, và sau khi lưu thành công nhánh trên thay chỗ form này. -->
      <div v-else class="ape-form">
        <!-- Chú giải cho dấu `*` ở các nhãn bên dưới — đứng TRƯỚC ô đầu tiên để
             người dùng biết quy ước trước khi gặp dấu đầu tiên. Không cần điều
             kiện hiện/ẩn: ô Tên luôn có dấu ở mọi lượt (form dùng chung cho cả
             tạo mới và sửa), nên dòng này không bao giờ thừa. -->
        <div class="ape-legend">{{ t('infra.editor.requiredLegend') }}</div>

        <div class="ape-field">
          <label class="ape-label">
            {{ t('infra.editor.name') }}
            <span class="ape-req" aria-hidden="true">*</span>
          </label>
          <input
            v-model.trim="name"
            class="ape-input mono"
            spellcheck="false"
            autocomplete="off"
            :placeholder="t('infra.editor.namePh')"
          />
          <div v-if="name.trim() && !nameValid" class="ape-error">
            {{ t('infra.editor.nameInvalid') }}
          </div>
          <div v-else-if="collidesWithOther" class="ape-warn">
            {{ t('infra.editor.nameCollides') }}
          </div>
        </div>

        <!-- Profile `login`: KHÔNG có ô đổi kiểu. Đổi nó sang static nghĩa là bỏ
             phiên Console để chạy bằng khoá dài hạn — sidecar từ chối
             (`LOGIN_READONLY`), nên ở đây cũng không được mời. -->
        <div v-if="!isLoginProfile" class="ape-field">
          <label class="ape-label">{{ t('infra.editor.kind') }}</label>
          <div class="seg ape-seg">
            <span :class="{ on: kind === 'static' }" @click="kind = 'static'">
              {{ t('infra.editor.kindStatic') }}
            </span>
            <span :class="{ on: kind === 'sso' }" @click="kind = 'sso'">
              {{ t('infra.editor.kindSso') }}
            </span>
            <span :class="{ on: kind === 'assume-role' }" @click="kind = 'assume-role'">
              {{ t('infra.editor.kindAssumeRole') }}
            </span>
          </div>
        </div>

        <!-- "Vắng mặt = giữ nguyên" (S2a) — mọi ô bỏ trống lúc sửa không đụng
             giá trị hiện tại trên đĩa, kể cả những ô không prefill được (xem
             openIssues: sso_region/external_id/duration_seconds không có trên
             đường đọc `infra.contexts`). -->
        <div v-if="isExisting && kind !== 'login'" class="ape-hint">
          {{ t('infra.editor.keepHint') }}
        </div>

        <AwsProfileEditorLoginFields
          v-if="kind === 'login'"
          v-model="loginRegion"
          :profile="profile"
          :profiles="profiles"
          :name="trimmedName"
          :region-hint="loginRegionHint"
          :region-hint-tone="loginRegionHintTone"
          :region-required="regionRequired"
          @relogin="onLoginRelogin"
        />
        <AwsProfileEditorStaticFields
          v-else-if="kind === 'static'"
          v-model="staticForm"
          :is-existing="isExisting"
          :secrets-loaded="secretsLoaded"
          :region-hint="staticRegionHint"
          :region-hint-tone="staticRegionHintTone"
          :region-required="regionRequired"
        />
        <AwsProfileEditorSsoFields
          v-else-if="kind === 'sso'"
          v-model="ssoForm"
          :is-existing="isExisting"
          :region-hint="ssoRegionHint"
        />
        <AwsProfileEditorAssumeRoleFields
          v-else
          v-model="assumeRoleForm"
          :profiles="profiles"
          :exclude-name="originalName || trimmedName"
          :is-existing="isExisting"
        />

        <!-- Nút "Kiểm tra" trong form: kết quả hiện NGAY TẠI ĐÂY, không phải
             chuyển sang màn "đã lưu" (màn đó chỉ dành cho lượt lưu thành công). -->
        <AwsProfileEditorIdentityCheck
          v-if="verifyVisible"
          :checking="identityChecking"
          :result="identityResult"
          @retry="onVerify"
        />
      </div>
    </div>

    <template #footer>
      <!-- Lý do nút Lưu đang khoá, đặt ở chỗ LUÔN nhìn thấy. Câu đầy đủ nằm dưới ô
           Region, mà `.lem-body` cuộn được nên ở cửa sổ thấp nó rơi ra ngoài vùng
           nhìn (đo được ở 860px: body clientHeight 622 < scrollHeight 674, đáy câu
           774 > đáy vùng cuộn 740): nút mờ mà không thấy vì sao. Cuộn hộ không ăn —
           modal tự focus ô Tên rồi kéo vùng cuộn về đầu (đo được: scrollTop 0). -->
      <span v-if="regionMissing" class="ape-warn">
        {{ t('infra.editor.region.requiredFooter') }}
      </span>
      <span style="flex: 1" />
      <template v-if="isProcessProfile || savedProfile">
        <button class="btn pri" type="button" @click="onRequestClose">
          {{ t('common.close') }}
        </button>
      </template>
      <template v-else>
        <button class="btn" type="button" :disabled="saving" @click="onRequestClose">
          {{ t('common.cancel') }}
        </button>
        <!-- Kiểm tra TRƯỚC khi ghi: khoá vừa gõ đi thẳng tới
             `sts get-caller-identity` qua env (xem infra.identity-check), nên
             gõ nhầm một ký tự lộ ra ngay chứ không nằm im trong ~/.aws. -->
        <button
          class="btn"
          type="button"
          :disabled="!canVerify || saving || identityChecking"
          @click="onVerify"
        >
          <Icon name="shield" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{
            identityChecking ? t('infra.editor.verify.running') : t('infra.editor.verify.action')
          }}
        </button>
        <button class="btn pri" type="button" :disabled="!canSave || saving" @click="onSave">
          {{ saving ? t('infra.editor.saving') : t('common.save') }}
        </button>
      </template>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Thêm / sửa profile AWS theo kiểu (A3, docs/features/aws-profile-manager.md
// §"Form theo kiểu profile"). Component này TỰ gọi useAwsProfilesApi() +
// useConfirm() + useToast() bên trong chính nó (phân vai U0 đã chốt — trang
// không gọi RPC hộ) và chỉ emit('save') SAU KHI profileSave() đã thành công.
//
// Vòng đời một lần mở modal:
//   1. form (theo kind) → onSave() → api.profileSave()
//   2. thành công ⇒ xoá sạch 3 ô secret khỏi state NGAY (luật cứng #2), chuyển
//      sang màn "đã lưu" và tự chạy identityCheck() — không cho sửa tiếp trong
//      cùng lần mở (đóng rồi mở lại nếu cần sửa nữa).
//   3. MỌI cách đóng modal sau bước 2 (nút Đóng, nút X, Esc, click ra ngoài)
//      đều emit('save') — vì tại thời điểm đó dữ liệu ĐÃ ghi, trang phải nạp
//      lại danh sách. Trước bước 2, mọi cách đóng đều emit('cancel').
import { computed, ref, watch } from 'vue'
import AwsProfileEditorAssumeRoleFields from '~/components/infra/AwsProfileEditorAssumeRoleFields.vue'
import AwsProfileEditorIdentityCheck from '~/components/infra/AwsProfileEditorIdentityCheck.vue'
import AwsProfileEditorLoginFields from '~/components/infra/AwsProfileEditorLoginFields.vue'
import AwsProfileEditorProcessView from '~/components/infra/AwsProfileEditorProcessView.vue'
import AwsProfileEditorSsoFields from '~/components/infra/AwsProfileEditorSsoFields.vue'
import AwsProfileEditorStaticFields from '~/components/infra/AwsProfileEditorStaticFields.vue'
import { emptyAssumeRoleForm, emptySsoForm, emptyStaticForm } from '~/utils/aws-profile-form'
import { detectRegion, type RegionDetection } from '~/utils/aws-regions'
import { AWS_PROFILE_NAME_RE } from '~/utils/aws-profile-view'
import type {
  AwsIdentityCheckResult,
  AwsProfileConfigFields,
  AwsProfileSaveParams,
  AwsProfileSecretFields,
  AwsProfileWriteErrorCode,
  AwsProfileWriteKind,
} from '~/composables/useAwsProfilesApi'
import type { AwsProfile } from '~/types'

const props = withDefaults(
  defineProps<{
    open: boolean
    profile: AwsProfile | null
    profiles: AwsProfile[]
    /**
     * Region đang ghim toàn app (`settings.infra.region`) — nguồn thứ hai của
     * `detectRegion()`, sau region của chính profile đang sửa. Vắng ⇒ chỉ còn
     * profile đang sửa và profile `default` của máy.
     */
    defaultRegion?: string
  }>(),
  { defaultRegion: '' },
)

// `relogin` = người dùng bấm "Đăng nhập lại" ở màn chỉ đọc của profile `login`;
// cha mở modal đăng nhập Console với đúng tên profile đó.
const emit = defineEmits<{ save: []; cancel: []; relogin: [name: string] }>()

const { t } = useI18n()
const api = useAwsProfilesApi()
const { confirm } = useConfirm()
const toast = useToast()

const isExisting = computed(() => !!props.profile)
const isProcessProfile = computed(() => props.profile?.kind === 'process')
const isLoginProfile = computed(() => props.profile?.kind === 'login')

// --- form state ------------------------------------------------------------
const name = ref('')
const originalName = ref('')
const kind = ref<AwsProfileWriteKind>('static')

const staticForm = ref(emptyStaticForm())
/** Ô duy nhất của profile `login` mà AWOG ghi được (ngoài cái tên) — xem `assertLoginEdit`. */
const loginRegion = ref('')
const ssoForm = ref(emptySsoForm())
const assumeRoleForm = ref(emptyAssumeRoleForm())

// Khai TRƯỚC watch(..., { immediate: true }) bên dưới — callback đọc các ref
// này ngay lúc gọi watch(), khai sau sẽ vỡ TDZ ("Cannot access before
// initialization") vì <script setup> chạy tuần tự từ trên xuống.
const saving = ref(false)
const savedProfile = ref<AwsProfile | null>(null)
const identityChecking = ref(false)
const identityResult = ref<AwsIdentityCheckResult | null>(null)
/** Ba ô secret đang chứa giá trị THẬT đọc từ `~/.aws/credentials`. */
const secretsLoaded = ref(false)
/** Kết quả tự dò region của lần mở modal này (null = không dò được gì). */
const detectedRegion = ref<RegionDetection | null>(null)
/** Vé của lượt nạp secret; lượt cũ về muộn không được ghi đè lượt mới. */
let secretsLoadToken = 0
/** Thế hệ của lượt Kiểm tra: sửa form hoặc thử lại ⇒ kết quả đang bay bị bỏ. */
let verifySeq = 0

const trimmedName = computed(() => name.value.trim())
const nameValid = computed(() => AWS_PROFILE_NAME_RE.test(trimmedName.value))
const isRename = computed(() => isExisting.value && trimmedName.value !== originalName.value)
// Trùng tên ⇒ cảnh báo + cho ghi đè có xác nhận (không chặn cứng) — profile
// tạo mới trùng tên bất kỳ profile nào, hoặc đổi tên vào chỗ đã có người ở.
const collidesWithOther = computed(() => {
  const n = trimmedName.value
  if (!n) return false
  if (!isExisting.value) return props.profiles.some((p) => p.name === n)
  return isRename.value && props.profiles.some((p) => p.name === n)
})

// Region của profile `default` trên máy — nguồn CUỐI của `detectRegion()`. Đây
// là region mà chính AWS CLI dùng khi không có gì khác chỉ định, nên nó là câu
// trả lời đúng cho "máy này thường làm việc ở đâu".
const defaultProfileRegion = computed(
  () => props.profiles.find((p) => p.name === 'default')?.region ?? '',
)

/**
 * Câu giải thích "region này vừa tự dò được từ đâu" — CHỈ hiện khi giá trị đang
 * có đúng bằng giá trị đã dò, tức khi người dùng chưa tự sửa. Sửa rồi mà vẫn
 * hiện "tự dò" là nói sai về nguồn gốc của con số trên màn hình.
 */
function regionHintFor(current: string): string | undefined {
  const detected = detectedRegion.value
  if (!detected || current.trim() !== detected.region) return undefined
  return t(`infra.editor.region.detected.${detected.from}`)
}
/**
 * Ô Region đang trống ở một profile `static` — đây là điều kiện CHẶN LƯU.
 *
 * `[default]` của máy KHÔNG phải là fallback cho profile khác: region chỉ được
 * đọc từ section của chính profile đang dùng (`--profile X`), nên một profile
 * thiếu `region` chết ngay ở mọi lệnh — đo được trên máy này: nhật ký
 * `~/.awog/infra-audit` có ba lượt `NoRegion` ("You must specify a region") lúc
 * 01:17:21, 01:33:42 và 01:34:00 ngày 2026-09-14, xen giữa các lần lưu không
 * region, và `[default] region = ap-northeast-1` vẫn nằm nguyên trên đĩa.
 *
 * Bản đầu của chỗ này chỉ HỎI rồi vẫn cho ghi ("Vẫn lưu"), và ca 01:32 cho thấy
 * hệ quả: bấm Lưu, không một dòng nhật ký, `~/.aws/config` không đổi, màn chi
 * tiết vẫn "Chưa đặt". Thiếu Region không phải một lựa chọn của người dùng, nên
 * nó là điều kiện hợp lệ của form — đứng cùng chỗ với `nameValid`, không phải
 * một hộp thoại để bấm cho qua.
 *
 * Điều kiện "trên đĩa cũng không có" giữ luật S2a cho ô trống kiểu KHÁC: sửa
 * một profile đã có Region rồi để trống vẫn là "giữ nguyên", không chặn.
 */
const regionMissing = computed(
  () =>
    (kind.value === 'static' || kind.value === 'login') &&
    activeRegion.value.trim() === '' &&
    (props.profile?.region ?? '').trim() === '',
)

/**
 * Ô Region đang hiển thị theo kiểu profile. `login` có state riêng (`loginRegion`)
 * vì nó chỉ có đúng ô đó để ghi, còn `sso`/`assume-role` không đi qua đây.
 */
const activeRegion = computed(() =>
  kind.value === 'login' ? loginRegion.value : staticForm.value.region,
)

/** Câu dưới ô Region: "tự dò từ đâu", hoặc LÝ DO nút Lưu đang khoá. */
function regionHintForForm(current: string): string | undefined {
  const fromDetection = regionHintFor(current)
  if (fromDetection !== undefined) return fromDetection
  // Ô trống ở một profile chưa có Region: nói YÊU CẦU ngay tại chỗ, cùng màu với
  // câu lỗi của ô Tên profile — nút Lưu đang khoá và đây là lý do.
  return regionMissing.value ? t('infra.editor.region.requiredHint') : undefined
}

const staticRegionHint = computed(() =>
  kind.value === 'static' ? regionHintForForm(staticForm.value.region) : undefined,
)
const loginRegionHint = computed(() =>
  kind.value === 'login' ? regionHintForForm(loginRegion.value) : undefined,
)
/**
 * Dấu `*` trên nhãn ô Region của profile `static`. Gần với `regionMissing()`
 * nhưng KHÁC một điểm: `regionMissing` chỉ đúng khi ô ĐANG trống (nó là điều
 * kiện của nút Lưu), còn nhãn thì phải ổn định suốt lượt mở modal — bỏ dấu đi
 * ngay sau khi người dùng vừa điền ô là nói dối về một ô vẫn bắt buộc. Nguồn sự
 * thật ở đây là "TRÊN ĐĨA có region chưa": chưa có thì region bắt buộc cho cả
 * lượt sửa; đã có thì để trống là "giữ nguyên" (S2a) nên không có dấu.
 */
const regionRequired = computed(
  () =>
    (kind.value === 'static' || kind.value === 'login') &&
    (props.profile?.region ?? '').trim() === '',
)

/** `warn` để câu trên ăn màu lỗi, không lẫn với câu "tự dò từ đâu". */
const staticRegionHintTone = computed<'info' | 'warn'>(() =>
  regionMissing.value ? 'warn' : 'info',
)
/* Cùng điều kiện với ô của kiểu static: `regionMissing` đã bao cả hai kiểu. */
const loginRegionHintTone = staticRegionHintTone
const ssoRegionHint = computed(() =>
  kind.value === 'sso' ? regionHintFor(ssoForm.value.region) : undefined,
)

/**
 * Ô Region của profile `login` đã khác giá trị trên đĩa chưa (so cả hai đầu đã
 * trim, vì chuỗi trong file có thể có khoảng trắng thừa).
 */
const loginRegionChanged = computed(
  () => kind.value === 'login' && loginRegion.value.trim() !== (props.profile?.region ?? '').trim(),
)

/**
 * Có gì để GHI không, ở một profile `login`: đổi tên, hoặc đổi region. Không có
 * ô nào khác — phiên do `aws login` giữ (xem `assertLoginEdit` phía sidecar).
 */
const isLoginDirty = computed(
  () =>
    kind.value === 'login' &&
    (trimmedName.value !== originalName.value || loginRegionChanged.value),
)

// Field bắt buộc theo kind chỉ ép khi TẠO MỚI — sửa một profile có sẵn thì mọi
// ô để trống nghĩa là "giữ nguyên" (S2a), không phải "thiếu dữ liệu".
//
// NGOẠI LỆ: Region của profile `static`/`login` (`regionMissing`) — ở đó ô trống
// nghĩa là profile HỎNG, nên nó bị chặn cho cả lượt sửa chứ không chỉ lượt tạo.
//
// NGOẠI LỆ THỨ HAI: profile `login` không có khái niệm "tạo mới" (nó chỉ ra đời
// từ `aws login`), nên điều kiện duy nhất của nút Lưu là "có gì đó đã đổi".
const canSave = computed(() => {
  if (isProcessProfile.value || savedProfile.value) return false
  if (!nameValid.value) return false
  if (regionMissing.value) return false
  // Profile `login`: chỉ TÊN và REGION ghi được, nên nút Lưu phải đứng yên khi
  // chưa đổi gì — bật lên là mời người dùng bấm vào một lần ghi rỗng (một bản sao
  // lưu + một dòng nhật ký không nói lên điều gì).
  if (kind.value === 'login') return isLoginDirty.value
  if (isExisting.value) return true
  if (kind.value === 'static') {
    return (
      staticForm.value.accessKeyId.trim().length > 0 &&
      staticForm.value.secretAccessKey.trim().length > 0
    )
  }
  if (kind.value === 'sso') {
    const s = ssoForm.value
    const identOk =
      s.source === 'session'
        ? s.ssoSession.trim().length > 0
        : s.ssoStartUrl.trim().length > 0 && s.ssoRegion.trim().length > 0
    return identOk && s.ssoAccountId.trim().length > 0 && s.ssoRoleName.trim().length > 0
  }
  return (
    assumeRoleForm.value.roleArn.trim().length > 0 &&
    assumeRoleForm.value.sourceProfile.trim().length > 0
  )
})

// --- reset / prefill khi mở modal ------------------------------------------
watch(
  () => [props.open, props.profile] as const,
  ([isOpen, p]) => {
    // Đóng modal PHẢI xoá ô khoá. Bốn overlay của /infra mount vĩnh viễn (chúng
    // chỉ đổi `open`), nên không có `onUnmounted` nào dọn hộ: bỏ nhánh này thì
    // một secret người dùng gõ rồi bấm Huỷ vẫn nằm trong bộ nhớ renderer tới khi
    // họ mở lại modal — trái luật cứng #2 ("xoá sạch khỏi state ngay").
    if (!isOpen) {
      clearSecrets()
      return
    }
    saving.value = false
    savedProfile.value = null
    identityChecking.value = false
    identityResult.value = null
    detectedRegion.value = null
    secretsLoadToken += 1

    name.value = p?.name ?? ''
    originalName.value = p?.name ?? ''
    kind.value =
      p && (p.kind === 'sso' || p.kind === 'assume-role' || p.kind === 'login') ? p.kind : 'static'

    staticForm.value = emptyStaticForm()
    staticForm.value.region = p?.region ?? ''
    staticForm.value.output = p?.output ?? ''

    loginRegion.value = p && p.kind === 'login' ? (p.region ?? '') : ''
    if (kind.value === 'login' && loginRegion.value.trim() === '') {
      const detected = detectRegion({
        appRegion: props.defaultRegion,
        defaultProfileRegion: defaultProfileRegion.value,
      })
      if (detected) {
        loginRegion.value = detected.region
        detectedRegion.value = detected
      }
    }

    // TỰ DÒ REGION (2026-09-14). Chỉ điền khi ô đang TRỐNG: một profile đã có
    // region thì không có gì để dò, và ghi đè lựa chọn có sẵn của người dùng là
    // đúng thứ tự động hoá không được phép làm.
    if (staticForm.value.region.trim() === '') {
      const detected = detectRegion({
        appRegion: props.defaultRegion,
        defaultProfileRegion: defaultProfileRegion.value,
      })
      if (detected) {
        staticForm.value.region = detected.region
        detectedRegion.value = detected
      }
    }

    // NẠP KHOÁ TĨNH vào form (2026-09-14 — trước đây là placeholder "để trống =
    // giữ nguyên", người dùng không thấy được khoá nào đang nằm trên đĩa).
    // Bất đồng bộ: `p` có thể đổi trong lúc chờ, nên kết quả về muộn bị chặn
    // bằng vé + so lại tên profile.
    if (p && p.kind === 'static' && p.hasStaticKeys) void loadStaticSecrets(p)

    ssoForm.value = emptySsoForm()
    if (p) {
      // Đường đọc `infra.contexts` không trả `sso_region` (chỉ AwsProfile không
      // có field này) — nhánh 'manual' vì thế luôn mở với ô region rỗng dù file
      // đã có giá trị; để trống lúc lưu là "giữ nguyên", không phải xoá.
      ssoForm.value.source = p.ssoSession ? 'session' : 'manual'
      ssoForm.value.ssoSession = p.ssoSession ?? ''
      ssoForm.value.ssoStartUrl = p.ssoStartUrl ?? ''
      ssoForm.value.ssoAccountId = p.ssoAccountId ?? ''
      ssoForm.value.ssoRoleName = p.ssoRoleName ?? ''
      ssoForm.value.region = p.region ?? ''
    }
    if (ssoForm.value.region.trim() === '') {
      const detected = detectRegion({
        appRegion: props.defaultRegion,
        defaultProfileRegion: defaultProfileRegion.value,
      })
      if (detected) {
        ssoForm.value.region = detected.region
        detectedRegion.value = detected
      }
    }
    // `sso_region` (region của portal SSO) CỐ Ý không tự dò: portal thường ở
    // us-east-1 trong khi tài nguyên ở ap-southeast-1, nên dò hộ ở đây là gợi ý
    // sai cho một trường mà sai một ký tự thì `sso login` hỏng. Dropdown vẫn có.

    assumeRoleForm.value = emptyAssumeRoleForm()
    if (p) {
      assumeRoleForm.value.roleArn = p.roleArn ?? ''
      assumeRoleForm.value.sourceProfile = p.sourceProfile ?? ''
      assumeRoleForm.value.mfaSerial = p.mfaSerial ?? ''
      // externalId/durationSeconds: cùng lý do — không có trên đường đọc.
    }
  },
  { immediate: true },
)

// Kết quả "Kiểm tra" gắn với ĐÚNG bộ giá trị đã thử: người dùng sửa lại một ô
// sau đó thì con số tài khoản trên màn hình đã là của bộ khoá CŨ. Bỏ nó đi thay
// vì để người dùng tin một kết quả không còn thuộc về thứ đang nằm trong form.
// Chỉ áp dụng cho kết quả của nút Kiểm tra (màn sau khi lưu không sửa được gì).
watch(
  [staticForm, ssoForm, assumeRoleForm, kind],
  () => {
    if (savedProfile.value !== null) return
    identityResult.value = null
    // Sửa giữa chừng trong lúc `get-caller-identity` đang bay ⇒ kết quả về sau
    // đó là của bộ giá trị CŨ, không được hiện lên (xem `verifySeq`).
    verifySeq += 1
  },
  { deep: true },
)

// --- lưu ---------------------------------------------------------------
function buildConfig(): AwsProfileConfigFields {
  const config: AwsProfileConfigFields = {}
  if (kind.value === 'login') {
    // Chỉ gửi region khi ĐỔI: một lần ghi thừa là một bản sao lưu + một dòng nhật
    // ký không cần thiết. Ô để trống = "giữ nguyên" (S2a) như mọi kiểu khác.
    if (loginRegionChanged.value) {
      const region = loginRegion.value.trim()
      if (region) config.region = region
    }
    return config
  }
  if (kind.value === 'static') {
    const region = staticForm.value.region.trim()
    const output = staticForm.value.output.trim()
    if (region) config.region = region
    if (output) config.output = output
  } else if (kind.value === 'sso') {
    const s = ssoForm.value
    if (s.source === 'session') {
      const session = s.ssoSession.trim()
      if (session) config.sso_session = session
    } else {
      const startUrl = s.ssoStartUrl.trim()
      const ssoRegion = s.ssoRegion.trim()
      if (startUrl) config.sso_start_url = startUrl
      if (ssoRegion) config.sso_region = ssoRegion
    }
    const accountId = s.ssoAccountId.trim()
    const roleName = s.ssoRoleName.trim()
    const region = s.region.trim()
    if (accountId) config.sso_account_id = accountId
    if (roleName) config.sso_role_name = roleName
    if (region) config.region = region
  } else {
    const a = assumeRoleForm.value
    const roleArn = a.roleArn.trim()
    const sourceProfile = a.sourceProfile.trim()
    const mfaSerial = a.mfaSerial.trim()
    const externalId = a.externalId.trim()
    const duration = a.durationSeconds.trim()
    if (roleArn) config.role_arn = roleArn
    if (sourceProfile) config.source_profile = sourceProfile
    if (mfaSerial) config.mfa_serial = mfaSerial
    if (externalId) config.external_id = externalId
    if (duration) {
      const n = Number.parseInt(duration, 10)
      // `config` đi vào `z.record(z.string())` phía sidecar ⇒ số phải thành chuỗi.
      if (Number.isFinite(n) && n > 0) config.duration_seconds = String(n)
    }
  }
  return config
}

function buildSecrets(): AwsProfileSecretFields | undefined {
  const s = staticForm.value
  const secrets: AwsProfileSecretFields = {}
  const accessKeyId = s.accessKeyId.trim()
  const secretAccessKey = s.secretAccessKey.trim()
  const sessionToken = s.sessionToken.trim()
  if (accessKeyId) secrets.accessKeyId = accessKeyId
  if (secretAccessKey) secrets.secretAccessKey = secretAccessKey
  if (sessionToken) secrets.sessionToken = sessionToken
  return Object.keys(secrets).length > 0 ? secrets : undefined
}

/**
 * Nạp ba khoá tĩnh của profile đang sửa từ `~/.aws/credentials` để form hiện
 * GIÁ TRỊ THẬT thay vì placeholder (2026-09-14). Đây là đường đọc secret duy
 * nhất của UI; sidecar ghi một dòng nhật ký cho mỗi lần đọc.
 *
 * Không thành công cũng KHÔNG chặn form: profile vẫn sửa được (ba ô ở trạng
 * thái "để trống = giữ nguyên" như trước), chỉ là người dùng không thấy khoá cũ.
 */
async function loadStaticSecrets(p: AwsProfile): Promise<void> {
  const token = secretsLoadToken
  try {
    const secrets = await api.profileSecrets(p.name)
    if (token !== secretsLoadToken || !props.open || props.profile?.name !== p.name) return
    staticForm.value.accessKeyId = secrets.accessKeyId
    staticForm.value.secretAccessKey = secrets.secretAccessKey
    staticForm.value.sessionToken = secrets.sessionToken
    secretsLoaded.value = secrets.accessKeyId !== '' || secrets.secretAccessKey !== ''
  } catch (err) {
    console.error('[infra] could not load static keys into the editor', err)
  }
}

// Xoá sạch 3 ô secret khỏi state ngay sau khi ghi thành công — luật cứng #2:
// secret chỉ đi UI → sidecar trong đúng MỘT lần, không giữ lại trong bất kỳ
// ref nào sau lần ghi đó (kể cả khi người dùng còn đang nhìn modal).
function clearSecrets(): void {
  staticForm.value.accessKeyId = ''
  staticForm.value.secretAccessKey = ''
  staticForm.value.sessionToken = ''
  secretsLoaded.value = false
  // Vé mới ⇒ lượt nạp đang bay (nếu có) không được ghi khoá vào một modal đã đóng.
  secretsLoadToken += 1
}

const WRITE_ERROR_CODES: readonly AwsProfileWriteErrorCode[] = [
  'INVALID_NAME',
  'EXISTS',
  // Đổi tên một profile vừa bị xoá ở nơi khác ⇒ sidecar ném NOT_FOUND.
  'NOT_FOUND',
  'PROCESS_READONLY',
  // Sidecar từ chối mọi đường ghi vào profile `login` ngoài tên + region.
  'LOGIN_READONLY',
  'UNKNOWN_KEY',
  'WRITE_FAILED',
  'VERIFY_FAILED',
]
function writeErrorCode(err: unknown): AwsProfileWriteErrorCode | null {
  if (!(err instanceof Error)) return null
  return WRITE_ERROR_CODES.find((c) => err.message.startsWith(`${c}:`)) ?? null
}
function describeSaveError(err: unknown): string {
  const code = writeErrorCode(err)
  if (code) return t(`infra.editor.error.${code}`)
  return t('infra.editor.error.unknown', {
    message: err instanceof Error ? err.message : String(err),
  })
}

async function onSave(): Promise<void> {
  if (!canSave.value || saving.value) return

  // Không có hộp thoại "Vẫn lưu" cho ca thiếu Region: nó là điều kiện KHÔNG hợp
  // lệ của form, nên nút Lưu đã bị khoá và guard ở đầu hàm này chặn từ trước. Ca
  // 2026-09-14 01:32 (bấm Lưu, không ghi gì, không dòng nhật ký, màn chi tiết
  // vẫn "Chưa đặt") là lý do đổi từ "hỏi rồi vẫn ghi" sang "chặn".
  const needsOverwrite = collidesWithOther.value
  if (needsOverwrite) {
    const ok = await confirm({
      title: t('infra.editor.overwriteConfirm.title'),
      description: t('infra.editor.overwriteConfirm.description', { name: trimmedName.value }),
      confirmLabel: t('infra.editor.overwriteConfirm.confirm'),
      kind: 'danger',
    })
    if (!ok) return
  }

  const params: AwsProfileSaveParams = {
    name: trimmedName.value,
    kind: kind.value,
    config: buildConfig(),
  }
  // Gắn khi ĐANG SỬA, kể cả tên không đổi: đó là cách duy nhất nói với sidecar
  // "đích chính là profile này". Chỉ gắn khi đổi tên thì một lần sửa tại chỗ đi
  // xuống trông y hệt một lần TẠO MỚI trùng tên ⇒ sidecar ném `EXISTS` và nút
  // Sửa không bao giờ lưu được (đo được: xem test `sửa tại chỗ` của profile-ops).
  if (isExisting.value) params.previousName = originalName.value
  if (kind.value === 'static') {
    const secrets = buildSecrets()
    if (secrets) params.secrets = secrets
  }
  if (needsOverwrite) params.overwrite = true

  saving.value = true
  try {
    const res = await api.profileSave(params)
    clearSecrets()
    savedProfile.value = res.profile
    toast.add({
      title: t('infra.editor.toast.saved', { name: res.profile.name }),
      color: 'success',
    })
    void runIdentityCheck(res.profile.name)
  } catch (err) {
    console.error('[infra] profile save failed', err)
    toast.add({ title: describeSaveError(err), color: 'error' })
  } finally {
    saving.value = false
  }
}

// --- kiểm tra danh tính sau khi lưu -----------------------------------------
// Region để truyền cho `sts get-caller-identity --region` — assume-role không
// có ô region riêng (bảng "Form theo kiểu" không liệt kê), nên bỏ trống và để
// CLI tự lấy từ chỗ khác (profile source hoặc AWS_DEFAULT_REGION).
function regionForIdentityCheck(): string {
  if (kind.value === 'static') return staticForm.value.region.trim()
  if (kind.value === 'login') return loginRegion.value.trim()
  if (kind.value === 'sso') return ssoForm.value.region.trim()
  return ''
}

async function runIdentityCheck(profileName: string): Promise<void> {
  identityChecking.value = true
  identityResult.value = null
  try {
    const region = regionForIdentityCheck()
    identityResult.value = await api.identityCheck({
      profile: profileName,
      ...(region !== '' ? { region } : {}),
    })
  } catch (err) {
    identityResult.value = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    identityChecking.value = false
  }
}

// --- nút "Kiểm tra" trong FORM (trước khi ghi) ------------------------------
// Hai chế độ, và chế độ quyết định khoá đi đường nào:
//   · 'secrets' — người dùng đã gõ đủ cặp khoá ⇒ kiểm tra CHÍNH bộ khoá đó, gửi
//     bằng env của tiến trình con, KHÔNG chạm `~/.aws`. Đây là giá trị thật của
//     nút này: gõ nhầm một ký tự lộ ra trước khi có gì được ghi.
//   · 'profile' — không có khoá mới để thử (profile SSO/assume-role, hoặc form
//     đang để nguyên khoá cũ) ⇒ kiểm tra profile đã ghi trên đĩa. Khoá tĩnh
//     KHÔNG đi qua RPC ở chế độ này: sidecar tự đọc file.
const verifyMode = computed<'secrets' | 'profile' | null>(() => {
  if (kind.value === 'static') {
    const s = staticForm.value
    if (s.accessKeyId.trim() !== '' && s.secretAccessKey.trim() !== '') return 'secrets'
    if (isExisting.value && (props.profile?.hasStaticKeys ?? false)) return 'profile'
    return null
  }
  // SSO/assume-role cần cấu hình đã nằm trên đĩa (`sso_session`, `role_arn`,
  // `source_profile`) mới gọi được STS ⇒ chỉ kiểm tra được profile đã lưu.
  return isExisting.value ? 'profile' : null
})
const canVerify = computed(() => verifyMode.value !== null)
const verifyVisible = computed(() => identityChecking.value || identityResult.value !== null)

async function onVerify(): Promise<void> {
  const mode = verifyMode.value
  if (mode === null || identityChecking.value) return
  const seq = ++verifySeq
  identityChecking.value = true
  identityResult.value = null
  const region = regionForIdentityCheck()
  let result: AwsIdentityCheckResult
  try {
    if (mode === 'secrets') {
      const s = staticForm.value
      const token = s.sessionToken.trim()
      result = await api.identityCheck({
        ...(region !== '' ? { region } : {}),
        secrets: {
          accessKeyId: s.accessKeyId.trim(),
          secretAccessKey: s.secretAccessKey.trim(),
          ...(token !== '' ? { sessionToken: token } : {}),
        },
      })
    } else {
      result = await api.identityCheck({
        profile: originalName.value || trimmedName.value,
        ...(region !== '' ? { region } : {}),
      })
    }
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  // Form đã đổi trong lúc chờ ⇒ kết quả này không còn thuộc về thứ trên màn hình.
  if (seq === verifySeq) identityResult.value = result
  identityChecking.value = false
}

/**
 * "Đăng nhập lại" trong form `login`.
 *
 * Tên gửi đi là tên TRÊN ĐĨA (`originalName`), không phải tên đang gõ: phiên thuộc
 * về profile đang tồn tại, và `aws login --profile X` chỉ ghi được vào đúng section
 * đó. Đổi tên xong mới đăng nhập lại thì tên mới đã là tên trên đĩa sau khi lưu.
 */
function onLoginRelogin(): void {
  emit('relogin', originalName.value || trimmedName.value)
}

// --- đóng modal --------------------------------------------------------
// Đã lưu xong (savedProfile ≠ null) ⇒ MỌI cách đóng (nút Đóng, X, Esc, click ra
// ngoài) đều báo 'save' để trang nạp lại danh sách; chưa lưu ⇒ 'cancel'.
function onRequestClose(): void {
  // Hai lời gọi tách bạch: `emit` khai theo từng overload nên biểu thức điều kiện
  // trả về `'save' | 'cancel'` không khớp chữ ký nào.
  if (savedProfile.value) emit('save')
  else emit('cancel')
}
</script>

<style scoped>
.ape {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ape-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ape-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ape-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
.ape-input {
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
.ape-input.mono {
  /* mono-ok: tên profile là identifier copy-paste vào --profile của CLI. */
  font-family: var(--code);
}
.ape-input:focus {
  border-color: var(--accent);
}
.ape-seg {
  align-self: flex-start;
}
.ape-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
/* Dấu `*` bắt buộc — cùng vocabulary với `.sse-req` (SshEditor) / `.vpe-req`
   (VpnEditor). Style scoped không với sang component con nên mỗi mảnh form khai
   lại một bản. */
.ape-req {
  color: var(--danger);
  font-weight: 700;
}
.ape-legend {
  margin-bottom: -8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ape-warn {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--amber);
}
.ape-error {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--danger);
}

/* --- post-save (phần identity-check nằm ở AwsProfileEditorIdentityCheck.vue,
   phần process-view nằm ở AwsProfileEditorProcessView.vue) --- */
.ape-post {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ape-post-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}
</style>
