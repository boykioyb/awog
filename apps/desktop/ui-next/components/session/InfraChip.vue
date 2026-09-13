<template>
  <!-- Chip ngữ cảnh hạ tầng của phiên (ADR 0088 §5b/§7, task 0.11). Cùng khuôn với
       chip SSH trong SessionContextStrip: một chip mở popover của CHÍNH nó, và
       không ghim gì thì VẮNG MẶT khỏi DOM — hàng ngữ cảnh không mất pixel nào cho
       tính năng người dùng chưa dùng. -->
  <span v-if="pinned" class="iwrap">
    <button
      type="button"
      class="ctxchip"
      :class="{ on: open, danger: isProd, warn: !isProd && bypassActive }"
      :title="chipTitle"
      @click.stop="open = !open"
    >
      <Icon name="layers" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <span class="ctxchip-lbl">{{ profileLabel }}</span>
      <span class="ctxchip-sub">{{ chipSub }}</span>
      <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </button>

    <template v-if="open">
      <div class="ibackdrop" @click="open = false" />
      <div class="pop ipop" @click.stop>
        <div class="pl">
          <span>{{ t('infra.pop.title') }}</span>
          <span v-if="isProd" class="ibadge prod">{{ t('infra.pop.prod') }}</span>
        </div>

        <p v-if="bypassActive" class="iwarn">
          {{ t('infra.pop.bypass', { left: bypassLeft }) }}
        </p>

        <!-- 1 · Profile -->
        <div class="ifield">
          <div class="ilbl">{{ t('infra.profile.label') }}</div>
          <AppSelect
            :model-value="effective.profile ?? ''"
            :options="profileOptions"
            :placeholder="t('infra.profile.placeholder')"
            width="100%"
            @update:model-value="onProfile"
          />
          <p v-if="profilesError" class="ierr">{{ profilesError }}</p>
          <p v-else-if="loadingProfiles" class="ihint">{{ t('infra.profile.loading') }}</p>
          <p v-else-if="!profiles.length" class="ihint">{{ t('infra.profile.empty') }}</p>
        </div>

        <!-- 2 · Region (rỗng = để chính profile quyết) -->
        <div class="ifield">
          <div class="ilbl">{{ t('infra.region.label') }}</div>
          <AppSelect
            :model-value="effective.region ?? ''"
            :options="regionOptions"
            width="100%"
            @update:model-value="onRegion"
          />
        </div>

        <!-- 3 · Quyền của phiên — chỉ siết xuống được (ADR 0088 §5b) -->
        <div class="ifield">
          <div class="ilbl">{{ t('infra.floor.label') }}</div>
          <AppSelect
            :model-value="floor"
            :options="floorOptions"
            width="100%"
            @update:model-value="onFloor"
          />
          <p class="ihint">{{ t('infra.floor.note') }}</p>
        </div>

        <p v-if="saveError" class="ierr">{{ saveError }}</p>

        <!-- 4 · Kiểm tra danh tính — lệnh DUY NHẤT ở đây chạm mạng, nên nó chỉ chạy
             khi người dùng bấm, và mọi lỗi hiện ra chữ đọc được. -->
        <button
          type="button"
          class="iact"
          :disabled="identityRunning || !awsAvailable"
          @click="checkIdentity()"
        >
          <Icon name="shield" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ identityRunning ? t('infra.identity.running') : t('infra.identity.run') }}
        </button>
        <p v-if="!awsAvailable" class="ihint">{{ t('infra.identity.noBinary') }}</p>
        <div v-if="identity" class="iout">
          <div class="iout-row">
            <span class="iout-k">{{ t('infra.identity.account') }}</span>
            <span class="iout-v">{{ identity.accountId }}</span>
          </div>
          <div v-if="identity.arn" class="iout-row">
            <span class="iout-k">{{ t('infra.identity.arn') }}</span>
            <span class="iout-v">{{ identity.arn }}</span>
          </div>
        </div>
        <p v-if="identityError" class="ierr">{{ identityError }}</p>
      </div>
    </template>
  </span>
