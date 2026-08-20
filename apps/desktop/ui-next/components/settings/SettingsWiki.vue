<template>
  <div>
    <SettingsPaneHeader :title="t('settings.wiki.heading')" />

    <SettingsField :name="t('settings.wiki.enabled.name')" :desc="t('settings.wiki.enabled.desc')">
      <SettingsTog v-model="wikiEnabled" />
    </SettingsField>

    <SettingsField :name="t('settings.wiki.budget.name')" :desc="t('settings.wiki.budget.desc')">
      <SettingsNumber v-model="wikiBudget" :min="500" :max="40000" :step="500" />
    </SettingsField>

    <SettingsField
      :name="t('settings.wiki.autoWrite.name')"
      :desc="t('settings.wiki.autoWrite.desc')"
    >
      <SettingsTog v-model="wikiAutoWrite" />
    </SettingsField>

    <SettingsField :name="t('settings.wiki.cost.name')" :desc="t('settings.wiki.cost.desc')">
      <span class="chip">
        {{ t('settings.wiki.cost.value', { pages: wiki.contextPageCount, chars: chars }) }}
      </span>
    </SettingsField>

    <SettingsField :name="t('settings.wiki.open.name')" :desc="t('settings.wiki.open.desc')">
      <button class="btn sm" @click="goWiki">
        <Icon name="book" :size="13" />
        {{ t('settings.wiki.open.action') }}
      </button>
    </SettingsField>
  </div>
</template>

<script setup lang="ts">
// Settings → Wiki: the two switches that decide what the wiki costs each turn
// (ADR 0073 D-12). Page-level control (which pages the agent may read at all)
// lives on the page itself — `context: false` in its frontmatter — because that is
// a property of the page, not a global preference.
import { computed, onMounted } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import { useWikiStore } from '~/stores/wiki'
import { useSettingsModal } from '~/composables/useSettingsModal'

const { t } = useI18n()
const settings = useSettingsStore()
const wiki = useWikiStore()
const { closeSettings } = useSettingsModal()

const wikiEnabled = computed({
  get: () => settings.context.wikiEnabled,
  set: (v: boolean) => settings.updateContext({ wikiEnabled: v }),
})
const wikiBudget = computed({
  get: () => settings.context.wikiBudgetChars,
  set: (v: number) => settings.updateContext({ wikiBudgetChars: v }),
})

const wikiAutoWrite = computed({
  get: () => settings.context.wikiAutoWrite,
  set: (v: boolean) => settings.updateContext({ wikiAutoWrite: v }),
})

const chars = computed(() =>
  wiki.indexChars >= 1000 ? `${(wiki.indexChars / 1000).toFixed(1)}k` : String(wiki.indexChars),
)

function goWiki(): void {
  closeSettings()
  void navigateTo('/wiki')
}

onMounted(() => {
  if (!wiki.loaded) void wiki.loadTree()
})
</script>
