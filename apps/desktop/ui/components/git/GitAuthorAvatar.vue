<template>
  <img
    v-if="src && !errored"
    :src="src"
    :alt="name"
    class="rounded-full flex-shrink-0 object-cover"
    :style="{ width: `${size}px`, height: `${size}px`, border: `1px solid ${t.border}` }"
    :title="title"
    loading="lazy"
    decoding="async"
    @error="errored = true"
  />
  <span
    v-else
    class="inline-flex items-center justify-center rounded-full flex-shrink-0 overflow-hidden font-medium leading-none"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: '10px',
      background: t.bgInput,
      color: t.textMuted,
      border: `1px solid ${t.border}`,
    }"
    :title="title"
  >
    {{ initials(name) }}
  </span>
</template>

<script setup lang="ts">
import { gitAvatarUrl, initials } from '~/utils/git-avatar'

const props = withDefaults(defineProps<{ name: string; email: string; size?: number }>(), {
  size: 18,
})

const { t } = useTheme()

const src = ref<string | null>(null)
const errored = ref(false)

const title = computed(() => `${props.name} <${props.email}>`)

// Email is stable per commit row (component keyed by hash), but watch keeps the
// avatar correct if a parent ever reuses the instance for a different author.
watch(
  () => props.email,
  async (email) => {
    errored.value = false
    src.value = await gitAvatarUrl(email, props.size)
  },
  { immediate: true },
)
</script>
