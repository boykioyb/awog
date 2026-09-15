<template>
  <div class="ia">
    <div class="ia-toolbar">
      <!-- "Thêm profile" là MENU, không phải một hành động đơn: người dùng tới
           đây từ hai thế giới khác nhau — có sẵn bộ ba Account ID/alias + IAM
           username + mật khẩu (đăng nhập Console, không gõ gì thêm) hoặc có
           access key trong tay (tự điền form). Đăng nhập Console đứng ĐẦU vì đó
           là đường ít thao tác nhất, và là câu trả lời cho đúng nhóm người dùng
           KHÔNG có credential nào khác để điền vào form. -->
      <div ref="newMenuWrapRef" class="ia-menuwrap">
        <button
          class="btn pri"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="newMenuOpen"
          @click="toggleNewMenu"
        >
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('infra.list.toolbar.new') }}
          <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </button>
        <div v-if="newMenuOpen" class="smenu ia-newmenu">
          <div class="mi ia-mi2" @click="onPickNewConsole">
            <Icon name="shield" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <span class="ia-mibody">
              <span class="ia-mititle">{{ t('infra.list.toolbar.newConsole') }}</span>
              <span class="ia-mihint">{{ t('infra.list.toolbar.newConsoleHint') }}</span>
            </span>
          </div>
          <div class="mi ia-mi2" @click="onPickNewManual">
            <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <span class="ia-mibody">
              <span class="ia-mititle">{{ t('infra.list.toolbar.newManual') }}</span>
              <span class="ia-mihint">{{ t('infra.list.toolbar.newManualHint') }}</span>
            </span>
          </div>
        </div>
      </div>

      <div ref="importMenuWrapRef" class="ia-menuwrap">
        <button
          class="btn"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="importMenuOpen"
          @click="toggleImportMenu"
        >
          <Icon name="download" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('infra.list.toolbar.import') }}
          <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </button>
        <div v-if="importMenuOpen" class="smenu ia-importmenu">
          <div class="mi" @click="onPickImportFile">
            <Icon name="file" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('infra.list.toolbar.importFile') }}
          </div>
          <div class="mi" @click="onPickImportSso">
            <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('infra.list.toolbar.importSso') }}
          </div>
        </div>
      </div>

      <button class="btn" type="button" @click="emit('export')">
        <Icon name="external" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('infra.list.toolbar.export') }}
      </button>

      <div class="srch ia-search">
        <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <input
          :value="search"
          :placeholder="t('infra.list.search')"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- A8 — chỉ hiện khi danh sách đã tải xong và còn ít nhất một profile chưa
         biết account id. `accountKindOf()` phía sidecar coi vắng accountId là
         production (mức nghiêm nhất) — banner nói rõ MỘT LẦN vì sao đáng bấm,
         thay vì lặp lại câu này ở mọi nơi có nút liên quan. -->
    <div v-if="!loading && !error && missingAccountIdProfiles.length" class="ia-accid-banner">
      <Icon
        name="info"
        style="width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto; margin-top: 1px"
      />
      <p>{{ t('infra.list.accountId.explain') }}</p>
      <button
        class="btn"
        type="button"
        :disabled="fillingMissingAccountIds"
        @click="onFillMissingAccountIds"
      >
        <Icon
          :name="fillingMissingAccountIds ? 'refresh' : 'search'"
          :class="{ 'iad-spin': fillingMissingAccountIds }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{
          fillingMissingAccountIds
            ? t('infra.list.accountId.working')
            : t('infra.list.accountId.fillMissing', { n: missingAccountIdProfiles.length })
        }}
      </button>
    </div>

    <!-- Icon quay: đọc danh sách profile là việc chạm đĩa, im lìm vài trăm ms thì
         người dùng tưởng màn trắng là màn hỏng. -->
    <div v-if="loading" class="empty">
      <span class="ei">
        <Icon name="refresh" class="ikspin" style="width: var(--icon-lg); height: var(--icon-lg)" />
      </span>
      <div class="et" role="status" aria-busy="true">{{ t('infra.list.loading') }}</div>
    </div>

    <div v-else-if="error" class="empty">
      <span class="ei">
        <Icon name="alert" style="width: var(--icon-lg); height: var(--icon-lg)" />
      </span>
      <div class="et">{{ error }}</div>
    </div>

    <div v-else-if="!profiles.length" class="empty">
      <span class="ei">
        <Icon name="layers" style="width: var(--icon-lg); height: var(--icon-lg)" />
      </span>
      <template v-if="search.trim()">
        <div class="et">{{ t('infra.list.noMatch') }}</div>
        <button class="btn" type="button" @click="emit('update:search', '')">
          {{ t('infra.list.clearSearch') }}
        </button>
      </template>
      <template v-else>
        <div class="et">{{ t('infra.list.empty') }}</div>
        <!-- Người chưa có profile nào là đúng nhóm cần "Đăng nhập Console" nhất
             (chỉ có tài khoản + mật khẩu AWS), nên ở màn trống hai lối này hiện
             thẳng ra thay vì giấu sau menu — bớt được một cú bấm so với toolbar. -->
        <button class="btn pri" type="button" @click="emit('console-login')">
          <Icon name="shield" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('infra.list.toolbar.newConsole') }}
        </button>
        <button class="btn" type="button" @click="emit('new-profile')">
          <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('infra.list.toolbar.newManual') }}
        </button>
      </template>
    </div>

    <div v-else class="md ia-mdwrap">
      <InfraAccountsList
        :profiles="profiles"
        :selected="selected"
        :default-profile="defaultProfile"
        :resolved-account-ids="resolvedAccountIds"
        :account-id-failures="accountIdFailureLabels"
        @select="emit('select', $event)"
        @activate="onActivate"
      />
      <div class="detail">
        <InfraAccountsDetail
          v-if="currentProfile"
          :profile="currentProfile"
          :is-default="currentProfile.name === defaultProfile"
          :identity="identityStates[currentProfile.name] ?? null"
          :usage-projects="usage.projectNames"
          :usage-session-count="usage.sessionCount"
          :account-id="accountIds.accountIdOf(currentProfile)"
          :account-id-resolving="accountIds.isResolving(currentProfile.name)"
          :account-id-failure="accountIdFailureLabels[currentProfile.name] ?? null"
          @edit="emit('edit', currentProfile)"
          @duplicate="onDuplicate(currentProfile)"
          @delete="onDelete(currentProfile)"
          @set-default="onSetDefault(currentProfile)"
          @check-identity="onCheckIdentity(currentProfile)"
          @open-config-file="onOpenConfigFile(currentProfile)"
          @resolve-account-id="onResolveAccountId(currentProfile)"
          @forget-account-id="onForgetAccountId(currentProfile)"
        />
        <div v-else class="empty">
          <span class="ei">
            <Icon name="folder" style="width: var(--icon-lg); height: var(--icon-lg)" />
          </span>
          <div class="et">{{ t('infra.list.detail.choose') }}</div>
        </div>
      </div>
    </div>

    <!-- Xoá profile đang là mặc định toàn app → bắt chọn người thay thế trước
         (LUẬT bố cục A2). Modal nhỏ, không cần store/composable riêng. -->
    <LibraryEntityModal
      :open="replaceOpen"
      :title="t('infra.list.replaceDefault.title')"
      :width="420"
      @close="replaceOpen = false"
    >
      <p class="ia-modalnote">
        {{ t('infra.list.replaceDefault.body', { name: pendingDeleteAfterReplace?.name ?? '' }) }}
      </p>
      <AppSelect
        v-model="replaceTarget"
        :options="replaceOptions"
        :placeholder="t('infra.list.replaceDefault.pick')"
        width="100%"
      />
      <template #footer>
        <span style="flex: 1" />
        <button class="btn" type="button" @click="replaceOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn pri"
          type="button"
          :disabled="!replaceTarget"
          @click="confirmReplaceThenDelete"
        >
          {{ t('infra.list.replaceDefault.confirm') }}
        </button>
      </template>
    </LibraryEntityModal>
  </div>
