<script setup lang="ts">
import { computed } from 'vue'
import type { Draft, StepDraft } from '../task-editor'
const props = defineProps<{ step: StepDraft; draft: Draft }>()
defineEmits<{ addParameter: [] }>()
const outputs = computed(() => props.draft.parameters.filter(p => p.source_type === 'expression' && p.step_key === props.step.key))
function addExpression() {
  props.step.options ||= {}
  props.step.options.expressions ||= []
  props.step.options.expressions.push({ name: '', expression: '' })
}
</script>
<template>
  <section class="node-settings" aria-label="计算节点配置">
    <h3>计算表达式</h3>
    <label>时区<input v-model="step.options!.timezone" placeholder="Asia/Shanghai"><small>使用 IANA 时区；HTTP-date 固定输出 GMT。</small></label>
    <p>先声明来源为本节点的全局参数，再为每个参数配置同名输出。</p>
    <button type="button" @click="$emit('addParameter')">添加输出全局参数</button>
    <div v-for="(entry,index) in step.options!.expressions" :key="index" class="expression-entry">
      <label>输出参数<select v-model="entry.name"><option value="">选择输出参数</option><option v-if="entry.name && !outputs.some(p => p.name === entry.name)" :value="entry.name">{{ entry.name }}（未绑定到本节点）</option><option v-for="p in outputs" :key="p.key" :value="p.name">{{ p.name }} · {{ p.value_type }}</option></select></label>
      <label>表达式<textarea v-model="entry.expression" rows="3" maxlength="2000" spellcheck="false" placeholder='concat("order-", str(param("order_id")))'></textarea></label>
      <button type="button" class="danger" @click="step.options!.expressions!.splice(index,1)">移除表达式 {{ index+1 }}</button>
    </div>
    <button type="button" @click="addExpression">添加表达式</button>
    <small>concat("order-", str(param("order_id"))) 拼接字符串；日期示例：http_date(add_seconds(now(), 3600))。支持数值四则运算；同节点输出不可互相引用，全部计算成功后统一赋值。保存时不求值。</small>
  </section>
</template>
<style scoped>
.expression-entry { display: grid; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--border); }
textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
