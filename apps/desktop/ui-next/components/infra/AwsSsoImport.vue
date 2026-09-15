<template>
  <LibraryEntityModal
    :open="open"
    :title="t('infra.import.sso.title')"
    :width="720"
    :lock-scrim="busy"
    @close="onClose"
  >
    <div class="asi">
      <!-- Bước 1: đăng nhập SSO — ghi [sso-session x] rồi mở trình duyệt (tách
           riêng, xem AwsSsoImportLoginStep.vue). -->
      <AwsSsoImportLoginStep
        v-if="step === 'login'"
        v-model:session-name="sessionName"
        v-model:start-url="startUrl"
        v-model:sso-region="ssoRegion"
        v-model:has-live-token="hasLiveToken"
        :logging-in="loggingIn"
        :needs-login-notice="needsLoginNotice"
        :show-required="loginAttempted"
        :profiles="profiles"
      />

      <!-- Bước 2: liệt kê account + role, tick hàng loạt. -->
      <AwsSsoImportAccountsStep
        v-else-if="step === 'accounts'"
        :accounts="accounts"
        :selected="selectedKeys"
        :loading="listing"
        :warnings="listWarnings"
        @toggle="toggleKey"
        @toggle-account="toggleAccount"
        @select-all="selectAllVisible"
      />

      <!-- Bước 3: đặt tên hàng loạt rồi tạo. -->
      <AwsSsoImportNamingStep
        v-else-if="step === 'naming'"
        v-model:region="createRegion"
        v-model:overwrite="overwrite"
        :rows="namingRows"
        :existing-names="existingNames"
        @set-name="setNamingRowName"
      />

      <!-- Bước 4: kết quả. -->
      <div v-else class="asi-result">
        <Icon
          name="check"
          style="width: var(--icon-lg); height: var(--icon-lg); color: var(--green)"
        />
        <div class="asi-result-title">{{ t('infra.import.sso.result.title') }}</div>
        <div class="asi-result-line">
          {{ t('infra.import.sso.result.created', { n: createResult?.created.length ?? 0 }) }}
        </div>
        <div class="asi-result-line">
          {{ t('infra.import.sso.result.skipped', { n: createResult?.skipped.length ?? 0 }) }}
        </div>
        <!-- Ghi đè một profile static ⇒ sidecar đã GỠ khoá dài hạn cũ khỏi
             ~/.aws/credentials. Đó là một lần xoá credential — phải nói ra, chứ
             không để người dùng phát hiện sau bằng cách mở file. -->
        <div v-if="createResult && createResult.clearedStaticKeys.length > 0" class="asi-warn">
          {{
            t('infra.import.sso.result.clearedStaticKeys', {
              names: createResult.clearedStaticKeys.join(', '),
            })
          }}
        </div>
        <div v-for="w in createResult?.warnings ?? []" :key="w" class="asi-warn">
          {{ w }}
        </div>
        <div v-if="createResult && createResult.backups.length > 0" class="asi-hint">
          {{ t('infra.import.backupsNote', { n: createResult.backups.length }) }}
        </div>
      </div>

      <div v-if="errorMsg && step !== 'result'" class="asi-error">{{ errorMsg }}</div>
    </div>

    <template #footer>
      <span v-if="step === 'accounts'" class="asi-count">
        {{ t('infra.import.sso.accounts.selectedCount', { n: selectedKeys.size }) }}
      </span>
      <span style="flex: 1" />
      <template v-if="step === 'login'">
        <button class="btn" type="button" :disabled="loggingIn" @click="onClose">
          {{ t('common.cancel') }}
        </button>
        <button v-if="loggingIn" class="btn" type="button" @click="cancelLogin">
          {{ t('infra.import.sso.login.cancel') }}
        </button>
        <!-- CỐ Ý không `:disabled="!canLogin"`: nút chính mờ mà không nói vì sao
             là ngõ cụt với người không rành — bấm vào "không có gì xảy ra".
             Cho bấm, rồi chỉ đúng ô còn thiếu (loginAttempted → show-required ở
             AwsSsoImportLoginStep) cộng một toast. -->
        <button v-else class="btn pri" type="button" :disabled="loggingIn" @click="onLogin">
          {{
            useExistingSession
              ? t('infra.import.sso.login.continueWithSession')
              : t('infra.import.sso.login.action')
          }}
        </button>
      </template>
      <template v-else-if="step === 'accounts'">
        <button class="btn" type="button" :disabled="listing" @click="step = 'login'">
          {{ t('common.back') }}
        </button>
        <button class="btn" type="button" :disabled="listing" @click="onList">
          {{ t('infra.import.sso.accounts.refresh') }}
        </button>
        <button class="btn pri" type="button" :disabled="!selectedKeys.size" @click="toNaming">
          {{ t('infra.import.sso.accounts.next') }}
        </button>
      </template>
      <template v-else-if="step === 'naming'">
        <button class="btn" type="button" :disabled="creating" @click="step = 'accounts'">
          {{ t('common.back') }}
        </button>
        <button class="btn pri" type="button" :disabled="!canCreate || creating" @click="onCreate">
          {{
            creating ? t('infra.import.sso.naming.creating') : t('infra.import.sso.naming.action')
          }}
        </button>
      </template>
      <template v-else>
        <button class="btn pri" type="button" @click="onDone">{{ t('common.close') }}</button>
      </template>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// A5 — Nhập từ SSO: `sso login` (mở trình duyệt) → `sso list-accounts` +