</template>

<script setup lang="ts">
// Màn "Tài khoản" (Mốc 1, việc A2) — sidebar nhóm theo kind (InfraAccountsList) +
// pane chi tiết (InfraAccountsDetail). File này là ORCHESTRATOR của cụm 3 file
// InfraAccounts*: giữ mọi state ngoài props (hai menu thanh công cụ đang mở, kết quả kiểm tra
// danh tính theo từng profile, modal chọn profile thay thế trước khi xoá mặc
// định) và là nơi DUY NHẤT gọi useAwsProfilesApi()/useConfirm()/useTextPrompt()/
// useToast() — hai component con (List/Detail) thuần trình bày, chỉ emit lên đây,
// đúng SRP (chúng không cần biết profileDelete ném lỗi kiểu gì).
//
// Hợp đồng props/emits ngay dưới là ĐÃ CHỐT (U0) — pages/infra.vue đã wire theo
// đúng hình dạng này, KHÔNG tự đổi (xem CLAUDE.md "Luật phân chia file"). Cần đổi
// gì thì ghi vào openIssues cho pha Tích hợp, đừng sửa `pages/infra.vue`/
// `useInfraPage.ts` từ đây.
import { computed, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import InfraAccountsDetail, {
  type InfraIdentityState,
} from '~/components/infra/InfraAccountsDetail.vue'
import InfraAccountsList from '~/components/infra/InfraAccountsList.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useAwsProfileAccountIds } from '~/composables/useAwsProfileAccountIds'
import { useAwsProfileErrorMessage } from '~/composables/useAwsProfileErrorMessage'
import { useAwsProfileUsage } from '~/composables/useAwsProfileUsage'
import {
  AWS_PROFILE_NAME_RE,
  AWS_PROFILE_SOURCE_LABEL_KEY,
  suggestDuplicateProfileName,
} from '~/utils/aws-profile-view'
import type { AwsProfile } from '~/types'

const props = defineProps<{
  /** Đã lọc theo ô tìm — dùng để HIỂN THỊ danh sách. */
  profiles: AwsProfile[]
  /**
   * Danh sách GỐC (chưa lọc) — dùng cho mọi quyết định về TẬP TÊN: gợi ý tên khi
   * nhân bản phải dedupe trên toàn bộ profile, và picker "chọn người thay thế
   * trước khi xoá mặc định" phải thấy đủ mọi profile, kể cả khi ô tìm đang thu
   * hẹp danh sách.
   */
  allProfiles: AwsProfile[]
  loading: boolean
  error: string
  selected: string
  defaultProfile: string
  search: string
}>()

const emit = defineEmits<{
  select: [name: string]
  'update:search': [value: string]
  'new-profile': []
  edit: [profile: AwsProfile]
  duplicate: [profile: AwsProfile]
  delete: [profile: AwsProfile]
  'set-default': [name: string]
  'check-identity': [profile: AwsProfile]
  import: []
  'import-sso': []
  /** Đăng nhập Console (`aws login`) — mở modal, không tự chạy lệnh nào. */
  'console-login': [profile?: string]
  // (tên profile, account id) vừa được STS xác nhận — cha ghim vào settings.infra
  'account-id-resolved': [profile: string, accountId: string]
  export: []
}>()

const { t } = useI18n()
const api = useAwsProfilesApi()
const sidecar = useSidecar()
const { confirm } = useConfirm()
const { prompt } = useTextPrompt()
const toast = useToast()
const { ensureHydrated, usageFor } = useAwsProfileUsage()
const { describeError, describeAccountIdFailure } = useAwsProfileErrorMessage()
const accountIds = useAwsProfileAccountIds()

onMounted(() => {
  ensureHydrated()
  // `load()` CHỈ đọc (`infra.account-ids`): sidecar không gọi mạng VÀ không ghi
  // đĩa ở method này — entry chết bị lọc trong bộ nhớ, việc dọn file thuộc về
  // hai đường người dùng bấm (`resolve`/`forget`). Nên an toàn để gọi ngay lúc
  // mở trang, khác `resolve()` — cái đó tiêu một lượt STS bằng credential của
  // người dùng nên CHỈ được gọi từ tay bấm, xem onFillMissingAccountIds/
  // onResolveAccountId bên dưới.
  void accountIds.load()
  window.addEventListener('mousedown', onWindowMousedown)
  window.addEventListener('keydown', onWindowKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWindowMousedown)
  window.removeEventListener('keydown', onWindowKeydown)
})

const currentProfile = computed<AwsProfile | null>(
  () => props.profiles.find((p) => p.name === props.selected) ?? null,
)

function onActivate(name: string): void {
  const p = props.profiles.find((x) => x.name === name)
  // Process là chỉ đọc ở v1 (LUẬT CỨNG #3) — Enter không mở Sửa cho nó, giống hệt
  // nút Sửa bị tắt trong InfraAccountsDetail.vue.
  if (p && p.kind !== 'process') emit('edit', p)
}

// ── "Đang được dùng ở đâu" (useAwsProfileUsage.ts) ────────────────────────────
const usage = computed(() =>
  currentProfile.value
    ? usageFor(currentProfile.value.name)
    : { projectNames: [] as string[], sessionCount: 0 },
)
function usageSummary(name: string): string {
  const { projectNames, sessionCount } = usageFor(name)
  const parts: string[] = []
  if (projectNames.length) {
    parts.push(
      t('infra.list.usage.projects', { n: projectNames.length, names: projectNames.join(', ') }),
    )
  }
  if (sessionCount) parts.push(t('infra.list.usage.sessions', { n: sessionCount }))
  return parts.length ? parts.join(' · ') : t('infra.list.usage.none')
}

// ── kiểm tra danh tính ───────────────────────────────────────────────────────
// Map theo TÊN profile (không phải một ref đơn) để đổi qua lại giữa các profile
// không làm mất kết quả lần kiểm tra trước của profile kia.
const identityStates = reactive<Record<string, InfraIdentityState>>({})
async function onCheckIdentity(p: AwsProfile): Promise<void> {
  identityStates[p.name] = { loading: true, result: identityStates[p.name]?.result ?? null }
  try {
    const res = await api.identityCheck({
      profile: p.name,
      ...(p.region != null ? { region: p.region } : {}),
    })
    identityStates[p.name] = { loading: false, result: res }
  } catch (err) {
    console.error('[infra] identity check failed', err)
    identityStates[p.name] = { loading: false, result: { ok: false, error: errText(err) } }
  }
  emit('check-identity', p)
}

// ── A8: account id theo profile (useAwsProfileAccountIds.ts) ─────────────────
// Vì sao đáng làm: `accountKindOf()` (sidecar infra/policy.ts) coi VẮNG accountId
// là 'production' — mức nghiêm nhất. Profile static/assume-role không tự biết id
// (không có sso_account_id) nên luôn bị chấm ở đó, cho tới khi ai đó phân giải.
//
// Gộp sẵn thành `Record<tên, ...>` cho hai component con THUẦN TRÌNH BÀY tra
// bằng object lookup, không phải map theo Array.find() mỗi lần render.
const resolvedAccountIds = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  for (const p of props.allProfiles) {
    const r = accountIds.accountIdOf(p)
    if (r) out[p.name] = r.accountId
  }
  return out
})
const accountIdFailureLabels = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  for (const p of props.allProfiles) {
    if (resolvedAccountIds.value[p.name]) continue // đã biết thì lỗi cũ hết ý nghĩa
    const raw = accountIds.failureFor(p.name)
    if (raw) out[p.name] = describeAccountIdFailure(raw)
  }
  return out
})
// Toàn bộ danh sách (KHÔNG lọc theo ô tìm) — nút "điền còn thiếu" là việc bảo trì
// toàn app, không phải hành động trên tập đang hiển thị (giống picker thay thế
// mặc định ở dưới, cũng đọc allProfiles vì cùng lý do).
const missingAccountIdProfiles = computed<AwsProfile[]>(() =>
  props.allProfiles.filter((p) => !accountIds.accountIdOf(p)),
)
const fillingMissingAccountIds = computed(() =>
  missingAccountIdProfiles.value.some((p) => accountIds.isResolving(p.name)),
)

