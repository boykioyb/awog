// Settings section metadata — ports the SETSECS table from awog-prototype.html (~2107).
// Static visual port; section switch is local state, no Pinia/IPC.
// `labelKey` is an i18n key resolved with t() at render (in SettingsNav).
//
// Nav render theo NHÓM (SETTINGS_GROUPS) — label nhóm ở SettingsNav; danh sách
// phẳng SETTINGS_SECTIONS giữ cho các consumer chỉ cần id→meta (vd SettingsPane).

export const SETTINGS_GROUPS = [
  {
    id: 'general',
    labelKey: 'settings.group.general',
    items: [
      { id: 'appearance', labelKey: 'settings.nav.appearance', icon: 'settings' },
      { id: 'notifications', labelKey: 'settings.nav.notifications', icon: 'alert' },
      { id: 'keymap', labelKey: 'settings.nav.keymap', icon: 'commands' },
      { id: 'pet', labelKey: 'settings.nav.pet', icon: 'smile' },
    ],
  },
  {
    id: 'ai',
    labelKey: 'settings.group.ai',
    items: [
      { id: 'models', labelKey: 'settings.nav.models', icon: 'agents' },
      { id: 'defaults', labelKey: 'settings.nav.defaults', icon: 'rules' },
      { id: 'pricing', labelKey: 'settings.nav.pricing', icon: 'act' },
      { id: 'styles', labelKey: 'settingsStyles.nav', icon: 'text' },
      { id: 'memory', labelKey: 'settings.nav.memory', icon: 'brain' },
    ],
  },
  {
    id: 'workspace',
    labelKey: 'settings.group.workspace',
    items: [
      { id: 'workspace', labelKey: 'settings.nav.workspace', icon: 'folder' },
      { id: 'sessions', labelKey: 'settings.nav.sessions', icon: 'sessions' },
      { id: 'git', labelKey: 'settings.nav.git', icon: 'git' },
      { id: 'wiki', labelKey: 'settings.nav.wiki', icon: 'book' },
      { id: 'storage', labelKey: 'settings.nav.storage', icon: 'folder' },
    ],
  },
  {
    id: 'system',
    labelKey: 'settings.group.system',
    items: [
      { id: 'devices', labelKey: 'settings.nav.devices', icon: 'smartphone' },
      { id: 'permissions', labelKey: 'settingsPermissions.nav', icon: 'shield' },
      { id: 'infra', labelKey: 'settingsInfra.nav', icon: 'globe' },
      { id: 'about', labelKey: 'settings.nav.about', icon: 'alert' },
    ],
  },
] as const

// Flat id→meta list, derived from the groups — section ids stay unique across groups.
// flatMap của readonly tuple union cần type đích tường minh (union của mọi item).
export type SettingsSection = (typeof SETTINGS_GROUPS)[number]['items'][number]
export type SettingsSectionId = SettingsSection['id']
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_GROUPS.flatMap(
  (g): readonly SettingsSection[] => g.items,
)
