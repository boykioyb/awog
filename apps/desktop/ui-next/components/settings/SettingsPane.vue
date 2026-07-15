<template>
  <div class="setpane">
    <SettingsAppearance v-if="active === 'appearance'" />
    <SettingsDefaults v-else-if="active === 'defaults'" />
    <SettingsModels v-else-if="active === 'models'" />
    <SettingsPricing v-else-if="active === 'pricing'" />
    <SettingsWorkspace v-else-if="active === 'workspace'" />
    <SettingsGit v-else-if="active === 'git'" />
    <SettingsSessions v-else-if="active === 'sessions'" />
    <SettingsKeymap v-else-if="active === 'keymap'" />
    <SettingsAbout v-else />
  </div>
</template>

<script setup lang="ts">
// Settings pane — renders the panel for the active section (ports the .setpane innerHTML
// dispatch from setSecHtml(SET.sec)).
import type { SettingsSectionId } from './sections'

defineProps<{
  active: SettingsSectionId
}>()
</script>