// `list-account-roles` → tick hàng loạt → `sso-create-profiles`
// (docs/features/aws-profile-manager.md §Nhập, hàng "Từ SSO (khám phá)").
// KHÔNG sinh ra secret dài hạn nào — chỉ ghi block [sso-session] + profile SSO
// (sso_session/sso_account_id/sso_role_name) vào ~/.aws/config.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import AwsSsoImportAccountsStep from '~/components/infra/AwsSsoImportAccountsStep.vue'
import AwsSsoImportLoginStep from '~/components/infra/AwsSsoImportLoginStep.vue'
import AwsSsoImportNamingStep, {
  type NamingRow,
} from '~/components/infra/AwsSsoImportNamingStep.vue'
import { useAwsProfilesApi } from '~/composables/useAwsProfilesApi'
import type {
  AwsSsoAccount,
  AwsSsoCreateProfilesResult,
  AwsSsoProfilePick,
} from '~/composables/useAwsProfilesApi'
import type { AwsProfile } from '~/types'
import { AWS_PROFILE_NAME_RE } from '~/utils/aws-profile-view'

const props = defineProps<{
  open: boolean
  profiles: AwsProfile[]
}>()

const emit = defineEmits<{ close: []; done: [] }>()

const { t } = useI18n()
const api = useAwsProfilesApi()
const toast = useToast()

type Step = 'login' | 'accounts' | 'naming' | 'result'
const step = ref<Step>('login')

// --- bước 1: đăng nhập ------------------------------------------------------
const sessionName = ref('')
const startUrl = ref('')
const ssoRegion = ref('')
const loggingIn = ref(false)
const needsLoginNotice = ref('')
/** Đã bấm "Đăng nhập bằng trình duyệt" khi còn ô trống — bật chỉ lỗi từng ô. */
const loginAttempted = ref(false)
// A7 — nguồn đang chọn ở bước 1 còn token cache chưa hết hạn. Bước 1 tự dò
// (AwsSsoImportLoginStep.vue) và báo lên đây để đổi nhãn + bỏ qua `aws sso
// login`.
const hasLiveToken = ref(false)
// Không có cách abort thật một RPC đang bay qua stdio JSON-RPC — "Huỷ" chỉ dừng
// CHỜ và vô hiệu kết quả trễ bằng cách tăng số thứ tự này; tiến trình `aws sso
// login` phía sidecar tự thoát khi hết `timeoutMs` hoặc người dùng đóng trình
// duyệt, không bị AWOG giết giữa chừng.
let loginSeq = 0

// --- bước 2: account + role --------------------------------------------------
const listing = ref(false)
const accounts = ref<AwsSsoAccount[]>([])
const listWarnings = ref<string[]>([])
const selectedKeys = ref<Set<string>>(new Set())

// --- bước 3: đặt tên hàng loạt -----------------------------------------------
const createRegion = ref('')
const overwrite = ref(false)
const namingRows = ref<NamingRow[]>([])

// --- bước 4: kết quả ---------------------------------------------------------
const creating = ref(false)
const createResult = ref<AwsSsoCreateProfilesResult | null>(null)

const errorMsg = ref('')

const busy = computed(() => loggingIn.value || listing.value || creating.value)
const existingNames = computed(() => new Set(props.profiles.map((p) => p.name)))

const canLogin = computed(
  () =>
    sessionName.value.trim().length > 0 &&
    startUrl.value.trim().length > 0 &&
    ssoRegion.value.trim().length > 0,
)

