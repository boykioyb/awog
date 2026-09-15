<template>
  <div class="ape-field">
    <label class="ape-label">{{ t('infra.editor.sso.source') }}</label>
    <div class="seg ape-seg">
      <span :class="{ on: model.source === 'session' }" @click="model.source = 'session'">
        {{ t('infra.editor.sso.sourceSession') }}
      </span>
      <span :class="{ on: model.source === 'manual' }" @click="model.source = 'manual'">
        {{ t('infra.editor.sso.sourceManual') }}
      </span>
    </div>
  </div>

  <div v-if="model.source === 'session'" class="ape-field">
    <label class="ape-label">
      <!-- Dấu `*` CHỈ ở lượt tạo mới: sửa profile có sẵn thì ô trống là "giữ
           nguyên giá trị trên đĩa" (S2a) nên không bắt buộc. -->
      {{ t('infra.editor.sso.ssoSession') }}
      <span v-if="!isExisting" class="ape-req" aria-hidden="true">*</span>
    </label>
    <input
      v-model.trim="model.ssoSession"
      class="ape-input mono"
      spellcheck="false"
      :placeholder="t('infra.editor.sso.ssoSessionPh')"
    />
    <div class="ape-hint">{{ t('infra.editor.sso.ssoSessionHint') }}</div>
  </div>

  <template v-else>
    <div class="ape-field">
      <label class="ape-label">
        {{ t('infra.editor.sso.startUrl') }}
        <span v-if="!isExisting" class="ape-req" aria-hidden="true">*</span>
      </label>
      <input
        v-model.trim="model.ssoStartUrl"
        class="ape-input mono"
        spellcheck="false"
        :placeholder="t('infra.editor.sso.startUrlPh')"
      />
    </div>
    <AwsRegionField
      v-model="model.ssoRegion"
      :label="t('infra.editor.sso.ssoRegion')"
      :hint="ssoRegionHint"
      :required="!isExisting"
    />
  </template>

  <div class="ape-row">
    <div class="ape-field">
      <label class="ape-label">
        {{ t('infra.editor.sso.accountId') }}
        <span v-if="!isExisting" class="ape-req" aria-hidden="true">*</span>
      </label>
      <input
        v-model.trim="model.ssoAccountId"
        class="ape-input mono"
        spellcheck="false"
        :placeholder="t('infra.editor.sso.accountIdPh')"
      />
    </div>
    <div class="ape-field">
      <label class="ape-label">
        {{ t('infra.editor.sso.roleName') }}
        <span v-if="!isExisting" class="ape-req" aria-hidden="true">*</span>
      </label>
      <input
        v-model.trim="model.ssoRoleName"
        class="ape-input"
        spellcheck="false"
        :placeholder="t('infra.editor.sso.roleNamePh')"
      />
    </div>
  </div>

  <AwsRegionField v-model="model.region" :hint="regionHint" />
</template>

<script setup lang="ts">
// Form con của AwsProfileEditor.vue cho kind === 'sso' (A3). Không có trường
// secret nào — token SSO nằm ở ~/.aws/sso/cache, không đi qua form này
// (docs/features/aws-profile-manager.md §"Form theo kiểu"). Hai nhánh loại trừ
// nhau: dùng lại một `[sso-session x]` đã có (nhập ở A5), hoặc điền thủ công
// start URL + sso region (định dạng SSO cũ, không có block sso-session).
import AwsRegionField from '~/components/infra/AwsRegionField.vue'
import type { SsoFormState } from '~/utils/aws-profile-form'

withDefaults(
  defineProps<{
    // Vài câu "tự dò được từ đâu" cho hai ô region — cha dựng (`detectRegion()`),
    // component này chỉ hiển thị. `ssoRegion` (region của portal SSO) và `region`
    // (region mặc định của profile) là hai thứ KHÁC nhau: portal thường ở
    // us-east-1 trong khi tài nguyên nằm ở ap-southeast-1.
    regionHint?: string | undefined
    ssoRegionHint?: string | undefined
    /**
     * Đang SỬA một profile có sẵn ⇒ mọi ô để trống là "giữ nguyên giá trị trên
     * đĩa" (S2a), nên các nhãn bỏ dấu `*` — chúng chỉ bắt buộc ở lượt tạo mới
     * (xem `canSave()` ở AwsProfileEditor.vue).
     */
    isExisting: boolean
  }>(),
  { regionHint: undefined, ssoRegionHint: undefined },
)

const model = defineModel<SsoFormState>({ required: true })

const { t } = useI18n()
</script>

<style scoped>
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
  /* mono-ok: sso-session name / start URL / account id là giá trị copy-paste
     từ portal SSO hoặc vào ~/.aws/config. */
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
/* Dấu `*` bắt buộc — cùng vocabulary với `.sse-req` (SshEditor). */
.ape-req {
  color: var(--danger);
  font-weight: 700;
}
.ape-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
</style>
