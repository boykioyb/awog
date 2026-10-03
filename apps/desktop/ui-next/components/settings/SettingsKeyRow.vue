<template>
  <div class="keyrow">
    <Input
      :class="{ mono }"
      :type="revealed ? 'text' : 'password'"
      :placeholder="placeholder"
      :readonly="readonly"
      :model-value="model"
      class="flex-1"
      @update:model-value="model = $event"
    />
    <span class="keyeye" @click="revealed = !revealed">👁</span>
  </div>
</template>

<script setup lang="ts">
import Input from '~/components/ui/input/Input.vue'

// API-key input with reveal toggle — ports the .keyrow > .keyinp + .keyeye control.
// Controlled via v-model; password <-> text on eye click. `readonly` renders an
// existing (masked) value the user can reveal but not edit (e.g. a stored key).
withDefaults(
  defineProps<{
    placeholder?: string
    readonly?: boolean
    mono?: boolean
  }>(),
  { placeholder: '', readonly: false, mono: false },
)

const model = defineModel<string>({ default: '' })
const revealed = ref(false)
</script>
