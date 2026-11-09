<script setup lang="ts">
import UiIcon from './UiIcon.vue'
withDefaults(defineProps<{ icon: string; label: string; type?: 'button' | 'submit' | 'reset' }>(), { type: 'button' })
</script>

<template>
  <button :type="type" class="icon-action" :aria-label="label" :title="label" :data-tooltip="label"><UiIcon :name="icon" :size="18"/></button>
</template>
