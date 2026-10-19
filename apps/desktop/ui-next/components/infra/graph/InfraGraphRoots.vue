<template>
  <!-- Chọn ĐIỂM VÀO của graph. Spec §"Giới hạn nói trước": account lớn không có nút
       "vẽ cả tài khoản" — luôn bắt đầu từ một điểm vào. Vì vậy đây là màn của trạng
       thái CHƯA có graph, và nó chịu trách nhiệm nói cách sửa khi chưa có gì để chọn. -->
  <Card
    class="max-h-full w-full max-w-115 items-center gap-2.5 overflow-auto p-4.5 text-center shadow-md"
  >
    <p v-if="loading" class="text-sm text-dim">{{ t('infra.graph.roots.loading') }}</p>

    <template v-else-if="error">
      <p class="text-sm text-destructive">{{ error }}</p>
      <Button type="button" variant="outline" size="sm" @click="emit('retry')">
        <Icon name="refresh" />
        {{ t('infra.graph.roots.retry') }}
      </Button>
    </template>

    <template v-else-if="!roots.length">
      <span class="grid size-11.5 place-items-center rounded-xl border bg-card text-dim">
        <Icon name="branch" class="size-5" />
      </span>
      <div class="text-lg font-semibold text-foreground">
        {{ t('infra.graph.roots.empty.title') }}
      </div>
      <p class="text-left text-sm leading-relaxed text-muted-foreground">
        {{ t('infra.graph.roots.empty.body') }}
      </p>
      <Button type="button" variant="outline" size="sm" @click="emit('retry')">
        <Icon name="refresh" />
        {{ t('infra.graph.roots.retry') }}
      </Button>
    </template>

    <template v-else>
      <div class="text-lg font-semibold text-foreground">{{ t('infra.graph.roots.title') }}</div>
      <p class="text-left text-sm leading-relaxed text-muted-foreground">
        {{ t('infra.graph.roots.about') }}
      </p>
      <ul class="flex w-full flex-col gap-1">
        <li v-for="root in roots" :key="root.id">
          <Button
            variant="outline"
            class="h-auto w-full justify-start gap-2 bg-card px-2.5 py-2 text-left font-normal hover:border-selected-border hover:bg-selected"
            type="button"
            :title="t('infra.graph.roots.select')"
            @click="emit('select', root.id)"
          >
            <span
              class="grid size-5.5 shrink-0 place-items-center rounded-sm bg-selected text-primary"
            >
              <Icon :name="graphServiceIcon(root.service)" class="size-3.5" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-semibold text-foreground">{{ root.label }}</span>
              <span class="truncate text-xs text-dim">
                {{ root.service }}
                <template v-if="root.region">· {{ root.region }}</template>
              </span>
            </span>
            <Icon name="chev-right" />
          </Button>
        </li>
      </ul>
      <ul v-if="notes.length" class="flex w-full flex-col gap-0.5 text-left text-xs text-faint">
        <li v-for="(note, i) in notes" :key="i">{{ t(note) }}</li>
      </ul>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { graphServiceIcon } from '~/composables/useInfraGraph'
import type { InfraGraphRoot } from '~/composables/useInfraGraphApi'
import Button from '~/components/ui/button/Button.vue'

defineProps<{
  roots: InfraGraphRoot[]
  loading: boolean
  error: string
  /** Khoá i18n cho những điểm vào bị bỏ qua (hợp đồng §3). */
  notes: string[]
}>()

const emit = defineEmits<{ select: [id: string]; retry: [] }>()

const { t } = useI18n()
</script>