async function onFillMissingAccountIds(): Promise<void> {
  const names = missingAccountIdProfiles.value.map((p) => p.name)
  if (!names.length || fillingMissingAccountIds.value) return
  try {
    const { resolved, failed } = await accountIds.resolve(names)
    const parts: string[] = []
    if (resolved.length) parts.push(t('infra.list.accountId.filled', { n: resolved.length }))
    if (failed.length) parts.push(t('infra.list.accountId.notResolved', { n: failed.length }))
    toast.add({
      title: parts.length ? parts.join(' · ') : t('infra.list.accountId.noneToFill'),
      color: failed.length ? (resolved.length ? 'warning' : 'error') : 'success',
    })
  } catch (err) {
    console.error('[infra] fill missing account ids failed', err)
    toast.add({
      title: describeError(err, t('infra.list.err.resolveAccountIdsFailed')),
      color: 'error',
    })
  }
}

async function onResolveAccountId(p: AwsProfile): Promise<void> {
  try {
    const { failed } = await accountIds.resolve([p.name])
    const failure = failed[0]
    if (failure) {
      toast.add({ title: describeAccountIdFailure(failure.error), color: 'error' })
    } else {
      // Bắn lên cha để ghim vào ngữ cảnh toàn app KHI đây là profile mặc định —
      // đó là đường duy nhất id này tới được ma trận quyền. Chỉ bắn ở nhánh
      // THÀNH CÔNG: giá trị phải đến thẳng từ lời gọi STS vừa chạy, không phải
      // đọc lên từ cache (xem `pinAccountIdForDefault` trong useInfraPage.ts).
      const known = accountIds.accountIdOf(p)
      if (known) emit('account-id-resolved', p.name, known.accountId)
    }
  } catch (err) {
    console.error('[infra] resolve account id failed', err)
    toast.add({
      title: describeError(err, t('infra.list.err.resolveAccountIdsFailed')),
      color: 'error',
    })
  }
}

