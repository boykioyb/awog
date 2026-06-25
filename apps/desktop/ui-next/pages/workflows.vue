<template>
  <section class="page on" data-page="workflows">
    <div class="md">
      <WorkflowCanvas
        :nodes="NODES"
        :selected="selected"
        @select="selected = $event"
        @run="onRun"
      />
      <WorkflowInspector v-if="selectedNode" :node="selectedNode" />
    </div>
  </section>
</template>

<script setup lang="ts">
// Workflows — visual port from awog-prototype.html (data-page="workflows").
// Dotted canvas with 5 hand-placed agent nodes + SVG edges + selection-driven
// inspector. Static mock from the WF state; no Pinia/IPC. Run button is a toast stub.
import type { WorkflowNodeData } from '~/components/workflow/WorkflowCanvas.vue'

// Ported from WF.nodes + the .wnode markup (positions/badges) in the prototype.
const NODES: WorkflowNodeData[] = [
  {
    id: 'po',
    name: 'product-owner',
    badge: 'PO',
    badgeBg: 'rgba(96,165,250,.15)',
    badgeColor: '#93c5fd',
    meta: 'Opus 4.8 · brief',
    model: 'Opus 4.8',
    skill: 'write-feature-brief',
    dep: '—',
    prompt: 'Đánh giá feature idea vs VISION, viết feature brief.',
    left: '20px',
    top: '104px',
    hasOut: true,
  },
  {
    id: 'tl',
    name: 'tech-lead',
    badge: 'TL',
    badgeBg: 'rgba(167,139,250,.15)',
    badgeColor: '#c4b5fd',
    meta: 'Opus 4.8 · write-adr',
    model: 'Opus 4.8',
    skill: 'write-adr',
    dep: 'product-owner',
    prompt:
      'Quyết định kiến trúc, viết ADR (Context / Decision / Consequences). Output docs/decisions/00NN-*.md',
    left: '270px',
    top: '104px',
    hasOut: true,
  },
  {
    id: 'dv',
    name: 'developer',
    badge: 'DV',
    badgeBg: 'rgba(16,185,129,.15)',
    badgeColor: '#6ee7b7',
    meta: 'Opus 4.8 · implement',
    model: 'Opus 4.8',
    skill: 'implement-feature',
    dep: 'tech-lead',
    prompt: 'Implement theo ADR, chạy lint + typecheck.',
    left: '520px',
    top: '74px',
    hasOut: true,
  },
  {
    id: 'is',
    name: 'infosec',
    badge: 'IS',
    badgeBg: 'rgba(239,68,68,.13)',
    badgeColor: '#fca5a5',
    meta: 'Sonnet 4.6 · audit',
    model: 'Sonnet 4.6',
    skill: 'security-audit',
    dep: 'tech-lead',
    prompt: 'Audit 21-rule + 8 invariant AWOG, xuất findings.',
    left: '520px',
    top: '164px',
    hasOut: true,
  },
  {
    id: 'qa',
    name: 'qa-tester',
    badge: 'QA',
    badgeBg: 'rgba(245,158,11,.15)',
    badgeColor: '#fcd34d',
    meta: 'Sonnet 4.6 · verify',
    model: 'Sonnet 4.6',
    skill: 'write-test-cases',
    dep: 'developer, infosec',
    prompt: 'Verify AC + edge case + regression.',
    left: '770px',
    top: '124px',
    hasOut: false,
  },
]

const selected = ref('tl')
const selectedNode = computed(() => NODES.find((n) => n.id === selected.value))

function onRun() {
  // Prototype showed a toast: "Đã chạy workflow → tạo Task mới". Toast wiring
  // arrives with the live feature port; no-op stub for the visual port.
}
</script>