// A7 — có token cache còn sống thì KHÔNG cần mở lại trình duyệt: đi thẳng sang
// bước liệt kê account.
//
// ⚠ `!needsLoginNotice` mới là phần giữ cho nó không thành vòng lặp. Token cache
// "sống" theo đồng hồ nội bộ vẫn có thể vô dụng: tổ chức thu hồi phía server,
// hoặc — hay gặp hơn — nguồn đến từ cache/profile cũ nên `[sso-session x]` CHƯA
// có trong ~/.aws/config, mà `ssoListAccounts` bắt buộc phải có block đó. Cả hai
// ca đều quay về bước 1 với `needsLoginNotice`. Nếu chỉ xét `hasLiveToken`, cú
// bấm kế tiếp lại bỏ qua đăng nhập → bật lại → bounce mãi. Có notice ⇒ nhãn trở
// về "đăng nhập bằng trình duyệt" và cú bấm sau chạy đăng nhập THẬT (chính nó
// ghi block còn thiếu). `onLogin()` xoá notice nên trạng thái tự mở lại.
const useExistingSession = computed(() => hasLiveToken.value && !needsLoginNotice.value)

function keyOf(accountId: string, roleName: string): string {
  return `${accountId}::${roleName}`
}

async function onLogin(): Promise<void> {
  if (loggingIn.value) return
  // Thiếu ô thì KHÔNG im lặng nữa: bật lỗi từng ô + toast, rồi dừng trước khi
  // chạm tới RPC (sidecar cũng sẽ từ chối, nhưng người dùng cần biết ngay tại
  // chỗ và biết CHÍNH XÁC ô nào còn thiếu).
  if (!canLogin.value) {
    loginAttempted.value = true
    toast.add({ title: t('infra.import.sso.login.requiredToast'), color: 'warning' })
    return
  }
  // Chốt nhánh TRƯỚC khi xoá `needsLoginNotice` bên dưới — `useExistingSession`
  // đọc chính giá trị đó, xoá trước thì nhánh luôn ra "bỏ qua đăng nhập".
  const skipLogin = useExistingSession.value
  const seq = ++loginSeq
  loggingIn.value = true
  errorMsg.value = ''
  needsLoginNotice.value = ''
  // Dùng lại phiên sẵn có: bỏ qua `aws sso login` (không mở trình duyệt, không
  // ghi lại block đã có) và thử liệt kê luôn. `onList()` tự quay về bước 1 kèm
  // `needsLoginNotice` nếu token thật ra không dùng được — xem `useExistingSession`.
  if (skipLogin) {
    step.value = 'accounts'
    try {
      await onList()
    } finally {
      if (seq === loginSeq) loggingIn.value = false
    }
    return
  }
  try {
    const res = await api.ssoLogin({
      sessionName: sessionName.value.trim(),
      startUrl: startUrl.value.trim(),
      ssoRegion: ssoRegion.value.trim(),
    })
    if (seq !== loginSeq) return // Đã bấm Huỷ trong lúc chờ — bỏ kết quả trễ.
    if (!res.ok) {
      errorMsg.value = t('infra.import.sso.login.failed', { error: res.error })
      return
    }
    step.value = 'accounts'
    await onList()
  } catch (err) {
    if (seq !== loginSeq) return
    console.error('[infra] sso login failed', err)
    errorMsg.value = t('infra.import.sso.login.failed', { error: errText(err) })
  } finally {
    if (seq === loginSeq) loggingIn.value = false
  }
}

function cancelLogin(): void {
  loginSeq++
  loggingIn.value = false
}

async function onList(): Promise<void> {
  if (listing.value) return
  listing.value = true
  errorMsg.value = ''
  try {
    const res = await api.ssoList(sessionName.value.trim())
    if (!res.ok) {
      if (res.needsLogin) {
        needsLoginNotice.value = t('infra.import.sso.login.needsLogin')
        step.value = 'login'
      } else {
        errorMsg.value = t('infra.import.sso.accounts.listFailed', { error: res.error })
      }
      return
    }
    accounts.value = res.accounts
    listWarnings.value = res.warnings
    selectedKeys.value = new Set()
  } catch (err) {
    console.error('[infra] sso list failed', err)
    errorMsg.value = t('infra.import.sso.accounts.listFailed', { error: errText(err) })
  } finally {
    listing.value = false
  }
}