// Quên account id đã nhớ. Hỏi trước vì nó ghi đĩa và không hoàn tác được bằng
// một cú bấm — muốn lấy lại thì phải gọi STS lần nữa, mà đúng những lúc cần quên
// là những lúc STS không gọi được.
async function onForgetAccountId(p: AwsProfile): Promise<void> {
  const ok = await confirm({
    title: t('infra.list.accountId.forgetConfirm.title', { name: p.name }),
    description: t('infra.list.accountId.forgetConfirm.description'),
    confirmLabel: t('infra.list.accountId.forget'),
    kind: 'danger',
  })
  if (!ok) return
  try {
    await accountIds.forget(p.name)
    // Quên mà không bỏ ghim thì chính sách vẫn chấm bằng id cũ — người dùng bấm
    // "quên" chính là lúc họ nói id đó không còn đúng. Chuỗi rỗng = "không ghim"
    // (xem utils/infra-context.ts), và `accountKindOf()` fail-safe về production.
    emit('account-id-resolved', p.name, '')
    toast.add({ title: t('infra.list.accountId.forgot', { name: p.name }), color: 'success' })
  } catch (err) {
    console.error('[infra] forget account id failed', err)
    toast.add({
      title: describeError(err, t('infra.list.err.forgetAccountIdsFailed')),
      color: 'error',
    })
  }
}

