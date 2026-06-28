<template>
  <div class="sb-usage">
    <StatusUsageRing v-for="a in rlAccounts" :key="a.id" :account="a" />
  </div>
</template>

<script setup lang="ts">
// Plan-usage donuts for the status bar: one ring per account that reports a usage
// surface (Anthropic / OpenAI). Each ring + its tooltip live in StatusUsageRing;
// this only picks which accounts get one. Accounts without data self-hide there.
import { computed } from 'vue'
import { useAccounts } from '~/composables/useAccounts'

const { accounts } = useAccounts()
const rlAccounts = computed(() =>
  accounts.value.filter((a) => a.provider === 'Anthropic' || a.provider === 'OpenAI'),
)
</script>

<style scoped>
.sb-usage {
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
