<template>
  <!-- MỘT chip cấu hình thay cho bốn (session-ui-refactor §3.4). Nhãn là tên model —
       thứ duy nhất trong bốn cái người ta liếc nhìn thường xuyên; account hiện đã có
       donut hạn mức ở đầu kia thanh lo, còn effort/style là cấu hình đặt rồi để đó.
       Popover gộp cả bốn mục, ngăn nhau bằng `.palg` (đường kẻ + nhãn nhóm).

       `openChip` vẫn giữ nguyên union bốn giá trị: `/style` ở composer gọi
       `open('style')` từ xa, nên menu mở cho BẤT KỲ giá trị nào và giá trị đó chỉ
       quyết định cuộn tới mục nào. Đổi union sẽ làm hỏng đường vào đó. -->
  <span class="sb-cfg">
    <span class="sb-wrap">
      <button class="sb-item" :title="cfgTitle" @click.stop="toggle('model')">
        <Icon name="settings" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <!-- Model VÀ văn phong cùng nằm trên nhãn: gộp bốn chip thành một là đúng,
             nhưng gộp xong mà giá trị biến khỏi thanh thì người dùng mất chỗ liếc.
             Account + mức suy luận ở lại trong popover — chúng ít đổi hơn. -->
        <span class="sb-cfg-lbl">{{ selectedModel }}</span>
        <span class="sb-cfg-sub">· {{ styleName }}</span>
      </button>

      <div v-if="openChip" class="smenu stylemenu sb-menu sb-cfgmenu" @click.stop>
        <!-- Bốn mục là bốn SEGMENT, không xếp chồng: chồng trong một khung cuộn
             60vh thì mục cuối ("Văn phong") nằm dưới ba danh sách và coi như mất.
             Segment giữ mọi mục cách chip đúng MỘT cú bấm. Accent-tint cho mục đang
             chọn, không fill xám — theo quy ước control của app. -->
        <div class="cfgseg">
          <button
            v-for="sec in sections"
            :key="sec.id"
            class="cfgseg-b"
            :class="{ on: section === sec.id }"
            @click.stop="section = sec.id"
          >
            {{ t(sec.label) }}
          </button>
        </div>
        <template v-if="section === 'model'">
          <button v-for="m in availableModels" :key="m" class="mi" @click="pick('model', m)">
            <span class="sb-mi-name">{{ m }}</span>
            <Icon
              v-if="m === selectedModel"
              name="check"
              class="ck"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </button>
        </template>

        <template v-if="section === 'account'">
          <!-- Fresh install: an empty menu reads as broken, so name the missing step. -->
          <span v-if="!accounts.length" class="mi sb-mi-empty">
            {{ t('sessions.config.noAccountHint') }}
          </span>
          <button v-for="a in accounts" :key="a.id" class="mi" @click="pickAccount(a)">
            <span class="sb-mi-name">{{ a.display }}</span>
            <Icon
              v-if="a.id === selectedAccountId"
              name="check"
              class="ck"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </button>
        </template>

        <!-- Ẩn với model không hỗ trợ suy luận (segment cũng ẩn theo, xem SECTIONS). -->
        <template v-if="section === 'effort' && thinkSupported">
          <button v-for="[v, l] in THINK" :key="v" class="mi" @click="pickThink(v)">
            <span class="sb-mi-name">{{ l }}</span>
            <Icon
              v-if="v === thinking && !ultracodeOn"
              name="check"
              class="ck"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </button>
          <!-- Bậc thứ sáu, chỉ nhánh Claude SDK (ADR 0089). Cùng danh sách chứ không
               phải một công tắc riêng: trong Claude Code nó LÀ một giá trị của
               `/effort`, nên để nó thành checkbox thì sẽ có trạng thái "Thấp +
               Ultracode" không ai giải thích được. Lời giải thích nằm ở `title` —
               hàng `.mi` chỉ cao một dòng. -->
          <button
            v-if="ultracodeSupported"
            class="mi"
            :title="t('common.thinking.ultracodeHint')"
            @click="pickUltracode"
          >
            <span class="sb-mi-name">{{ t('common.thinking.ultracode') }}</span>
            <Icon
              v-if="ultracodeOn"
              name="check"
              class="ck"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </button>
        </template>

        <template v-if="section === 'style'">
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
        </template>
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
// Model / Account / Reasoning-effort / Style as separate status-bar chips (moved out
// of the composer to avoid duplication). All math + store writes live in
// useSessionModelConfig; which popover is open is module-level (useStatusConfig) so
// only one shows at a time AND the composer's `/style` builtin can still pop the
// style picker. Popovers open upward (the bar is pinned to the window bottom).
import type { Session, ThinkingLevel } from '~/composables/useSessionsData'
import type { AccountOption } from '~/composables/useAccounts'
import { computed, ref, watch } from 'vue'
import type { ConfigChip } from '~/composables/useStatusConfig'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { openChip, toggle, close } = useStatusConfig()

