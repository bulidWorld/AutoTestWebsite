<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import { request, ApiError, type Model } from '../api'
import { bodyTemplate, buildInterfaceTest, customTestHeader, displayTestHeaders, privateParameter, testParameters, type TestDraft } from '../interface-test'
import UiIcon from './UiIcon.vue'
const props = defineProps<{ projectId: number; definition: Model<'InterfaceDetail'> }>()
const unsupportedBody = !!props.definition.request_body && String(props.definition.request_body.content_type) !== 'application/json'
const initialServer = props.definition.servers.map(server => server.url).find((url): url is string => typeof url === 'string' && /^https?:\/\/[^{}?#\s]+$/.test(url)) || ''
const draft = reactive<TestDraft>({ base_url: initialServer, timeout_seconds: 30, parameters: testParameters(props.definition),
  bodyEnabled: !unsupportedBody && (!!props.definition.request_body?.required || props.definition.request_body?.schema.default !== undefined),
  bodyText: props.definition.request_body && !unsupportedBody ? JSON.stringify(bodyTemplate(props.definition.request_body.schema), null, 2) : '', bodySensitive: false })
const busy = ref(false), error = ref<ApiError>(), result = ref<Model<'InterfaceTestResult'>>()
const resultTab = ref<'response' | 'request'>('response')
const locations = ['path', 'query', 'header'] as const
const errors: Record<string,string> = { HTTP_STATUS_ERROR: 'HTTP 状态码错误', TIMEOUT: '请求超时', CONNECTION_ERROR: '连接失败' }
let mounted = true
onBeforeUnmount(() => { mounted = false })
function prettyBody(body: string | null) { if (body === null) return '无正文'; try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body } }
const pretty = (value: unknown) => JSON.stringify(value, null, 2)
const time = (value: string) => new Date(value).toLocaleString('zh-CN')
async function execute() {
  if (busy.value) return
  error.value = undefined; result.value = undefined
  const { body, issues } = buildInterfaceTest(props.definition, draft)
  if (issues.length) { error.value = new ApiError('请修正参数后再发送测试。', issues); return }
  busy.value = true
  try {
    const response = await request<Model<'InterfaceTestResult'>>(`/projects/${props.projectId}/yaml-files/${props.definition.file_id}/interfaces/${props.definition.id}/test`, 'POST', body)
    if (mounted) { result.value = response; resultTab.value = 'response' }
  } catch (e) {
    if (mounted) error.value = e instanceof ApiError ? e : new ApiError('单次测试未能完成。')
  } finally { if (mounted) busy.value = false }
}
</script>
<template>
  <div class="interface-test">
    <div class="inline-note test-note"><UiIcon name="info" :size="15"/><span>测试当前 v{{ definition.version }} 接口，仅展示本次结果，不保存历史。</span></div>
    <div v-if="unsupportedBody" class="alert" role="status">该接口声明 {{ definition.request_body?.content_type }} 请求体；当前单次测试仅支持 JSON 请求体。</div>
    <form @submit.prevent="execute" novalidate>
      <fieldset :disabled="busy" class="task-fieldset">
        <div class="test-environment"><label>运行地址 <span class="required">*</span><input v-model="draft.base_url" type="url" placeholder="https://api.example.com/service" aria-label="单次测试运行地址"><small>支持路径前缀，由服务端发送请求。</small></label><label>超时<div class="input-unit"><input v-model.number="draft.timeout_seconds" type="number" min="1" max="300" step="1" aria-label="单次测试超时"><span>秒</span></div></label></div>
        <template v-for="location in locations" :key="location"><section v-if="draft.parameters.some(p => p.location === location)" class="test-parameter-group"><div class="binding-group-heading"><h3>{{ location === 'path' ? 'Path 参数' : location === 'query' ? 'Query 参数' : '请求头' }}</h3><code>{{ location.toUpperCase() }}</code></div><div v-for="p in draft.parameters.filter(p => p.location === location)" :key="p.key" class="test-parameter-row" :class="{ 'parameter-disabled': !p.enabled }"><div class="test-parameter-identity"><label class="check"><input v-model="p.enabled" type="checkbox" :aria-label="'发送 '+(p.name || '自定义 Header')"><input v-if="p.custom" v-model="p.name" aria-label="测试 Header 名称" placeholder="Authorization"><code v-else>{{ p.name }}</code></label><div class="field-meta"><span>{{ p.schema.type || 'string' }}</span><span v-if="p.required" class="required">必填</span><span v-else>可选</span></div><small v-if="p.description" class="parameter-description">{{ p.description }}</small></div><div class="test-parameter-value"><input v-if="privateParameter(p)" v-model="p.text" type="password" autocomplete="new-password" :disabled="!p.enabled" :aria-label="'测试参数 '+p.location+'.'+p.name" placeholder="输入敏感值"><textarea v-else-if="['object','array'].includes(String(p.schema.type))" v-model="p.text" rows="2" :disabled="!p.enabled" :aria-label="'测试参数 '+p.location+'.'+p.name" placeholder="输入 JSON 值"></textarea><input v-else v-model="p.text" :disabled="!p.enabled" :aria-label="'测试参数 '+p.location+'.'+p.name" :placeholder="p.schema.type && p.schema.type !== 'string' ? '输入 '+p.schema.type+' 值' : '输入字符串'"><div class="test-field-options"><label class="check"><input :checked="privateParameter(p)" type="checkbox" @change="p.sensitive = ($event.target as HTMLInputElement).checked" :disabled="!p.enabled || privateParameter({ ...p, sensitive: false })"><UiIcon name="lock" :size="12"/>敏感值</label><button v-if="p.custom" type="button" class="text-button danger" aria-label="移除测试 Header" @click="draft.parameters = draft.parameters.filter(item => item.key !== p.key)">移除</button></div></div></div></section></template>
        <button type="button" class="text-button add-header" @click="draft.parameters.push(customTestHeader())"><UiIcon name="plus" :size="15"/>添加认证 / 自定义 Header</button>
        <section v-if="definition.request_body && !unsupportedBody" class="test-body-section"><div class="section-top"><label class="check"><input v-model="draft.bodyEnabled" type="checkbox" aria-label="发送 JSON 请求体"><h3>JSON 请求体</h3><span v-if="definition.request_body.required" class="required">必填</span></label><label class="check body-sensitive"><input v-model="draft.bodySensitive" type="checkbox"><UiIcon name="lock" :size="13"/>敏感正文</label></div><input v-if="draft.bodySensitive" v-model="draft.bodyText" type="password" autocomplete="new-password" :disabled="!draft.bodyEnabled" aria-label="单次测试 JSON 请求体" placeholder="输入完整 JSON，正文隐藏显示"><textarea v-else v-model="draft.bodyText" class="json-input" rows="8" spellcheck="false" :disabled="!draft.bodyEnabled" aria-label="单次测试 JSON 请求体" placeholder="输入完整 JSON 对象或数组"></textarea><small>按接口 Schema 校验，保留对象、数组和布尔值等 JSON 类型。</small></section>
        <div v-if="error" class="alert test-error" role="alert"><strong>{{ error.detail }}</strong><div v-for="(issue,i) in error.issues" :key="i"><code>{{ issue.location }}</code> · {{ issue.reason }}</div><small>{{ error.code }} {{ error.requestId ? '请求 ID：'+error.requestId : '' }}</small></div>
        <div class="test-send-bar"><small>可选参数未勾选则不发送。</small><button class="primary" type="submit" :disabled="busy || unsupportedBody"><span v-if="busy" class="spinner"></span><UiIcon v-else name="play" :size="14"/>{{ busy ? '正在测试…' : '发送测试' }}</button></div>
      </fieldset>
    </form>
    <section v-if="result" class="single-test-result" aria-live="polite"><div class="section-top"><h3>本次测试结果</h3><span class="status" :class="result.status">{{ result.status === 'succeeded' ? '成功' : '失败' }}</span></div><div class="test-result-metrics"><span>HTTP <b>{{ result.response_status ?? '无响应' }}</b></span><span>耗时 <b>{{ result.duration_ms }} ms</b></span><span v-if="result.redacted" class="tag"><UiIcon name="lock" :size="12"/>已脱敏</span></div><div v-if="result.error_code" class="alert">{{ errors[result.error_code] || result.error_code }} · {{ result.error_message }}</div><div class="test-actual-url"><span class="method" :class="result.method.toLowerCase()">{{ result.method }}</span><code>{{ result.actual_url }}</code></div><nav class="tabs" aria-label="单次测试结果分区"><button type="button" :class="{ active: resultTab === 'response' }" :aria-pressed="resultTab === 'response'" @click="resultTab = 'response'">响应</button><button type="button" :class="{ active: resultTab === 'request' }" :aria-pressed="resultTab === 'request'" @click="resultTab = 'request'">实际请求</button><button type="button" class="clear-test-result" @click="result = undefined">清除结果</button></nav><h4>{{ resultTab === 'response' ? '响应头' : '请求头' }}</h4><pre>{{ pretty(displayTestHeaders(resultTab === 'response' ? result.response_headers : result.request_headers)) }}</pre><div class="section-top"><h4>{{ resultTab === 'response' ? '响应体' : '请求体' }}</h4><small v-if="resultTab === 'response'">{{ result.response_body_encoding }}</small></div><pre class="single-response-body">{{ resultTab === 'response' && result.response_body_encoding === 'base64' ? result.response_body ?? '无正文' : prettyBody(resultTab === 'response' ? result.response_body : result.request_body) }}</pre><div class="request-times"><small>开始 {{ time(result.started_at) }}</small><small>结束 {{ time(result.finished_at) }}</small></div></section>
  </div>
</template>
