<template>
  <div class="ach">
    <div class="ach-head">
      <Icon
        name="help"
        style="width: var(--icon-sm); height: var(--icon-sm); color: var(--accent)"
      />
      <span class="ach-title">{{ t('infra.help.title') }}</span>
    </div>

    <p class="ach-intro">{{ t('infra.help.intro') }}</p>

    <div class="ach-route">
      <div class="ach-route-title">{{ t('infra.help.consoleTitle') }}</div>
      <p class="ach-route-body">{{ t('infra.help.consoleBody') }}</p>
    </div>

    <div class="ach-route">
      <div class="ach-route-title">{{ t('infra.help.keyTitle') }}</div>
      <ol class="ach-steps">
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
           (Cùng lý do + cùng khuôn với SettingsDevices.vue → openTailscale.) -->
      <div class="ach-links">
        <button type="button" class="ach-link" @click="openSignIn">
          <Icon name="external" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ t('infra.help.openSignIn') }}
        </button>
        <button type="button" class="ach-link" @click="openDocs">
          <Icon name="external" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ t('infra.help.openDocs') }}
        </button>
      </div>
    </div>

    <div class="ach-blocked">
      <div class="ach-blocked-title">{{ t('infra.help.blockedTitle') }}</div>
      <p class="ach-blocked-body">{{ t('infra.help.blockedBody') }}</p>
    </div>

    <p class="ach-note">{{ t('infra.help.passwordNote') }}</p>
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

<style scoped>
.ach {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 13px;
  border-radius: var(--r-btn);
  background: var(--bgSubtle);
  border: 1px solid var(--border);
}
.ach-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ach-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.ach-intro {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ach-route {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--bgEl);
  border: 1px solid var(--border);
}
.ach-route-title {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textMuted);
}
.ach-route-body {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textMuted);
}
.ach-steps {
  margin: 0;
  padding-left: 18px;
  list-style: decimal;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textMuted);
}
.ach-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
.ach-link {
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
.ach-link:hover {
  background: var(--bgHover);
}
.ach-blocked {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
}
.ach-blocked-title {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--amber);
}
.ach-blocked-body {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textMuted);
}
.ach-note {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
