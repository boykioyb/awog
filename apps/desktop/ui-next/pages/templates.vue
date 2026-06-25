<template>
  <section class="page on" data-page="templates">
    <div class="scroll">
      <div class="cards">
        <div v-for="tpl in TEMPLATES" :key="tpl.name" class="tcard">
          <span class="tx"><Icon :name="tpl.icon" /></span>
          <div class="tn">{{ tpl.name }}</div>
          <div class="tds">{{ tpl.desc }}</div>
          <div class="tg">
            <span v-for="(tag, i) in tpl.tags" :key="i" class="tag">{{ tag }}</span>
          </div>
        </div>
        <div class="tcard tcard-new">
          <span class="tx"><Icon name="plus" /></span>
          <div class="tn">{{ t('templates.new.title') }}</div>
          <div class="tds">{{ t('templates.new.desc') }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// Templates — faithful port of awog-prototype.html (data-page="templates").
// Static cards grid (.cards > .tcard): icon, name, desc, tags + a trailing
// new-template card. Not a library page. Visual only.
const { t } = useI18n()

type TemplateCard = {
  name: string
  icon: string
  desc: string
  tags: string[]
}

const TEMPLATES: TemplateCard[] = [
  {
    name: 'Full Delivery Guild',
    icon: 'templates',
    desc: 'PO → BA → PM → TL → dev → QA → reviewer',
    tags: ['7 agents', 'workflow'],
  },
  {
    name: 'Security Sweep',
    icon: 'shield',
    desc: 'infosec audit + code-reviewer red flags',
    tags: ['2 agents'],
  },
  {
    name: 'Quick Fix',
    icon: 'act',
    desc: 'developer-only, lint + typecheck',
    tags: ['1 agent'],
  },
  {
    name: 'Docs Refresh',
    icon: 'rules',
    desc: 'docs-sync sau implementation',
    tags: ['1 agent'],
  },
  {
    name: 'Research Report',
    icon: 'sessions',
    desc: 'deep-research fan-out + verify',
    tags: ['workflow'],
  },
]
</script>
