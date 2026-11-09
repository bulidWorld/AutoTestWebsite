<script setup lang="ts">
import { useId } from 'vue'
// Keep the component instance suffix unique, including recursive and repeated components.
const divId = useId()

import type { Draft, ParameterDraft } from '../task-editor'
import IconAction from './IconAction.vue'
defineProps<{ draft: Draft; canExtract: (p: ParameterDraft) => boolean; currentValue?: (p: ParameterDraft) => string | undefined; showRefresh?: boolean; busy?: boolean }>()
defineEmits<{ add: []; refresh: []; edit: [p: ParameterDraft]; remove: [p: ParameterDraft]; preview: [p: ParameterDraft]; extract: [p: ParameterDraft] }>()
</script>
<template>
  <div :id="'parameter-config-parameter-config-' + divId" class="parameter-config">
    <div :id="'parameter-config-surface-toolbar-' + divId" class="surface-toolbar parameter-toolbar"><div :id="'parameter-config-block-' + divId"><h2>全局参数 <span class="count">{{ draft.parameters.length }}</span></h2></div><div :id="'parameter-config-actions-' + divId" class="actions"><IconAction v-if="showRefresh" type="button" class="text-button" :disabled="busy" @click="$emit('refresh')" icon="refresh" label="刷新"/><IconAction type="button" :disabled="busy" @click="$emit('add')" icon="plus" label="添加参数"/></div></div>
    <p class="muted">REST 来源支持主流程和 finally 接口，计算参数来源为 compute 节点。流程预览仅适用于主流程 REST 参数，会执行必要前序节点并发送真实请求；保存草稿可声明由前序任务组批次继承的输入。</p>
    <div :id="'parameter-config-parameter-summary-row-' + divId + '-' + encodeURIComponent(String(p.key))" v-for="p in draft.parameters" :key="p.key" class="parameter-summary-row">
      <div :id="'parameter-config-parameter-summary-content-' + divId + '-' + encodeURIComponent(String(p.key))" class="parameter-summary-content"><strong>{{ p.name || '未命名' }}</strong><code>{{ p.value_type }}</code><span v-if="p.sensitive">敏感</span><p v-if="p.source_type === 'rest'">接口响应 · {{ draft.steps.find(s => s.key === p.step_key)?.path || '来源步骤已移除' }} · {{ p.extract_expression }}</p><p v-if="p.source_type === 'expression'">计算表达式 · {{ draft.steps.find(s => s.key === p.step_key)?.path || '来源节点已移除' }}</p><p v-if="p.source_type === 'function'">UUID 函数 · 任务初始化时生成</p><p class="parameter-value">{{ currentValue ? currentValue(p) : (p.sensitive || p.retained?.redacted ? '••••••' : p.text || '空字符串') }}</p></div>
      <div :id="'parameter-config-actions-2-' + divId + '-' + encodeURIComponent(String(p.key))" class="actions"><IconAction v-if="p.source_type === 'rest'" type="button" :disabled="busy" @click="$emit('preview',p)" icon="workflow" label="流程预览"/><IconAction v-if="p.source_type === 'rest'" type="button" :disabled="!canExtract(p)" @click="$emit('extract',p)" icon="play" label="单次参数取值"/><IconAction type="button" :disabled="busy" @click="$emit('edit',p)" icon="edit" label="修改"/><IconAction type="button" class="text-button danger" :disabled="busy" @click="$emit('remove',p)" icon="trash" label="移除"/></div>
    </div>
    <div :id="'parameter-config-parameter-empty-' + divId" v-if="!draft.parameters.length" class="parameter-empty">暂无参数，点击“添加参数”配置。</div>
  </div>
</template>
