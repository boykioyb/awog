<template>
  <!-- SVG sprite — ported verbatim from awog-prototype.html. Mounted once in
       app.vue; every <Icon name="x"/> references #i-x via <use>. -->
  <svg width="0" height="0" style="position: absolute" aria-hidden="true">
    <defs>
      <symbol id="i-home" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </symbol>
      <symbol id="i-sessions" viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </symbol>
      <symbol id="i-tasks" viewBox="0 0 24 24">
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" />
      </symbol>
      <symbol id="i-workflows" viewBox="0 0 24 24">
        <rect x="3" y="3" width="6" height="6" rx="1" />
        <rect x="15" y="15" width="6" height="6" rx="1" />
        <path d="M9 6h6a2 2 0 0 1 2 2v7" />
      </symbol>
      <symbol id="i-agents" viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <circle cx="17" cy="9" r="2.2" />
        <path d="M16 20a5 5 0 0 1 5-5" />
      </symbol>
      <symbol id="i-skills" viewBox="0 0 24 24">
        <path d="M15 4V2m0 20v-2M4 15H2m20 0h-2" />
        <path d="m6 6 12 12M9 4l11 11a2 2 0 0 1-3 3L6 7a2 2 0 0 1 3-3z" />
      </symbol>
      <symbol id="i-templates" viewBox="0 0 24 24">
        <path d="M16 16l3-8 3 8M2 16l3-8 3 8M5 13h6M19 13h-6" />
      </symbol>
      <symbol id="i-git" viewBox="0 0 24 24">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="9" r="2.5" />
        <path d="M6 8.5v7M8.3 7.2 15.7 8M18 11.5c0 4-5 3.5-9.5 4" />
      </symbol>
      <symbol id="i-conn" viewBox="0 0 24 24">
        <path d="M12 7V2M9 5h6M7 11h10v4a5 5 0 0 1-10 0z" />
        <path d="M12 20v2" />
      </symbol>
      <symbol id="i-hooks" viewBox="0 0 24 24">
        <path d="M13 2L4.5 12.5a1 1 0 0 0 .8 1.5H11l-1 8 8.5-10.5a1 1 0 0 0-.8-1.5H12z" />
      </symbol>
      <symbol id="i-rules" viewBox="0 0 24 24">
        <path d="M6 4h11a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4z" />
        <path d="M9 8h7M9 12h7M9 16h4" />
      </symbol>
      <symbol id="i-commands" viewBox="0 0 24 24">
        <path d="M9 21l6-18" />
        <path d="M5 8l-3 4 3 4M19 8l3 4-3 4" />
      </symbol>
      <symbol id="i-projects" viewBox="0 0 24 24">
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </symbol>
      <symbol id="i-settings" viewBox="0 0 24 24">
        <path d="M4 6h11M19 6h1M4 12h1M9 12h11M4 18h7M15 18h5" />
        <circle cx="17" cy="6" r="2" />
        <circle cx="7" cy="12" r="2" />
        <circle cx="13" cy="18" r="2" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4-4" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4" /></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4l3 2" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </symbol>
      <symbol id="i-shield" viewBox="0 0 24 24">
        <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
        <path d="M9 12l2 2 4-4" />
      </symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></symbol>
      <symbol id="i-clip" viewBox="0 0 24 24">
        <path d="M21 12.5 12 21a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
      </symbol>
      <symbol id="i-sun" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path
          d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"
        />
      </symbol>
      <symbol id="i-moon" viewBox="0 0 24 24">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </symbol>
      <symbol id="i-act" viewBox="0 0 24 24"><path d="M3 12h4l2 6 4-14 2 8h6" /></symbol>
      <symbol id="i-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></symbol>
      <symbol id="i-branch" viewBox="0 0 24 24">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <path d="M6 8.5v7" />
      </symbol>
      <symbol id="i-folder" viewBox="0 0 24 24">
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </symbol>
      <symbol id="i-trash" viewBox="0 0 24 24">
        <path
          d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
        />
      </symbol>
      <symbol id="i-stop" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </symbol>
      <symbol id="i-filter" viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4" /></symbol>
      <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
      <symbol id="i-panel" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </symbol>
      <symbol id="i-copy" viewBox="0 0 24 24">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </symbol>
      <symbol id="i-edit" viewBox="0 0 24 24">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24">
        <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v4h-4" />
      </symbol>
      <symbol id="i-fork" viewBox="0 0 24 24">
        <circle cx="6" cy="5" r="2.5" />
        <circle cx="18" cy="5" r="2.5" />
        <circle cx="12" cy="19" r="2.5" />
        <path d="M6 7.5v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-3M12 13.5v3" />
      </symbol>
      <symbol id="i-quote" viewBox="0 0 24 24">
        <path d="M7 7h4v4a4 4 0 0 1-4 4M15 7h4v4a4 4 0 0 1-4 4" />
      </symbol>
      <symbol id="i-rewind" viewBox="0 0 24 24"><path d="M11 19 4 12l7-7M20 19l-7-7 7-7" /></symbol>
      <symbol id="i-revert" viewBox="0 0 24 24">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </symbol>
      <symbol id="i-tag" viewBox="0 0 24 24">
        <path
          d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
        />
        <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
      </symbol>
      <symbol id="i-merge" viewBox="0 0 24 24">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M6 21V9a9 9 0 0 0 9 9" />
      </symbol>
      <symbol id="i-pin" viewBox="0 0 24 24">
        <path d="M12 17v5M8 3h8l-1.2 7.2 2.7 2.8H6.5l2.7-2.8z" />
      </symbol>
      <symbol id="i-foldv" viewBox="0 0 24 24">
        <path d="M8 4l4 4 4-4M8 20l4-4 4 4M4 12h16" />
      </symbol>
      <!-- brain (lucide) — used for Thinking blocks -->
      <symbol id="i-brain" viewBox="0 0 24 24">
        <path
          d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"
        />
        <path
          d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"
        />
      </symbol>
    </defs>
  </svg>
</template>

<script setup lang="ts">
// Static markup only — no logic.
</script>