// ── nhân bản (AWS_PROFILE_NAME_RE + suggestDuplicateProfileName ở
// utils/aws-profile-view.ts) ──────────────────────────────────────────────────
async function onDuplicate(p: AwsProfile): Promise<void> {
  // Profile static mang theo khoá khi nhân bản (profile-ops.ts: copySection chép
  // nguyên văn từng dòng) — nói rõ ngay trong tiêu đề hộp thoại vì TextPromptOptions
  // không có slot mô tả riêng.
  const titleKey =
    p.kind === 'static' ? 'infra.list.duplicate.titleStatic' : 'infra.list.duplicate.titleGeneric'
  const name = await prompt({
    title: t(titleKey, { name: p.name }),
    value: suggestDuplicateProfileName(
      p.name,
      props.allProfiles.map((x) => x.name),
    ),
    placeholder: t('infra.list.duplicate.placeholder'),
    submitLabel: t('infra.list.duplicate.submit'),
  })
  if (!name) return
  const trimmed = name.trim()
  if (!AWS_PROFILE_NAME_RE.test(trimmed)) {
    toast.add({ title: t('infra.list.err.invalidName'), color: 'error' })
    return
  }
  try {
    await api.profileDuplicate(p.name, trimmed)
    toast.add({ title: t('infra.list.toast.duplicated', { name: trimmed }), color: 'success' })
    emit('duplicate', p)
  } catch (err) {
    console.error('[infra] duplicate profile failed', err)
    toast.add({ title: describeError(err, t('infra.list.err.duplicateFailed')), color: 'error' })
  }
}