</template>

<script setup lang="ts">
// Bề mặt trong phiên của ngữ cảnh hạ tầng (ADR 0088 §7, task 0.11).
//
// Nhà của nó là hàng ngữ cảnh (`SessionContextStrip`), KHÔNG phải composer: commit
// 372b0dc chốt luật "mỗi control đúng một nhà" và composer chỉ còn Mode · đính kèm
// · ⋯ · Gửi.
//
// Ba tín hiệu màu, theo đúng thứ tự quan trọng:
//   danger — account nằm trong `prodAccountIds`: mọi lệnh của phiên này chạy trên
//            production. Đây là thứ phải nhìn thấy trước cả tên profile.
//   warn   — bypass tạm thời đang bật (ADR 0088 §5, tính chất "nhìn thấy được").
//   thường — như chip SSH.
//
// P0 chỉ có nhánh AWS. Terraform/kubectl có ngữ cảnh hình dạng khác (thư mục +
// workspace, context + namespace) và `infra.contexts` trả mảng rỗng cho chúng tới
// Mốc 8 — nên chip chưa nhận tham số `tool`: thêm một tham số chỉ có một nhánh
// sống là cấu hình chết.
import type { Session } from '~/composables/useSessionsData'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { InfraContext } from '~/types'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const { confirm } = useConfirm()
const sc = useSidecar()
const { effective, sessionValue, setForSession } = useInfraContext(() => ({
  sessionId: props.session.id,
}))

// ── Kiểu của payload IPC (L1) ───────────────────────────────────────────────
// Mirror rút gọn của `AwsProfile` / `InfraPolicySnapshot` / `InfraBinaryStatus` ở
// sidecar: chỉ những trường chip thật sự vẽ. Payload là L1 nên mọi trường đi qua
// một hàm thu hẹp bên dưới thay vì được ép kiểu thẳng.
type AwsProfileKind = 'sso' | 'assume-role' | 'process' | 'static' | 'unknown'
type AwsProfileEntry = { name: string; region: string; kind: AwsProfileKind; accountId: string }
type Identity = { accountId: string; arn: string }

/** Mức trần phiên tự siết. `inherit` = không gửi `sessionFloor`, ma trận Settings nói gì nghe nấy. */
type InfraFloor = 'inherit' | 'ask' | 'block'

const PROFILE_KINDS: readonly AwsProfileKind[] = [
  'sso',
  'assume-role',
  'process',
  'static',
  'unknown',
]
const FLOORS: readonly InfraFloor[] = ['inherit', 'ask', 'block']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
function message(err: unknown, fallback: string): string {
  const m = err instanceof Error ? err.message.trim() : ''
  return m || fallback
}

// ── Trần của phiên: nhà tạm ────────────────────────────────────────────────
// `SessionHeader.infra` chưa có ô cho mức duyệt (task 0.7 mới wire ma trận ở
// sidecar), nên lựa chọn này sống ở localStorage theo `engineId` — cùng khuôn với
// `awog.linkOpenMode` / `awog.browserPins`. Giữ trên đĩa chứ không để ref cục bộ:
// một cú F5 mà đưa phiên từ "chặn" về "theo cài đặt" là nới quyền sau lưng người
// dùng. Chỉ lưu phiên ĐÃ siết; chọn lại `inherit` thì xoá hẳn khoá.
const FLOOR_KEY = 'awog.infraSessionFloor'

function readFloors(): Record<string, InfraFloor> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(FLOOR_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    const out: Record<string, InfraFloor> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const found = FLOORS.find((f) => f === value)
      if (found && found !== 'inherit') out[key] = found
    }
    return out
  } catch {
    return {}
  }
}

const floors = ref<Record<string, InfraFloor>>(readFloors())

// Phiên chưa có `engineId` (chưa gửi lượt nào) vẫn phải siết được — khoá tạm theo
// id client để control không thành một cái nút chết; nó sống hết phiên làm việc.
const floorKey = computed(() => props.session.engineId || `local:${props.session.id}`)
const floor = computed<InfraFloor>(() => floors.value[floorKey.value] ?? 'inherit')

