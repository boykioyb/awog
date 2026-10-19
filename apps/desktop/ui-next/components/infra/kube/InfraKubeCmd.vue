<template>
  <!-- Một dòng lệnh để người dùng chép sang terminal — dùng cho lệnh BỊ CHẶN và lệnh
       đã chạy. Ba chỗ của tab Kubernetes (modal cluster · khung output · vùng
       workload) dùng chung khuôn này nên tách ra một component thay vì chép ba bản. -->
  <div class="flex min-w-0 items-center gap-2">
    <!-- mono-ok: dòng lệnh người dùng copy-paste sang terminal -->
    <code
      class="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs whitespace-nowrap text-foreground"
    >
      {{ command }}
    </code>
    <Button type="button" variant="outline" @click="emit('copy', command)">
      {{ t('infra.kube.blocked.copy') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import Button from '~/components/ui/button/Button.vue'

defineProps<{ command: string }>()
const emit = defineEmits<{ (e: 'copy', command: string): void }>()

const { t } = useI18n()
</script>