function toggleKey(accountId: string, roleName: string): void {
  const key = keyOf(accountId, roleName)
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}
function toggleAccount(_accountId: string, keys: string[]): void {
  const allOn = keys.length > 0 && keys.every((k) => selectedKeys.value.has(k))
  const next = new Set(selectedKeys.value)
  for (const k of keys) {
    if (allOn) next.delete(k)
    else next.add(k)
  }
  selectedKeys.value = next
}
function selectAllVisible(keys: string[]): void {
  const allOn = keys.length > 0 && keys.every((k) => selectedKeys.value.has(k))
  selectedKeys.value = allOn ? new Set() : new Set(keys)
}

function toNaming(): void {
  const rows: NamingRow[] = []
  for (const account of accounts.value) {
    for (const role of account.roles) {
      if (!selectedKeys.value.has(keyOf(account.accountId, role))) continue
      rows.push({
        accountId: account.accountId,
        accountName: account.accountName,
        roleName: role,
        name: `${account.accountId}_${role}`,
      })
    }
  }
  namingRows.value = rows
  step.value = 'naming'
}

function setNamingRowName(key: string, value: string): void {
  namingRows.value = namingRows.value.map((r) =>
    keyOf(r.accountId, r.roleName) === key ? { ...r, name: value } : r,
  )
}

const namingDuplicates = computed<Set<string>>(() => {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const row of namingRows.value) {
    const name = row.name.trim()
    if (seen.has(name)) dupes.add(name)
    seen.add(name)
  }
  return dupes
})

// Cổng "Tạo profile" chỉ chặn lỗi CỨNG (tên sai định dạng / trùng NHAU trong
// chính lô này — hai selection cùng `to` sẽ giẫm lên nhau ở tầng dưới). Trùng
// với một profile CÓ SẴN không chặn: sidecar tự bỏ qua dòng đó (`skipped`) khi
// `overwrite` tắt — xem AwsSsoImportNamingStep.vue cho cảnh báo mềm tương ứng.
const canCreate = computed(
  () =>
    namingRows.value.length > 0 &&
    namingRows.value.every((r) => AWS_PROFILE_NAME_RE.test(r.name.trim())) &&
    namingDuplicates.value.size === 0,
)

async function onCreate(): Promise<void> {
  if (!canCreate.value || creating.value) return
  creating.value = true
  errorMsg.value = ''
  try {
    const picks: AwsSsoProfilePick[] = namingRows.value.map((r) => ({
      accountId: r.accountId,
      roleName: r.roleName,
      profileName: r.name.trim(),
    }))
    const region = createRegion.value.trim()
    const res = await api.ssoCreateProfiles({
      sessionName: sessionName.value.trim(),
      ssoRegion: ssoRegion.value.trim(),
      startUrl: startUrl.value.trim(),
      ...(region ? { region } : {}),
      picks,
      overwrite: overwrite.value,
    })
    createResult.value = res
    step.value = 'result'
  } catch (err) {
    console.error('[infra] sso create profiles failed', err)
    errorMsg.value = t('infra.import.sso.naming.failed', { error: errText(err) })
  } finally {
    creating.value = false
  }
}

function resetAll(): void {
  step.value = 'login'
  sessionName.value = ''
  startUrl.value = ''
  ssoRegion.value = ''
  loggingIn.value = false
  loginAttempted.value = false
  needsLoginNotice.value = ''
  loginSeq++
  listing.value = false
  accounts.value = []
  listWarnings.value = []
  selectedKeys.value = new Set()
  createRegion.value = ''
  overwrite.value = false
  namingRows.value = []
  creating.value = false
  createResult.value = null
  errorMsg.value = ''
}

function onClose(): void {
  resetAll()
  emit('close')
}
function onDone(): void {
  resetAll()
  emit('done')
}

// Mở lại từ đầu mỗi lần overlay bật (Esc/scrim đi qua @close -> onClose() đã
// reset; đây là lớp phòng hờ thứ hai, khuôn AwsProfileImport.vue).
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) resetAll()
  },
)

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<style scoped>
.asi {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}
.asi-error {
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--dangerDim);
  border: 1px solid var(--dangerBorder);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.asi-count {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.asi-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 8px 8px;
  text-align: center;
}
.asi-result-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
  margin-top: 4px;
}
.asi-result-line {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.asi-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
/* Gỡ khoá dài hạn là một lần xoá credential — đọc phải nặng hơn `asi-hint`. */
.asi-warn {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--amber);
  text-align: center;
}
</style>
