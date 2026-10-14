<template>
  <SwitchRoot
    v-bind="$attrs"
    :model-value="checked"
    :class="
      cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        $attrs.class,
      )
    "
    @update:model-value="emit('update:checked', $event)"
  >
    <SwitchThumb
      :class="
        cn(
          'pointer-events-none block size-4 rounded-full bg-background shadow ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5',
        )
      "
    >
      <slot name="thumb" />
    </SwitchThumb>
  </SwitchRoot>
</template>

<script setup lang="ts">
// shadcn-vue Switch — stock new-york. Track/thumb read the standard var set
// (primary/input/background) so the look follows the active theme layer.
// API `checked` / `update:checked` (v-model:checked) dịch sang `modelValue` của reka-ui 2.x:
// SwitchRoot 2.x KHÔNG còn prop `checked`, nên chuyển thẳng qua `$attrs` thì nút chỉ lật
// trạng thái nội bộ (uncontrolled) còn model của caller không bao giờ đổi — mọi công tắc
// SettingsTog trông như bật/tắt được nhưng không lưu gì.
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })

defineProps<{ checked?: boolean }>()
const emit = defineEmits<{ 'update:checked': [value: boolean] }>()
</script>
