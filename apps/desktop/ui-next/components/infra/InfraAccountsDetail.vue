<template>
  <div class="iad">
    <header class="iad-hero">
      <div class="iad-hero-main">
        <div class="iad-name">{{ profile.name }}</div>
        <div class="iad-meta">
          <span class="tag">{{ kindLabel }}</span>
          <span v-if="isDefault" class="tag acc">{{ t('infra.list.default') }}</span>
          <span v-if="expiry" class="tag" :class="{ danger: expiry.expired }">
            {{ expiry.label }}
          </span>
        </div>
      </div>
      <div class="iad-actions">
        <button
          class="iconbtn"
          type="button"
          :disabled="identity?.loading"
          :title="t('infra.list.action.checkIdentity')"
          @click="emit('check-identity')"
        >
          <Icon name="shield" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          class="iconbtn"
          type="button"
          :disabled="!canEdit"
          :title="canEdit ? t('common.edit') : t('infra.list.action.editDisabledProcess')"
          @click="canEdit && emit('edit')"
        >
          <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          class="iconbtn"
          type="button"
          :title="t('infra.list.action.duplicate')"
          @click="emit('duplicate')"
        >
          <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          class="iconbtn"
          type="button"
          :disabled="isDefault"
          :title="
            isDefault ? t('infra.list.action.alreadyDefault') : t('infra.list.action.setDefault')
          "
          @click="!isDefault && emit('set-default')"
        >
          <Icon name="check" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          class="iconbtn iad-danger"
          type="button"
          :title="t('common.delete')"
          @click="emit('delete')"
        >
          <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
    </header>

    <div class="dscroll">
      <div
        v-if="identity"
        class="iad-identity"
        :class="{ err: identity.result && !identity.result.ok }"
      >
        <template v-if="identity.loading">
          <Icon
            name="refresh"
            class="iad-spin"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
          {{ t('infra.list.identity.checking') }}
        </template>
        <template v-else-if="identity.result?.ok">
          <Icon name="check" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <span class="mono">{{ identity.result.accountId }}</span>
          <span class="mono iad-arn">{{ identity.result.arn }}</span>
        </template>
        <template v-else-if="identity.result">
          <Icon name="alert" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <span>{{ identity.result.error }}</span>
        </template>
      </div>

      <dl class="iad-kv">
        <div class="iad-kv-row">
          <dt>{{ t('infra.list.field.accountId') }}</dt>
          <dd>
            <template v-if="accountId">
              <span class="mono">{{ accountId.accountId }}</span>
              <span class="iad-accid-src">
                {{
                  accountId.origin === 'sts' && accountId.at
                    ? t('infra.list.accountId.verifiedAt', { time: verifiedAtLabel })
                    : t('infra.list.accountId.fromConfig')
                }}
              </span>
            </template>
            <!-- Nút LUÔN hiện khi giá trị còn sửa được (chưa biết, hoặc đã nhớ
                 từ STS). Trước đây nó chỉ hiện lúc CHƯA biết, nên một id nhớ sai
                 không có đường nào gỡ ra khỏi UI — phải chờ hết hạn. Id đọc thẳng
                 từ `~/.aws` (`origin: 'config'`) thì không có nút: nó luôn tươi
                 theo file cấu hình, không có gì để phân giải lại hay để quên. -->
            <template v-if="canResolveAccountId">
              <span class="iad-accid-actions">
                <button
                  class="iad-linkbtn"
                  type="button"
                  :disabled="accountIdResolving"
                  :title="t('infra.list.accountId.resolveOneHint')"
                  @click="emit('resolve-account-id')"
                >
                  <Icon
                    :name="accountIdResolving ? 'refresh' : 'search'"
                    :class="{ 'iad-spin': accountIdResolving }"
                    style="width: var(--icon-xs); height: var(--icon-xs)"
                  />
                  {{ resolveAccountIdLabel }}
                </button>
                <button
                  v-if="canForgetAccountId"
                  class="iad-linkbtn"
                  type="button"
                  :disabled="accountIdResolving"
                  :title="t('infra.list.accountId.forgetHint')"
                  @click="emit('forget-account-id')"
                >
                  <Icon name="trash" style="width: var(--icon-xs); height: var(--icon-xs)" />
                  {{ t('infra.list.accountId.forget') }}
                </button>
              </span>
              <div v-if="accountIdFailure" class="iad-accid-err">{{ accountIdFailure }}</div>
            </template>
          </dd>
        </div>
        <div class="iad-kv-row">
          <dt>{{ t('infra.list.field.region') }}</dt>
          <!-- Không region KHÔNG phải một ô trống vô hại: `--profile X` không đọc
               `region` từ section `[default]`, nên profile này chết ở mọi lệnh.
               Nói ra hậu quả ngay tại hàng, thay vì để "Chưa đặt" trơ ra như một
               trạng thái bình thường (ca 2026-09-14 01:32). -->
          <dd :class="{ 'iad-value-warn': !profile.region }">
            {{ profile.region || t('infra.list.value.regionUnset') }}
          </dd>
        </div>
        <div v-if="profile.output" class="iad-kv-row">
          <dt>{{ t('infra.list.field.output') }}</dt>
          <dd>{{ profile.output }}</dd>
        </div>

        <template v-if="profile.kind === 'static'">
          <div class="iad-kv-row">
            <dt>{{ t('infra.list.field.staticKeys') }}</dt>
            <dd>
              {{ profile.hasStaticKeys ? t('infra.list.value.yes') : t('infra.list.value.no') }}
            </dd>
          </div>
          <div class="iad-kv-row">
            <dt>{{ t('infra.list.field.sessionToken') }}</dt>
            <dd>
              {{ profile.hasSessionToken ? t('infra.list.value.yes') : t('infra.list.value.no') }}
            </dd>
          </div>
        </template>

        <template v-else-if="profile.kind === 'sso'">
          <div v-if="profile.ssoStartUrl" class="iad-kv-row">
            <dt>{{ t('infra.list.field.ssoStartUrl') }}</dt>
            <dd class="mono">{{ profile.ssoStartUrl }}</dd>
          </div>
          <div v-if="profile.ssoSession" class="iad-kv-row">
            <dt>{{ t('infra.list.field.ssoSession') }}</dt>
            <dd>{{ profile.ssoSession }}</dd>
          </div>
          <div v-if="profile.ssoAccountId" class="iad-kv-row">
            <dt>{{ t('infra.list.field.ssoAccountId') }}</dt>
            <dd class="mono">{{ profile.ssoAccountId }}</dd>
          </div>
          <div v-if="profile.ssoRoleName" class="iad-kv-row">
            <dt>{{ t('infra.list.field.ssoRoleName') }}</dt>
            <dd>{{ profile.ssoRoleName }}</dd>
          </div>
        </template>

        <template v-else-if="profile.kind === 'assume-role'">
          <div v-if="profile.roleArn" class="iad-kv-row">
            <dt>{{ t('infra.list.field.roleArn') }}</dt>
            <dd class="mono">{{ profile.roleArn }}</dd>
          </div>
          <div v-if="profile.sourceProfile" class="iad-kv-row">
            <dt>{{ t('infra.list.field.sourceProfile') }}</dt>
            <dd>{{ profile.sourceProfile }}</dd>
          </div>
          <div v-if="profile.mfaSerial" class="iad-kv-row">
            <dt>{{ t('infra.list.field.mfaSerial') }}</dt>
            <dd class="mono">{{ profile.mfaSerial }}</dd>
          </div>
        </template>

        <div class="iad-kv-row">
          <dt>{{ t('infra.list.field.source') }}</dt>
          <dd>{{ sourceLabel }}</dd>
        </div>
      </dl>

      <!-- credential_process là chỉ đọc ở v1 (LUẬT CỨNG #3) — VÀ `AwsProfile`
           (types/index.ts, khoá cho A2) không mang trường lưu nguyên văn lệnh, nên
           không có gì thật để hiện ở đây ngoài việc trỏ người dùng ra file thật.
           Xem openIssues: thiếu `credentialProcess?: string` xuyên sidecar → UI. -->
      <div v-if="profile.kind === 'process'" class="iad-note">
        <Icon
          name="info"
          style="width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto; margin-top: 1px"
        />
        <div>
          <p>{{ t('infra.list.process.note') }}</p>
          <button class="iad-linkbtn" type="button" @click="emit('open-config-file')">
            <Icon name="external" style="width: var(--icon-xs); height: var(--icon-xs)" />
            {{ t('infra.list.process.openFile') }}
          </button>
        </div>
      </div>

      <div v-else-if="profile.kind === 'unknown'" class="iad-note">
        <Icon
          name="info"
          style="width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto; margin-top: 1px"
        />
        <p>{{ t('infra.list.unknown.note') }}</p>
      </div>

      <div class="iad-sec-h">{{ t('infra.list.usage.title') }}</div>
      <div class="iad-usage">
        <p v-if="!usageProjects.length && !usageSessionCount" class="iad-usage-empty">
          {{ t('infra.list.usage.none') }}
        </p>
        <template v-else>
          <p v-if="usageProjects.length">
            {{
              t('infra.list.usage.projects', {
                n: usageProjects.length,
                names: usageProjects.join(', '),
              })
            }}
          </p>
          <p v-if="usageSessionCount">
            {{ t('infra.list.usage.sessions', { n: usageSessionCount }) }}
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Pane chi tiết của màn "Tài khoản" (A2). THUẦN TRÌNH BÀY — không tự gọi RPC,
// không tự mở confirm/prompt: mọi nút chỉ emit lên InfraAccounts.vue (orchestrator
// sở hữu useAwsProfilesApi()/useConfirm()/useTextPrompt(), theo đúng SRP — pane này
// không cần biết profileDelete ném lỗi kiểu gì). Khuôn hero (tên + tag co giãn +
// hàng action) + `dl` key-value mượn từ components/ssh/SshDetail.vue — KHÔNG dùng
// `.dh` cao cố định 50px của RuleDetail.vue vì profile có thể mang tới 3 tag
// (kind/mặc định/hết hạn) cần wrap, một hàng cứng sẽ cắt chữ.
import { computed } from 'vue'
import { AWS_PROFILE_SOURCE_LABEL_KEY, computeExpiry } from '~/utils/aws-profile-view'
import type { AwsProfile, AwsProfileKind } from '~/types'
import type { AwsIdentityCheckResult } from '~/composables/useAwsProfilesApi'
import type { ResolvedAccountId } from '~/composables/useAwsProfileAccountIds'

// Trạng thái kiểm tra danh tính của ĐÚNG profile đang hiện — orchestrator giữ một
// Map theo tên profile (đổi profile không mất kết quả lần kiểm tra trước), còn ở
// đây chỉ nhận lát cắt của đúng profile này. `null` = chưa từng bấm kiểm tra.
export type InfraIdentityState = { loading: boolean; result: AwsIdentityCheckResult | null }

const props = defineProps<{
  profile: AwsProfile
  isDefault: boolean
  identity: InfraIdentityState | null
  usageProjects: string[]
  usageSessionCount: number
  /**
   * A8 — id đã biết cho ĐÚNG profile đang hiện (miễn phí hoặc đã resolve), hoặc
   * `null` khi chưa biết. Khác `identity`: đây KHÔNG phải kết quả "kiểm tra danh
   * tính" (ephemeral, không cache) — nó là giá trị PERSIST vào
   * `~/.awog/infra/account-ids.json`.
   *
   * ⚠ File đó KHÔNG phải đầu vào của `accountKindOf()` và cố ý không phải: agent
   * ghi được nó bằng `Bash`, còn trường `fp` chỉ chống lệch cấu hình chứ không
   * phải chữ ký (xem runtime/permission.ts). Nó được nhớ để HIỂN THỊ. Đường tới
   * ma trận quyền đi qua ngữ cảnh đã ghim (`settings.infra`, khuôn InfraChip) và
   * chỉ áp cho profile đang là mặc định — xem `pinAccountIdForDefault`.
   */
  accountId: ResolvedAccountId | null
  /** `true` khi ĐÚNG profile này đang có một lời gọi resolve-account-id bay. */
  accountIdResolving: boolean
  /** Lỗi ĐÃ dịch của lần điền account id gần nhất cho profile này, hoặc `null`. */
  accountIdFailure: string | null
}>()

const emit = defineEmits<{
  edit: []
  duplicate: []
  delete: []
  'set-default': []
  'check-identity': []
  'open-config-file': []
  // A8 — điền account id CHỈ cho profile đang hiện. Khác 'check-identity': nút
  // đó chạy sts get-caller-identity ĐỂ HIỂN THỊ (ARN/userId, không lưu), còn nút
  // này gọi CÙNG lời gọi STS nhưng để GHI vào cache dùng cho chính sách hạ tầng.
  'resolve-account-id': []
  // Đường LÙI của cái trên: xoá giá trị đã nhớ. Cần riêng vì "phân giải lại" chỉ
  // sửa được id sai khi STS còn gọi được — token hết hạn thì không.
  'forget-account-id': []
}>()

const { t } = useI18n()

const KIND_LABEL = computed<Record<AwsProfileKind, string>>(() => ({
  sso: t('infra.list.kind.sso'),
  login: t('infra.list.kind.login'),
  static: t('infra.list.kind.static'),
  'assume-role': t('infra.list.kind.assumeRole'),
  process: t('infra.list.kind.process'),
  unknown: t('infra.list.kind.unknown'),
}))
const kindLabel = computed(() => KIND_LABEL.value[props.profile.kind])

// LUẬT CỨNG #3: process chỉ đọc ở v1 — tắt Sửa, có title giải thích vì sao (không
// im lặng disable).
const canEdit = computed(() => props.profile.kind !== 'process')

const sourceLabel = computed(() => t(AWS_PROFILE_SOURCE_LABEL_KEY[props.profile.source]))

// Định dạng theo locale hệ điều hành — khuôn `.toLocaleString()` mà TaskDetail.vue
// đã dùng cho mốc thời gian, không viết thêm một hàm format riêng (YAGNI).
// Ba trạng thái của hàng Account, không phải hai:
//   · chưa biết          ⇒ "Điền account ID"
//   · nhớ từ STS         ⇒ "Xác minh lại" + "Quên" (giá trị có thể đã cũ/sai)
//   · đọc từ ~/.aws      ⇒ không nút nào (luôn tươi, không có gì để sửa)
const isStsAccountId = computed(() => props.accountId?.origin === 'sts')
const canResolveAccountId = computed(() => props.accountId === null || isStsAccountId.value)
const canForgetAccountId = computed(() => isStsAccountId.value)
const resolveAccountIdLabel = computed(() => {
  if (props.accountIdResolving) return t('infra.list.accountId.working')
  return isStsAccountId.value
    ? t('infra.list.accountId.reverify')
    : t('infra.list.accountId.resolveOne')
})

const verifiedAtLabel = computed(() => {
  const at = props.accountId?.at
  if (!at) return ''
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? at : new Date(ms).toLocaleString()
})

const expiry = computed(() => {
  const info = computeExpiry(props.profile.expiresAt)
  if (!info) return null
  if (info.status === 'expired') return { label: t('infra.list.expiry.expired'), expired: true }
  return {
    label:
      info.hours > 0
        ? t('infra.list.expiry.inHours', { h: info.hours, m: info.minutes })
        : t('infra.list.expiry.inMinutes', { n: info.minutes }),
    expired: false,
  }
})
</script>

<style scoped>
.iad {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.iad-hero {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 18px;
  box-shadow: inset 0 -1px 0 var(--border);
}

.iad-hero-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.iad-name {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.iad-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.iad-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  padding-top: 2px;
}

.iad-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.iad-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 18px;
  border-radius: var(--r-btn);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.iad-identity.err {
  color: var(--danger);
  background: var(--dangerDim);
  border-color: var(--dangerBorder);
}

.iad-arn {
  color: var(--textDim);
  word-break: break-all;
}

@keyframes iad-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.iad-spin {
  animation: iad-spin 0.8s linear infinite;
}

.iad-kv {
  margin: 0 0 22px;
}
.iad-kv-row {
  display: flex;
  gap: 16px;
  padding: 8px 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.iad-kv-row + .iad-kv-row {
  border-top: 1px solid var(--border);
}
.iad-kv-row dt {
  flex: 0 0 auto;
  width: 140px;
  color: var(--textDim);
}
.iad-kv-row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--text);
  word-break: break-word;
}
.iad-value-warn {
  color: var(--amber);
}

.iad-note {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 22px;
  border-radius: var(--r-btn);
  background: var(--bgHover);
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}
.iad-note p {
  margin: 0 0 6px;
}

.iad-linkbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.iad-linkbtn:hover {
  border-color: var(--borderStrong);
  background: var(--bgHover);
}

.iad-linkbtn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* Hai nút phụ của hàng Account — xuống dòng khi hàng hẹp thay vì bóp nhau, và
   tách khỏi giá trị id một khoảng khi chúng đứng cùng dòng với nó. */
.iad-accid-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: 8px;
  vertical-align: middle;
}
.iad-accid-actions:first-child {
  margin-left: 0;
}

.iad-accid-src {
  margin-left: 8px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.iad-accid-err {
  margin-top: 6px;
  color: var(--danger);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.iad-sec-h {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
  margin: 0 0 6px;
}

.iad-usage p {
  margin: 0 0 4px;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textMuted);
}
.iad-usage-empty {
  color: var(--textDim);
}

.tag.danger {
  color: var(--danger);
  border-color: var(--dangerBorder);
}
</style>
