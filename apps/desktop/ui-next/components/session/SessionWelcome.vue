<template>
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center"
  >
    <div class="flex flex-col items-center gap-2.5">
      <div
        class="grid size-13.5 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary"
      >
        <Icon name="sessions" class="size-6" />
      </div>
      <div class="text-2xl font-semibold tracking-tight text-foreground">
        {{ t('sessions.welcome.title') }}
      </div>
      <div class="max-w-105 leading-relaxed text-muted-foreground">
        {{ t('sessions.welcome.subtitle') }}
      </div>
      <div class="mt-1 flex gap-2">
        <Badge
          variant="outline"
          class="gap-1.5 rounded-md bg-muted px-2 font-normal text-muted-foreground"
        >
          <Icon name="folder" />
          {{ projectLabel }}
        </Badge>
        <Badge
          variant="outline"
          class="gap-1.5 rounded-md bg-muted px-2 font-normal text-muted-foreground"
        >
          <Icon name="settings" />
          {{ model }}
        </Badge>
      </div>
    </div>

    <!-- Starter suggestions: clicking seeds the composer draft (user reviews + sends).
         Lưới 2 cột; hover = accent-wash trung tính, focus = ring. -->
    <div class="grid w-full max-w-130 grid-cols-2 gap-2.5 max-[560px]:grid-cols-1">
      <Button
        v-for="s in suggestions"
        :key="s.key"
        type="button"
        variant="outline"
        class="h-auto items-start justify-start gap-2.5 rounded-lg bg-card px-3.5 py-3 text-left font-normal whitespace-normal shadow-none"
        @click="useSuggestion(s.prompt)"
      >
        <span
          class="grid size-7 flex-none place-items-center rounded-md bg-primary/10 text-primary"
        >
          <Icon :name="s.icon" />
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="text-base font-semibold text-foreground">{{ s.label }}</span>
          <span class="text-sm text-muted-foreground">{{ s.desc }}</span>
        </span>
      </Button>
    </div>

    <div class="flex flex-wrap justify-center gap-3.5 text-xs text-faint">
      <span class="inline-flex items-center gap-1.5">
        <Kbd>⏎</Kbd>
        {{ t('sessions.welcome.hintSend') }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <Kbd>⇧⏎</Kbd>
        {{ t('sessions.welcome.hintNewline') }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <Kbd>/</Kbd>
        {{ t('sessions.welcome.hintSlash') }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <Kbd>@</Kbd>
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
const scope = useSessionScope()
const { projectName } = useProjects()

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
  // Gửi kèm phiên của transcript chứa component này: ở chế độ LƯỚI, bấm ở ô nào thì
  // chỉ composer của ô ĐÓ nhận (useSessionScope).
  store.seedComposer(prompt, scope.sessionId.value)
}
</script>
