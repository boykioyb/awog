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
  <QuotaGuardHost />
  <!-- SSH host-key TOFU prompt: an SSH connect can be triggered from a session's
       terminal, so the prompt must exist wherever a session is rendered. -->
  <SshHostKeyHost />
  <ActionToastHost />

  <!-- Shared full-window file preview + the corner "minimize dock" (parked
       previews/sessions/tasks/terminal) — docs/features/minimize-dock.md. -->
  <PreviewModal />
  <MinimizeDock />

  <!-- Shared "translate the highlighted text" popover (selection-to-translate). -->
  <SelectionTranslatePopover />
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
</script>
