<template>
  <div>
    <SettingsPaneHeader :title="t('settings.pet.heading')" />

    <SettingsField :name="t('settings.pet.enabled.name')" :desc="t('settings.pet.enabled.desc')">
      <SettingsTog v-model="enabled" />
    </SettingsField>

    <!-- Pet gallery. Each card renders the REAL sprite component in its idle loop, so
         what you pick is literally what lands on the desktop. -->
    <SettingsGroupLabel>{{ t('settings.pet.gallery.heading') }}</SettingsGroupLabel>
    <div class="mt-1 flex flex-wrap gap-2.5">
      <Button
        v-for="p in PET_SPRITES"
        :key="p"
        variant="outline"
        class="h-auto w-24 flex-col gap-1.5 bg-card px-2 pt-3 pb-2.5 font-normal text-dim hover:border-input hover:bg-card hover:text-foreground"
        :class="{
          'border-selected-border bg-selected text-foreground hover:border-selected-border hover:bg-selected':
            p === store.pet.sprite,
        }"
        :title="t(`settings.pet.sprite.${p}`)"
        :aria-pressed="p === store.pet.sprite"
        @click="store.updatePet({ sprite: p })"
      >
        <!-- Unmirrored in the gallery: on the desktop the pet turns to face into the
             screen, but here it is a portrait, not a status. -->
        <PetSprite state="idle" :sprite="p" facing="right" />
        <span>{{ t(`settings.pet.sprite.${p}`) }}</span>
      </Button>
    </div>
    <div class="mt-2 text-dim">{{ t('settings.pet.gallery.hint') }}</div>

    <SettingsField :name="t('settings.pet.scale.name')" :desc="t('settings.pet.scale.desc')">
      <SettingsSeg v-model="scale" :options="scaleOptions" />
    </SettingsField>

    <SettingsField :name="t('settings.pet.autoPeek.name')" :desc="t('settings.pet.autoPeek.desc')">
      <SettingsTog v-model="autoPeek" />
    </SettingsField>

    <SettingsField :name="t('settings.pet.quips.name')" :desc="t('settings.pet.quips.desc')">
      <SettingsTog v-model="quips" />
    </SettingsField>

    <SettingsField :name="t('settings.pet.tricks.name')" :desc="t('settings.pet.tricks.desc')">
      <SettingsTog v-model="tricks" />
    </SettingsField>

    <SettingsField :name="t('settings.pet.reminder.name')" :desc="t('settings.pet.reminder.desc')">
      <SettingsSeg v-model="reminder" :options="reminderOptions" />
    </SettingsField>

    <SettingsField :name="t('settings.pet.reset.name')" :desc="t('settings.pet.reset.desc')">
      <Button :disabled="!store.pet.pos" variant="outline" @click="store.updatePet({ pos: null })">
        {{ t('settings.pet.reset.action') }}
      </Button>
    </SettingsField>

    <!-- Line editor. One textarea per bucket, chosen by the segmented control, rather
         than six stacked boxes: the buckets are alternatives, not a checklist. -->
    <SettingsGroupLabel>{{ t('settings.pet.lines.heading') }}</SettingsGroupLabel>
    <SettingsSeg v-model="bucket" :options="bucketOptions" />
    <Textarea
      v-model="draft"
      class="mt-2 min-h-32 resize-y px-3 py-2.5 text-base"
      spellcheck="false"
      @change="commitLines"
      @blur="commitLines"
    />
    <div class="mt-2 flex items-center justify-between gap-3 text-dim">
      <span>{{ t('settings.pet.lines.desc') }}</span>
      <Button :disabled="!isEdited" variant="outline" @click="resetBucket">
        {{ t('settings.pet.lines.reset') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PET_REMINDER_CHOICES, PET_SCALES, PET_SPRITES, useSettingsStore } from '~/stores/settings'
import type { PetScale } from '~/stores/settings'
import { PET_QUIP_BUCKETS, defaultQuipLines } from '~/utils/pet-quips'
import type { PetQuipBucket } from '~/utils/pet-quips'

// Desktop pet panel (docs/features/desktop-pet.md). Its own settings section rather
// than a block inside Appearance: the pet is a surface of its own (a window on the
// desktop), and the sprite picker wants room to grow into a real gallery.
//
// No DOM applier here — the prefs are pushed to the Electron main process by
// usePetStatus, which is what creates/resizes/moves the window.
const { t } = useI18n()
const store = useSettingsStore()

const enabled = computed<boolean>({
  get: () => store.pet.enabled,
  set: (value) => store.updatePet({ enabled: value }),
})
const autoPeek = computed<boolean>({
  get: () => store.pet.autoPeek,
  set: (value) => store.updatePet({ autoPeek: value }),
})
const quips = computed<boolean>({
  get: () => store.pet.quips,
  set: (value) => store.updatePet({ quips: value }),
})
// Only the 8-row packs (shiba/dino/miku) have a skill to perform; girl + chicken ignore
// it. The toggle stays visible either way — hiding it per sprite would read as a bug.
const tricks = computed<boolean>({
  get: () => store.pet.tricks,
  set: (value) => store.updatePet({ tricks: value }),
})
const scaleOptions = PET_SCALES.map((s) => ({ label: `${Math.round(s * 100)}%`, value: String(s) }))

// Reminders: minutes, 0 = off.
const reminderOptions = computed(() =>
  PET_REMINDER_CHOICES.map((m) => ({
    label: m === 0 ? t('settings.pet.reminder.off') : `${m}m`,
    value: String(m),
  })),
)
const reminder = computed<string>({
  get: () => String(store.pet.reminderMinutes),
  set: (value) => store.updatePet({ reminderMinutes: Number(value) }),
})

// ── Line editor ──
const bucket = ref<PetQuipBucket>('working')
const bucketOptions = computed(() =>
  PET_QUIP_BUCKETS.map((b) => ({ label: t(`settings.pet.bucket.${b}`), value: b })),
)

// A bucket the user never touched shows the localised defaults, so the editor is
// always populated — but it is only STORED once they change something.
const isEdited = computed(() => (store.pet.quipLines[bucket.value]?.length ?? 0) > 0)

// A LOCAL draft, committed on blur — not a computed writing straight to the store.
// Writing per keystroke would strip the blank line the moment you press Enter, so a
// new line could never be typed.
const draft = ref('')
watch(
  [bucket, () => store.pet.quipLines],
  () => {
    const saved = store.pet.quipLines[bucket.value]
    draft.value = (saved?.length ? saved : defaultQuipLines(t, bucket.value)).join('\n')
  },
  { immediate: true },
)

function commitLines(): void {
  const cleaned = draft.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  store.updatePet({ quipLines: { ...store.pet.quipLines, [bucket.value]: cleaned } })
}

function resetBucket(): void {
  const next = { ...store.pet.quipLines }
  delete next[bucket.value]
  store.updatePet({ quipLines: next })
}
const scale = computed<string>({
  get: () => String(store.pet.scale),
  set: (value) => store.updatePet({ scale: Number(value) as PetScale }),
})
</script>