function onFloor(next: string): void {
  const value = FLOORS.find((f) => f === next) ?? 'inherit'
  // Đọc lại rồi mới ghi: mỗi phiên đang mở có một chip, mà cả đám dùng CHUNG một
  // khoá localStorage. Ghi đè bằng bản trong bộ nhớ của riêng chip này sẽ xoá mức
  // siết mà chip của phiên khác vừa đặt.
  const all = readFloors()
  if (value === 'inherit') delete all[floorKey.value]
  else all[floorKey.value] = value
  floors.value = all
  try {
    window.localStorage.setItem(FLOOR_KEY, JSON.stringify(all))
  } catch {
    // Storage bị chặn — mức siết chỉ sống hết phiên làm việc này.
  }
}

// ── Dữ liệu từ engine ──────────────────────────────────────────────────────
const profiles = ref<AwsProfileEntry[]>([])
const loadingProfiles = ref(false)
const profilesError = ref<string | null>(null)
const prodAccountIds = ref<string[]>([])
const bypassUntilMs = ref(0)
// Mặc định theo cầu nối engine: không có engine thì nút Kiểm tra danh tính là một
// nút chết, và thà tắt nó còn hơn để cú bấm rơi vào hư không.
const awsAvailable = ref(sc.available)
const identity = ref<Identity | null>(null)
const identityError = ref<string | null>(null)
const identityRunning = ref(false)
const saveError = ref<string | null>(null)

const open = ref(false)

// Chip chỉ nói về AWS ở P0 ⇒ "đã ghim" = có profile hoặc region. Luật này được
// tính LẠI trong SessionContextStrip (`hasInfra`) vì cha phải biết TRƯỚC có nên
// vẽ hàng 30px hay không — con không nói ngược lên cha được.
const pinned = computed(() => !!effective.value.profile || !!effective.value.region)

async function loadProfiles(): Promise<void> {
  if (!sc.available || loadingProfiles.value) return
  loadingProfiles.value = true
  profilesError.value = null
  try {
    const raw = await sc.request<unknown>('infra.contexts', { tool: 'aws' })
    const list = isRecord(raw) && Array.isArray(raw.contexts) ? raw.contexts : []
    const out: AwsProfileEntry[] = []
    for (const item of list) {
      if (!isRecord(item)) continue
      const name = text(item.name)
      if (!name) continue
      out.push({
        name,
        region: text(item.region),
        kind: PROFILE_KINDS.find((k) => k === item.kind) ?? 'unknown',
        // Chỉ profile SSO mới khai account id trong `~/.aws`; profile khác phải
        // hỏi AWS mới biết (nút Kiểm tra danh tính).
        accountId: text(item.ssoAccountId),
      })
    }
    profiles.value = out
  } catch (err) {
    profilesError.value = message(err, t('infra.profile.failed'))
  } finally {
    loadingProfiles.value = false
  }
}

async function loadPolicy(): Promise<void> {
  if (!sc.available) return
  try {
    const raw = await sc.request<unknown>('infra.policy.get')
    if (!isRecord(raw)) return
    prodAccountIds.value = Array.isArray(raw.prodAccountIds)
      ? raw.prodAccountIds.map(text).filter(Boolean)
      : []
    const until = text(raw.bypassUntil)
    const parsed = until ? Date.parse(until) : Number.NaN
    bypassUntilMs.value = Number.isNaN(parsed) ? 0 : parsed
  } catch (err) {
    // Không đọc được chính sách thì chip giữ màu thường — một cảnh báo bịa ra
    // còn tệ hơn không có cảnh báo.
    console.warn('[infra] infra.policy.get failed', err)
  }
}

async function loadStatus(): Promise<void> {
  if (!sc.available) return
  try {
    const raw = await sc.request<unknown>('infra.status')
    const tools = isRecord(raw) && Array.isArray(raw.tools) ? raw.tools : []
    const aws = tools.find((item) => isRecord(item) && item.tool === 'aws')
    awsAvailable.value = isRecord(aws) ? aws.found === true : false
  } catch (err) {
    console.warn('[infra] infra.status failed', err)
  }
}

