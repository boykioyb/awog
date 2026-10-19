<template>
  <!-- Teleport ra body để modal thoát stacking context của workspace panel và phủ cả
       cửa sổ. Một instance duy nhất, lái bởi store useGitModal(). Git Manager mount lười
       (v-if) nên store.init() chỉ chạy khi modal đang mở.
       Scrim tự dựng, KHÔNG phải Dialog reka: Git Manager tự mở menu / popover / hộp
       thoại con teleport ra body (AppSelect, menu nhánh, context menu…) — Dialog modal
       của reka khoá pointer-events của body nên mấy lớp đó sẽ không bấm được. Card mang
       `role="dialog"` + `data-state="open"` để khớp OVERLAYS (useEmbeddedBrowser.ts).
       z-120: trên trang phiên, dưới hộp thoại con của git (150) và Dialog shadcn (170). -->
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-120 flex items-center justify-center bg-black/55 p-6 [-webkit-app-region:no-drag]"
      @click.self="close"
    >
      <Card
        role="dialog"
        aria-modal="true"
        data-state="open"
        :aria-label="t('sessions.workspace.gitModal.title')"
        class="flex h-[88vh] w-[95vw] max-w-320 flex-col gap-0 overflow-hidden rounded-lg py-0 shadow-lg"
      >
        <div class="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
          <Icon name="git" class="size-3.5 text-primary" />
          <span class="flex-1 font-semibold">{{ t('sessions.workspace.gitModal.title') }}</span>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <Icon name="x" class="size-3.5" />
          </Button>
        </div>
        <Separator />
        <!-- Git Manager lấp phần còn lại; mô phỏng đúng wrapper của trang /git (flex
             column + min-width/min-height 0 + overflow hidden) để nó không tràn modal. -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <GitManager :project-id="projectId ?? undefined" />
        </div>
      </Card>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Session Git modal — pops the full Git Manager over the current session (the
// session stays mounted behind the backdrop) so the user can stage/commit/branch
// without navigating away. Opened from the session workspace Diff header via
// useGitModal().open(projectId); mounted once in the default layout.
import { useGitModal } from '~/composables/useGitModal'

const { t } = useI18n()
const { isOpen, projectId, close } = useGitModal()

// Esc closes the modal (only while open, so it doesn't swallow other Esc users).
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) {
    e.preventDefault()
    close()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
