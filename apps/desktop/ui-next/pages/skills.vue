<template>
  <section class="page on" data-page="skills">
    <LibraryView
      :items="SKILLS"
      :item-key="(s) => s.name"
      :search-text="(s) => s.name + s.desc"
      :placeholder="t('skills.search')"
      show-new
    >
      <template #row="{ item: s }">
        <div class="lrow">
          <span class="ttl">{{ s.name }}</span>
          <span class="tag" :class="{ acc: s.tier === 'project' }" style="padding: 1px 6px">
            {{ t('skills.tier.' + s.tier) }}
          </span>
        </div>
        <div class="sub">{{ s.desc }}</div>
      </template>

      <template #detail="{ item: s }">
        <div class="dh">
          <div class="dt">{{ s.name }}</div>
          <span class="tag" :class="{ acc: s.tier === 'project' }">
            {{ t('skills.tierBadge', { tier: t('skills.tier.' + s.tier) }) }}
          </span>
          <span style="flex: 1" />
          <button class="btn sm">{{ t('skills.preview') }}</button>
        </div>
        <div class="dscroll">
          <div class="sech">{{ t('skills.description') }}</div>
          <p style="font-size: 1rem; color: var(--textMuted); margin: 0">{{ s.desc }}</p>
          <div class="sech">{{ t('skills.skillMd') }}</div>
          <div class="codeblk">{{ s.body }}</div>
          <div style="margin-top: 16px">
            <button class="btn sm" style="color: var(--danger)">
              <Icon name="trash" />
              {{ t('skills.delete') }}
            </button>
          </div>
        </div>
      </template>
    </LibraryView>
  </section>
</template>

<script setup lang="ts">
// Skills library — faithful port of awog-prototype.html (data-page="skills").
// Tier badge (project=accent) + description + SKILL.md body block. Static mock;
// shell from <LibraryView>. Visual only.
const { t } = useI18n()

type SkillTier = 'project' | 'global'

type SkillItem = {
  name: string
  tier: SkillTier
  desc: string
  body: string
}

const SKILLS: SkillItem[] = [
  {
    name: 'design-ui-ux',
    tier: 'project',
    desc: 'UI/UX design intelligence cho AWOG',
    body: '# Skill: Design UI/UX (AWOG desktop)\n\nDesign intelligence — chọn style/màu/typography, dựng component, tự review.\n\n## Khi nào dùng\nBắt buộc khi task chạm bố cục, quyết định thị giác, pattern tương tác, chất lượng UX.',
  },
  {
    name: 'write-adr',
    tier: 'global',
    desc: 'Author Architecture Decision Record',
    body: '# write-adr\n\nAuthor an ADR with Context / Decision / Consequences.',
  },
  {
    name: 'security-audit',
    tier: 'global',
    desc: '21-rule vulnerability catalog',
    body: '# security-audit\n\nApply 21-rule catalog + AWOG invariants. Output findings.',
  },
  {
    name: 'implement-feature',
    tier: 'global',
    desc: 'Implement một dev task end-to-end',
    body: '# implement-feature\n\nRead spec/ADR → code theo coding-guide → lint + typecheck.',
  },
  {
    name: 'review-pr',
    tier: 'global',
    desc: 'Code review trên diff/PR',
    body: '# review-pr\n\nVerify architecture fit, AWOG invariants, security, perf.',
  },
]
</script>