onMounted(() => {
  // Nạp ngay khi chip có mặt: màu production là tín hiệu quan trọng nhất và nó
  // không được đợi tới lúc người dùng mở popover.
  if (pinned.value) {
    void loadPolicy()
    void loadProfiles()
  }
})

watch(pinned, (now) => {
  if (!now) return
  void loadPolicy()
  if (!profiles.value.length) void loadProfiles()
})

watch(open, (now) => {
  if (!now) return
  void loadPolicy()
  void loadProfiles()
  void loadStatus()
})

// ── Account đang trỏ tới + cờ production ───────────────────────────────────
// Ba nguồn, giảm dần độ chắc chắn: ghim tường minh → lần kiểm tra danh tính vừa
// chạy → `sso_account_id` khai trong `~/.aws`. Không nguồn nào trong ba cái này
// được GHI ngược vào ngữ cảnh: account id là thuộc tính của account, không phải
// một lựa chọn của người dùng.
const selectedProfile = computed(() =>
  profiles.value.find((p) => p.name === effective.value.profile),
)
const accountId = computed(
  () =>
    effective.value.accountId ||
    identity.value?.accountId ||
    selectedProfile.value?.accountId ||
    '',
)
const isProd = computed(() => !!accountId.value && prodAccountIds.value.includes(accountId.value))

// ── Đếm ngược bypass ───────────────────────────────────────────────────────
const nowMs = ref(Date.now())
const bypassActive = computed(() => bypassUntilMs.value > nowMs.value)
const bypassLeft = computed(() => {
  const left = Math.max(0, Math.round((bypassUntilMs.value - nowMs.value) / 1000))
  const mm = Math.floor(left / 60)
  const ss = left % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
})

let ticker: ReturnType<typeof setInterval> | null = null
function stopTicker(): void {
  if (ticker === null) return
  clearInterval(ticker)
  ticker = null
}
watch(
  bypassActive,
  (on) => {
    stopTicker()
    // Đồng hồ chỉ chạy khi có thứ để đếm; hết giờ thì chính watcher này tắt nó.
    if (on) ticker = setInterval(() => (nowMs.value = Date.now()), 1000)
  },
  { immediate: true },
)
onBeforeUnmount(stopTicker)

// ── Nhãn ───────────────────────────────────────────────────────────────────
const KIND_KEYS: Record<AwsProfileKind, string> = {
  sso: 'infra.kind.sso',
  'assume-role': 'infra.kind.assumeRole',
  process: 'infra.kind.process',
  static: 'infra.kind.static',
  unknown: 'infra.kind.unknown',
}
const FLOOR_SHORT: Record<InfraFloor, string> = {
  inherit: 'infra.floor.shortInherit',
  ask: 'infra.floor.shortAsk',
  block: 'infra.floor.shortBlock',
}

const profileLabel = computed(() => effective.value.profile || t('infra.chip.noProfile'))
// `<profile> · <region> · <mức duyệt viết tắt>` — profile ở `.ctxchip-lbl` (nó là
// cái được cắt khi hàng chật), phần còn lại ở `.ctxchip-sub`.
const chipSub = computed(() => {
  const parts: string[] = []
  if (effective.value.region) parts.push(effective.value.region)
  parts.push(t(FLOOR_SHORT[floor.value]))
  return parts.map((part) => `· ${part}`).join(' ')
})
const chipTitle = computed(() =>
  isProd.value ? t('infra.chip.prodTitle', { account: accountId.value }) : t('infra.chip.title'),
)

