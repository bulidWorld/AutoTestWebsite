<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ schema: Record<string, any>; label?: string; required?: boolean }>()
const children = computed(() => Object.entries(props.schema.properties || {}) as [string, Record<string, any>][])
const format = (value: unknown) => JSON.stringify(value)
</script>
<template>
  <div class="schema-node">
    <div><strong>{{ label || '根结构' }}</strong> <code>{{ schema.type || (schema.$ref ? schema.$ref : '未指定类型') }}</code> <span v-if="required" class="required">必填</span><span v-if="schema.nullable"> · 可空</span></div>
    <p v-if="schema.description">{{ schema.description }}</p>
    <small v-if="schema.default !== undefined">默认值：{{ format(schema.default) }} </small>
    <small v-if="schema.example !== undefined">示例：{{ format(schema.example) }} </small>
    <small v-if="schema.enum">枚举：{{ format(schema.enum) }}</small>
    <SchemaTree v-for="[name, child] in children" :key="name" :schema="child" :label="name" :required="schema.required?.includes(name)" />
    <SchemaTree v-if="schema.items" :schema="schema.items" label="数组元素" />
    <SchemaTree v-if="schema.additionalProperties && typeof schema.additionalProperties === 'object'" :schema="schema.additionalProperties" label="附加字段" />
    <details><summary>完整 Schema</summary><pre>{{ JSON.stringify(schema, null, 2) }}</pre></details>
  </div>
</template>