const {
  accounts,
  selectedModel,
  availableModels,
  selectModel,
  selectedAccountId,
  accountShort,
  selectAccount,
  thinking,
  thinkingLabel,
  thinkSupported,
  ultracodeSupported,
  ultracodeOn,
  selectUltracode,
  THINK,
  selectThink,
  activeStyleId,
  styleName,
  styleGroups,
  noMd,
  selectStyle,
  toggleNoMd,
} = useSessionModelConfig(() => props.session)

// Tooltip mang cả bốn giá trị, vì nhãn chip giờ chỉ hiện model.
const cfgTitle = computed(() =>
  [
    selectedModel.value,
    accountShort.value,
    thinkSupported.value ? thinkingLabel.value : '',
    styleName.value,
  ]
    .filter(Boolean)
    .join(' · '),
)

// Segment đang mở. `openChip` vẫn giữ union bốn giá trị vì `/style` ở composer gọi
// `open('style')` từ xa — giá trị đó giờ chọn thẳng segment, không còn phải cuộn.
const SECTIONS = [
  { id: 'model', label: 'statusbar.cfg.model' },
  { id: 'account', label: 'statusbar.cfg.account' },
  { id: 'effort', label: 'statusbar.effort.title' },
  { id: 'style', label: 'statusbar.cfg.style' },
] as const
// Model không hỗ trợ suy luận thì segment đó biến mất luôn — một segment mở ra
// danh sách rỗng còn tệ hơn là không có segment.
const sections = computed(() =>
  SECTIONS.filter((sec) => sec.id !== 'effort' || thinkSupported.value),
)
const section = ref<ConfigChip>('model')
watch(openChip, (c) => {
  if (c) section.value = c
})
// Đổi sang model không suy luận trong lúc đang mở đúng segment đó → rơi về Model,
// nếu không popover hiện một khoảng trắng không giải thích.
watch(thinkSupported, (ok) => {
  if (!ok && section.value === 'effort') section.value = 'model'
})

function pick(_kind: 'model', m: string) {
  selectModel(m)
  close()
}
function pickAccount(a: AccountOption) {
  selectAccount(a)
  close()
}
function pickThink(v: ThinkingLevel) {
  selectThink(v)
  close()
}
function pickUltracode() {
  selectUltracode()
  close()
}
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
/* Non-interactive hint row (no account connected yet). */
.sb-mi-empty {
  color: var(--textDim);
  cursor: default;
  white-space: normal;
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
.sb-mi-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Giá trị thứ hai trên nhãn chip (văn phong) — mờ hơn tên model, và nhường chỗ
   trước khi model bị cắt khi thanh chật. */
.sb-cfg-sub {
  color: var(--textFaint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Segment chuyển mục trong popover cấu hình. Accent-tint cho mục đang chọn, KHÔNG
   fill xám đặc — control active của app dùng transparent + border + tint. */
.cfgseg {
  display: flex;
  gap: 3px;
  padding: 4px 4px 7px;
  box-shadow: inset 0 -1px 0 var(--border);
  margin-bottom: 5px;
}
.cfgseg-b {
  flex: 1 1 0;
  min-width: 0;
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.cfgseg-b:hover {
  color: var(--text);
  background: var(--bgHover);
}
.cfgseg-b.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
</style>
