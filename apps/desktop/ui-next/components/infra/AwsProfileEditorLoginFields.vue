<template>
  <div class="flex flex-col gap-2.5 rounded-lg border bg-muted p-3">
    <div class="flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon name="globe" class="size-3.5 text-primary" />
      <span>{{ t('infra.editor.login.title') }}</span>
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex items-baseline gap-2">
        <span class="min-w-21 flex-none text-xs text-dim">
          {{ t('infra.editor.login.account') }}
        </span>
        <!-- Account id đọc thẳng từ ARN của `login_session`, không cần gọi STS —
             biết thì hiện, không biết thì để dấu gạch, không đoán.
             mono-ok: account id / ARN phiên là giá trị copy-paste vào terminal. -->
        <code class="font-mono text-sm wrap-anywhere text-foreground">
          {{ accountId || t('infra.editor.login.accountUnknown') }}
        </code>
      </div>
      <div v-if="session" class="flex items-baseline gap-2">
        <span class="min-w-21 flex-none text-xs text-dim">
          {{ t('infra.editor.login.session') }}
        </span>
        <code class="font-mono text-sm wrap-anywhere text-foreground">{{ session }}</code>
      </div>
    </div>

    <p class="m-0 text-sm text-muted-foreground">{{ t('infra.editor.login.body') }}</p>

    <!-- Hai profile cho CÙNG một phiên (ca thật 2026-09-14). Nói ngay trong màn
         sửa vì đây là chỗ người dùng đang nhìn khi tự hỏi "sao lại có hai cái". -->
    <p v-if="sameSession.length > 0" class="m-0 text-xs text-warning">
      {{ t('infra.editor.login.sameSession', { names: sameSession.join(', ') }) }}
    </p>

    <Button type="button" class="self-start" variant="outline" size="sm" @click="emit('relogin')">
      <Icon name="refresh" class="size-3" />
      {{ t('infra.editor.login.relogin') }}
    </Button>
  </div>

  <AwsRegionField
    v-model="region"
    :hint="regionHint"
    :hint-tone="regionHintTone"
    :required="regionRequired"
  />
</template>

<script setup lang="ts">
// Form con của AwsProfileEditor.vue cho kind === 'login' (profile `aws login`).
//
// VÌ SAO KHÔNG PHẢI FORM STATIC. Ruột của profile `login` là `login_session` —
// định danh phiên do CLI sinh, token nằm trong `~/.aws/login/cache`. Cho người
// dùng "lưu" khoá tĩnh vào đây là ghi `aws_access_key_id` vào `~/.aws/credentials`
// trong khi họ tưởng vẫn đang chạy bằng phiên Console: khoá tĩnh CÓ QUYỀN CAO HƠN,
// nên phiên đăng nhập trở thành vô nghĩa mà màn hình không nói gì.
//
// VÌ SAO VẪN CÓ Ô SỬA. Tên và `region` là hai thứ người dùng cần đổi thật, và bản
// trước không cho đổi cái nào (chỉ có nút Đăng nhập lại). Hệ quả đo được trên máy
// người dùng 2026-09-14: tên gợi ý `console` không sửa được, nên muốn tên khác thì
// phải đăng nhập lần nữa — và kết quả là hai profile cho cùng một tài khoản
// (`console` + `hoatq.dev`, cùng `login_session`). Sidecar chỉ cho đổi đúng hai
// thứ này (`assertLoginEdit` trong infra/aws/profile-ops.ts).
//
// Component KHÔNG tự gọi RPC: cha giữ state, gọi `profileSave()` và `relogin`.
import { computed } from 'vue'
import AwsRegionField from '~/components/infra/AwsRegionField.vue'
import { accountIdOfLoginSession, otherProfilesWithSameSession } from '~/utils/aws-profile-view'
import type { AwsProfile } from '~/types'
import Button from '~/components/ui/button/Button.vue'

const props = withDefaults(
  defineProps<{
    /** Profile đang sửa — nguồn của `login_session` và của tên TRÊN ĐĨA. */
    profile: AwsProfile | null
    /** Danh sách gốc: để tìm profile khác dùng cùng phiên. */
    profiles: AwsProfile[]
    /** Tên đang gõ trong form (có thể khác tên trên đĩa khi đang đổi tên). */
    name: string
    regionHint?: string | undefined
    regionHintTone?: 'info' | 'warn'
    regionRequired?: boolean
  }>(),
  { regionHint: undefined, regionHintTone: 'info', regionRequired: false },
)

const emit = defineEmits<{ relogin: [] }>()

const { t } = useI18n()

const region = defineModel<string>({ required: true })

const session = computed(() => props.profile?.loginSession?.trim() ?? '')
const accountId = computed(() => accountIdOfLoginSession(session.value))
const sameSession = computed(() =>
  props.profile ? otherProfilesWithSameSession(props.profile, props.profiles, props.name) : [],
)
</script>
