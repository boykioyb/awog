<template>
  <!-- Chip văn phong (style) — "đặt một lần". Model + account + effort đã chuyển
       xuống composer footer (proto: picker ngay trên nút gửi — per-turn, per-pane,
       model/account cùng một menu vì account quyết định model khả dụng), nên chip
       này chỉ còn style; nhãn = tên văn phong, tooltip nói rõ là style picker.

       `openChip` vẫn giữ nguyên union bốn giá trị: `/style` ở composer gọi
       `open('style')` từ xa. Đổi union sẽ làm hỏng đường vào đó. -->
  <span class="sb-cfg">
    <span class="sb-wrap">
      <button class="sb-item" :title="cfgTitle" @click.stop="toggle('style')">
        <Icon name="settings" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="sb-cfg-lbl">{{ styleName }}</span>
      </button>

      <div v-if="openChip" class="smenu stylemenu sb-menu sb-cfgmenu" @click.stop>
        <template v-for="grp in styleGroups" :key="grp.key">
          <div class="palg" :class="{ first: grp.key === styleGroups[0]?.key }">
            {{ grp.label }}
          </div>
          <div
            v-for="row in grp.rows"
            :key="row.slug"
            class="mi sty"
            :class="{ cur: row.slug === activeStyleId }"
            @click="pickStyle(row.slug)"
          >
            <Icon :name="row.icon" class="styicon" />
            <div class="stytext">
              <div class="nm2">
                <span class="stynm">{{ row.name }}</span>
                <span
                  v-if="row.overridesBuiltIn"
                  class="tag styover"
                  :title="t('settingsStyles.overrides.hint')"
                >
                  {{ t('settingsStyles.overrides.tag') }}
                </span>
              </div>
              <div v-if="row.hint" class="sd2">{{ row.hint }}</div>
            </div>
            <button
              v-if="row.desc"
              class="styinfo"
              type="button"
              :aria-label="t('sessions.style.infoLabel', { name: row.name })"
              :aria-expanded="infoSlug === row.slug"
              @click.stop="toggleInfo(row.slug)"
            >
              <Icon name="info" class="styinfoicon" />
            </button>
            <Icon v-if="row.slug === activeStyleId" name="check" class="styck" />
          </div>
        </template>
        <label class="nmk" style="padding: 0 10px 8px" @click.stop="toggleNoMd">
          <span class="tog2 sm" :class="{ off: !noMd }" />
          {{ t('sessions.config.noMarkdown') }}
        </label>
      </div>

      <!-- Description popover for the highlighted style row. Rendered as a sibling of
           the menu (which has overflow-y:auto and would CLIP a child card) and
           anchored to the LEFT of the menu so it never runs off the window's right
           edge. Position lives in the scoped <style> (mirrors .sb-menu). -->
      <div
        v-if="openChip && infoSlug"
        class="styinfocard"
        role="dialog"
        aria-labelledby="styinfo-title"
        aria-describedby="styinfo-body"
        @click.stop
      >
        <div id="styinfo-title" class="styinfotitle">{{ infoName }}</div>
        <div id="styinfo-body" class="styinfobody">{{ infoDesc }}</div>
      </div>
    </span>

    <div v-if="openChip" class="sb-backdrop" @click="close" />
  </span>
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
import { computed, ref, watch } from 'vue'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { openChip, toggle, close } = useStatusConfig()

const { activeStyleId, styleName, styleGroups, noMd, selectStyle, toggleNoMd } =
  useSessionModelConfig(() => props.session)

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
// every user style.
const infoSlug = ref<string | null>(null)
const infoRow = computed(() =>
  infoSlug.value
    ? styleGroups.value.flatMap((g) => g.rows).find((r) => r.slug === infoSlug.value)
    : undefined,
)
const infoName = computed(() => infoRow.value?.name ?? '')
const infoDesc = computed(() => infoRow.value?.desc ?? '')
function toggleInfo(slug: string) {
  infoSlug.value = infoSlug.value === slug ? null : slug
}
// Close the card whenever the style menu closes or another chip opens (covers the
// backdrop click, pickStyle, and remote opens — close() is shared so we can't hook it).
watch(openChip, () => {
  infoSlug.value = null
})
// Esc dismisses the open description card.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && infoSlug.value) infoSlug.value = null
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.sb-cfg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sb-wrap {
  position: relative;
  display: inline-flex;
}
.sb-cfg-lbl {
  font-weight: 500;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Popovers open UPWARD, anchored above the chip. Override the global `.smenu`
   fixed/z so they sit over page content (the bar's z-index:82 stacking context). */
.sb-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 95;
  max-height: min(60vh, 420px);
  overflow-y: auto;
}
.sb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 94;
}
/* Style description card: absolute (like .sb-menu), opens UPWARD, sits to the LEFT of
   the 272px-wide style menu (272 + 8px gap) so it clears the window's right edge and
   escapes the menu's overflow-y clip. Trade-off: on a very narrow window it can near
   the left edge, but the style chip lives in the bar's right cluster so there is room. */
.styinfocard {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 280px;
  z-index: 96;
}
.mi {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
}
/* Style rows: a user-written style brings a free-form name + description from its
   file, so the name line truncates and the hint clamps to two lines — the 272px
   menu must not stretch because someone wrote a long title. */
.stylemenu .mi.sty .nm2 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.stynm {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.styover {
  flex: none;
}
.stylemenu .mi.sty .sd2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
</style>
