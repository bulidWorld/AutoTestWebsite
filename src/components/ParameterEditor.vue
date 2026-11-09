<script setup lang="ts">
import { useId } from 'vue'
// Keep the component instance suffix unique, including recursive and repeated components.
const divId = useId()

import { ref } from 'vue'
import { parseValue, type Draft, type ParameterDraft, type ValueType } from '../task-editor'
const props = defineProps<{ parameter: ParameterDraft; draft: Draft }>()
const emit = defineEmits<{ confirm: [p: ParameterDraft]; cancel: [] }>()
const types: ValueType[] = ['string', 'integer', 'number', 'boolean', 'object', 'array']
const message = ref('')
function confirm() {
  const p = { ...props.parameter, name: props.parameter.name.trim() }
  message.value = ''
  if (!p.name) { message.value = '请输入参数名称。'; return }
  if (props.draft.parameters.some(v => v.key !== p.key && v.name === p.name)) { message.value = '参数名称必须唯一。'; return }
  if (p.source_type === 'rest') {
    if (!props.draft.steps.some(s => s.key === p.step_key && (!s.step_type || s.step_type === 'rest'))) { message.value = '请选择来源接口步骤。'; return }
    if (!p.extract_expression || !/^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d+\]))*$/.test(p.extract_expression)) { message.value = '请输入有效的取值表达式，例如 data.items[0].id。'; return }
  } else if (p.source_type === 'expression') {
    if (!props.draft.steps.some(s => s.key === p.step_key && s.step_type === 'compute')) { message.value = '请选择来源计算节点。'; return }
  } else if (p.source_type === 'function') {
    p.value_type = 'string'; p.text = 'generateUUID()'
  } else {
    const retain = p.retained?.source_type === 'fixed' && p.retained.redacted && p.retained.sensitive && p.sensitive && p.retained.name === p.name && p.retained.value_type === p.value_type && !p.text
    if (!retain) try { parseValue(p.text, p.value_type) } catch (e) { message.value = (e as Error).message; return }
  }
  emit('confirm', p)
}
</script>
<template>
  <form @submit.prevent="confirm">
    <div :id="'parameter-editor-alert-' + divId" v-if="message" class="alert" role="alert">{{ message }}</div>
    <label>名称<input v-model="parameter.name" required maxlength="120" placeholder="parameter_name" autofocus></label>
    <label>类型<select v-model="parameter.value_type" :disabled="parameter.source_type === 'function'"><option v-for="t in types" :key="t">{{ t }}</option></select></label>
    <label>来源<select v-model="parameter.source_type" @change="parameter.source_type === 'function' && (parameter.value_type = 'string')"><option value="fixed">固定值</option><option value="rest">接口响应</option><option value="expression">计算表达式</option><option value="function">UUID 函数</option></select></label>
    <template v-if="parameter.source_type === 'rest'">
      <label>绑定接口步骤<select v-model="parameter.step_key"><option :value="undefined">选择接口步骤</option><option v-for="(s,i) in draft.steps.filter(s => (!s.step_type || s.step_type === 'rest'))" :key="s.key" :value="s.key">{{ s.execution_scope === 'finally' ? 'FINALLY' : 'MAIN' }} · {{ i+1 }}. {{ s.method }} {{ s.path }}</option></select></label>
      <label>取值表达式<input v-model="parameter.extract_expression" required placeholder="data.items[0].id"></label>
      <p>可绑定尚未保存的步骤，参数模型随任务一起保存。</p>
    </template>
    <template v-else-if="parameter.source_type === 'expression'">
      <label>来源计算节点<select v-model="parameter.step_key" required><option :value="undefined">选择计算节点</option><option v-for="s in draft.steps.filter(s => s.step_type === 'compute')" :key="s.key" :value="s.key">{{ s.execution_scope === 'finally' ? 'FINALLY' : 'MAIN' }} · {{ s.position }} · {{ s.id ? 'ID '+s.id : '新节点' }}</option></select></label>
      <p>在对应计算节点中配置同名输出表达式，任务运行时计算并赋值。</p>
    </template>
    <p v-else-if="parameter.source_type === 'function'">generateUUID()：每次任务初始化时生成一次 UUID，多个步骤共享结果。</p>
    <label v-else>固定值<input v-if="parameter.sensitive" v-model="parameter.text" type="password" autocomplete="new-password" :placeholder="parameter.retained?.redacted ? '留空保留已有值' : '输入固定值'"><textarea v-else v-model="parameter.text" rows="3" :placeholder="parameter.value_type === 'string' ? '输入字符串，可为空' : '输入 JSON 值'"></textarea></label>
    <label class="check"><input v-model="parameter.sensitive" type="checkbox">敏感</label>
    <div :id="'parameter-editor-dialog-actions-' + divId" class="dialog-actions"><button type="button" @click="emit('cancel')">取消</button><button class="primary">确认</button></div>
  </form>
</template>
