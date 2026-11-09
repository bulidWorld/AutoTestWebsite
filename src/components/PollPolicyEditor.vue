<script setup lang="ts">
import type { StepDraft, TaskModel } from '../task-editor'
const props = defineProps<{ step: StepDraft }>()
function toggle(enabled: boolean) {
  props.step.options ||= {}
  if (enabled) props.step.options.poll = { max_attempts: 10, interval_milliseconds: 1000, timeout_seconds: 60 }
  else delete props.step.options.poll
}
function change(name: keyof TaskModel<'PollPolicy'>, event: Event) {
  const text = (event.target as HTMLInputElement).value
  if (text === '') delete props.step.options!.poll![name]
  else props.step.options!.poll![name] = Number(text)
}
</script>
<template>
  <section class="node-settings" aria-label="REST 轮询配置">
    <h3>轮询</h3>
    <label class="check"><input type="checkbox" :checked="!!step.options?.poll" @change="toggle(($event.target as HTMLInputElement).checked)">启用 REST 轮询</label>
    <template v-if="step.options?.poll">
      <label>最大尝试次数<input :value="step.options.poll.max_attempts" @input="change('max_attempts',$event)" type="number" min="1" max="1000" placeholder="默认 10"></label>
      <label>轮询间隔（毫秒）<input :value="step.options.poll.interval_milliseconds" @input="change('interval_milliseconds',$event)" type="number" min="1" max="3600000" placeholder="默认 1000"></label>
      <label>轮询超时（秒）<input :value="step.options.poll.timeout_seconds" @input="change('timeout_seconds',$event)" type="number" min="1" max="86400" placeholder="默认 60"></label>
      <small>立即发送首次请求，按业务断言或 HTTP 2xx 判定成功。仅 HTTP 状态错误或断言失败会重试，达到上限返回 POLL_EXHAUSTED；只发布最终响应的提取值，统计为一个 REST 节点。留空使用默认值。</small>
    </template>
  </section>
</template>
