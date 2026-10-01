<script setup lang="ts">
import type { ScoreResponse } from '#shared/types/interview'

withDefaults(defineProps<{ result: ScoreResponse; showModel?: boolean; missingLabel?: string }>(), {
  showModel: true,
  missingLabel: 'Missing',
})
</script>

<template>
  <div class="space-y-3 rounded-md border border-neutral-800 bg-neutral-900/50 p-4">
    <p class="text-lg font-semibold" :class="scoreColor(result.score)">{{ result.score }} / 5</p>
    <p>{{ result.feedback }}</p>
    <div v-if="result.missing.length">
      <p class="label mb-1">{{ missingLabel }}</p>
      <ul class="list-disc space-y-1 pl-5 text-neutral-300">
        <li v-for="m in result.missing" :key="m">{{ m }}</li>
      </ul>
    </div>
    <div v-if="showModel && result.modelAnswer">
      <p class="label mb-1">A strong answer</p>
      <p class="text-neutral-300">{{ result.modelAnswer }}</p>
    </div>
  </div>
</template>
