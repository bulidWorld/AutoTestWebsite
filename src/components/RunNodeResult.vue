<script setup lang="ts">
import { useId } from 'vue'
// Keep the component instance suffix unique, including recursive and repeated components.
const divId = useId()

import { computed } from 'vue'
import UiIcon from './UiIcon.vue'
import type { TaskModel } from '../task-editor'
const props = defineProps<{ node: TaskModel<'RunStep'>; snapshot?: TaskModel<'Step'>; busy: boolean }>()
defineEmits<{ request: [id: number]; edit: [stepId: number] }>()
const assertionLines = computed(() => (props.snapshot?.step_type === 'rest' ? props.snapshot.assertion_code ?? '' : '').split(/\r\n|\n|\r/))
const assertionErrorLine = computed(() => {
  const match = props.node.error_message?.match(/<assertion>\s*:\s*([1-9]\d*)\b/)
  const line = match ? Number(match[1]) : 0
  return line <= assertionLines.value.length ? line : 0
})
const labels: Record<string,string> = { pending: '待执行', running: '运行中', succeeded: '成功', failed: '失败', blocked: '前提不足', skipped: '已跳过' }
const ms = (value: number | null) => value === null ? '—' : `${value} ms`
</script>
<template>
  <article class="execution-step"><button type="button" class="execution-number" :class="node.status" :disabled="busy" :aria-label="'修改节点 ' + node.step_id" title="修改节点" @click="$emit('edit', node.step_id)"><span class="execution-position" aria-hidden="true">{{ node.position }}</span><UiIcon class="execution-edit-icon" name="edit" :size="14"/></button><div :id="'run-node-result-execution-step-body-' + divId" class="execution-step-body">
    <div :id="'run-node-result-section-top-' + divId" class="section-top"><strong>{{ node.execution_scope === 'finally' ? 'FINALLY 清理' : 'MAIN 主流程' }} · {{ node.step_type === 'parallel' ? '并行屏障' : node.step_type === 'wait' ? '固定等待' : node.step_type === 'sql' ? 'SQL 执行' : node.step_type === 'compute' ? '表达式计算' : snapshot?.step_type === 'rest' ? snapshot.method+' '+snapshot.path : 'REST' }}</strong><span class="status" :class="node.status">{{ labels[node.status] }}</span></div>
    <div :id="'run-node-result-execution-meta-' + divId" class="execution-meta"><span>节点 ID {{ node.step_id }}</span><span>{{ ms(node.duration_ms) }}</span><button v-if="node.step_type === 'rest' && node.request_id" class="text-button" :disabled="busy" @click="$emit('request',node.request_id)">请求 #{{ node.request_id }}</button></div>
    <p v-if="snapshot?.step_type === 'wait'">配置等待：{{ snapshot.wait_milliseconds }} ms</p>
    <details v-if="snapshot?.step_type === 'compute'"><summary>本次运行的计算配置</summary><p>时区：{{ snapshot.options?.timezone || 'Asia/Shanghai' }}</p><p v-for="entry in snapshot.options?.expressions" :key="entry.name"><code>{{ entry.name }} = {{ entry.expression }}</code></p></details>
    <p v-if="snapshot?.step_type === 'rest' && snapshot.options?.poll">轮询：最多 {{ snapshot.options.poll.max_attempts ?? 10 }} 次 · 间隔 {{ snapshot.options.poll.interval_milliseconds ?? 1000 }} ms · 超时 {{ snapshot.options.poll.timeout_seconds ?? 60 }} 秒</p>
    <template v-if="node.step_type === 'parallel'"><div :id="'run-node-result-parallel-stats-' + divId" class="parallel-stats"><span>REST 总数 {{ node.parallel_stats.rest_total }}</span><span>待执行 {{ node.parallel_stats.pending_count }}</span><span>运行中 {{ node.parallel_stats.running_count }}</span><span>成功 {{ node.parallel_stats.succeeded_count }}</span><span>失败 {{ node.parallel_stats.failed_count }}</span><span>跳过 {{ node.parallel_stats.skipped_count }}</span><span>请求 {{ node.parallel_stats.request_count }} / 完整响应 {{ node.parallel_stats.response_count }}</span><span>响应耗时总和 {{ ms(node.parallel_stats.response_time_sum_ms) }}</span><span>平均 {{ ms(node.parallel_stats.avg_response_time_ms) }}</span><span>最短 {{ ms(node.parallel_stats.min_response_time_ms) }} / 最长 {{ ms(node.parallel_stats.max_response_time_ms) }}</span></div><p v-if="node.failed_child_step_id">失败子节点 {{ node.failed_child_step_id }} · {{ node.child_error_code }}</p><small>不提供并行子请求的逐条响应详情。</small></template>
    <details v-if="snapshot?.step_type === 'rest' && snapshot.assertion_code?.trim()"><summary>本次运行的业务断言</summary><pre class="assertion-code"><code><span v-for="(line, index) in assertionLines" :key="index" class="assertion-line" :class="{ 'assertion-before-error': assertionErrorLine > 0 && index + 1 < assertionErrorLine, 'assertion-error-line': index + 1 === assertionErrorLine }"><span class="assertion-line-number" aria-hidden="true">{{ index + 1 }}</span><span class="assertion-line-text">{{ line || ' ' }}</span></span></code></pre></details>
    <p v-if="node.error_code" class="step-error">{{ node.error_code }} · {{ node.error_message }}</p>
  </div></article>
</template>

<style scoped>
.execution-number { min-height: 0; padding: 0; }
.execution-edit-icon { display: none; }
.execution-number:not(:disabled):is(:hover, :focus-visible) .execution-position { display: none; }
.execution-number:not(:disabled):is(:hover, :focus-visible) .execution-edit-icon { display: block; }
.execution-number:focus-visible { outline: 2px solid var(--primary, #526fe8); outline-offset: 3px; }
.assertion-code { white-space: pre; overflow-wrap: normal; }
.assertion-line { display: flex; min-width: max-content; }
.assertion-line-number { flex: 0 0 4ch; padding-right: 2ch; text-align: right; color: #8895a7; user-select: none; }
.assertion-line-text { flex: 1; }
.assertion-before-error .assertion-line-text { color: #228044; }
.assertion-error-line { background: #fff0f0; }
.assertion-error-line .assertion-line-text, .assertion-error-line .assertion-line-number { color: #c63232; }
</style>
