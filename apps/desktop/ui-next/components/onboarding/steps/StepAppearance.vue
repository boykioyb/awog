<template>
  <div class="obap">
    <p class="ob-lead">{{ t('onboarding.appearance.desc') }}</p>

    <div class="obap-field">
      <span class="obap-label">{{ t('onboarding.appearance.theme') }}</span>
      <div class="seg">
        <span :class="{ on: isDark }" @click="ensureDark(true)">
          {{ t('onboarding.appearance.themeDark') }}
        </span>
        <span :class="{ on: !isDark }" @click="ensureDark(false)">
          {{ t('onboarding.appearance.themeLight') }}
        </span>
      </div>
    </div>

    <div class="obap-field">
      <span class="obap-label">{{ t('onboarding.appearance.accent') }}</span>
      <div class="swatches">
        <span
          v-for="h in accents"
          :key="h"
          class="sw"
          :class="{ on: h === accent }"
          :style="{ background: h }"
          @click="setAccent(h)"
        />
      </div>
    </div>

    <div class="obap-field">
      <span class="obap-label">{{ t('onboarding.appearance.language') }}</span>
      <div class="seg">
        <span :class="{ on: locale === 'vi' }" @click="setLocale('vi')">Tiếng Việt</span>
        <span :class="{ on: locale === 'en' }" @click="setLocale('en')">English</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Appearance step — reuses the live theme/locale composables so choices apply
// instantly and persist exactly like the Settings → Appearance panel. Accent
// presets mirror that panel's palette.
const { t, locale, setLocale } = useI18n()
const { accent, setAccent, isDark, toggleTheme } = useTheme()

const accents = ['#10b981', '#60a5fa', '#a78bfa', '#f59e0b', '#f43f5e', '#22d3ee', '#fafafa']

const ensureDark = (dark: boolean) => {
  if (dark !== isDark.value) toggleTheme()
}
</script>

<style scoped>
.obap {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ob-lead {
  color: var(--textMuted);
  line-height: 1.5;
}
.obap-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.obap-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
</style>
