<template>
  <!-- mono-ok (các ô font-mono dưới đây): role ARN / MFA serial / external id là giá
       trị copy-paste từ IAM console vào ~/.aws/config. -->
  <div class="flex flex-col gap-1.5">
    <Label class="gap-1 text-xs font-semibold text-foreground">
      <!-- Dấu `*` CHỈ ở lượt tạo mới: sửa profile có sẵn thì ô trống là "giữ
           nguyên giá trị trên đĩa" (S2a) nên không bắt buộc. -->
      {{ t('infra.editor.assumeRole.roleArn') }}
      <span v-if="!isExisting" class="font-semibold text-destructive" aria-hidden="true">*</span>
    </Label>
    <Input
      v-model.trim="model.roleArn"
      spellcheck="false"
      :placeholder="t('infra.editor.assumeRole.roleArnPh')"
      class="font-mono"
    />
  </div>

  <div class="flex flex-col gap-1.5">
    <Label class="gap-1 text-xs font-semibold text-foreground">
      {{ t('infra.editor.assumeRole.sourceProfile') }}
      <span v-if="!isExisting" class="font-semibold text-destructive" aria-hidden="true">*</span>
    </Label>
    <AppSelect
      v-model="model.sourceProfile"
      :options="sourceProfileOptions"
      :placeholder="t('infra.editor.assumeRole.sourceProfilePh')"
      width="100%"
    />
  </div>

  <div class="grid grid-cols-2 gap-3.5">
    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        {{ t('infra.editor.assumeRole.mfaSerial') }}
        <span class="font-normal text-dim">{{ t('infra.editor.optional') }}</span>
      </Label>
      <Input
        v-model.trim="model.mfaSerial"
        spellcheck="false"
        :placeholder="t('infra.editor.assumeRole.mfaSerialPh')"
        class="font-mono"
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        {{ t('infra.editor.assumeRole.externalId') }}
        <span class="font-normal text-dim">{{ t('infra.editor.optional') }}</span>
      </Label>
      <Input
        v-model.trim="model.externalId"
        spellcheck="false"
        :placeholder="t('infra.editor.assumeRole.externalIdPh')"
        class="font-mono"
      />
    </div>
  </div>

  <div class="flex flex-col gap-1.5">
    <Label class="gap-1 text-xs font-semibold text-foreground">
      {{ t('infra.editor.assumeRole.duration') }}
      <span class="font-normal text-dim">{{ t('infra.editor.optional') }}</span>
    </Label>
    <Input
      v-model.trim="model.durationSeconds"
      type="number"
      min="900"
      step="1"
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
import Input from '~/components/ui/input/Input.vue'

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
