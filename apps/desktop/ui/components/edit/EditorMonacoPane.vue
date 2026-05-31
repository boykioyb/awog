<template>
  <div
    class="flex flex-col overflow-hidden"
    :class="isSplit ? 'w-full md:w-1/2' : 'flex-1'"
    :style="{ borderRight: isSplit ? `1px solid ${t.border}` : 'none' }"
  >
    <div class="flex-1 overflow-auto" :style="{ background: t.bg }">
      <div class="flex font-mono text-[1em] leading-[1.6]" :style="{ minHeight: '100%' }">
        <div
          class="select-none text-right pr-3 pl-3 py-3 flex-shrink-0"
          :style="{
            color: t.textFaint,
            background: t.bgPanel,
            borderRight: `1px solid ${t.border}`,
          }"
        >
          <div v-for="n in lineCount" :key="n" :style="{ minHeight: '1.6em' }">
            {{ n }}
          </div>
        </div>
        <textarea
          :value="modelValue"
          spellcheck="false"
          class="flex-1 px-3 py-3 outline-none resize-none"
          :style="{
            background: 'transparent',
            color: t.text,
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
            border: 'none',
            minHeight: `${lineCount * 1.6}em`,
            caretColor: t.text,
          }"
          @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  isSplit: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useTheme()

const lineCount = computed(() => props.modelValue.split('\n').length)
</script>