// ── đặt làm mặc định (KHÔNG phải RPC — page-controller ghi settings.infra) ────
function onSetDefault(p: AwsProfile): void {
  emit('set-default', p.name)
}

// ── xoá ──────────────────────────────────────────────────────────────────────
/** `true` = đã xoá thật. `false` = người dùng huỷ, hoặc RPC hỏng. */
async function doDelete(p: AwsProfile): Promise<boolean> {
  const ok = await confirm({
    title: t('infra.list.delete.title', { name: p.name }),
    description: t('infra.list.delete.description', {
      source: t(AWS_PROFILE_SOURCE_LABEL_KEY[p.source]),
      usage: usageSummary(p.name),
      backups: '~/.awog/aws-backups/',
    }),
    confirmLabel: t('common.delete'),
    kind: 'danger',
  })
  if (!ok) return false
  try {
    await api.profileDelete(p.name)
    toast.add({ title: t('infra.list.toast.deleted', { name: p.name }), color: 'success' })
    emit('delete', p)
    return true
  } catch (err) {
    console.error('[infra] delete profile failed', err)
    toast.add({ title: describeError(err, t('infra.list.err.deleteFailed')), color: 'error' })
    return false
  }
}

const replaceOpen = ref(false)
const replaceTarget = ref('')
const pendingDeleteAfterReplace = ref<AwsProfile | null>(null)
const replaceOptions = computed<AppSelectOption[]>(() =>
  props.allProfiles
    .filter((p) => p.name !== pendingDeleteAfterReplace.value?.name)
    .map((p) => ({ label: p.name, value: p.name })),
)

async function onDelete(p: AwsProfile): Promise<void> {
  if (p.name !== props.defaultProfile) {
    await doDelete(p)
    return
  }
  // Đang là mặc định toàn app — bắt chọn người thay thế trước khi cho xoá.
  // Picker đọc `allProfiles` nên KHÔNG phải xoá ô tìm của người dùng để thấy đủ
  // danh sách (bản đầu làm thế, và ô tìm bị xoá mất là một tác dụng phụ khó hiểu).
  pendingDeleteAfterReplace.value = p
  replaceTarget.value = ''
  replaceOpen.value = true
}

async function confirmReplaceThenDelete(): Promise<void> {
  const p = pendingDeleteAfterReplace.value
  const replacement = replaceTarget.value
  if (!p || !replacement) return
  replaceOpen.value = false
  pendingDeleteAfterReplace.value = null
  // Đổi mặc định SAU khi xoá thành công. Đổi trước thì hộp xác nhận xoá (bước
  // thứ hai) bị huỷ vẫn để lại mặc định toàn app đã bị đổi — người dùng bấm Huỷ
  // mà vẫn mất mặc định của mình.
  if (await doDelete(p)) emit('set-default', replacement)
}

// ── menu thanh công cụ: "Thêm profile" (Console vs tự điền) và "Nhập" ─────────
// Hai menu dùng chung một khuôn; chỉ MỘT cái mở tại một thời điểm (mở cái này
// đóng cái kia) và cả hai đóng khi bấm ra ngoài hoặc Esc — người dùng không phải
// hiểu rằng đây là hai widget riêng.
const newMenuOpen = ref(false)
const importMenuOpen = ref(false)
const newMenuWrapRef = useTemplateRef<HTMLElement>('newMenuWrapRef')
const importMenuWrapRef = useTemplateRef<HTMLElement>('importMenuWrapRef')

