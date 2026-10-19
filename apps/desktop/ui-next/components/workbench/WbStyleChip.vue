<template>
  <!-- Chip "Phong cách trả lời" của status bar Workbench — bản workbench của
       StatusConfig (status bar toàn app bị ẩn ở /workbench nên chip từng biến mất ở
       đây). Menu là WorkbenchContextMenu dùng chung (mở phía TRÊN, teleport — không
       bị footer `overflow-hidden` cắt): nhóm phong cách có tick + công tắc bỏ markdown. -->
  <WbChip
    :title="t('statusbar.cfg.style')"
    :aria-expanded="isOpen"
    data-wbi="style"
    @click="(e: MouseEvent) => toggle(e.currentTarget as HTMLElement)"
  >
    <Icon name="text" class="size-3" />
    <span class="max-w-30 truncate">{{ styleName }}</span>
  </WbChip>
</template>

<script setup lang="ts">
import type { Session } from '~/composables/useSessionsData'
import type { WbMenuItem } from '~/composables/useWorkbenchMenu'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { menu, openMenu } = useWorkbenchMenu()
const statusCfg = useStatusConfig()
const { activeStyleId, styleName, styleGroups, noMd, selectStyle, toggleNoMd } =
  useSessionModelConfig(() => props.session)

// Điểm neo = phần tử nút THẬT của chip (lấy từ sự kiện / data-wbi) — KHÔNG phải
// `$el` của component: WbChip mở đầu bằng một comment nên ở dev `$el` là nút comment,
// không có `dataset` ⇒ menu workbench đọc `anchor.dataset.wbi` là văng lỗi.
const isOpen = computed(() => menu.value?.anchor?.dataset?.wbi === 'style')

function toggle(anchor: HTMLElement | null): void {
  if (!anchor?.dataset) return
  const items: WbMenuItem[] = []
  for (const g of styleGroups.value) {
    items.push({ header: g.label })
    for (const r of g.rows) {
      items.push({
        id: `style:${r.slug}`,
        label: r.name,
        ...(r.hint ? { hint: r.hint } : {}),
        active: r.slug === activeStyleId.value,
      })
    }
  }
  items.push({ separator: true })
  items.push({ id: 'nomd', label: t('sessions.config.noMarkdown'), active: noMd.value })
  openMenu(
    anchor,
    items,
    (id) => {
      if (id === 'nomd') toggleNoMd()
      else if (id.startsWith('style:')) selectStyle(id.slice('style:'.length))
    },
    { compact: true },
  )
}

// `/style` ở composer mở picker từ xa qua useStatusConfig — ở workbench không có
// StatusConfig nghe nó, nên chip này nhận thay rồi trả cờ về.
watch(
  () => statusCfg.openChip.value,
  (c) => {
    if (c !== 'style') return
    statusCfg.close()
    if (!isOpen.value) toggle(document.querySelector<HTMLElement>('[data-wbi="style"]'))
  },
)
</script>