// AppSelect không có slot cho badge, nên `kind` đi vào chính nhãn của dòng —
// người dùng phải phân biệt được một profile SSO với một profile khoá tĩnh TRƯỚC
// khi chọn, không phải sau.
const profileOptions = computed<AppSelectOption[]>(() => {
  const opts = profiles.value.map((p) => ({
    label: `${p.name} · ${t(KIND_KEYS[p.kind])}`,
    value: p.name,
  }))
  const current = effective.value.profile
  // Profile đang ghim mà không còn trong `~/.aws` vẫn phải hiện, nếu không
  // AppSelect sẽ vẽ ô rỗng và người dùng tưởng phiên không trỏ vào đâu cả.
  if (current && !opts.some((o) => o.value === current)) {
    opts.unshift({ label: current, value: current })
  }
  return opts
})

const regionOptions = computed<AppSelectOption[]>(() => {
  const seen = new Set<string>()
  for (const p of profiles.value) if (p.region) seen.add(p.region)
  if (effective.value.region) seen.add(effective.value.region)
  return [
    { label: t('infra.region.follow'), value: '' },
    ...[...seen].sort().map((r) => ({ label: r, value: r })),
  ]
})

const floorOptions = computed<AppSelectOption[]>(() => [
  { label: t('infra.floor.inherit'), value: 'inherit' },
  { label: t('infra.floor.ask'), value: 'ask' },
  { label: t('infra.floor.block'), value: 'block' },
])

// ── Ghi ────────────────────────────────────────────────────────────────────
// Ghi lên TẦNG PHIÊN, không lên `effective`: gộp cả bản đã giải vào phiên sẽ biến
// mọi giá trị đang kế thừa thành giá trị ghim, tức đóng băng thêm thứ người dùng
// không đụng tới.
async function pin(patch: InfraContext): Promise<void> {
  saveError.value = null
  const ok = await setForSession({ ...(sessionValue.value ?? {}), ...patch })
  if (!ok) saveError.value = t('infra.error.save')
}

function onProfile(next: string): void {
  if (next === effective.value.profile) return
  // Account id cũ thuộc về profile CŨ. Giữ lại thì cảnh báo production sẽ tô cho
  // nhầm tài khoản — nguy hiểm hơn là không tô. `''` = cố ý không ghim (dừng kế
  // thừa), rồi profile SSO/lần kiểm tra danh tính sẽ điền lại.
  const known = profiles.value.find((p) => p.name === next)
  identity.value = null
  identityError.value = null
  void pin({ profile: next, accountId: known?.accountId ?? '' })
}

function onRegion(next: string): void {
  if (next === (effective.value.region ?? '')) return
  void pin({ region: next })
}

