<template>
  <section class="page on" data-page="hooks">
    <LibraryView
      :items="hooks"
      :item-key="(h) => h.name"
      :search-text="(h) => h.name + h.desc"
      :placeholder="t('hooks.search')"
      show-new
    >
      <template #row="{ item }">
        <div class="lrow">
          <span
            class="sdot"
            :style="{ background: item.enabled ? 'var(--accent)' : 'var(--textFaint)' }"
          />
          <span class="ttl mono" style="font-size: 0.9231rem">{{ item.event }}</span>
        </div>
        <div class="sub">{{ item.desc }}</div>
      </template>

      <template #detail="{ item }">
        <div class="dh">
          <div class="dt mono" style="font-size: 1rem">{{ item.event }}</div>
          <span style="flex: 1" />
          <span class="tag" :class="{ acc: item.tier === 'project' }">{{ item.tier }}</span>
          <span
            class="tog2"
            :class="{ off: !item.enabled }"
            :title="t('hooks.enableToggle')"
            @click="item.enabled = !item.enabled"
          />
        </div>
        <div class="dscroll">
          <div class="sech">{{ t('hooks.sech.desc') }}</div>
          <p style="font-size: 1rem; color: var(--textMuted); margin: 0">{{ item.desc }}</p>
          <div class="sech">{{ t('hooks.sech.command') }}</div>
          <div class="codeblk">{{ item.cmd }}</div>
          <div style="margin-top: 16px">
            <button class="btn sm" style="color: var(--danger)">
              <Icon name="trash" />
              {{ t('hooks.delete') }}
            </button>
          </div>
        </div>
      </template>
    </LibraryView>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// Hooks — visual port of mountLib('hooks', …) from awog-prototype.html. Each hook
// pairs an event-filter anchor with a tier badge, enable toggle, and command.
// Static mock.
const { t } = useI18n()

type Hook = {
  name: string
  event: string
  desc: string
  tier: 'global' | 'project'
  enabled: boolean
  cmd: string
}

const hooks = ref<Hook[]>([
  {
    name: 'h1',
    event: 'tool.after-call → format',
    desc: 'Sau Edit/Write .vue → prettier --write',
    tier: 'project',
    enabled: true,
    cmd: 'prettier --write $FILE',
  },
  {
    name: 'h2',
    event: 'task.after-complete → notify',
    desc: 'Task xong → native notification',
    tier: 'global',
    enabled: true,
    cmd: 'notify "Task done"',
  },
  {
    name: 'h3',
    event: 'phase.after-approve → commit',
    desc: 'Auto git-commit per phase trong Tasks',
    tier: 'project',
    enabled: true,
    cmd: 'git commit -m "$PHASE"',
  },
  {
    name: 'h4',
    event: 'artifact.on-create → log',
    desc: 'Ghi log khi tạo artifact',
    tier: 'global',
    enabled: false,
    cmd: 'echo "$ARTIFACT" >> .awog/log',
  },
])
</script>
