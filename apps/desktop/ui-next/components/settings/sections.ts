// Settings section metadata — ports the SETSECS table from awog-prototype.html (~2107).
// Static visual port; section switch is local state, no Pinia/IPC.
// `labelKey` is an i18n key resolved with t() at render (in SettingsNav).

export const SETTINGS_SECTIONS = [
  { id: 'appearance', labelKey: 'settings.nav.appearance', icon: 'settings' },
  { id: 'pet', labelKey: 'settings.nav.pet', icon: 'smile' },
  { id: 'defaults', labelKey: 'settings.nav.defaults', icon: 'rules' },
  { id: 'models', labelKey: 'settings.nav.models', icon: 'agents' },
  { id: 'pricing', labelKey: 'settings.nav.pricing', icon: 'act' },
  { id: 'workspace', labelKey: 'settings.nav.workspace', icon: 'folder' },
  { id: 'git', labelKey: 'settings.nav.git', icon: 'git' },
  { id: 'devices', labelKey: 'settings.nav.devices', icon: 'smartphone' },
  { id: 'notifications', labelKey: 'settings.nav.notifications', icon: 'alert' },
  { id: 'sessions', labelKey: 'settings.nav.sessions', icon: 'sessions' },
  { id: 'keymap', labelKey: 'settings.nav.keymap', icon: 'commands' },
  { id: 'about', labelKey: 'settings.nav.about', icon: 'alert' },
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
export type SettingsSectionId = SettingsSection['id']
