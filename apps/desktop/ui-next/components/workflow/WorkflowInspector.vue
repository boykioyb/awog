<template>
  <div class="insp">
    <div class="th">
      <Icon name="workflows" />
      <span class="tt">{{ t('workflow.inspector.node') }}</span>
    </div>
    <div style="font-size: 1.1538rem; font-weight: 650; margin-bottom: 3px">{{ node.name }}</div>
    <div class="mono" style="font-size: 0.8462rem; color: var(--textDim); margin-bottom: 16px">
      {{ t('workflow.inspector.dependsOn', { dep: node.dep }) }}
    </div>
    <div class="sech">{{ t('workflow.inspector.agent') }}</div>
    <div class="chip" style="margin-bottom: 8px">{{ node.name }}</div>
    <div class="sech">{{ t('workflow.inspector.model') }}</div>
    <div class="chip" style="margin-bottom: 8px">
      {{ t('workflow.inspector.modelValue', { model: node.model }) }}
    </div>
    <div class="sech">{{ t('workflow.inspector.skill') }}</div>
    <div class="chip acc" style="margin-bottom: 8px">{{ node.skill }}</div>
    <div class="sech">{{ t('workflow.inspector.prompt') }}</div>
    <div class="codeblk" style="font-size: 0.8462rem">{{ node.prompt }}</div>
  </div>
</template>

<script setup lang="ts">
// Right inspector for the selected workflow node — ported from renderInsp() in
// awog-prototype.html (data-page="workflows"). Static mock; no IPC.
import type { WorkflowNodeData } from './WorkflowCanvas.vue'

defineProps<{ node: WorkflowNodeData }>()

const { t } = useI18n()
</script>