function toggleNewMenu(): void {
  newMenuOpen.value = !newMenuOpen.value
  if (newMenuOpen.value) importMenuOpen.value = false
}
function toggleImportMenu(): void {
  importMenuOpen.value = !importMenuOpen.value
  if (importMenuOpen.value) newMenuOpen.value = false
}

function onWindowMousedown(e: MouseEvent): void {
  const target = e.target
  if (!(target instanceof Node)) return
  if (newMenuOpen.value && !newMenuWrapRef.value?.contains(target)) newMenuOpen.value = false
  if (importMenuOpen.value && !importMenuWrapRef.value?.contains(target)) {
    importMenuOpen.value = false
  }
}
function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  newMenuOpen.value = false
  importMenuOpen.value = false
}

// Đăng nhập Console (`aws login`) đứng đầu menu "Thêm profile": không tạo access
// key, không mở terminal, không gõ gì — CLI tự mở trình duyệt.
function onPickNewConsole(): void {
  newMenuOpen.value = false
  emit('console-login')
}
function onPickNewManual(): void {
  newMenuOpen.value = false
  emit('new-profile')
}
function onPickImportFile(): void {
  importMenuOpen.value = false
  emit('import')
}
function onPickImportSso(): void {
  importMenuOpen.value = false
  emit('import-sso')
}

// ── mở file cấu hình thật cho profile credential_process (chỉ đọc) ────────────
// Không có RPC riêng cho việc này — dùng lại revealPath(root, relPath) sẵn có
// (chỉ cần path nằm TRONG root, không nhất thiết root là "workspace" của project,
// xem apps/desktop/electron/src/workspace-scope.ts). awogHome (~/.awog) trừ đúng
// hậu tố để ra $HOME, từ đó ghép `.aws/config`|`.aws/credentials`.
async function onOpenConfigFile(p: AwsProfile): Promise<void> {
  try {
    const info = await sidecar.getAppInfo()
    const home = info.awogHome.replace(/[\\/]\.awog$/, '')
    const rel = p.source === 'credentials' ? '.aws/credentials' : '.aws/config'
    await sidecar.revealPath(home, rel)
  } catch (err) {
    console.error('[infra] reveal aws config file failed', err)
    toast.add({ title: describeError(err, t('infra.list.err.openFileFailed')), color: 'error' })
  }
}

// ── lỗi (describeError ở useAwsProfileErrorMessage.ts) ────────────────────────
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<style scoped>
.ia {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.ia-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  flex: 0 0 auto;
  box-shadow: inset 0 -1px 0 var(--border);
}

.ia-menuwrap {
  position: relative;
}

.ia-importmenu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
}

/* Menu "Thêm profile" rộng hơn menu thường vì mỗi mục có một dòng phụ: người
   không rành chọn được lối đi mà không phải đoán "access key" là gì. */
.ia-newmenu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 268px;
}
.ia-mi2 .ia-mibody {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.ia-mi2 .ia-mihint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.ia-search {
  margin-left: auto;
  max-width: 260px;
}

.ia-mdwrap {
  flex: 1;
  min-height: 0;
}

.ia-modalnote {
  margin: 0 0 12px;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}

.ia-accid-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  flex: 0 0 auto;
  background: var(--bgHover);
  box-shadow: inset 0 -1px 0 var(--border);
}
.ia-accid-banner p {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}
.ia-accid-banner .btn {
  flex: 0 0 auto;
}

/* Cùng khuôn animation với .iad-spin của InfraAccountsDetail.vue — style scoped
   nên không dùng chung được, chép lại tại chỗ thay vì tách file CSS riêng cho
   một keyframe 6 dòng (YAGNI). */
@keyframes ia-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.iad-spin {
  animation: ia-spin 0.8s linear infinite;
}
</style>
