<template>
  <span class="sb-cfg">
    <!-- Model -->
    <span class="sb-wrap">
      <button
        class="sb-item"
        :title="t('sessions.composer.modelTooltip')"
        @click.stop="toggle('model')"
      >
        <Icon name="settings" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="sb-cfg-lbl">{{ selectedModel }}</span>
      </button>
      <div v-if="openChip === 'model'" class="smenu sb-menu" @click.stop>
        <button v-for="m in availableModels" :key="m" class="mi" @click="pick('model', m)">
          <span class="sb-mi-name">{{ m }}</span>
          <Icon
            v-if="m === selectedModel"
            name="check"
            class="ck"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
      </div>
    </span>

    <!-- Account -->
    <span class="sb-wrap">
      <button
        class="sb-item"
        :title="t('sessions.composer.accountTooltip')"
        @click.stop="toggle('account')"
      >
        <Icon name="agents" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="sb-cfg-lbl">{{ accountShort }}</span>
      </button>
      <div v-if="openChip === 'account'" class="smenu sb-menu" @click.stop>
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
      </div>
    </span>

    <!-- Reasoning effort (hidden for models without reasoning support) -->
    <span v-if="thinkSupported" class="sb-wrap">
      <button class="sb-item" :title="t('statusbar.effort.title')" @click.stop="toggle('effort')">
        <Icon name="zap" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="sb-cfg-lbl">{{ thinkingLabel }}</span>
      </button>
      <div v-if="openChip === 'effort'" class="smenu sb-menu" @click.stop>
        <button v-for="[v, l] in THINK" :key="v" class="mi" @click="pickThink(v)">
          <span class="sb-mi-name">{{ l }}</span>
          <Icon
            v-if="v === thinking"
            name="check"
            class="ck"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
      </div>
    </span>

    <!-- Style + no-markdown -->
    <span class="sb-wrap">
      <button
        class="sb-item"
        :title="t('sessions.composer.styleTooltip')"
        @click.stop="toggle('style')"
      >
        <Icon name="skills" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="sb-cfg-lbl">{{ styleName }}</span>
      </button>
      <div v-if="openChip === 'style'" class="smenu stylemenu sb-menu" @click.stop>
        <template v-for="(grp, gi) in RESPONSE_STYLES" :key="grp.key">
          <div class="palg" :class="{ first: gi === 0 }">
            {{ t(`sessions.style.group.${grp.key}`) }}
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
              <div class="nm2">{{ t(`sessions.style.${row.slug}.name`) }}</div>
              <div class="sd2">{{ t(`sessions.style.${row.slug}.hint`) }}</div>
            </div>
            <button
              class="styinfo"
              type="button"
              :aria-label="
                t('sessions.style.infoLabel', { name: t(`sessions.style.${row.slug}.name`) })
              "
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
           the style menu (which has overflow-y:auto and would CLIP a child card) and
           anchored to the LEFT of the menu so it never runs off the window's right
           edge. Position lives in the scoped <style> (mirrors .sb-menu). -->
      <div
        v-if="openChip === 'style' && infoSlug"
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
  THINK,
  selectThink,
  activeStyleId,
  styleName,
  RESPONSE_STYLES,
  noMd,
  selectStyle,
  toggleNoMd,
} = useSessionModelConfig(() => props.session)

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
function pickStyle(slug: string) {
  infoSlug.value = null
  selectStyle(slug)
  close()
}

// ── Style description popover ──
// Which style row's info card is open (one at a time), or null.
const infoSlug = ref<string | null>(null)
const infoName = computed(() => (infoSlug.value ? t(`sessions.style.${infoSlug.value}.name`) : ''))
const infoDesc = computed(() => (infoSlug.value ? t(`sessions.style.${infoSlug.value}.desc`) : ''))
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
.sb-mi-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
