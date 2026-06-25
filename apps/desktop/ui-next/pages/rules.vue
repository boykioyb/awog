<template>
  <section class="page on" data-page="rules">
    <LibraryView
      :items="rules"
      :item-key="(r) => r.name"
      :search-text="(r) => r.name + r.desc"
      :placeholder="t('rules.search')"
      show-new
    >
      <template #row="{ item }">
        <div class="lrow">
          <span
            class="sdot"
            :style="{ background: item.enabled ? 'var(--accent)' : 'var(--textFaint)' }"
          />
          <span class="ttl">{{ item.name }}</span>
          <span class="tag" :class="{ acc: item.tier === 'project' }" style="padding: 1px 6px">
            {{ item.tier }}
          </span>
        </div>
        <div class="sub">{{ item.desc }}</div>
      </template>

      <template #detail="{ item }">
        <div class="dh">
          <div class="dt">{{ item.name }}</div>
          <span style="flex: 1" />
          <span class="fd" style="margin: 0">{{ t('rules.autoInject') }}</span>
          <span
            class="tog2"
            :class="{ off: !item.enabled }"
            :title="t('rules.enableToggle')"
            @click="item.enabled = !item.enabled"
          />
        </div>
        <div class="dscroll">
          <div class="sech">{{ t('rules.sech.body') }}</div>
          <div class="codeblk">{{ item.body }}</div>
          <div style="margin-top: 16px">
            <button class="btn sm" style="color: var(--danger)">
              <Icon name="trash" />
              {{ t('rules.delete') }}
            </button>
          </div>
        </div>
      </template>
    </LibraryView>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// Rules — visual port of mountLib('rules', …) from awog-prototype.html. Auto-inject
// instruction .md files with a tier badge + enable toggle. Static mock.
const { t } = useI18n()

type Rule = {
  name: string
  desc: string
  tier: 'global' | 'project'
  enabled: boolean
  body: string
}

const rules = ref<Rule[]>([
  {
    name: 'principles.md',
    desc: 'KISS / YAGNI / DRY / SRP',
    tier: 'project',
    enabled: true,
    body: 'Khi xung đột: KISS + YAGNI thắng DRY (chấp nhận trùng tạm).',
  },
  {
    name: 'typescript.md',
    desc: 'strict:true · cấm any',
    tier: 'project',
    enabled: true,
    body: 'strict luôn bật. Cấm any → dùng unknown rồi narrow.',
  },
  {
    name: 'security.md',
    desc: '8 invariant AWOG',
    tier: 'project',
    enabled: true,
    body: 'API key không rời sidecar; path sanitize; git scope = workspace.',
  },
  {
    name: 'nuxt-vue.md',
    desc: 'Component / store / theme',
    tier: 'project',
    enabled: false,
    body: '<script setup> luôn; defineProps type-only; theme qua useTheme().',
  },
])
</script>
