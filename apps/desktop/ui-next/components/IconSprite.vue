<template>
  <!-- SVG sprite — ported verbatim from awog-prototype.html. Mounted once in
       app.vue; every <Icon name="x"/> references #i-x via <use>. -->
  <svg width="0" height="0" style="position: absolute" aria-hidden="true">
    <defs>
      <symbol id="i-scan" viewBox="0 0 24 24">
        <path
          d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"
        />
      </symbol>
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
      <symbol id="i-ssh" viewBox="0 0 24 24">
        <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M7 9l3 3-3 3M13 15h4" />
      </symbol>
      <symbol id="i-smartphone" viewBox="0 0 24 24">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
        <path d="M12 18h.01" />
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
      <symbol id="i-chev-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></symbol>
      <symbol id="i-chev-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></symbol>
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
      <symbol id="i-menu" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></symbol>
      <symbol id="i-panel" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </symbol>
      <!-- dock-position icons: rect frame + a divider biased to the docked edge
           (lucide panel-left/right/bottom style). -->
      <symbol id="i-dock-left" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </symbol>
      <symbol id="i-dock-right" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </symbol>
      <symbol id="i-dock-bottom" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 14h18" />
      </symbol>
      <symbol id="i-copy" viewBox="0 0 24 24">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </symbol>
      <symbol id="i-commit" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M3 12h6M15 12h6" />
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />
      </symbol>
      <!-- table (lucide) — spreadsheet preview (xlsx) header + minimize pill. -->
      <symbol id="i-table" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M9 10v10" />
      </symbol>
      <symbol id="i-bold" viewBox="0 0 24 24">
        <path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z" />
      </symbol>
      <symbol id="i-italic" viewBox="0 0 24 24">
        <path d="M19 4h-9M14 20H5M15 4 9 20" />
      </symbol>
      <symbol id="i-code" viewBox="0 0 24 24">
        <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
      </symbol>
      <symbol id="i-link" viewBox="0 0 24 24">
        <path
          d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        />
      </symbol>
      <symbol id="i-listul" viewBox="0 0 24 24">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </symbol>
      <symbol id="i-listol" viewBox="0 0 24 24">
        <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
      </symbol>
      <symbol id="i-maximize" viewBox="0 0 24 24">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </symbol>
      <symbol id="i-minimize" viewBox="0 0 24 24">
        <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
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
      <!-- preview-modal actions (ADR 0053 / preview-modal-actions) -->
      <symbol id="i-save" viewBox="0 0 24 24">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M17 21v-8H7v8M7 3v5h8" />
      </symbol>
      <symbol id="i-download" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5M12 15V3" />
      </symbol>
      <symbol id="i-globe" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c2.5 2.5 3.7 6 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-6-3.7-9s1.2-6.5 3.7-9z" />
      </symbol>
      <symbol id="i-palette" viewBox="0 0 24 24">
        <path d="M12 3s6 5.5 6 10a6 6 0 0 1-12 0c0-4.5 6-10 6-10z" />
      </symbol>
      <symbol id="i-move" viewBox="0 0 24 24">
        <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
      </symbol>
      <symbol id="i-forward" viewBox="0 0 24 24">
        <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
      </symbol>
      <symbol id="i-dots" viewBox="0 0 24 24">
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </symbol>
      <symbol id="i-minus" viewBox="0 0 24 24">
        <path d="M5 12h14" />
      </symbol>
      <symbol id="i-maximize" viewBox="0 0 24 24">
        <path
          d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"
        />
      </symbol>
      <symbol id="i-minimize" viewBox="0 0 24 24">
        <path
          d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"
        />
      </symbol>
      <!-- Response-style glyphs (SessionComposer style picker) — lucide outlines. -->
      <symbol id="i-text" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h14" /></symbol>
      <symbol id="i-zap" viewBox="0 0 24 24">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </symbol>
      <symbol id="i-help" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </symbol>
      <symbol id="i-sparkles" viewBox="0 0 24 24">
        <path
          d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"
        />
        <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
      </symbol>
      <symbol id="i-flag" viewBox="0 0 24 24">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" x2="4" y1="22" y2="15" />
      </symbol>
      <symbol id="i-smile" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" x2="9.01" y1="9" y2="9" />
        <line x1="15" x2="15.01" y1="9" y2="9" />
      </symbol>
      <symbol id="i-message" viewBox="0 0 24 24">
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </symbol>
      <symbol id="i-bulb" viewBox="0 0 24 24">
        <path
          d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"
        />
        <path d="M9 18h6M10 22h4" />
      </symbol>
      <symbol id="i-layers" viewBox="0 0 24 24">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </symbol>
      <!-- info (lucide) — response-style description popover trigger. Dot is a
           filled circle (not a round-cap `h.01`) so the "i" reads crisply at 14px. -->
      <symbol id="i-info" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="12" x2="12" y2="16" />
        <circle cx="12" cy="8" r=".85" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24">
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </symbol>
      <symbol id="i-terminal" viewBox="0 0 24 24">
        <path d="m4 17 6-6-6-6" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </symbol>
    </defs>
  </svg>
</template>

<script setup lang="ts">
// Static markup only — no logic.
</script>
