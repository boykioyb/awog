<template>
  <!-- mono-ok (các ô font-mono dưới đây): sso-session name / start URL / account id
       là giá trị copy-paste từ portal SSO hoặc vào ~/.aws/config. -->
  <div class="flex flex-col gap-1.5">
    <Label class="text-xs font-semibold text-foreground">{{ t('infra.editor.sso.source') }}</Label>
    <!-- Bấm lại mục đang bật thì ToggleGroup emit rỗng — segmented luôn giữ một giá trị. -->
    <ToggleGroup
      type="single"
      :spacing="1"
      class="self-start rounded-lg bg-muted p-0.5"
      :model-value="model.source"
      @update:model-value="
        (v) => {
          if (v === 'session' || v === 'manual') model.source = v
        }
      "
    >
      <ToggleGroupItem
        value="session"
        class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
      >
        {{ t('infra.editor.sso.sourceSession') }}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="manual"
        class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
      >
        {{ t('infra.editor.sso.sourceManual') }}
      </ToggleGroupItem>
    </ToggleGroup>
  </div>

  <div v-if="model.source === 'session'" class="flex flex-col gap-1.5">
    <Label class="gap-1 text-xs font-semibold text-foreground">
      <!-- Dấu `*` CHỈ ở lượt tạo mới: sửa profile có sẵn thì ô trống là "giữ
           nguyên giá trị trên đĩa" (S2a) nên không bắt buộc. -->
      {{ t('infra.editor.sso.ssoSession') }}
      <span v-if="!isExisting" class="font-semibold text-destructive" aria-hidden="true">*</span>
    </Label>
    <Input
      v-model.trim="model.ssoSession"
      spellcheck="false"
      :placeholder="t('infra.editor.sso.ssoSessionPh')"
      class="font-mono"
    />
    <div class="text-xs text-dim">{{ t('infra.editor.sso.ssoSessionHint') }}</div>
  </div>

  <template v-else>
    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        {{ t('infra.editor.sso.startUrl') }}
        <span v-if="!isExisting" class="font-semibold text-destructive" aria-hidden="true">*</span>
      </Label>
      <Input
        v-model.trim="model.ssoStartUrl"
        spellcheck="false"
        :placeholder="t('infra.editor.sso.startUrlPh')"
        class="font-mono"
      />
    </div>
    <AwsRegionField
      v-model="model.ssoRegion"
      :label="t('infra.editor.sso.ssoRegion')"
      :hint="ssoRegionHint"
      :required="!isExisting"
    />
  </template>

  <div class="grid grid-cols-2 gap-3.5">
    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        {{ t('infra.editor.sso.accountId') }}
        <span v-if="!isExisting" class="font-semibold text-destructive" aria-hidden="true">*</span>
      </Label>
      <Input
        v-model.trim="model.ssoAccountId"
        spellcheck="false"
        :placeholder="t('infra.editor.sso.accountIdPh')"
        class="font-mono"
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        {{ t('infra.editor.sso.roleName') }}
        <span v-if="!isExisting" class="font-semibold text-destructive" aria-hidden="true">*</span>
      </Label>
      <Input
        v-model.trim="model.ssoRoleName"
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
import Input from '~/components/ui/input/Input.vue'

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
