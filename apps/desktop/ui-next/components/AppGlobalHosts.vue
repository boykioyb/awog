<template>
  <!-- Modal/overlay hosts driven by singleton composables. Order is irrelevant (each
       renders into its own fixed layer per the z-index bands) — group by concern. -->
  <SessionPromptEditOverlay />
  <SessionGitModal />
  <GitPrSummaryHost />
  <ProjectQuickViewModal />
  <SessionExportModal />
  <SessionForkTreeModal />
  <NewTaskModalHost />
  <ConfirmDialogHost />
  <TextPromptHost />
  <!-- SSH host-key TOFU prompt: an SSH connect can be triggered from a session's
       terminal, so the prompt must exist wherever a session is rendered. -->
  <SshHostKeyHost />
  <!-- The app's single toast surface (useToast) — every notification in the app
       lands here, from any scope, in both the main window and a session popout. -->
  <AppToaster />

  <!-- Shared full-window file preview + the corner "minimize dock" (parked
       previews/sessions/tasks/terminal) — docs/features/minimize-dock.md. -->
  <PreviewModal />
  <MinimizeDock />

  <!-- Shared "translate the highlighted text" popover (selection-to-translate). -->
  <SelectionTranslatePopover />

  <!-- "Open this link in the app or outside?" (ADR 0086 phần C). Also the place
       the delegated link-click listener is installed, so every <a> in whichever
       surface mounts this stack gets the same choice. -->
  <LinkOpenHost />

  <!-- "Hỏi agent → phiên hiện tại hay phiên mới?" — host của lựa chọn đó. Nó phải
       ở đây (chứ không ở màn hạ tầng) vì câu hỏi được nêu từ Logs, Tổng quan,
       Explorer, Nhật ký và cả một phiên đang mở. Bong bóng phiên thì KHÔNG ở đây:
       nó thuộc cửa sổ chính, xem layouts/default.vue. -->
  <InfraAskTargetDialog />

  <!-- Bộ xuất · chia sẻ · báo cáo (mốc 6.5–6.7). Ở đây chứ không ở màn hạ tầng:
       đối tượng được xuất có thể là một playbook (trang /playbooks), một lượt
       chạy, hay một báo cáo — và trạng thái mở nằm ở MỌC MODULE của
       `useShareExport`, nên bên gọi chỉ cần `openShare(subject)` là hộp hiện ra,
       không phải tự render nó. -->
  <ShareExportModal />
</template>

<script setup lang="ts">
// The host stack any surface that renders a SESSION needs — mounted once per
// renderer. Two surfaces use it: the main window's shell (layouts/default.vue, which
// adds the app-only globals: command palette, settings/activity modals, onboarding,
// terminal dock, status bar) and a session popout window (pages/session.vue,
// docs/features/session-popout-window.md), which has no app shell at all.
//
// It exists so a popout can't silently lose a host: a confirm(), a toast, a preview
// or a "Run as task" from inside a session must work identically in both windows,
// and one list is the only way to keep that true as hosts are added.
defineOptions({ name: 'AppGlobalHosts' })

// The usage-quota guard used to live in its own host component purely because it
// owned a toast queue to render. It doesn't any more (it pushes to useToast like
// everything else), so it just needs an app-lifetime setup scope to hang its poll
// timer and watcher on — this one.
useQuotaGuard()
</script>
