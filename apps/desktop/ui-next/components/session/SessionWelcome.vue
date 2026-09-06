<template>
  <div class="swelcome">
    <div class="swhero">
      <!-- Cute theme swaps the decorative icon tile for the mascot. Only the MASCOT is
           a markup fork: the title/subtitle keep their own classes so the hero type
           scale lives in one place, and theme-cute.css restyles them from there. -->
      <AwogMascot v-if="isCute" :size="64" state="idle" bob style="color: var(--accent)" />
      <div v-else class="swicon">
        <Icon name="sessions" style="width: var(--icon-xl); height: var(--icon-xl)" />
      </div>
      <div class="swh">{{ t('sessions.welcome.title') }}</div>
      <div class="swsub">{{ t('sessions.welcome.subtitle') }}</div>
      <div class="swctx">
        <span class="swctxchip">
          <Icon name="folder" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ projectLabel }}
        </span>
        <span class="swctxchip">
          <Icon name="settings" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ model }}
        </span>
      </div>
    </div>

    <!-- Starter suggestions: clicking seeds the composer draft (user reviews + sends). -->
    <div class="swsug">
      <button
        v-for="s in suggestions"
        :key="s.key"
        type="button"
        class="swcard"
        @click="useSuggestion(s.prompt)"
      >
        <span class="swcardic">
          <Icon :name="s.icon" style="width: var(--icon-md); height: var(--icon-md)" />
        </span>
        <span class="swcardtx">
          <span class="swcardl">{{ s.label }}</span>
          <span class="swcardd">{{ s.desc }}</span>
        </span>
      </button>
    </div>

    <div class="swhints">
      <span class="swhint">
        <kbd>⏎</kbd>
        {{ t('sessions.welcome.hintSend') }}
      </span>
      <span class="swhint">
        <kbd>⇧⏎</kbd>
        {{ t('sessions.welcome.hintNewline') }}
      </span>
      <span class="swhint">
        <kbd>/</kbd>
        {{ t('sessions.welcome.hintSlash') }}
      </span>
      <span class="swhint">
        <kbd>@</kbd>
        {{ t('sessions.welcome.hintMention') }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// New-session welcome / empty state. A content-first hero (icon + title + the
// session's project · model context), a few clickable starter prompts that seed
// the composer, and the composer key hints. Replaces the bare "Start the
// conversation…" text. Seeds via store.seedComposer (the composer watches it).
const { t } = useI18n()
const store = useSessionsStore()
const { projectName } = useProjects()
const { isCute } = useThemeFamily()

const projectLabel = computed(() => projectName(store.active?.project ?? ''))
const model = computed(() => store.active?.model ?? 'Opus 5')

// Curated starter prompts (dev-tool oriented). Label/desc/prompt are i18n; icon
// from the lucide sprite. Clicking loads the prompt into the composer draft.
type Suggestion = { key: string; icon: string; label: string; desc: string; prompt: string }
const suggestions = computed<Suggestion[]>(() =>
  (['understand', 'debug', 'review', 'implement'] as const).map((key) => ({
    key,
    icon: { understand: 'search', debug: 'alert', review: 'git', implement: 'edit' }[key],
    label: t(`sessions.welcome.sug.${key}.label`),
    desc: t(`sessions.welcome.sug.${key}.desc`),
    prompt: t(`sessions.welcome.sug.${key}.prompt`),
  })),
)

function useSuggestion(prompt: string) {
  store.seedComposer(prompt)
}
</script>

<style scoped>
.swelcome {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
  padding: 40px 24px;
  text-align: center;
}
.swhero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.swicon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: var(--r-panel);
  color: var(--accent);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
}
.swh {
  font-size: 1.5em;
  /* Global leading is now a LENGTH (20px), which would crowd a 1.5em headline — take
     the display step instead. */
  line-height: var(--lh-2xl);
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}
.swsub {
  max-width: 420px;
  color: var(--textDim);
  line-height: var(--lh-prose);
}
.swctx {
  display: flex;
  gap: 7px;
  margin-top: 4px;
}
.swctxchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: var(--r-pill);
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
  background: var(--bgSubtle);
  border: 1px solid var(--border);
}
/* Starter cards: a 2-col grid; hover/focus tint via color only (no layout shift). */
.swsug {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  max-width: 520px;
}
.swcard {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 13px 14px;
  text-align: left;
  border-radius: var(--r-btn);
  border: 1px solid var(--border);
  background: var(--bgEl);
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background 0.14s ease;
}
.swcard:hover {
  border-color: var(--accentBorder);
  background: var(--bgHover);
}
.swcard:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.swcardic {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  color: var(--accent);
  background: var(--accentDim);
}
.swcardtx {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.swcardl {
  font-weight: 600;
  color: var(--text);
}
.swcardd {
  font-size: 0.9231em;
  color: var(--textDim);
  line-height: var(--lh-sm);
}
.swhints {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.swhint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swhint kbd {
  font-size: 11px;
  line-height: 12px;
  padding: 3px 6px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  background: var(--bgSubtle);
  border: 1px solid var(--border);
}
@media (max-width: 560px) {
  .swsug {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
