<template>
  <div class="keyrow">
    <input
      class="keyinp"
      :class="{ mono }"
      :type="revealed ? 'text' : 'password'"
      :placeholder="placeholder"
      :readonly="readonly"
      :value="model"
      @input="model = ($event.target as HTMLInputElement).value"
    />
    <span class="keyeye" @click="revealed = !revealed">👁</span>
  </div>
</template>

<script setup lang="ts">
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
