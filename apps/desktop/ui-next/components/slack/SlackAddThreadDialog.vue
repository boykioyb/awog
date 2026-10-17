<template>
  <Dialog :open="ctx.addOpen.value" @update:open="(v) => (ctx.addOpen.value = v)">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t('slack.add.title') }}</DialogTitle>
        <DialogDescription>{{ t('slack.add.hint') }}</DialogDescription>
      </DialogHeader>
      <div class="grid gap-3">
        <Input
          ref="urlRef"
          v-model="url"
          :placeholder="t('slack.add.placeholder')"
          @keydown.enter.prevent="submit"
        />
        <div v-if="url.trim() && !looksValid" class="text-xs text-destructive">
          {{ t('slack.add.invalid') }}
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-muted-foreground">{{ t('slack.add.project') }}</span>
          <AppSelect
            v-model="projectId"
            :options="ctx.assignOptions.value"
            class="flex-1"
            width="100%"
            searchable
            :search-placeholder="t('slack.filter.searchProject')"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="ctx.addOpen.value = false">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="!looksValid || busy" @click="submit">
          {{ busy ? t('slack.add.adding') : t('slack.add.submit') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Thêm thread bằng permalink Slack. Kiểm sơ dạng link ở đây cho phản hồi tức thì; parse
// thật (kênh, ts, link vào reply ⇒ thread cha) là việc của sidecar `slack.threads.add`.
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useSlackCtx } from '~/composables/useSlackManager'

const NONE = '__none'
const PERMALINK = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[CGD][A-Z0-9]+\/p\d{16}/i

const { t } = useI18n()
const ctx = useSlackCtx()
const url = ref('')
const projectId = ref(NONE)
const busy = ref(false)
const urlRef = useTemplateRef<{ focus: () => void }>('urlRef')

const looksValid = computed(() => PERMALINK.test(url.value.trim()))

watch(
  () => ctx.addOpen.value,
  async (open) => {
    if (!open) return
    url.value = ''
    // Đang lọc theo một project thì thread mới mặc định thuộc project đó.
    const pf = ctx.projectFilter.value
    projectId.value = ctx.assignOptions.value.some((o) => o.value === pf) ? pf : NONE
    await nextTick()
    urlRef.value?.focus()
  },
)

async function submit(): Promise<void> {
  if (!looksValid.value || busy.value) return
  busy.value = true
  try {
    await ctx.addThread(url.value.trim(), projectId.value === NONE ? null : projectId.value)
  } finally {
    busy.value = false
  }
}
</script>
