<template>
  <!-- Chip văn phong (style) — "đặt một lần". Model + account + effort đã chuyển
       xuống composer footer (proto: picker ngay trên nút gửi — per-turn, per-pane,
       model/account cùng một menu vì account quyết định model khả dụng), nên chip
       này chỉ còn style; nhãn = tên văn phong, tooltip nói rõ là style picker.

       `openChip` vẫn giữ nguyên union bốn giá trị: `/style` ở composer gọi
       `open('style')` từ xa. Đổi union sẽ làm hỏng đường vào đó.
       Popover portal ra <body> và tự né mép cửa sổ (mở LÊN vì thanh ở đáy). -->
  <Popover :open="!!openChip" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <StatusChip :title="cfgTitle">
        <Icon name="settings" />
        <span class="max-w-32 truncate font-medium">{{ styleName }}</span>
      </StatusChip>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align="end"
      :side-offset="8"
      class="max-h-[min(60vh,420px)] w-68 overflow-y-auto p-1"
    >
      <template v-for="grp in styleGroups" :key="grp.key">
        <div class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          {{ grp.label }}
        </div>
        <!-- Cả hàng là vùng bấm chọn style; nút ⓘ lồng bên trong nên hàng không thể
             là nút (nút lồng nút là HTML sai). Tên style người dùng tự viết có thể
             dài: tên tự cắt, mô tả kẹp 2 dòng để menu không bị kéo giãn. -->
        <div
          v-for="row in grp.rows"
          :key="row.slug"
          class="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
          @click="pickStyle(row.slug)"
        >
          <Icon :name="row.icon" class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1.5">
              <span class="min-w-0 truncate text-base text-foreground">{{ row.name }}</span>
              <Badge
                v-if="row.overridesBuiltIn"
                variant="outline"
                class="shrink-0"
                :title="t('settingsStyles.overrides.hint')"
              >
                {{ t('settingsStyles.overrides.tag') }}
              </Badge>
            </div>
            <div v-if="row.hint" class="line-clamp-2 text-sm text-muted-foreground">
              {{ row.hint }}
            </div>
          </div>
          <!-- Thẻ mô tả của style: Popover lồng, mở sang TRÁI menu để không tràn mép
               phải cửa sổ (chip style nằm ở cụm phải của thanh). -->
          <Popover
            v-if="row.desc"
            :open="infoSlug === row.slug"
            @update:open="(v: boolean) => (infoSlug = v ? row.slug : null)"
          >
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                size="iconSm"
                class="size-5 shrink-0 text-muted-foreground"
                :aria-label="t('sessions.style.infoLabel', { name: row.name })"
                @click.stop
              >
                <Icon name="info" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="left" align="start" :side-offset="12" class="w-64 p-3">
              <div class="text-sm font-semibold text-foreground">{{ row.name }}</div>
              <div class="mt-1 text-sm whitespace-pre-line text-muted-foreground">
                {{ row.desc }}
              </div>
            </PopoverContent>
          </Popover>
          <Icon
            v-if="row.slug === activeStyleId"
            name="check"
            class="mt-0.5 size-3.5 shrink-0 text-primary"
          />
        </div>
      </template>
      <Separator class="my-1" />
      <div class="flex items-center gap-2 px-2 py-1.5">
        <Switch :id="noMdId" :checked="noMd" @update:checked="toggleNoMd" />
        <Label :for="noMdId" class="font-normal">
          {{ t('sessions.config.noMarkdown') }}
        </Label>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
// Style picker (moved out of the composer to avoid duplication). Model + account +
// effort live in the composer footer now (proto parity — per-turn pickers beside
// Send; model/account share one menu since the account decides which models are
// usable), so this chip no longer repeats them; `/style` still remote-opens it.
// All math + store writes live in useSessionModelConfig; which popover is open is
// module-level (useStatusConfig) so only one shows at a time. Popovers open upward
// (the bar is pinned to the window bottom).
import type { Session } from '~/composables/useSessionsData'
import { computed, ref, useId, watch } from 'vue'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { openChip, toggle, close } = useStatusConfig()

// Popover điều khiển bởi `openChip` (module-level) để `/style` mở được từ xa.
function onOpenChange(open: boolean) {
  if (open) toggle('style')
  else close()
}

const { activeStyleId, styleName, styleGroups, noMd, selectStyle, toggleNoMd } =
  useSessionModelConfig(() => props.session)

// Status bar và dock SSH cùng lắp chip này — id của công tắc phải riêng từng bản.
const noMdId = useId()

// Nhãn chip là tên văn phong; tooltip nói rõ đây là style picker.
const cfgTitle = computed(() => t('statusbar.cfg.style'))
function pickStyle(slug: string) {
  infoSlug.value = null
  selectStyle(slug)
  close()
}

// ── Style description popover ──
// Which style row's info card is open (one at a time), or null. Text comes off the
// row itself (i18n for built-ins, the file's frontmatter/directive for a style the
// user wrote) — never from an i18n key built out of the id, which would miss for
// every user style. Esc / bấm ra ngoài do Popover lồng tự lo.
const infoSlug = ref<string | null>(null)
// Close the card whenever the style menu closes or another chip opens (covers
// pickStyle and remote opens — close() is shared so we can't hook it).
watch(openChip, () => {
  infoSlug.value = null
})
</script>
