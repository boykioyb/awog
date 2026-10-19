<template>
  <!-- Doc 'chat' của workbench (ADR 0098): SessionDetail nhúng nguyên trạng vào
       stage, parity với pages/sessions.vue — KeepAlive :max=5 keyed theo session.id
       (đổi phiên instant, PTY/browser/view giữ sống), SessionHandoffCard cho phiên
       đã popout sang cửa sổ riêng, empty state khi chưa có phiên. Comment nằm NGOÀI
       <KeepAlive> — comment node cũng tính là con và sẽ fail kiểm tra "exactly one
       child component" (ghi chú giống hệt sessions.vue). -->
  <!-- relative: neo .dropzone của SessionDetail (absolute inset:0 leo lên ancestor
       gần nhất có position) để chỉ phủ stage, không leo lên .wb (§1 embed notes). -->
  <div class="relative flex h-full min-h-0 overflow-hidden">
    <KeepAlive :max="5">
      <SessionHandoffCard
        v-if="store.active && store.isHandedOff(store.active.engineId)"
        key="handoff"
        :session="store.active"
      />
      <SessionDetail
        v-else-if="store.active"
        :key="store.active.id"
        :session="store.active"
        embedded
      />
      <div
        v-else
        class="grid flex-1 place-content-center justify-items-center gap-2.5 text-center text-base text-faint"
      >
        <span class="text-dim"><Icon class="size-5.5" name="sessions" /></span>
        <div>
          {{ t('sessions.empty.title') }}
          <br />
          {{ t('sessions.empty.subtitle') }}
        </div>
        <Button type="button" @click="store.create(store.activeTab)">
          <Icon name="plus" />
          {{ t('sessions.new') }}
        </Button>
      </div>
    </KeepAlive>
  </div>
</template>

<script setup lang="ts">
// Slice G — scaffold nhúng SessionDetail. KHÔNG provide lại gì: mọi provide/inject
// (transcript surface ADR 0075, session scope, file preview, gh-comment link) được
// SessionDetail tự khai trong chính setup của nó, nên chỉ cần truyền đúng prop
// `session` duy nhất (store.active — SessionDetail tự suy active qua
// `session.id === store.activeId` chứ không nhận flag).
//
// ⚠ TẠM THỜI (ghi chi tiết trong docs/features/workbench-embed-notes.md): SessionDetail
// còn render workspace panel 3 mép + main-tab strip web ngay trong stage — đúng như
// trang sessions cũ. Khi slice C/D đưa dock rail phải + doc 'web' vào thì mặt đó
// cần tắt tại đây (hiện SessionDetail chưa có prop tắt) và doc-visibility phải
// đóng góp vào `visible()` của useEmbeddedBrowser.
const { t } = useI18n()
const store = useSessionsStore()
</script>
