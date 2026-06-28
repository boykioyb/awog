<template>
  <span class="sb-cfg">
    <!-- Model -->
    <span class="sb-wrap">
      <button
        class="sb-item"
        :title="t('sessions.composer.modelTooltip')"
        @click.stop="toggle('model')"
      >
        <Icon name="settings" style="width: 12px; height: 12px" />
        <span class="sb-cfg-lbl">{{ selectedModel }}</span>
      </button>
      <div v-if="openChip === 'model'" class="smenu sb-menu" @click.stop>
        <button v-for="m in availableModels" :key="m" class="mi" @click="pick('model', m)">
          <span class="sb-mi-name">{{ m }}</span>
          <Icon
            v-if="m === selectedModel"
            name="check"
            class="ck"
            style="width: 13px; height: 13px"
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
        <Icon name="agents" style="width: 12px; height: 12px" />
        <span class="sb-cfg-lbl">{{ accountShort }}</span>
      </button>
      <div v-if="openChip === 'account'" class="smenu sb-menu" @click.stop>
        <button v-for="a in accounts" :key="a.id" class="mi" @click="pickAccount(a)">
          <span class="sb-mi-name">{{ a.display }}</span>
          <Icon
            v-if="a.id === selectedAccountId"
            name="check"
            class="ck"
            style="width: 13px; height: 13px"
          />
        </button>
      </div>
    </span>

    <!-- Reasoning effort (hidden for models without reasoning support) -->
    <span v-if="thinkSupported" class="sb-wrap">
      <button class="sb-item" :title="t('statusbar.effort.title')" @click.stop="toggle('effort')">
        <Icon name="zap" style="width: 12px; height: 12px" />
        <span class="sb-cfg-lbl">{{ thinkingLabel }}</span>
      </button>
      <div v-if="openChip === 'effort'" class="smenu sb-menu" @click.stop>
        <button v-for="[v, l] in THINK" :key="v" class="mi" @click="pickThink(v)">
          <span class="sb-mi-name">{{ l }}</span>
          <Icon v-if="v === thinking" name="check" class="ck" style="width: 13px; height: 13px" />
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
        <Icon name="skills" style="width: 12px; height: 12px" />
        <span class="sb-cfg-lbl">{{ styleName }}</span>
      </button>
      <div v-if="openChip === 'style'" class="smenu stylemenu sb-menu" @click.stop>
        <template v-for="(grp, gi) in RESPONSE_STYLES" :key="grp.key">
          <div class="palg" :class="{ first: gi === 0 }">
            {{ t(`sessions.style.group.${grp.key}`) }}
          </div>
          <div
            v-for="row in grp.rows"
            :key="row.id"
            class="mi sty"
            :class="{ cur: row.id === activeStyleId }"
            @click="pickStyle(row.id)"
          >
            <Icon :name="row.icon" class="styicon" />
            <div class="stytext">
              <div class="nm2">{{ t(`sessions.style.${row.slug}.name`) }}</div>
              <div class="sd2">{{ t(`sessions.style.${row.slug}.hint`) }}</div>
            </div>
            <Icon v-if="row.id === activeStyleId" name="check" class="styck" />
          </div>
        </template>
        <label class="nmk" style="padding: 0 11px 9px" @click.stop="toggleNoMd">
          <span class="tog2 sm" :class="{ off: !noMd }" />
          {{ t('sessions.config.noMarkdown') }}
        </label>
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
function pickStyle(id: string) {
  selectStyle(id)
  close()
}
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
