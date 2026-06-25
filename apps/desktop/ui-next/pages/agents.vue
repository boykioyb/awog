<template>
  <section class="page on" data-page="agents">
    <LibraryView
      :items="AGENTS"
      :item-key="(a) => a.name"
      :search-text="(a) => a.name + a.model"
      :placeholder="t('agents.search')"
      show-new
    >
      <template #row="{ item: a }">
        <div class="lrow">
          <span class="lav" :style="{ background: a.c, color: a.cf }">{{ a.ini }}</span>
          <span class="ttl">{{ a.name }}</span>
        </div>
        <div class="sub" style="margin-left: 30px">{{ a.model }} · {{ a.prov }}</div>
      </template>

      <template #detail="{ item: a }">
        <div class="dh">
          <span
            class="lav"
            :style="{
              background: a.c,
              color: a.cf,
              width: '26px',
              height: '26px',
              marginRight: '8px',
            }"
          >
            {{ a.ini }}
          </span>
          <div class="dt">{{ a.name }}</div>
          <span style="flex: 1" />
          <span class="chip">{{ a.model }}</span>
          <button
            class="iconbtn"
            style="width: 28px; height: 28px"
            :title="t('agents.editAgentMd')"
          >
            <Icon name="edit" style="width: 14px; height: 14px" />
          </button>
        </div>
        <div class="dscroll">
          <div class="sech">{{ t('agents.providerModel') }}</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <span class="chip">{{ a.prov }}</span>
            <span class="chip">{{ a.model }}</span>
            <span class="chip">{{ t('agents.temp', { temp: a.temp }) }}</span>
          </div>
          <div class="sech">{{ t('agents.systemPrompt') }}</div>
          <div class="codeblk">{{ a.prompt }}</div>
          <div class="sech">{{ t('agents.toolsWhitelist') }}</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <span
              v-for="(tool, i) in a.tools"
              :key="i"
              class="chip"
              :class="{ mono: tool.startsWith('mcp') }"
              :style="
                tool.startsWith('mcp')
                  ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' }
                  : undefined
              "
            >
              {{ tool.startsWith('mcp') ? `${tool}__*` : tool }}
            </span>
          </div>
          <div style="margin-top: 16px">
            <button class="btn sm" style="color: var(--danger)">
              <Icon name="trash" />
              {{ t('agents.delete') }}
            </button>
          </div>
        </div>
      </template>
    </LibraryView>
  </section>
</template>

<script setup lang="ts">
// Agents library — faithful port of awog-prototype.html (data-page="agents").
// Floating-card rows with color/initials avatar (AGCOL), provider/model chips,
// system-prompt block + tools whitelist (mcp__* chips accent-styled). Static mock;
// shell from <LibraryView>. Visual only.

const { t } = useI18n()

type AgentItem = {
  name: string
  ini: string
  c: string
  cf: string
  model: string
  prov: string
  temp: string
  prompt: string
  tools: string[]
}

const AGENTS: AgentItem[] = [
  {
    name: 'tech-lead',
    ini: 'TL',
    c: 'rgba(167,139,250,.15)',
    cf: '#c4b5fd',
    model: 'Opus 4.8',
    prov: 'Anthropic',
    temp: '0.3',
    prompt:
      'Bạn là Tech Lead của AWOG. Quyết định kiến trúc, viết ADR (Context/Decision/Consequences), thiết kế ranh giới module qua UI/sidecar/storage. Output là ADR/design note, KHÔNG phải code.',
    tools: ['Read', 'Grep', 'Glob', 'Write', 'mcp__github'],
  },
  {
    name: 'developer',
    ini: 'DV',
    c: 'rgba(16,185,129,.15)',
    cf: '#6ee7b7',
    model: 'Opus 4.8',
    prov: 'Anthropic',
    temp: '0.2',
    prompt:
      'Bạn là Developer. Implement một task end-to-end theo coding-guide, chạy lint+typecheck trước khi báo xong.',
    tools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
  },
  {
    name: 'infosec',
    ini: 'IS',
    c: 'rgba(239,68,68,.13)',
    cf: '#fca5a5',
    model: 'Sonnet 4.6',
    prov: 'Anthropic',
    temp: '0.1',
    prompt:
      'Bạn là Infosec. Audit theo 21-rule + 8 invariant AWOG. Read-only; xuất finding report (severity / file:line / fix).',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
  },
  {
    name: 'product-owner',
    ini: 'PO',
    c: 'rgba(96,165,250,.15)',
    cf: '#93c5fd',
    model: 'Opus 4.8',
    prov: 'Anthropic',
    temp: '0.4',
    prompt:
      'Bạn là Product Owner. Đánh giá feature idea vs VISION, ưu tiên roadmap, viết feature brief.',
    tools: ['Read', 'Grep', 'Glob'],
  },
  {
    name: 'qa-tester',
    ini: 'QA',
    c: 'rgba(245,158,11,.15)',
    cf: '#fcd34d',
    model: 'Sonnet 4.6',
    prov: 'Anthropic',
    temp: '0.2',
    prompt: 'Bạn là QA. Viết test case (manual+auto), verify AC, surface edge case + regression.',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write'],
  },
]
</script>