// ── Kiểm tra danh tính ─────────────────────────────────────────────────────
// `sts get-caller-identity` là lệnh lớp `read`, nhưng nó CHẠM MẠNG nên chỉ chạy
// khi người dùng bấm. KHÔNG gửi cờ tự khai "đã duyệt": sidecar không tin bên gọi
// nữa (infosec audit #1) — nếu ma trận đòi duyệt thì nó trả `requiresApproval`
// kèm một VÉ, ta hỏi người dùng rồi gọi lại kèm vé đó. Với lệnh `read` thì nhánh
// này gần như không xảy ra, nhưng có sẵn để phiên tự siết xuống `ask` vẫn chạy đúng.
async function checkIdentity(ticket?: string): Promise<void> {
  if (identityRunning.value || !sc.available) return
  identityRunning.value = true
  identityError.value = null
  identity.value = null
  try {
    const raw = await sc.request<unknown>('infra.run', {
      tool: 'aws',
      args: ['sts', 'get-caller-identity', '--output', 'json'],
      context: effective.value,
      surface: 'session',
      toolName: 'aws_whoami',
      ...(ticket ? { approvalTicket: ticket } : {}),
      ...(floor.value !== 'inherit' ? { sessionFloor: floor.value } : {}),
      ...(props.session.engineId ? { sessionId: props.session.engineId } : {}),
    })
    if (!isRecord(raw)) {
      identityError.value = t('infra.identity.unreadable')
      return
    }
    if (raw.blocked === true) {
      // Ma trận đòi người duyệt: hỏi rồi gọi lại kèm vé sidecar vừa phát. Vé gắn
      // vân tay đúng lời gọi này và chỉ dùng được một lần.
      const nextTicket = text(raw.approvalTicket)
      if (raw.requiresApproval === true && nextTicket && !ticket) {
        identityRunning.value = false
        const ok = await confirm({
          title: t('infra.identity.run'),
          description: text(raw.command) || t('infra.identity.run'),
          confirmLabel: t('common.confirm'),
        })
        if (ok) await checkIdentity(nextTicket)
        return
      }
      identityError.value = text(raw.reason) || t('infra.identity.failed')
      return
    }
    const result = isRecord(raw.result) ? raw.result : {}
    if (result.ok !== true) {
      identityError.value = text(result.stderr) || t('infra.identity.failed')
      return
    }
    identity.value = parseIdentity(text(result.stdout))
    if (!identity.value) {
      identityError.value = t('infra.identity.unreadable')
    } else if (identity.value.accountId && !effective.value.accountId) {
      // GHIM account id vừa xác minh vào ngữ cảnh phiên (infosec audit #1).
      // Cột `production` của ma trận chọn theo accountId; profile không-SSO thì
      // `infra.contexts` không biết id, nên cột đó gần như luôn rỗng — tức hàng
      // rào MẠNH NHẤT đang ngủ. Ghim ở đây an toàn vì id này vừa do chính AWS
      // trả về cho profile đang chọn, và `onProfile` đã xoá id mỗi lần đổi
      // profile (id cũ thuộc profile cũ — giữ lại sẽ tô đỏ cho nhầm tài khoản).
      void pin({ accountId: identity.value.accountId })
    }
  } catch (err) {
    identityError.value = message(err, t('infra.identity.failed'))
  } finally {
    identityRunning.value = false
  }
}

function parseIdentity(stdout: string): Identity | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!isRecord(parsed)) return null
    const account = text(parsed.Account)
    if (!account) return null
    return { accountId: account, arn: text(parsed.Arn) }
  } catch {
    return null
  }
}
</script>

<style scoped>
.iwrap {
  position: relative;
  display: inline-flex;
  flex: 0 1 auto;
  min-width: 0;
}
/* Account production: tín hiệu quan trọng nhất của chip, nên nó thắng cả `warn`.
   Biến thể này sống ở đây chứ không trong app-shell.css vì chỉ chip hạ tầng có
   khái niệm "tài khoản đánh dấu production". */
.ctxchip.danger {
  border-color: var(--dangerBorder);
  color: var(--danger);
  background: var(--dangerDim);
}
.ctxchip.danger .ctxchip-lbl,
.ctxchip.danger .ctxchip-sub {
  color: inherit;
}
.ibackdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
/* Strip nằm ở ĐẦU cột chat nên popover mở XUỐNG (`.pop` mặc định là fixed). */
.ipop {
  position: absolute;
  top: 128%;
  left: 0;
  z-index: 50;
  width: 296px;
}
.ifield {
  margin-top: 12px;
}
.ilbl {
  margin-bottom: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.ihint {
  margin: 6px 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.ierr {
  margin: 6px 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--danger);
}
.iwarn {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--amber);
}
.ibadge {
  padding: 1px 6px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-xs);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ibadge.prod {
  border-color: var(--dangerBorder);
  background: var(--dangerDim);
  color: var(--danger);
}
.iact {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 12px;
  padding: 7px 9px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: left;
  cursor: pointer;
}
.iact:hover:not(:disabled) {
  background: var(--bgHover);
}
.iact:disabled {
  opacity: 0.55;
  cursor: default;
}
.iact .icn {
  flex: 0 0 auto;
  color: var(--textDim);
}
.iout {
  display: grid;
  gap: 4px;
  margin-top: 10px;
}
.iout-row {
  display: flex;
  gap: 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
.iout-k {
  flex: 0 0 auto;
  color: var(--textFaint);
}
.iout-v {
  min-width: 0;
  /* mono-ok: account id + ARN là định danh người dùng copy-paste sang terminal */
  font-family: var(--code);
  color: var(--text);
  word-break: break-all;
}
</style>
