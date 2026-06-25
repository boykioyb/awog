<template>
  <section class="page on" data-page="commands">
    <LibraryView
      :items="commands"
      :item-key="(c) => c.name"
      :search-text="(c) => c.name + c.desc"
      :placeholder="t('commands.search')"
      show-new
    >
      <template #row="{ item }">
        <div class="lrow">
          <span class="ttl mono">{{ item.name }}</span>
          <span class="tag" :class="{ acc: item.tier === 'project' }" style="padding: 1px 6px">
            {{ item.tier }}
          </span>
        </div>
        <div class="sub">{{ item.desc }}</div>
      </template>

      <template #detail="{ item }">
        <div class="dh">
          <div class="dt mono">{{ item.name }}</div>
          <span style="flex: 1" />
          <span class="tag" :class="{ acc: item.tier === 'project' }">{{ item.tier }}</span>
        </div>
        <div class="dscroll">
          <div class="sech">{{ t('commands.sech.desc') }}</div>
          <p style="font-size: 1rem; color: var(--textMuted); margin: 0">{{ item.desc }}</p>
          <div class="sech">{{ t('commands.sech.template') }}</div>
          <div class="codeblk">{{ item.body }}</div>
          <div style="margin-top: 16px">
            <button class="btn sm" style="color: var(--danger)">
              <Icon name="trash" />
              {{ t('commands.delete') }}
            </button>
          </div>
        </div>
      </template>
    </LibraryView>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// Commands — visual port of mountLib('commands', …) from awog-prototype.html.
// Slash-name prompt templates with a global/project tier badge. Static mock.
const { t } = useI18n()

type Command = {
  name: string
  desc: string
  tier: 'global' | 'project'
  body: string
}

const commands = ref<Command[]>([
  {
    name: '/compact',
    desc: 'Nén ngữ cảnh để tiết kiệm token',
    tier: 'global',
    body: 'Tóm tắt hội thoại, giữ 8 lượt gần nhất.',
  },
  {
    name: '/review',
    desc: 'Review diff hiện tại',
    tier: 'global',
    body: 'Review the current diff for correctness + cleanup.',
  },
  {
    name: '/commit',
    desc: 'Tạo commit theo convention · $ARGUMENTS',
    tier: 'project',
    body: 'Create a well-structured git commit. Args: $ARGUMENTS',
  },
  {
    name: '/design-ui-ux',
    desc: 'Gọi skill thiết kế UI/UX',
    tier: 'project',
    body: 'Invoke design-ui-ux skill cho trang/component.',
  },
  {
    name: '/security-review',
    desc: 'Audit bảo mật branch',
    tier: 'global',
    body: 'Security review pending changes on branch.',
  },
])
</script>
