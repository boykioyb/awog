<template>
  <div class="flex flex-col gap-2.5 rounded-lg border bg-muted p-3">
    <div class="flex items-center gap-2">
      <Icon name="help" class="size-3.5 text-primary" />
      <span class="text-sm font-semibold text-foreground">{{ t('infra.help.title') }}</span>
    </div>

    <p class="m-0 text-xs text-dim">{{ t('infra.help.intro') }}</p>

    <div class="flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2">
      <div class="text-xs font-semibold text-muted-foreground">
        {{ t('infra.help.consoleTitle') }}
      </div>
      <p class="m-0 text-xs text-muted-foreground">{{ t('infra.help.consoleBody') }}</p>
    </div>

    <div class="flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2">
      <div class="text-xs font-semibold text-muted-foreground">{{ t('infra.help.keyTitle') }}</div>
      <ol class="m-0 flex list-decimal flex-col gap-1 pl-4.5 text-xs text-muted-foreground">
        <li>{{ t('infra.help.step1') }}</li>
        <li>{{ t('infra.help.step2') }}</li>
        <li>{{ t('infra.help.step3') }}</li>
        <li>{{ t(context === 'csv' ? 'infra.help.step4Csv' : 'infra.help.step4Static') }}</li>
      </ol>

      <!-- Nút, KHÔNG phải <a href>: interceptor toàn cục của useLinkOpen bắt mọi
           <a href^=http> rồi hỏi "Mở trong AWOG hay browser của tôi". Với trang
           đăng nhập AWS thì lựa chọn đó là một cái bẫy — người dùng sẽ gõ mật khẩu
           AWS vào Chromium của app. Hai link dưới đây luôn ra browser hệ điều hành,
           và đi thẳng qua openExternally() nên không bao giờ hiện popover.
           (Cùng lý do + cùng khuôn với SettingsDevices.vue → openNetbird.) -->
      <div class="mt-0.5 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="xs" class="text-primary" @click="openSignIn">
          <Icon name="external" class="size-3" />
          {{ t('infra.help.openSignIn') }}
        </Button>
        <Button type="button" variant="outline" size="xs" class="text-primary" @click="openDocs">
          <Icon name="external" class="size-3" />
          {{ t('infra.help.openDocs') }}
        </Button>
      </div>
    </div>

    <div class="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
      <div class="text-xs font-semibold text-warning">{{ t('infra.help.blockedTitle') }}</div>
      <p class="m-0 text-xs text-muted-foreground">{{ t('infra.help.blockedBody') }}</p>
    </div>

    <p class="m-0 text-xs text-dim">{{ t('infra.help.passwordNote') }}</p>
  </div>
</template>

<script setup lang="ts">
// Khối trợ giúp "lấy credential ở đâu" — Mốc 1 (docs/features/
// aws-profile-manager.md §"Lấy credential ở đâu"). Trước component này, cả ba
// nguồn nhập đều giả định người dùng ĐÃ có credential sẵn: hint của nhánh CSV chỉ
// nói "file mà IAM console đưa ngay sau khi tạo access key", mà người chưa từng
// tạo access key thì không biết bấm vào đâu.
//
// HAI ĐƯỜNG, và đường đầu KHÔNG sinh khoá dài hạn. Bản đầu của khối này chỉ có
// đường access key, kèm câu "mật khẩu Console không dùng được ở dòng lệnh" —
// đúng với CLI cũ nhưng SAI với aws-cli v2 hiện hành: `aws login` (đo trên
// 2.35.9) đăng nhập bằng chính phiên Console, nhận credential tạm + refresh
// token, và ghi `login_session` vào profile trong ~/.aws/config
// (awscli/customizations/login/login.py). Vì vậy nó đứng trước.
//
// Dùng chung cho hai bề mặt, chỉ khác bước cuối của đường access key (chọn file
// CSV vs dán vào form) — nên prop là `context` chứ không phải hai bản copy.
//
// Chỉ dẫn chứ không thu thập: KHÔNG có ô nhập username/password ở đây và không
// bao giờ được thêm (luật cứng #2 — secret không rời sidecar; mật khẩu Console
// thậm chí không phải credential mà sidecar dùng được).
import { useLinkOpen } from '~/composables/useLinkOpen'

defineProps<{
  // 'csv' = wizard nhập profile (AwsProfileImportSourceStep) · 'static' = form
  // thêm/sửa profile static (AwsProfileEditorStaticFields).
  context: 'csv' | 'static'
}>()

const { t } = useI18n()
const { openExternally } = useLinkOpen()

// Link TĨNH, cố ý: không ghép từ Account ID/alias người dùng gõ vào. URL dựng từ
// input L1 là bề mặt SSRF/redirect mà repo đã có luật riêng (invariant #7), và
// deep link tới đúng trang user là việc của nút Console ↗ ở Mốc 3.4 — làm một
// lần ở đó, có validate, thay vì hai cách dựng URL console khác nhau.
const SIGN_IN_URL = 'https://signin.aws.amazon.com/console'
const DOCS_URL = 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html'

function openSignIn(): void {
  void openExternally(SIGN_IN_URL)
}
function openDocs(): void {
  void openExternally(DOCS_URL)
}
</script>
