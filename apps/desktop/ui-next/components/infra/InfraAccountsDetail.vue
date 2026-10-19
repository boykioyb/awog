<template>
  <!-- mono-ok (các giá trị font-mono dưới đây): account id / ARN / start URL / MFA
       serial là định danh người dùng copy-paste sang console hoặc CLI. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <header class="flex flex-none items-start gap-2.5 border-b px-4.5 py-3.5">
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="truncate text-lg font-semibold text-foreground">{{ profile.name }}</div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" class="rounded-sm px-1.5 py-0 font-normal text-muted-foreground">
            {{ kindLabel }}
          </Badge>
          <Badge
            v-if="isDefault"
            variant="outline"
            class="rounded-sm px-1.5 py-0 font-normal border-primary/45 bg-primary/10 text-primary"
          >
            {{ t('infra.list.default') }}
          </Badge>
          <Badge
            v-if="expiry"
            variant="outline"
            class="rounded-sm px-1.5 py-0 font-normal"
            :class="
              expiry.expired ? 'border-destructive/40 text-destructive' : 'text-muted-foreground'
            "
          >
            {{ expiry.label }}
          </Badge>
        </div>
      </div>
      <div class="flex flex-none items-center gap-0.5 pt-0.5">
        <Button
          type="button"
          :disabled="identity?.loading"
          :title="t('infra.list.action.checkIdentity')"
          variant="ghost"
          size="iconMd"
          @click="emit('check-identity')"
        >
          <Icon name="shield" class="size-3.5" />
        </Button>
        <Button
          type="button"
          :disabled="!canEdit"
          :title="canEdit ? t('common.edit') : t('infra.list.action.editDisabledProcess')"
          variant="ghost"
          size="iconMd"
          @click="canEdit && emit('edit')"
        >
          <Icon name="edit" class="size-3.5" />
        </Button>
        <Button
          type="button"
          :title="t('infra.list.action.duplicate')"
          variant="ghost"
          size="iconMd"
          @click="emit('duplicate')"
        >
          <Icon name="copy" class="size-3.5" />
        </Button>
        <Button
          type="button"
          :disabled="isDefault"
          :title="
            isDefault ? t('infra.list.action.alreadyDefault') : t('infra.list.action.setDefault')
          "
          variant="ghost"
          size="iconMd"
          @click="!isDefault && emit('set-default')"
        >
          <Icon name="check" class="size-3.5" />
        </Button>
        <Button
          type="button"
          :title="t('common.delete')"
          class="text-dim hover:bg-destructive/10 hover:text-destructive"
          variant="ghost"
          size="iconMd"
          @click="emit('delete')"
        >
          <Icon name="trash" class="size-3.5" />
        </Button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-4.5">
      <div
        v-if="identity"
        class="mb-4.5 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
        :class="
          identity.result && !identity.result.ok
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'text-foreground'
        "
      >
        <template v-if="identity.loading">
          <Icon name="refresh" class="size-3.5 animate-spin" />
          {{ t('infra.list.identity.checking') }}
        </template>
        <template v-else-if="identity.result?.ok">
          <Icon name="check" class="size-3.5" />
          <span class="font-mono">{{ identity.result.accountId }}</span>
          <span class="font-mono break-all text-dim">{{ identity.result.arn }}</span>
        </template>
        <template v-else-if="identity.result">
          <Icon name="alert" class="size-3.5" />
          <span>{{ identity.result.error }}</span>
        </template>
      </div>

      <dl class="mt-0 mb-5.5">
        <div
          class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
        >
          <dt>{{ t('infra.list.field.accountId') }}</dt>
          <dd>
            <template v-if="accountId">
              <span class="font-mono">{{ accountId.accountId }}</span>
              <span class="ml-2 text-xs text-dim">
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
              <!-- Hai nút phụ xuống dòng khi hàng hẹp thay vì bóp nhau, và tách khỏi
                   giá trị id một khoảng khi đứng cùng dòng với nó. -->
              <span class="ml-2 inline-flex flex-wrap gap-1.5 align-middle first:ml-0">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  class="h-auto gap-1 rounded-sm px-2 py-0.5 font-normal"
                  :disabled="accountIdResolving"
                  :title="t('infra.list.accountId.resolveOneHint')"
                  @click="emit('resolve-account-id')"
                >
                  <Icon
                    :name="accountIdResolving ? 'refresh' : 'search'"
                    class="size-3"
                    :class="{ 'animate-spin': accountIdResolving }"
                  />
                  {{ resolveAccountIdLabel }}
                </Button>
                <Button
                  v-if="canForgetAccountId"
                  type="button"
                  variant="outline"
                  size="xs"
                  class="h-auto gap-1 rounded-sm px-2 py-0.5 font-normal"
                  :disabled="accountIdResolving"
                  :title="t('infra.list.accountId.forgetHint')"
                  @click="emit('forget-account-id')"
                >
                  <Icon name="trash" class="size-3" />
                  {{ t('infra.list.accountId.forget') }}
                </Button>
              </span>
              <div v-if="accountIdFailure" class="mt-1.5 text-xs text-destructive">
                {{ accountIdFailure }}
              </div>
            </template>
          </dd>
        </div>
        <div
          class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
        >
          <dt>{{ t('infra.list.field.region') }}</dt>
          <!-- Không region KHÔNG phải một ô trống vô hại: `--profile X` không đọc
               `region` từ section `[default]`, nên profile này chết ở mọi lệnh.
               Nói ra hậu quả ngay tại hàng, thay vì để "Chưa đặt" trơ ra như một
               trạng thái bình thường (ca 2026-09-14 01:32). -->
          <dd :class="{ 'text-warning': !profile.region }">
            {{ profile.region || t('infra.list.value.regionUnset') }}
          </dd>
        </div>
        <div
          v-if="profile.output"
          class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
        >
          <dt>{{ t('infra.list.field.output') }}</dt>
          <dd>{{ profile.output }}</dd>
        </div>

        <template v-if="profile.kind === 'static'">
          <div
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.staticKeys') }}</dt>
            <dd>
              {{ profile.hasStaticKeys ? t('infra.list.value.yes') : t('infra.list.value.no') }}
            </dd>
          </div>
          <div
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.sessionToken') }}</dt>
            <dd>
              {{ profile.hasSessionToken ? t('infra.list.value.yes') : t('infra.list.value.no') }}
            </dd>
          </div>
        </template>

        <template v-else-if="profile.kind === 'sso'">
          <div
            v-if="profile.ssoStartUrl"
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.ssoStartUrl') }}</dt>
            <dd class="font-mono">{{ profile.ssoStartUrl }}</dd>
          </div>
          <div
            v-if="profile.ssoSession"
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.ssoSession') }}</dt>
            <dd>{{ profile.ssoSession }}</dd>
          </div>
          <div
            v-if="profile.ssoAccountId"
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.ssoAccountId') }}</dt>
            <dd class="font-mono">{{ profile.ssoAccountId }}</dd>
          </div>
          <div
            v-if="profile.ssoRoleName"
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.ssoRoleName') }}</dt>
            <dd>{{ profile.ssoRoleName }}</dd>
          </div>
        </template>

        <template v-else-if="profile.kind === 'assume-role'">
          <div
            v-if="profile.roleArn"
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.roleArn') }}</dt>
            <dd class="font-mono">{{ profile.roleArn }}</dd>
          </div>
          <div
            v-if="profile.sourceProfile"
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.sourceProfile') }}</dt>
            <dd>{{ profile.sourceProfile }}</dd>
          </div>
          <div
            v-if="profile.mfaSerial"
            class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
          >
            <dt>{{ t('infra.list.field.mfaSerial') }}</dt>
            <dd class="font-mono">{{ profile.mfaSerial }}</dd>
          </div>
        </template>

        <div
          class="flex gap-4 border-t py-2 text-sm first:border-t-0 [&>dd]:m-0 [&>dd]:min-w-0 [&>dd]:flex-1 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:w-35 [&>dt]:flex-none [&>dt]:text-dim"
        >
          <dt>{{ t('infra.list.field.source') }}</dt>
          <dd>{{ sourceLabel }}</dd>
        </div>
      </dl>

      <!-- credential_process là chỉ đọc ở v1 (LUẬT CỨNG #3) — VÀ `AwsProfile`
           (types/index.ts, khoá cho A2) không mang trường lưu nguyên văn lệnh, nên
           không có gì thật để hiện ở đây ngoài việc trỏ người dùng ra file thật.
           Xem openIssues: thiếu `credentialProcess?: string` xuyên sidecar → UI. -->
      <div
        v-if="profile.kind === 'process'"
        class="mb-5.5 flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground"
      >
        <Icon name="info" class="mt-px size-3.5 flex-none" />
        <div>
          <p class="mt-0 mb-1.5">{{ t('infra.list.process.note') }}</p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-auto gap-1 rounded-sm px-2 py-0.5 font-normal"
            @click="emit('open-config-file')"
          >
            <Icon name="external" class="size-3" />
            {{ t('infra.list.process.openFile') }}
          </Button>
        </div>
      </div>

      <div
        v-else-if="profile.kind === 'unknown'"
        class="mb-5.5 flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground"
      >
        <Icon name="info" class="mt-px size-3.5 flex-none" />
        <p class="mt-0 mb-1.5">{{ t('infra.list.unknown.note') }}</p>
      </div>

      <div class="mt-0 mb-1.5 text-xs font-semibold text-dim">
        {{ t('infra.list.usage.title') }}
      </div>
      <div class="text-sm leading-relaxed text-muted-foreground [&_p]:mt-0 [&_p]:mb-1">
        <p v-if="!usageProjects.length && !usageSessionCount" class="text-dim">
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
import Button from '~/components/ui/button/Button.vue'

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
