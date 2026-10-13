<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  layers: 'm12 3 10 5-10 5L2 8 12 3z M2 12l10 5 10-5 M2 16l10 5 10-5',
  workflow: 'M4 3h6v6H4z M14 15h6v6h-6z M7 9v6h10 M17 15V9h-3',
  plus: 'M12 5v14 M5 12h14', search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 1l1 5 M4 12l1 5a8 8 0 0 0 13 1',
  arrow: 'M19 12H5 M11 6l-6 6 6 6', chevron: 'm9 5 7 7-7 7',
  play: 'm8 4 12 8-12 8V4z', file: 'M14 2H5v20h14V7l-5-5z M14 2v6h5 M8 12h8 M8 16h6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  code: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
  lock: 'M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
  copy: 'M8 8h13v13H8z M16 8V3H3v13h5', trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  up: 'm6 14 6-6 6 6', down: 'm6 10 6 6 6-6', close: 'm6 6 12 12 M18 6 6 18',
  check: 'm5 12 4 4L19 6', more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  folder: 'M3 5h7l2 3h9v12H3V5z', info: 'M12 11v6 M12 7h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  edit: 'm15 5 4 4 M4 20l4-1L20 7l-3-3L5 16l-1 4z',
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ui-icon"><path :d="paths[name] || paths.grid" /></svg></template>
