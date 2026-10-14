<script setup lang="ts">
import type { Draft, ParameterDraft } from '../task-editor'
import UiIcon from './UiIcon.vue'
defineProps<{ draft: Draft; canExtract: (p: ParameterDraft) => boolean; currentValue?: (p: ParameterDraft) => string | undefined; showRefresh?: boolean; busy?: boolean }>()
defineEmits<{ add: []; refresh: []; edit: [p: ParameterDraft]; remove: [p: ParameterDraft]; extract: [p: ParameterDraft] }>()
</script>
<template>
  <div class="parameter-config">
    <div class="surface-toolbar parameter-toolbar"><div><h2>全局参数 <span class="count">{{ draft.parameters.length }}</span></h2></div><div class="actions"><button v-if="showRefresh" type="button" class="text-button" :disabled="busy" @click="$emit('refresh')"><UiIcon name="refresh"/>刷新</button><button type="button" :disabled="busy" @click="$emit('add')"><UiIcon name="plus"/>添加参数</button></div></div>
    <div v-for="p in draft.parameters" :key="p.key" class="parameter-summary-row">
      <div class="parameter-summary-content"><strong>{{ p.name || '未命名' }}</strong><code>{{ p.value_type }}</code><span v-if="p.sensitive">敏感</span><p v-if="p.source_type === 'rest'">接口响应 · {{ draft.steps.find(s => s.key === p.step_key)?.path || '来源步骤已移除' }} · {{ p.extract_expression }}</p><p class="parameter-value">{{ currentValue ? currentValue(p) : (p.sensitive || p.retained?.redacted ? '••••••' : p.text || '空字符串') }}</p></div>
      <div class="actions"><button v-if="p.source_type === 'rest'" title="未获取当前响应时会单次运行来源接口；依赖的前序参数需先取值。" type="button" :disabled="!canExtract(p)" @click="$emit('extract',p)">单次参数取值</button><button type="button" :disabled="busy" @click="$emit('edit',p)">修改</button><button type="button" class="text-button danger" :disabled="busy" @click="$emit('remove',p)">移除</button></div>
    </div>
    <div v-if="!draft.parameters.length" class="parameter-empty">暂无参数，点击“添加参数”配置。</div>
  </div>
</template>
