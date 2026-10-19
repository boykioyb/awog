<template>
  <!-- mono-ok (các ô font-mono dưới đây): đường dẫn file/CSV + khối dán từ SSO portal —
       copy được thẳng vào terminal/editor. -->
  <div class="flex flex-col gap-3.5">
    <p class="m-0 text-sm text-dim">{{ t('infra.import.file.subtitle') }}</p>

    <!-- Bấm lại mục đang bật thì ToggleGroup emit rỗng — segmented luôn giữ một giá trị. -->
    <ToggleGroup
      type="single"
      :spacing="1"
      class="self-start rounded-lg bg-muted p-0.5"
      :model-value="sourceKind"
      @update:model-value="
        (v) => {
          if (v === 'paste' || v === 'file' || v === 'csv') sourceKind = v
        }
      "
    >
      <ToggleGroupItem
        value="paste"
        class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
      >
        {{ t('infra.import.file.source.paste') }}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="file"
        class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
      >
        {{ t('infra.import.file.source.file') }}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="csv"
        class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
      >
        {{ t('infra.import.file.source.csv') }}
      </ToggleGroupItem>
    </ToggleGroup>

    <div v-if="sourceKind === 'paste'" class="flex flex-col gap-1.5">
      <Label class="text-xs font-semibold text-foreground">
        {{ t('infra.import.file.paste.label') }}
      </Label>
      <!-- Textarea, KHÔNG type=password — người dùng cần sửa được khối đã dán.
           Cảnh báo rõ + cha xoá sạch khỏi state ngay khi apply xong. -->
      <Textarea
        v-model="pasteText"
        class="min-h-32 resize-y font-mono text-sm"
        rows="7"
        spellcheck="false"
        autocomplete="off"
        :placeholder="t('infra.import.file.paste.placeholder')"
      />
      <div
        class="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
      >
        <Icon name="alert" class="mt-0.5 size-3 flex-none" />
        {{ t('infra.import.file.paste.warning') }}
      </div>
    </div>

    <div v-else-if="sourceKind === 'file'" class="flex flex-col gap-1.5">
      <Label class="text-xs font-semibold text-foreground">
        {{ t('infra.import.file.file.label') }}
      </Label>
      <div class="flex items-center gap-2">
        <Input
          v-model="filePath"
          :placeholder="t('infra.import.file.file.pathPlaceholder')"
          spellcheck="false"
          class="min-w-0 flex-1 font-mono"
        />
        <Button v-if="canBrowse" type="button" variant="outline" size="sm" @click="browseFile">
          <Icon name="folder" class="size-3" />
          {{ t('infra.import.file.file.browse') }}
        </Button>
      </div>
      <div class="text-xs text-dim">{{ t('infra.import.file.file.hint') }}</div>
    </div>

    <div v-else class="flex flex-col gap-1.5">
      <Label class="text-xs font-semibold text-foreground">
        {{ t('infra.import.file.csv.label') }}
      </Label>
      <div class="flex items-center gap-2">
        <Input
          v-model="csvPath"
          :placeholder="t('infra.import.file.csv.pathPlaceholder')"
          spellcheck="false"
          class="min-w-0 flex-1 font-mono"
        />
        <Button v-if="canBrowse" type="button" variant="outline" size="sm" @click="browseCsv">
          <Icon name="folder" class="size-3" />
          {{ t('infra.import.file.csv.browse') }}
        </Button>
      </div>
      <div class="text-xs text-dim">{{ t('infra.import.file.csv.hint') }}</div>
      <!-- Người chưa từng tạo access key đọc hint trên không biết đi đâu tiếp.
           Khối này là chỗ duy nhất trong app nói cách LẤY credential
           (docs/features/aws-profile-manager.md §"Lấy credential ở đâu"). -->
      <AwsProfileCredentialHelp context="csv" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Bước 1 (chọn nguồn) của AwsProfileImport.vue, tách riêng để giữ file cha dưới
// ngưỡng ~250 dòng (docs/coding/nuxt-frontend.md). Sở hữu TOÀN BỘ state của bước
// này qua defineModel — cha chỉ giữ ref, không cần biết chi tiết UI bên trong.
import { hasBridge, pickFile } from '~/composables/useFolderPicker'
import type { AwsProfileImportSource } from '~/composables/useAwsProfilesApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const sourceKind = defineModel<AwsProfileImportSource>('sourceKind', { required: true })
const pasteText = defineModel<string>('pasteText', { required: true })
const filePath = defineModel<string>('filePath', { required: true })
const csvPath = defineModel<string>('csvPath', { required: true })

const { t } = useI18n()

// Native file picker chỉ có trong Electron shell; browser-dev rơi về nhập tay.
const canBrowse = hasBridge()

async function browseFile(): Promise<void> {
  const p = await pickFile({
    title: t('infra.import.file.file.browse'),
    filters: [{ name: 'AWS config/credentials', extensions: ['*'] }],
  })
  if (p) filePath.value = p
}
async function browseCsv(): Promise<void> {
  const p = await pickFile({
    title: t('infra.import.file.csv.browse'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (p) csvPath.value = p
}
</script>
