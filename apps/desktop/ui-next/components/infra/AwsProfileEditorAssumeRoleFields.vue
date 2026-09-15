<template>
  <div class="ape-field">
    <label class="ape-label">
      <!-- Dấu `*` CHỈ ở lượt tạo mới: sửa profile có sẵn thì ô trống là "giữ
           nguyên giá trị trên đĩa" (S2a) nên không bắt buộc. -->
      {{ t('infra.editor.assumeRole.roleArn') }}
      <span v-if="!isExisting" class="ape-req" aria-hidden="true">*</span>
    </label>
    <input
      v-model.trim="model.roleArn"
      class="ape-input mono"
      spellcheck="false"
      :placeholder="t('infra.editor.assumeRole.roleArnPh')"
    />
  </div>

  <div class="ape-field">
    <label class="ape-label">
      {{ t('infra.editor.assumeRole.sourceProfile') }}
      <span v-if="!isExisting" class="ape-req" aria-hidden="true">*</span>
    </label>
    <AppSelect
      v-model="model.sourceProfile"
      :options="sourceProfileOptions"
      :placeholder="t('infra.editor.assumeRole.sourceProfilePh')"
      width="100%"
    />
  </div>

  <div class="ape-row">
    <div class="ape-field">
      <label class="ape-label">
        {{ t('infra.editor.assumeRole.mfaSerial') }}
        <span class="ape-optional">{{ t('infra.editor.optional') }}</span>
      </label>
      <input
        v-model.trim="model.mfaSerial"
        class="ape-input mono"
        spellcheck="false"
        :placeholder="t('infra.editor.assumeRole.mfaSerialPh')"
      />
    </div>
    <div class="ape-field">
      <label class="ape-label">
        {{ t('infra.editor.assumeRole.externalId') }}
        <span class="ape-optional">{{ t('infra.editor.optional') }}</span>
      </label>
      <input
        v-model.trim="model.externalId"
        class="ape-input mono"
        spellcheck="false"
        :placeholder="t('infra.editor.assumeRole.externalIdPh')"
      />
    </div>
  </div>

  <div class="ape-field">
    <label class="ape-label">
      {{ t('infra.editor.assumeRole.duration') }}
      <span class="ape-optional">{{ t('infra.editor.optional') }}</span>
    </label>
    <input
      v-model.trim="model.durationSeconds"
      type="number"
      min="900"
      step="1"
      class="ape-input"
      :placeholder="t('infra.editor.assumeRole.durationPh')"
    />
  </div>
</template>

<script setup lang="ts">
// Form con của AwsProfileEditor.vue cho kind === 'assume-role' (A3). Không có
// trường secret nào — role được assume qua source_profile lúc CLI chạy, không
// có credential tĩnh nào ghi ở đây (docs/features/aws-profile-manager.md
// §"Form theo kiểu"). `sourceProfile` chọn từ danh sách profile GỐC (chưa lọc
// theo ô tìm — cha truyền `profiles` = `allProfiles` của useInfraPage), trừ
// chính profile đang sửa (không thể assume-role từ chính mình).
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type { AwsProfile } from '~/types'
import type { AssumeRoleFormState } from '~/utils/aws-profile-form'

const props = defineProps<{
  profiles: AwsProfile[]
  // Tên profile đang sửa (hoặc đang gõ cho profile mới) — loại khỏi danh sách
  // chọn source_profile để không tự-tham-chiếu.
  excludeName: string
  // Đang SỬA một profile có sẵn ⇒ `role_arn`/`source_profile` để trống là "giữ
  // nguyên" (S2a), nên hai nhãn bỏ dấu `*` (xem `canSave()`: chúng chỉ bắt buộc
  // ở lượt tạo mới).
  isExisting: boolean
}>()

const model = defineModel<AssumeRoleFormState>({ required: true })

const { t } = useI18n()

const sourceProfileOptions = computed<AppSelectOption[]>(() =>
  props.profiles
    .filter((p) => p.name !== props.excludeName)
    .map((p) => ({ value: p.name, label: p.name })),
)
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
.ape-optional {
  font-weight: 400;
  color: var(--textDim);
}
/* Dấu `*` bắt buộc — cùng vocabulary với `.sse-req` (SshEditor). */
.ape-req {
  color: var(--danger);
  font-weight: 700;
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
  /* mono-ok: role ARN / MFA serial / external id là giá trị copy-paste từ
     IAM console vào ~/.aws/config. */
  font-family: var(--code);
}
.ape-input:focus {
  border-color: var(--accent);
}
.ape-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
</style>
