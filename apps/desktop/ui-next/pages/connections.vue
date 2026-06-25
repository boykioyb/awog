<template>
  <section class="page on" data-page="connections">
    <LibraryView
      :items="connections"
      :item-key="(c) => c.name"
      :search-text="(c) => c.name + c.cmd"
      :placeholder="t('connections.search')"
      show-new
    >
      <template #row="{ item }">
        <div class="lrow">
          <span
            class="sdot"
            :style="{ background: item.status === 'running' ? 'var(--green)' : 'var(--textFaint)' }"
          />
          <span class="ttl">{{ item.name }}</span>
          <span class="tag" style="padding: 1px 6px">{{ item.transport }}</span>
        </div>
        <div class="sub">
          {{ t('connections.toolsStatus', { n: item.tools, status: item.status }) }}
        </div>
      </template>

      <template #detail="{ item }">
        <div class="dh">
          <div class="dt">{{ item.name }}</div>
          <span class="tag">{{ item.transport }}</span>
          <span style="flex: 1" />
          <span class="chip">
            <span
              style="width: 6px; height: 6px; border-radius: 50%; display: inline-block"
              :style="{
                background: item.status === 'running' ? 'var(--green)' : 'var(--textFaint)',
              }"
            />
            {{ item.status }}
          </span>
          <span
            class="tog2"
            :class="{ off: !item.enabled }"
            :title="t('connections.enableToggle')"
            @click="item.enabled = !item.enabled"
          />
        </div>
        <div class="dscroll">
          <div class="sech">{{ t('connections.sech.command') }}</div>
          <div class="codeblk" style="font-size: 0.9231rem">{{ item.cmd }}</div>
          <div class="sech">{{ t('connections.sech.tools') }}</div>
          <span class="chip">{{ t('connections.tools', { n: item.tools }) }}</span>
          <div class="sech">{{ t('connections.sech.whitelist') }}</div>
          <span class="chip">{{ item.wl }}</span>
          <div class="sech">{{ t('connections.sech.secret') }}</div>
          <div class="fd">
            {{ t('connections.secretNoteBefore') }}
            <span class="mono">secret:KEY</span>
            {{ t('connections.secretNoteAfter') }}
          </div>
          <div style="margin-top: 16px">
            <button class="btn sm" style="color: var(--danger)">
              <Icon name="trash" />
              {{ t('connections.delete') }}
            </button>
          </div>
        </div>
      </template>
    </LibraryView>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// Connections (MCP) — visual port of mountLib('connections', …) from
// awog-prototype.html. Static mock; the enable toggle flips a local field.
const { t } = useI18n()

type Connection = {
  name: string
  transport: 'stdio' | 'http'
  cmd: string
  tools: number
  status: 'running' | 'idle'
  enabled: boolean
  wl: string
}

const connections = ref<Connection[]>([
  {
    name: 'github',
    transport: 'stdio',
    cmd: 'npx @modelcontextprotocol/server-github',
    tools: 14,
    status: 'running',
    enabled: true,
    wl: 'all agents',
  },
  {
    name: 'filesystem',
    transport: 'stdio',
    cmd: 'secret:FS_ROOT',
    tools: 9,
    status: 'running',
    enabled: true,
    wl: 'all agents',
  },
  {
    name: 'linear',
    transport: 'http',
    cmd: 'https://mcp.linear.app/sse · header secret:LINEAR_KEY',
    tools: 6,
    status: 'idle',
    enabled: true,
    wl: 'tech-lead, product-owner',
  },
  {
    name: 'notion',
    transport: 'http',
    cmd: 'https://mcp.notion.com',
    tools: 5,
    status: 'idle',
    enabled: false,
    wl: 'tech-lead',
  },
])
</script>
