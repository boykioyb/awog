<template>
  <LibraryEntityModal
    :open="open"
    :title="t('infra.login.title')"
    :width="520"
    :lock-scrim="busy"
    @close="onClose"
  >
    <div class="acl">
      <p class="acl-sub">{{ t('infra.login.subtitle') }}</p>

      <div v-if="done" class="acl-done">
        <Icon
          name="check"
          style="width: var(--icon-sm); height: var(--icon-sm); color: var(--accent)"
        />
        {{ t('infra.login.done', { name: doneProfile }) }}
      </div>

      <template v-else>
        <div class="acl-field">
          <label class="acl-label">{{ t('infra.login.profileName') }}</label>
          <!-- Mở từ màn sửa = LÀM MỚI PHIÊN cho đúng profile đó, nên tên đứng
               yên. Bản trước để ô này sửa được, và sửa nó là TẠO PROFILE THỨ HAI
               thay vì đổi tên (đo trên máy người dùng 2026-09-14: `console` +
               `hoatq.dev`, cùng một `login_session`). Đổi tên giờ làm ở màn Sửa —
               form `login` đã cho sửa tên (AwsProfileEditorLoginFields.vue). -->
          <input
            v-model.trim="name"
            class="acl-input mono"
            spellcheck="false"
            autocomplete="off"
            :readonly="isRelogin"
            :disabled="busy"
          />
          <div v-if="isRelogin" class="acl-hint">
            {{ t('infra.login.reloginNameLocked', { name: name }) }}
          </div>
          <div v-if="nameError" class="acl-error">{{ nameError }}</div>
        </div>

        <div class="acl-field">
          <label class="acl-label">{{ t('infra.login.region') }}</label>
          <AppSelect v-model="regionPick" :options="regionOptions" width="100%" :disabled="busy" />
          <!-- Region ngoài danh sách ngắn ở trên: vẫn phải tới được, nhưng chỉ
               hiện ô gõ tay khi thật sự chọn "Region khác…" — người dùng phổ
               thông không phải nhìn thấy một ô trống để tự đoán. -->
          <input
            v-if="regionPick === OTHER_REGION"
            v-model.trim="otherRegion"
            class="acl-input"
            spellcheck="false"
            autocomplete="off"
            :placeholder="t('infra.login.regionPh')"
            :disabled="busy"
          />
        </div>

        <div v-if="busy" class="acl-waiting">
          <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('infra.login.waiting') }}
        </div>
        <p v-else class="acl-hint">{{ t('infra.login.hint') }}</p>
        <p v-if="!busy" class="acl-hint">{{ t('infra.login.staleCookieHint') }}</p>
      </template>

      <!-- URL uỷ quyền do CLI in ra, hiện NGAY khi có — không đợi đăng nhập xong.
           Đây là đường thoát cho hai ca có thật: trình duyệt mặc định không mở,
           và trang đăng nhập trả 400 Bad Request vì cookie AWS cũ
           (aws/aws-cli#10186) — ca sau làm CLI treo im lặng tới hết timeout.

           Nhưng chỉ hiện khi phiên còn SỐNG (`busy`): `execFile` giết tiến trình
           khi hết timeout, nên sau `LOGIN_TIMEOUT` callback 127.0.0.1 đã chết và
           URL cũ chỉ dẫn tới trang "không kết nối được" SAU khi người dùng gõ
           xong mật khẩu. Câu lỗi hết giờ thay vào đó nói đúng việc cần làm:
           chạy lại rồi mở ẩn danh ngay khi URL hiện ra. -->
      <div v-if="loginUrl && busy" class="acl-url">
        <div class="acl-url-title">{{ t('infra.login.url.title') }}</div>
        <code class="acl-url-value">{{ loginUrl }}</code>
        <div class="acl-url-acts">
          <button class="btn pri" type="button" :disabled="openingPrivate" @click="onOpenPrivate">
            <Icon name="eye-off" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('infra.login.url.private') }}
          </button>
          <button class="btn" type="button" @click="onCopyUrl">
            <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ copied ? t('infra.login.url.copied') : t('infra.login.url.copy') }}
          </button>
          <button class="btn" type="button" @click="onReopenUrl">
            <Icon name="external" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('infra.login.url.reopen') }}
          </button>
        </div>
        <p class="acl-url-hint">{{ t('infra.login.url.hint') }}</p>
      </div>

      <div v-if="errorMsg" class="acl-error acl-error-box">{{ errorMsg }}</div>

      <!-- Hai đường khi cửa sổ ẩn danh không cứu được, hiện NGAY trong lúc chờ
           (không đợi hết 5 phút): trang lỗi của AWS hiện ra tức thì, còn CLI thì
           im lặng — người dùng nhìn modal là biết làm gì tiếp.

           (1) Cửa sổ ẩn danh phải gõ lại bộ ba MỖI lần; nếu trình duyệt chính
               giữ phiên Console còn hạn thì `aws login` dùng lại được phiên đó
               (đúng mục đích luồng `same-device`) — nên làm mới phiên trong trình
               duyệt chính là đường ít việc nhất cho người đăng nhập thường xuyên.
           (2) Ẩn danh CŨNG lỗi ⇒ gần như chắc chắn không phải cookie: Sign-in
               service từ chối thẳng nếu user IAM thiếu policy
               `SignInLocalDevelopmentAccess` (đo 2026-09-13; có ca thật trên
               re:Post: bật policy cho group là hết lỗi).

           Nút này KHÔNG phải <a href>: interceptor của useLinkOpen sẽ hỏi "mở
           trong AWOG hay browser?", mà gõ mật khẩu AWS vào Chromium của app là
           một cái bẫy (cùng lý do với AwsProfileCredentialHelp.vue). -->
      <div v-if="loginUrl && (busy || errorCode === 'LOGIN_TIMEOUT')" class="acl-once">
        <p class="acl-hint">{{ t('infra.login.retryNote') }}</p>
        <button type="button" class="acl-link" @click="onOpenConsoleSignIn">
          <Icon name="external" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ t('infra.login.openSignIn') }}
        </button>
      </div>
    </div>

    <template #footer>
      <span style="flex: 1" />
      <button v-if="done" class="btn pri" type="button" @click="onDone">
        {{ t('common.close') }}
      </button>
      <template v-else>
        <button class="btn" type="button" @click="onClose">
          {{ busy ? t('infra.login.cancel') : t('common.cancel') }}
        </button>
        <button class="btn pri" type="button" :disabled="!canSubmit" @click="onSubmit">
          {{ busy ? t('infra.login.working') : t('infra.login.action') }}
        </button>
      </template>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Đăng nhập Console → profile `login_session` (docs/features/aws-profile-manager.md
// §"Lấy credential ở đâu"). Mục tiêu của màn này là KHÔNG bắt người dùng gõ gì:
// tên profile và region đều được điền sẵn, việc còn lại là đăng nhập trong trình
// duyệt mà CLI tự mở.
//
// Component tự gọi RPC (`consoleLogin`) và chỉ emit tín hiệu xong lên cha, cùng
// khuôn với AwsSsoImport: cha giữ overlay + reload danh sách, không cần biết chi
// tiết lỗi.
//
// Luật cứng #4: lệnh chỉ chạy khi người dùng bấm nút — không `onMounted`, không
// `watch` nào tự gọi `consoleLogin()`.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import { useAwsProfilesApi, type AwsConsoleLoginUrlEvent } from '~/composables/useAwsProfilesApi'
import { AWS_PROFILE_NAME_RE } from '~/utils/aws-profile-view'
import type { AwsProfile } from '~/types'

const props = defineProps<{
  open: boolean
  /** Danh sách gốc — dùng để gợi ý tên chưa bị chiếm và để cảnh báo sớm. */
  profiles: AwsProfile[]
  /** Region đang ghim của app (nếu có) — điền sẵn thay vì bắt người dùng chọn. */
  defaultRegion?: string
  /**
   * Tên profile điền sẵn. Có giá trị khi modal được mở từ chỗ ĐÃ BIẾT profile
   * (nút "Đăng nhập lại" trong màn sửa) — lúc đó không gợi ý tên mới, vì gợi ý
   * tên khác là tạo profile thứ hai ngoài ý người dùng.
   */
  presetProfile?: string
}>()

const emit = defineEmits<{ close: []; done: [] }>()

const { t } = useI18n()
const api = useAwsProfilesApi()
const sidecar = useSidecar()
const { openExternally } = useLinkOpen()
const toast = useToast()

// Danh sách NGẮN, cố ý: đủ cho hầu hết người dùng VN/JP và không biến modal thành
// một bảng tra 30 dòng. Region ngoài danh sách đi qua mục "Region khác…" bên dưới
// — vẫn tới được, nhưng chỉ hiện ô gõ tay khi người dùng thật sự cần.
const COMMON_REGIONS = [
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
] as const

const FALLBACK_REGION = 'ap-southeast-1'

/** Giá trị sentinel của mục cuối menu — không bao giờ là region thật. */
const OTHER_REGION = '__other__'

/**
 * Trang đăng nhập Console — mở ở trình duyệt hệ điều hành để LÀM MỚI phiên.
 *
 * Không dùng region của form: cổng đăng nhập này là chung, và điền sai region
 * còn tệ hơn không điền (người dùng bị đưa sang một cổng khác với tài khoản của
 * họ). Hằng số này trùng `SIGN_IN_URL` của `AwsProfileCredentialHelp.vue`.
 */
const CONSOLE_SIGN_IN_URL = 'https://signin.aws.amazon.com/console'

const name = ref('')
const regionPick = ref<string>(FALLBACK_REGION)
const otherRegion = ref('')
const busy = ref(false)
const errorMsg = ref('')
// Mã lỗi thô, song song với `errorMsg` (đã dịch): UI cần phân nhánh theo MÃ để
// hiện đúng đường đi tiếp, còn người dùng chỉ cần thấy câu tiếng người.
const errorCode = ref('')
const done = ref(false)
const doneProfile = ref('')
/** URL uỷ quyền CLI vừa in ra (rỗng = chưa mở trình duyệt / CLI không in). */
const loginUrl = ref('')
const copied = ref(false)
/** Đang gọi sidecar để mở cửa sổ ẩn danh (chặn bấm hai lần mở hai cửa sổ). */
const openingPrivate = ref(false)

const regionOptions = computed<AppSelectOption[]>(() => [
  ...COMMON_REGIONS.map((r) => ({ value: r, label: r })),
  { value: OTHER_REGION, label: t('infra.login.regionOther') },
])

/** Region thật sẽ gửi lên sidecar — tách khỏi giá trị sentinel của dropdown. */
const region = computed(() =>
  regionPick.value === OTHER_REGION ? otherRegion.value : regionPick.value,
)

/** Tên gợi ý: `console`, `console-2`, … — chưa bị profile nào chiếm. */
function suggestName(): string {
  const taken = new Set(props.profiles.map((p) => p.name))
  if (!taken.has('console')) return 'console'
  for (let i = 2; i < 100; i++) {
    const candidate = `console-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return 'console'
}

function existingProfile(): AwsProfile | undefined {
  return props.profiles.find((p) => p.name === name.value)
}

const nameError = computed(() => {
  const value = name.value.trim()
  if (value === '') return ''
  if (!AWS_PROFILE_NAME_RE.test(value)) return t('infra.login.nameInvalid')
  const existing = existingProfile()
  // Đăng nhập lại lên chính profile `login` là hợp lệ; đè lên kiểu khác thì
  // sidecar từ chối (`EXISTS_OTHER_STYLE`) — cảnh báo ở đây để người dùng biết
  // TRƯỚC khi bấm, chứ không phải sau một vòng trình duyệt.
  if (existing && existing.kind !== 'login') return t('infra.login.nameTaken')
  return ''
})

const canSubmit = computed(
  () => !busy.value && name.value.trim() !== '' && nameError.value === '' && region.value !== '',
)

/** Mở từ màn sửa của một profile `login` ⇒ chỉ làm mới phiên, KHÔNG tạo mới. */
const isRelogin = ref(false)

function reset(): void {
  isRelogin.value = (props.presetProfile?.trim() ?? '') !== ''
  name.value = props.presetProfile?.trim() || suggestName()
  const preset = props.defaultRegion?.trim() || FALLBACK_REGION
  // Region đang ghim của app: nằm trong danh sách thì chọn luôn, ngoài danh sách
  // thì rơi vào nhánh "Region khác…" với giá trị điền sẵn.
  if ((COMMON_REGIONS as readonly string[]).includes(preset)) {
    regionPick.value = preset
    otherRegion.value = ''
  } else {
    regionPick.value = OTHER_REGION
    otherRegion.value = preset
  }
  busy.value = false
  errorMsg.value = ''
  errorCode.value = ''
  loginUrl.value = ''
  copied.value = false
  done.value = false
  doneProfile.value = ''
}

// Mở lại từ đầu mỗi lần overlay bật (Esc/scrim cũng đóng mà không đi qua onClose),
// và nghe sự kiện URL trong lúc overlay mở. Chỉ nghe khi mở: một `aws login` chạy
// nền (nếu có) không được làm modal của lần sau hiện URL cũ.
let unlisten: (() => void) | null = null

function onSidecarEvent(e: { type: string; payload: unknown }): void {
  if (e.type !== 'infra.console-login.url') return
  const p = e.payload as Partial<AwsConsoleLoginUrlEvent> | null | undefined
  if (!p || typeof p.url !== 'string' || p.url === '') return
  // Sự kiện mang theo tên profile: bỏ qua nếu không phải phiên của modal này.
  if (typeof p.profile === 'string' && p.profile !== name.value.trim()) return
  loginUrl.value = p.url
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      unlisten?.()
      unlisten = null
      return
    }
    reset()
    try {
      unlisten = await sidecar.onEvent(onSidecarEvent)
    } catch (err) {
      console.error('[infra] subscribe console-login url failed', err)
    }
  },
)

onBeforeUnmount(() => {
  unlisten?.()
})

async function onCopyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(loginUrl.value)
    copied.value = true
    toast.add({ title: t('infra.login.url.copied'), color: 'success' })
  } catch {
    toast.add({ title: t('infra.login.url.copyFailed'), color: 'error' })
  }
}

function onReopenUrl(): void {
  void openExternally(loginUrl.value)
}

/**
 * Mở lại URL uỷ quyền trong cửa sổ ẨN DANH — đường thoát của `400 Bad Request`.
 *
 * Không chạy lại `aws login`: tiến trình đang chờ vẫn dùng đúng URL này, và cửa
 * sổ sạch sẽ redirect về `127.0.0.1:<port>/oauth/callback` mà CLI đang lắng
 * nghe. `openExternally` không dùng được ở đây vì nó luôn mở trình duyệt mặc
 * định và không truyền được cờ nào — tức mở lại đúng cửa sổ đang dính cookie cũ.
 */
async function onOpenPrivate(): Promise<void> {
  if (openingPrivate.value) return
  openingPrivate.value = true
  try {
    const res = await api.consoleLoginPrivate(loginUrl.value)
    if (res.ok) {
      toast.add({
        title: t('infra.login.url.privateOpened', { browser: res.browser }),
        color: 'success',
      })
      return
    }
    // Ba mã lỗi có ba việc-để-làm khác nhau, nên câu cũng phải khác nhau.
    const key =
      res.error === 'NO_BROWSER'
        ? 'infra.login.url.privateNoBrowser'
        : 'infra.login.url.privateFailed'
    toast.add({ title: t(key), color: 'warning' })
  } catch (err) {
    toast.add({ title: errText(err), color: 'error' })
  } finally {
    openingPrivate.value = false
  }
}

function errText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.startsWith('INVALID_NAME')) return t('infra.login.nameInvalid')
  if (raw.startsWith('INVALID_REGION')) return t('infra.login.regionInvalid')
  if (raw.startsWith('EXISTS_OTHER_STYLE')) return t('infra.login.nameTaken')
  return raw
}

/** Mở trang đăng nhập Console ở trình duyệt NGOÀI để làm mới phiên (xem khối `.acl-once`). */
function onOpenConsoleSignIn(): void {
  void openExternally(CONSOLE_SIGN_IN_URL)
}

/**
 * Mã lỗi sidecar → câu tiếng người.
 *
 * `LOGIN_TIMEOUT` là ca đáng nói nhất: CLI không tự thoát mà bị hết giờ, và
 * nguyên nhân thường gặp nhất là trang đăng nhập trả 400 vì cookie AWS cũ
 * (aws/aws-cli#10186). Câu này phải nói ra cách đi tiếp, không chỉ "hết giờ".
 */
function loginErrorText(code: string): string {
  if (code === 'LOGIN_TIMEOUT') return t('infra.login.errTimeout')
  return code
}

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  errorMsg.value = ''
  errorCode.value = ''
  try {
    const res = await api.consoleLogin({ profile: name.value.trim(), region: region.value })
    if (!res.ok) {
      errorCode.value = res.error
      errorMsg.value = loginErrorText(res.error)
      return
    }
    doneProfile.value = res.profile
    done.value = true
  } catch (err) {
    console.error('[infra] console login failed', err)
    errorCode.value = 'TRANSPORT'
    errorMsg.value = errText(err)
  } finally {
    busy.value = false
  }
}

function onClose(): void {
  // Đang chờ mà đóng ⇒ huỷ CỨNG tiến trình `aws login`. Bỏ chờ ở UI thôi thì
  // tiến trình vẫn sống tới hết timeout 300s VÀ vẫn ghi `login_session` nếu
  // người dùng đăng nhập nốt trong trình duyệt — profile tự dưng xuất hiện mà
  // không ai bấm gì trong app.
  if (busy.value) void api.consoleLoginCancel().catch(() => {})
  reset()
  emit('close')
}
function onDone(): void {
  emit('done')
}
</script>

<style scoped>
.acl {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.acl-sub {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.acl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.acl-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
.acl-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  /* mono-ok: tên profile là định danh người dùng gõ/dán và cũng là tham số
     `--profile` của CLI — cùng lý do với các ô tên profile khác của màn này. */
  font-family: var(--code);
  outline: none;
}
.acl-input:focus {
  border-color: var(--accent);
}
.acl-hint {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.acl-waiting {
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
.acl-done {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--r-btn);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.acl-error {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--danger);
}
.acl-url {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--r-btn);
  background: var(--bgHover);
  border: 1px solid var(--border);
}
.acl-url-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  font-weight: 600;
}
.acl-url-value {
  /* mono-ok: URL uỷ quyền của AWS — người dùng đọc và copy nguyên văn sang
     trình duyệt, nên phải tách được ký tự dễ nhầm (0/O, 1/l). */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textMuted);
  word-break: break-all;
  max-height: 96px;
  overflow-y: auto;
}
.acl-url-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.acl-url-hint {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.acl-error-box {
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--dangerDim);
  border: 1px solid var(--dangerBorder);
}
.acl-once {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.acl-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.acl-link:hover {
  background: var(--bgHover);
}
</style>
