<template>
  <!-- Collection page header — khuôn Multica: icon tile + title (kèm count)
       + tagline muted bên phải + actions slot (nút New primary). -->
  <header class="clh">
    <span class="clh-icon">
      <Icon :name="icon" class="size-4" />
    </span>
    <div class="clh-text">
      <span class="clh-title">
        {{ title }}
        <span v-if="count != null" class="clh-count">{{ count }}</span>
      </span>
      <span v-if="tagline" class="clh-tag">{{ tagline }}</span>
    </div>
    <span class="clh-flex" />
    <slot />
  </header>
</template>

<script setup lang="ts">
import Icon from '~/components/Icon.vue'

defineProps<{
  icon: string
  title: string
  tagline?: string
  count?: number
}>()
</script>

<style scoped>
.clh {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  height: 56px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--border);
}
.clh-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--muted);
  color: var(--muted-foreground);
  flex: 0 0 auto;
}
.clh-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.clh-title {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--foreground);
  letter-spacing: -0.01em;
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
}
.clh-count {
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--muted-foreground);
  background: var(--muted);
  border-radius: var(--r-pill);
  padding: 1px 7px;
}
.clh-tag {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clh-flex {
  flex: 1;
}
</style>
