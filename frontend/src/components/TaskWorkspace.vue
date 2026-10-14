<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch, onBeforeUnmount } from 'vue'
import { ApiError, query, request, type Model } from '../api'
import { buildTask, field, fieldsFor, key, secretHeader, stepDraft, textValue, type Draft, type FieldDraft, type StepDraft, type TaskModel } from '../task-editor'
import { buildStepTest } from '../step-test'
import { parseValue, type ParameterDraft } from '../task-editor'
import ParameterConfig from './ParameterConfig.vue'
import ParameterEditor from './ParameterEditor.vue'
import SchemaTree from './SchemaTree.vue'
import UiIcon from './UiIcon.vue'
import { useDialogFocus } from '../useDialogFocus'
const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ busy: [value: boolean]; dirty: [value: boolean] }>()
const base = `/projects/${props.projectId}`
const tasks = ref<TaskModel<'TaskSummary'>[]>([]), task = ref<TaskModel<'Task'>>()
const search = ref(''), page = ref(1), total = ref(0), busy = ref(false), error = ref<ApiError>(), notice = ref('')
const view = ref<'list' | 'editor' | 'history'>('list'), dirty = ref(false)
const editorTab = ref<'config' | 'parameters' | 'steps'>('config')
const selectedStepKey = ref<number>()
const selectedStep = computed(() => draft.steps.find(s => s.key === selectedStepKey.value) || draft.steps[0])
const selectedStepIndex = computed(() => draft.steps.findIndex(s => s.key === selectedStep.value?.key))
const detailTab = ref<'steps' | 'parameters' | 'requests' | 'snapshot'>('steps')
const requestPart = ref<'request' | 'response'>('response')
const interfaceSearch = ref('')
const matchingInterfaces = computed(() => interfaces.value.filter(i => `${i.method} ${i.path} ${i.summary}`.toLowerCase().includes(interfaceSearch.value.toLowerCase())))
const locations = ['path', 'query', 'header', 'body'] as const
const draft = reactive<Draft>({ name: '', description: '', base_url: '', timeout_seconds: 30, parameters: [], steps: [] })
const modal = ref<'choose' | 'copy' | 'delete' | 'discard' | 'parameter' | null>(null)
const target = ref<TaskModel<'TaskSummary'>>(), copyName = ref(''), deletion = ref<TaskModel<'DeletionPreview'>>()
const files = ref<Model<'YamlFile'>[]>([]), selectedFile = ref<number>(), selectedVersion = ref<number>()
const versions = ref<Model<'YamlVersion'>[]>([]), interfaces = ref<Model<'Interface'>[]>([]), replacing = ref<number>()
const runs = ref<TaskModel<'Run'>[]>([]), runPage = ref(1), runTotal = ref(0), statusFilter = ref('')
const runDetail = ref<TaskModel<'RunDetail'>>(), requests = ref<TaskModel<'Request'>[]>([])
const requestPage = ref(1), requestTotal = ref(0), requestDetail = ref<TaskModel<'Request'>>()
const taskBase = computed(() => `${base}/tasks/${task.value?.id}`)
const runBase = computed(() => `${taskBase.value}/runs/${runDetail.value?.run.id}`)
const active = computed(() => tasks.value.some(t => t.id === task.value?.id && t.has_active_run) || runs.value.some(r => r.status === 'queued' || r.status === 'running'))
const labels: Record<string, string> = { queued: '待运行', running: '运行中', succeeded: '成功', failed: '失败', pending: '待执行', skipped: '已跳过' }
const errors: Record<string, string> = { HTTP_STATUS_ERROR: 'HTTP 状态码错误', CONNECTION_ERROR: '连接失败', TIMEOUT: '请求超时', EXECUTION_INTERRUPTED: '执行中断（服务重启）' }
const time = (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '—'
const duration = (v: number | null) => v === null ? '—' : `${v} ms`
const pretty = (v: unknown) => JSON.stringify(v, null, 2)
async function act(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; emit('busy', true); error.value = undefined; notice.value = ''
  try { await action() } catch (e) { error.value = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : '操作失败。') }
  finally { busy.value = false; emit('busy', false) }
}
async function allPages<T>(url: string): Promise<T[]> {
  const items: T[] = []; let page = 1
  while (true) { const result = await request<{ items: T[]; total: number }>(url + (url.includes('?') ? '&' : '?') + new URLSearchParams({ page: String(page++), page_size: '100' })); items.push(...result.items); if (items.length >= result.total || !result.items.length) return items }
}
async function loadTasks() {
  const result = await request<TaskModel<'TaskPage'>>(`${base}/tasks${query({ name: search.value, page: page.value, page_size: 20 })}`)
  tasks.value = result.items; total.value = result.total
}
function reset() { stepResults.value.clear(); parameterPreviews.value.clear(); task.value = undefined; runDetail.value = undefined; requestDetail.value = undefined; runs.value = []; dirty.value = false }
function create() { reset(); Object.assign(draft, { name: '', description: '', base_url: '', timeout_seconds: 30, parameters: [], steps: [] }); view.value = 'editor'; editorTab.value = 'config'; selectedStepKey.value = undefined; error.value = undefined }
const stepResults = ref(new Map<number, { signature: string; result: Model<'InterfaceTestResult'> }>())
const editingParameter = ref<ParameterDraft>()
const parameterPreviews = ref(new Map<number, { signature: string; value: unknown }>())
const parameterSignature = (p: ParameterDraft) => JSON.stringify([p.name, p.value_type, p.source_type, p.step_key, p.extract_expression, p.sensitive])
const stepSignature = (s: StepDraft) => {
  try {
    const previews = new Map<number, unknown>()
    for (const p of draft.parameters) { const v = parameterPreviews.value.get(p.key); if (v?.signature === parameterSignature(p)) previews.set(p.key, v.value) }
    return JSON.stringify([s.interface_id, buildStepTest(draft, s, previews)])
  } catch { return 'invalid' }
}
watch(() => JSON.stringify([draft.base_url, draft.timeout_seconds, draft.steps.map(s => [s.key, s.interface_id, s.fields]), draft.parameters.filter(p => p.source_type !== 'rest').map(p => [p.name, p.value_type, p.text, p.sensitive])]), () => {
  stepResults.value.clear(); parameterPreviews.value.clear()
}, { flush: 'sync' })
watch(() => JSON.stringify(draft.parameters.filter(p => p.source_type === 'rest').map(p => [p.key, parameterSignature(p)])), () => parameterPreviews.value.clear(), { flush: 'sync' })
function validResult(s?: StepDraft) { if (!s) return; const stored = stepResults.value.get(s.key); return stored?.signature === stepSignature(s) ? stored.result : undefined }
const currentStepResult = computed(() => validResult(selectedStep.value))
function canExtract(p: ParameterDraft) { return !busy.value && !!draft.steps.find(s => s.key === p.step_key) && !!p.name.trim() && !!p.extract_expression?.trim() }
function previewValue(p: ParameterDraft) { const v = parameterPreviews.value.get(p.key); return v?.signature === parameterSignature(p) ? v : undefined }
function currentParameter(p: ParameterDraft) {
  if (p.sensitive || (p.retained?.redacted && !p.text)) return '••••••'
  if (p.source_type === 'rest') { const v = previewValue(p); return v ? pretty(v.value) : '待单次取值' }
  try { return pretty(parseValue(p.text, p.value_type)) } catch { return '值格式无效' }
}
async function refreshParameters() {
  await act(async () => {
    if (task.value) {
      const saved = await request<TaskModel<'Task'>>(taskBase.value)
      for (const p of draft.parameters) { const original = saved.global_parameters.find(v => v.name === p.name && v.value_type === p.value_type && v.source_type === (p.source_type || 'fixed')); if (original && p.retained) {
        if (p.source_type !== 'rest' && p.text === textValue(p.retained.value, p.value_type)) p.text = original.redacted ? '' : textValue(original.value, p.value_type)
        p.retained = original
      } }
    }
    notice.value = '当前全局参数已刷新，未保存的配置已保留。'
  })
}
function editParameter(p: ParameterDraft) {
  rememberDialogTrigger()
  editingParameter.value = JSON.parse(JSON.stringify(p))
  editingParameter.value!.source_type ||= 'fixed'
  error.value = undefined; modal.value = 'parameter'
}
function applyParameter(p: ParameterDraft) {
  const index = draft.parameters.findIndex(v => v.key === p.key)
  if (index < 0) draft.parameters.push(p)
  else draft.parameters[index] = p
  dirty.value = true; modal.value = null
}
function removeParameter(p: ParameterDraft) {
  draft.parameters = draft.parameters.filter(v => v.key !== p.key); dirty.value = true
}
function addRestParameter(s: StepDraft) {
  editParameter({ key: key(), name: '', value_type: 'string', sensitive: false, text: '', source_type: 'rest', step_key: s.key, extract_expression: '' })
}
async function runStep(s: StepDraft) {
  const index = draft.steps.indexOf(s)
  for (const p of draft.parameters.filter(p => p.source_type === 'rest' && draft.steps.findIndex(s => s.key === p.step_key) >= index)) parameterPreviews.value.delete(p.key)
  for (const later of draft.steps.slice(index)) stepResults.value.delete(later.key)
  const values = new Map<number, unknown>()
  for (const p of draft.parameters) { const v = previewValue(p); if (v) values.set(p.key, v.value) }
  const { body, issues } = buildStepTest(draft, s, values)
  if (issues.length) throw new ApiError('请修正当前步骤的请求参数。', issues)
  const result = await request<Model<'InterfaceTestResult'>>(`${base}/yaml-files/${s.file_id}/interfaces/${s.interface_id}/test`, 'POST', body)
  stepResults.value.set(s.key, { signature: stepSignature(s), result })
}
async function executeStep(s: StepDraft) { await act(() => runStep(s)) }
async function extractParameter(p: ParameterDraft) {
  await act(async () => {
    if (!p.name.trim() || !p.extract_expression?.trim()) throw new ApiError('请填写参数名称和取值表达式。')
    const source = draft.steps.find(s => s.key === p.step_key)
    if (!source) throw new ApiError('请选择本任务中存在的来源步骤。')
    if (!validResult(source)) {
      selectedStepKey.value = source.key
      await runStep(source)
    }
    const response = validResult(source)!
    if (response.status !== 'succeeded' || response.response_body === null || response.response_body_encoding !== 'utf-8') throw new ApiError(response.error_message || '来源接口未返回成功的 JSON 响应，请检查单次接口结果。')
    parameterPreviews.value.delete(p.key)
    const result = await request<{ value: unknown }>('/parameters/rest/extract', 'POST', { parameter_name: p.name.trim(), value_type: p.value_type, extract_expression: p.extract_expression, response: { response_body: response.response_body, response_body_encoding: response.response_body_encoding } })
    parameterPreviews.value.set(p.key, { signature: parameterSignature(p), value: result.value })
    // Extraction does not change the HTTP request; keep this response usable for other bound parameters.
    for (const s of draft.steps) { const stored = stepResults.value.get(s.key); if (stored && s.key === p.step_key) stored.signature = stepSignature(s) }
    notice.value = `参数 ${p.name} 取值成功。`
  })
}
async function fillTask(saved: TaskModel<'Task'>) {
  const currentIndex = selectedStepIndex.value, currentId = selectedStep.value?.id
  const definitions = await Promise.all(saved.steps.map(s => request<Model<'InterfaceDetail'>>(`${base}/yaml-files/${s.file_id}/interfaces/${s.interface_id}`)))
  const steps = saved.steps.map((s, i) => stepDraft(s, definitions[i]!))
  stepResults.value.clear(); parameterPreviews.value.clear()
  Object.assign(draft, { name: saved.name, description: saved.description, base_url: saved.base_url, timeout_seconds: saved.timeout_seconds, parameters: saved.global_parameters.map(p => ({ key: key(), name: p.name, value_type: p.value_type, sensitive: p.sensitive, text: p.redacted ? '' : textValue(p.value, p.value_type), retained: p, source_type: p.source_type, step_key: steps.find(s => s.id === p.rest_source?.step_id)?.key, extract_expression: p.rest_source?.extract_expression })), steps })
  selectedStepKey.value = (draft.steps.find(s => s.id === currentId) || draft.steps[Math.max(0, currentIndex)])?.key
  task.value = saved; dirty.value = false; runDetail.value = undefined; requestDetail.value = undefined; runs.value = []; view.value = 'editor'
}
async function openTask(id: number) { editorTab.value = 'config'; selectedStepKey.value = undefined; await act(async () => fillTask(await request<TaskModel<'Task'>>(`${base}/tasks/${id}`))) }
function checkedBody() {
  const { body, issues } = buildTask(draft)
  if (issues.length) {
    const location = issues[0]!.location
    editorTab.value = location.includes('global_parameters') ? 'parameters' : location.includes('steps') ? 'steps' : 'config'
    const stepIndex = /steps\[(\d+)\]/.exec(location)?.[1]
    if (stepIndex !== undefined) selectedStepKey.value = draft.steps[Number(stepIndex)]?.key
    throw new ApiError('配置校验失败，请修正以下字段。', issues)
  }
  return body
}
async function save() {
  await act(async () => {
    const saved = await request<TaskModel<'Task'>>(task.value ? taskBase.value : `${base}/tasks`, task.value ? 'PUT' : 'POST', checkedBody())
    await fillTask(saved); await loadTasks(); notice.value = '任务已保存；步骤顺序及接口版本已固定。'
  })
}
function back() { if (dirty.value) { modal.value = 'discard'; return }; reset(); view.value = 'list'; act(loadTasks) }
function discard() { modal.value = null; reset(); view.value = 'list'; act(loadTasks) }
function addParameter() { editParameter({ key: key(), name: '', value_type: 'string', sensitive: false, text: '', source_type: 'fixed' }) }
function move(index: number, delta: number) { const item = draft.steps.splice(index, 1)[0]!; draft.steps.splice(index + delta, 0, item); dirty.value = true }
function copyStep(index: number) { // Vue drafts contain proxies; clone a plain JSON copy.
  const s = draft.steps[index]!
  if (s.fields.some(f => f.enabled && f.kind === 'literal' && f.preserved)) { error.value = new ApiError('该步骤包含隐藏字面值。请先重新输入，或改为全局参数引用，再复制步骤。'); return }
  const copy: StepDraft = JSON.parse(JSON.stringify(s)); delete copy.id; copy.key = key(); copy.fields.forEach(f => { f.key = key(); f.preserved = false }); draft.steps.splice(index + 1, 0, copy); selectedStepKey.value = copy.key; dirty.value = true
}
function toggleField(s: StepDraft, f: FieldDraft) {
  dirty.value = true
  if (f.enabled && f.location === 'body') for (const other of s.fields) if (other !== f && other.location === 'body' && (other.name.startsWith(f.name + '/') || f.name.startsWith(other.name + '/'))) other.enabled = false
}
function privateField(f: FieldDraft) { return (f.location === 'header' && secretHeader(f.name)) || f.schema.format === 'password' || f.schema['x-sensitive'] === true }
function removeStep(index: number) { draft.steps.splice(index, 1); dirty.value = true }
function addHeader(s: StepDraft) { const f = field('header', ''); f.enabled = true; s.fields.push(f); dirty.value = true }
function customHeader(s: StepDraft, f: FieldDraft) { return f.location === 'header' && !s.definition.parameters.some(p => p.location === 'header' && p.name.toLowerCase() === f.name.toLowerCase()) }
async function choose(index?: number) {
  rememberDialogTrigger()
  await act(async () => { files.value = await allPages<Model<'YamlFile'>>(`${base}/yaml-files`); selectedFile.value = undefined; selectedVersion.value = undefined; versions.value = []; interfaces.value = []; replacing.value = index; interfaceSearch.value = ''; modal.value = 'choose' })
}
async function chooseFile() {
  await act(async () => { interfaces.value = []; selectedVersion.value = undefined; versions.value = await allPages<Model<'YamlVersion'>>(`${base}/yaml-files/${selectedFile.value}/versions`); selectedVersion.value = files.value.find(f => f.id === selectedFile.value)?.current_version; await loadChoices() })
}
async function loadChoices() { interfaces.value = selectedFile.value && selectedVersion.value ? await allPages<Model<'Interface'>>(`${base}/yaml-files/${selectedFile.value}/interfaces?version=${selectedVersion.value}`) : [] }
async function selectInterface(api: Model<'Interface'>) {
  await act(async () => {
    const definition = await request<Model<'InterfaceDetail'>>(`${base}/yaml-files/${selectedFile.value}/interfaces/${api.id}`)
    const previous = replacing.value === undefined ? undefined : draft.steps[replacing.value]
    const file = files.value.find(f => f.id === selectedFile.value)!
    const s: StepDraft = { key: previous?.key || key(), id: previous?.id, interface_id: api.id, file_id: file.id, version: api.version, file_name: file.name, method: api.method, path: api.path, has_new_version: api.version < file.current_version, definition, fields: fieldsFor(definition) }
    // Explicit reselection resets bindings so old types and hidden values cannot leak into another version.
    if (replacing.value === undefined) draft.steps.push(s); else draft.steps[replacing.value] = s
    selectedStepKey.value = s.key; editorTab.value = 'steps'; dirty.value = true; modal.value = null; notice.value = previous ? '已重新选择接口，请重新配置并校验参数。' : '步骤已添加，请配置必填字段。'
  })
}
async function prepareCopy(item: TaskModel<'TaskSummary'>) { target.value = item; copyName.value = `${item.name} 副本`.slice(0,120); modal.value = 'copy'; error.value = undefined }
async function copyTask() {
  await act(async () => { if (!copyName.value.trim()) throw new ApiError('请输入新任务名称。'); await request(`${base}/tasks/${target.value?.id}/copy`, 'POST', { name: copyName.value.trim() }); modal.value = null; await loadTasks(); notice.value = '任务已复制，运行历史未复制。' })
}
async function previewDelete(item: TaskModel<'TaskSummary'>) {
  rememberDialogTrigger()
  await act(async () => { deletion.value = await request<TaskModel<'DeletionPreview'>>(`${base}/tasks/${item.id}/deletion-preview`); target.value = item; modal.value = 'delete' })
}
async function deleteTask() {
  await act(async () => { if (!deletion.value?.can_delete) return; await request(`${base}/tasks/${target.value?.id}?confirm=true`, 'DELETE'); modal.value = null; if (task.value?.id === target.value?.id) { reset(); view.value = 'list' }; if (tasks.value.length === 1 && page.value > 1) page.value--; await loadTasks(); notice.value = '任务及关联运行记录已删除。' })
}
async function validate(mode: 'save' | 'run') {
  const result = await request<TaskModel<'ValidationResult'>>(`${taskBase.value}/validate`, 'POST', { mode })
  if (!result.valid) throw new ApiError('后端配置校验失败，未启动运行。', result.issues)
}
async function validateSaved() { await act(async () => { await validate('run'); notice.value = '运行配置校验通过，未发送测试请求。' }) }
async function start(id: number, saveDraft = false) {
  await act(async () => {
    if (saveDraft) {
      if (!draft.steps.length) throw new ApiError('运行至少需要一个步骤。')
      const saved = await request<TaskModel<'Task'>>(task.value ? taskBase.value : `${base}/tasks`, task.value ? 'PUT' : 'POST', checkedBody())
      await fillTask(saved); id = saved.id
    } else { task.value = await request<TaskModel<'Task'>>(`${base}/tasks/${id}`); dirty.value = false }
    await validate('run')
    const result = await request<TaskModel<'Run'>>(`${base}/tasks/${id}/runs`, 'POST')
    view.value = 'history'; detailTab.value = 'steps'; runPage.value = 1; statusFilter.value = ''; requestPage.value = 1
    await loadRun(result.id); await loadRuns(); await loadTasks(); notice.value = '运行已由服务端接受，可手动刷新查看结果。'
  })
}
async function history(id: number) {
  await act(async () => { task.value = await request<TaskModel<'Task'>>(`${base}/tasks/${id}`); view.value = 'history'; detailTab.value = 'steps'; runPage.value = 1; statusFilter.value = ''; runDetail.value = undefined; requestDetail.value = undefined; runs.value = []; await loadRuns(); if (runs.value[0]) { requestPage.value = 1; await loadRun(runs.value[0].id) } })
}
async function loadRuns() {
  const result = await request<TaskModel<'RunPage'>>(`${taskBase.value}/runs${query({ page: runPage.value, page_size: 20, status: statusFilter.value })}`)
  runs.value = result.items; runTotal.value = result.total
}
async function loadRequests() {
  const result = await request<TaskModel<'RequestPage'>>(`${runBase.value}/requests${query({ page: requestPage.value, page_size: 20 })}`)
  requests.value = result.items; requestTotal.value = result.total
}
async function loadRun(id: number) { runDetail.value = await request<TaskModel<'RunDetail'>>(`${taskBase.value}/runs/${id}`); requestDetail.value = undefined; await loadRequests() }
async function refreshHistory() { await loadTasks(); await loadRuns(); if (runDetail.value) { const selected = requestDetail.value?.id; await loadRun(runDetail.value.run.id); if (selected) requestDetail.value = await request<TaskModel<'Request'>>(`${runBase.value}/requests/${selected}`) } }
async function openRequest(id: number) { rememberDialogTrigger(); requestPart.value = 'response'; await act(async () => { requestDetail.value = await request<TaskModel<'Request'>>(`${runBase.value}/requests/${id}`) }) }
function headers(headers: TaskModel<'Header'>[] | null) { return headers?.map(h => ({ name: h.name, value: h.redacted || secretHeader(h.name) ? '••••••' : h.value })) || [] }
function safeJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeJSON)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, k === 'value' && (object.redacted || object.sensitive || (typeof object.name === 'string' && secretHeader(object.name))) ? '••••••' : secretHeader(k) ? '••••••' : safeJSON(v)]))
  }
  return value
}
const rememberDialogTrigger = useDialogFocus(() => modal.value !== null || requestDetail.value !== undefined)
watch(dirty, value => emit('dirty', value))
function leaving(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => { window.addEventListener('beforeunload', leaving); act(loadTasks) })
onBeforeUnmount(() => window.removeEventListener('beforeunload', leaving))
</script>

<template>
  <div class="task-workspace">
    <div class="workspace-heading">
      <div><button v-if="view !== 'list'" class="back-link" :disabled="busy" @click="back"><UiIcon name="arrow" :size="15"/>返回任务列表</button><div v-else class="eyebrow">TEST WORKFLOWS</div><h1>{{ view === 'list' ? '任务编排' : view === 'editor' ? (task ? draft.name || '编辑任务' : '新建任务') : task?.name }}</h1><p>{{ view === 'list' ? '将接口组成可重复执行的测试流程。' : view === 'editor' ? '配置运行环境、固定参数与有序接口步骤。' : '查看每次执行的状态、配置与请求结果。' }}</p></div>
      <div class="actions">
        <template v-if="view === 'list'"><button :disabled="busy" @click="act(loadTasks)"><UiIcon name="refresh"/>刷新</button><button class="primary" :disabled="busy" @click="create"><UiIcon name="plus"/>新建任务</button></template>
        <template v-else-if="view === 'editor'"><span v-if="dirty" class="unsaved"><span></span>未保存</span><button :disabled="busy" form="task-editor" type="submit">保存任务</button><button class="primary" :disabled="busy || active || !draft.steps.length" @click="start(task?.id || 0,true)"><UiIcon name="play" :size="15"/>保存并运行</button></template>
        <button v-else :disabled="busy" @click="act(refreshHistory)"><UiIcon name="refresh"/>刷新历史及详情</button>
      </div>
    </div>
    <div v-if="error && !modal" class="alert" role="alert"><div class="feedback-heading"><UiIcon name="info"/><strong>{{ error.detail }}</strong><button class="icon-button" aria-label="关闭错误提示" @click="error = undefined"><UiIcon name="close" :size="16"/></button></div><div v-for="(issue,i) in error.issues" :key="i"><code>{{ issue.location }}</code> · {{ issue.reason }}</div><small>{{ error.code }} {{ error.requestId ? '请求 ID：' + error.requestId : '' }}</small></div>
    <div v-if="notice" class="success" role="status"><UiIcon name="check"/>{{ notice }}<button class="icon-button" aria-label="关闭成功提示" @click="notice = ''"><UiIcon name="close" :size="16"/></button></div>
    <div v-if="busy" class="working" role="status"><span class="spinner"></span>正在处理…</div>
    <section v-if="view === 'list'" class="surface">
      <div class="surface-toolbar"><div class="section-label">全部任务 <span class="count">{{ total }}</span></div><form class="search-form" @submit.prevent="page = 1; act(loadTasks)"><UiIcon name="search" :size="17"/><input v-model="search" placeholder="搜索任务名称…" aria-label="任务名称搜索"><button :disabled="busy">搜索</button></form></div>
      <div class="table-scroll task-table-wrap"><table class="task-table"><thead><tr><th>任务名称</th><th>运行环境</th><th>步骤</th><th>更新时间</th><th class="align-right">操作</th></tr></thead><tbody><tr v-for="item in tasks" :key="item.id"><td><div class="entity-cell"><span class="entity-icon"><UiIcon name="workflow"/></span><div><button class="entity-title" :disabled="busy" @click="openTask(item.id)">{{ item.name }}</button><small class="block">{{ item.description || '暂无描述' }}</small></div></div></td><td><code class="url-text">{{ item.base_url }}</code><small v-if="item.has_active_run" class="block"><span class="status running">有未结束运行</span></small></td><td><span class="step-count">{{ item.step_count }} <small>步</small></span></td><td class="muted">{{ time(item.updated_at) }}</td><td><div class="row-actions"><button class="text-button" :disabled="busy" @click="openTask(item.id)">编辑</button><button class="text-button" :disabled="busy" @click="history(item.id)">历史</button><button class="run-button" :disabled="busy || item.has_active_run || !item.step_count" @click="start(item.id)"><UiIcon name="play" :size="13"/>运行</button><details class="action-menu"><summary aria-label="更多任务操作"><UiIcon name="more"/></summary><div><button :disabled="busy" @click="prepareCopy(item)"><UiIcon name="copy" :size="15"/>复制</button><button class="danger" :disabled="busy || item.has_active_run" @click="previewDelete(item)"><UiIcon name="trash" :size="15"/>删除</button></div></details></div></td></tr></tbody></table></div>
      <div v-if="!tasks.length && !busy && !error" class="empty"><span class="empty-icon"><UiIcon name="workflow" :size="30"/></span><h3>{{ search ? '没有匹配的任务' : '开始你的第一个测试流程' }}</h3><p>{{ search ? '尝试其他名称，或清空搜索条件。' : '选择接口，配置参数，然后按顺序执行。' }}</p><button v-if="!search" class="primary" @click="create"><UiIcon name="plus"/>新建任务</button></div>
      <div class="table-footer"><small>共 {{ total }} 个任务</small><div class="pagination"><button :disabled="busy || page <= 1" @click="page--; act(loadTasks)">上一页</button><span>{{ page }} / {{ Math.max(1, Math.ceil(total/20)) }}</span><button :disabled="busy || page*20 >= total" @click="page++; act(loadTasks)">下一页</button></div></div>
    </section>
    <template v-else-if="view === 'editor'">
      <div class="editor-nav"><nav class="tabs" aria-label="任务编辑分区"><button :class="{ active: editorTab === 'config' }" :aria-pressed="editorTab === 'config'" @click="editorTab = 'config'"><UiIcon name="settings" :size="16"/>基本配置</button><button :class="{ active: editorTab === 'parameters' }" :aria-pressed="editorTab === 'parameters'" @click="editorTab = 'parameters'"><UiIcon name="code" :size="16"/>全局参数<span class="count">{{ draft.parameters.length }}</span></button><button :class="{ active: editorTab === 'steps' }" :aria-pressed="editorTab === 'steps'" @click="editorTab = 'steps'"><UiIcon name="workflow" :size="16"/>执行步骤<span class="count">{{ draft.steps.length }}</span></button></nav><div class="actions compact"><button class="text-button" :disabled="busy || !task || dirty" @click="validateSaved"><UiIcon name="check" :size="15"/>校验配置</button><button v-if="task" class="text-button" :disabled="busy || dirty" @click="history(task.id)"><UiIcon name="clock" :size="15"/>运行历史</button></div></div>
      <form id="task-editor" @submit.prevent="save" @input="dirty = true" @change="dirty = true">
        <fieldset :disabled="busy" class="task-fieldset">
          <section v-if="editorTab === 'config'" class="surface config-surface"><div class="section-intro"><span class="section-icon"><UiIcon name="settings" :size="22"/></span><div><h2>运行环境</h2><p>为这项任务设置名称、服务地址与请求超时。</p></div></div><div class="task-config"><label>任务名称 <span class="required">*</span><input v-model="draft.name" required maxlength="120" placeholder="例如：订单服务回归"><small>在当前项目内使用唯一名称。</small></label><label>任务描述<textarea v-model="draft.description" maxlength="2000" rows="3" placeholder="简要描述测试范围与用途"></textarea></label><div class="form-divider"></div><label>运行地址 <span class="required">*</span><input v-model="draft.base_url" required type="url" placeholder="https://api.example.com/service"><small>支持 HTTP / HTTPS 和路径前缀，不含 query、fragment。</small></label><label class="timeout-field">请求超时<div class="input-unit"><input v-model.number="draft.timeout_seconds" type="number" min="1" max="300" step="1" required><span>秒</span></div><small>每步请求的超时时间，范围 1–300 秒。</small></label></div><div class="section-bottom"><span><UiIcon name="info" :size="16"/>草稿可不含步骤；运行前请添加至少一个步骤。</span><button type="button" @click="editorTab = 'parameters'">配置全局参数<UiIcon name="chevron" :size="15"/></button></div></section>
          <section v-else-if="editorTab === 'parameters'" class="surface parameters-surface"><ParameterConfig :draft="draft" :current-value="currentParameter" :busy="busy" @edit="editParameter" @remove="removeParameter" @add="addParameter" @extract="extractParameter" :can-extract="canExtract"/><div class="section-bottom"><button type="button" @click="editorTab = 'steps'">编排执行步骤<UiIcon name="chevron" :size="15"/></button></div></section>
          <div v-else class="compose-layout">
            <section class="surface compose-parameters"><ParameterConfig :draft="draft" :current-value="currentParameter" :busy="busy" show-refresh @refresh="refreshParameters" @edit="editParameter" @remove="removeParameter" @add="addParameter" @extract="extractParameter" :can-extract="canExtract"/></section>
            <aside class="step-outline surface"><div class="outline-heading"><h2>执行顺序 <span class="count">{{ draft.steps.length }}</span></h2><small>从上至下，依次执行</small></div><div class="step-list"><button v-for="(s,index) in draft.steps" :key="s.key" type="button" class="step-nav-item" :class="{ active: selectedStep?.key === s.key }" @click="selectedStepKey = s.key"><span class="step-number">{{ String(index+1).padStart(2,'0') }}</span><div><span class="method" :class="s.method.toLowerCase()">{{ s.method }}</span><code>{{ s.path }}</code><small>{{ s.file_name }} · v{{ s.version }}</small></div><span v-if="s.has_new_version" class="version-dot" title="存在新版本"></span></button></div><button type="button" class="add-step" @click="choose()"><UiIcon name="plus"/>添加接口步骤</button><div class="outline-note"><UiIcon name="info" :size="15"/><span>失败后停止执行，后续步骤标记为已跳过。</span></div></aside>
            <section v-if="selectedStep" class="surface step-editor"><div class="step-editor-heading"><div><div class="eyebrow">STEP {{ String(selectedStepIndex+1).padStart(2,'0') }}</div><h2><span class="method" :class="selectedStep.method.toLowerCase()">{{ selectedStep.method }}</span><code>{{ selectedStep.path }}</code></h2><p>{{ selectedStep.file_name }} <span class="separator">/</span> v{{ selectedStep.version }} <span class="separator">/</span> {{ selectedStep.id ? 'ID '+selectedStep.id : '新步骤' }}</p></div><div class="actions"><button type="button" class="icon-button" :disabled="selectedStepIndex === 0" aria-label="上移步骤" title="上移" @click="move(selectedStepIndex,-1)"><UiIcon name="up"/></button><button type="button" class="icon-button" :disabled="selectedStepIndex === draft.steps.length-1" aria-label="下移步骤" title="下移" @click="move(selectedStepIndex,1)"><UiIcon name="down"/></button><button type="button" class="icon-button" aria-label="复制步骤" title="复制步骤" @click="copyStep(selectedStepIndex)"><UiIcon name="copy"/></button><button type="button" class="icon-button danger" aria-label="移除步骤" title="移除步骤" @click="removeStep(selectedStepIndex)"><UiIcon name="trash"/></button></div></div>
              <div class="version-bar"><span v-if="selectedStep.has_new_version" class="version-notice"><span class="version-dot"></span>存在新版本，当前绑定保持 v{{ selectedStep.version }}</span><span v-else class="muted">已绑定明确的 YAML 版本</span><button type="button" class="text-button" @click="choose(selectedStepIndex)">重新选择接口 / 版本<UiIcon name="chevron" :size="14"/></button></div>
              <div class="step-test-area"><div class="actions"><button type="button" class="primary" @click="executeStep(selectedStep)"><UiIcon name="play"/>单次运行接口</button><button type="button" @click="addRestParameter(selectedStep)"><UiIcon name="plus"/>设置响应全局参数</button></div><small>使用当前请求绑定与运行环境。参数取值使用本次响应。</small><div v-if="currentStepResult" class="single-test-result"><div class="section-top"><h3>单次接口结果</h3><span>HTTP {{ currentStepResult.response_status ?? '无响应' }} · {{ currentStepResult.duration_ms }} ms</span></div><p v-if="currentStepResult.error_code" class="alert">{{ currentStepResult.error_code }} · {{ currentStepResult.error_message }}</p><pre>{{ currentStepResult.response_body ?? '无响应体' }}</pre><div v-for="p in draft.parameters.filter(p => p.source_type === 'rest' && p.step_key === selectedStep?.key)" :key="p.key" class="actions"><span>{{ p.name }} · {{ p.extract_expression }}</span><button type="button" :disabled="!canExtract(p)" @click="extractParameter(p)">单次参数取值</button><span>{{ currentParameter(p) }}</span></div></div></div>
              <div class="bindings-area"><div class="section-top"><h3>请求参数绑定</h3><small>勾选字段后才会发送</small></div>
                <template v-for="location in locations" :key="location"><section v-if="selectedStep.fields.some(f => f.location === location)" class="binding-group"><div class="binding-group-heading"><span>{{ location === 'body' ? 'JSON 请求体' : location === 'header' ? '请求头' : location === 'query' ? 'Query 参数' : 'Path 参数' }}</span><code>{{ location.toUpperCase() }}</code></div><div v-for="f in selectedStep.fields.filter(f => f.location === location)" :key="f.key" class="binding-row" :class="{ 'binding-disabled': !f.enabled }"><div class="field-identity"><label class="check"><input v-model="f.enabled" type="checkbox" :aria-label="'配置 '+(f.name || 'JSON 根字段')" @change="toggleField(selectedStep,f)"><input v-if="customHeader(selectedStep,f)" v-model="f.name" class="header-name-input" aria-label="自定义 Header 名称" placeholder="Authorization"><code v-else>{{ f.name || '整个 JSON 请求体' }}</code></label><div class="field-meta"><span>{{ f.schema.type || 'string' }}</span><span v-if="f.required" class="required">必填</span><span v-else>可选</span><span v-if="privateField(f)"><UiIcon name="lock" :size="12"/>敏感</span></div></div><select v-model="f.kind" :disabled="!f.enabled" aria-label="绑定方式"><option value="literal">字面值</option><option value="global">全局参数</option></select><select v-if="f.kind === 'global'" v-model="f.parameter_name" :disabled="!f.enabled" aria-label="全局参数引用"><option value="">选择全局参数</option><option v-for="p in draft.parameters" :key="p.key" :value="p.name">{{ p.name }} · {{ p.value_type }}</option></select><div v-else class="binding-value"><input v-if="privateField(f) || f.preserved" v-model="f.text" type="password" autocomplete="new-password" :disabled="!f.enabled" :placeholder="f.preserved ? '留空保留隐藏值' : '输入值'" @input="f.preserved = false"><textarea v-else-if="['object','array'].includes(String(f.schema.type))" v-model="f.text" rows="3" :disabled="!f.enabled" placeholder="输入 JSON 值" @input="f.preserved = false"></textarea><input v-else v-model="f.text" :disabled="!f.enabled" :placeholder="f.schema.type && f.schema.type !== 'string' ? '输入 '+f.schema.type+' 值' : '输入字符串'" @input="f.preserved = false"></div><button v-if="customHeader(selectedStep,f)" type="button" class="remove-field icon-button" aria-label="移除 Header" @click="selectedStep.fields = selectedStep.fields.filter(item => item.key !== f.key); dirty = true"><UiIcon name="close" :size="14"/></button></div></section></template>
                <p v-if="!selectedStep.fields.length" class="muted">此接口没有必填参数，可按需添加认证 Header。</p><button type="button" class="text-button add-header" @click="addHeader(selectedStep)"><UiIcon name="plus" :size="15"/>认证 / 自定义 Header</button>
                <details class="schema-reference"><summary><UiIcon name="code" :size="16"/>查看绑定版本的参数 Schema</summary><SchemaTree v-for="p in selectedStep.definition.parameters" :key="p.location+p.name" :schema="p.schema" :label="p.location+'.'+p.name" :required="p.required"/><SchemaTree v-if="selectedStep.definition.request_body" :schema="selectedStep.definition.request_body.schema" label="JSON 请求体" :required="selectedStep.definition.request_body.required"/></details>
              </div></section>
            <section v-else class="surface compose-empty"><div class="empty"><span class="empty-icon"><UiIcon name="layers" :size="32"/></span><h3>选择接口，开始编排</h3><p>从当前项目的 YAML 文件中选择版本和接口。<br>同一个接口可以添加多次。</p><button type="button" class="primary" @click="choose()"><UiIcon name="plus"/>添加接口步骤</button></div></section>
          </div>
        </fieldset>
      </form>
    </template>
    <div v-else class="history-layout">
      <aside class="surface run-list"><div class="outline-heading"><h2>运行历史 <span class="count">{{ runTotal }}</span></h2><form class="run-filter" @submit.prevent="runPage = 1; act(loadRuns)"><select v-model="statusFilter" aria-label="运行状态"><option value="">全部状态</option><option v-for="s in ['queued','running','succeeded','failed']" :key="s" :value="s">{{ labels[s] }}</option></select><button class="icon-button" :disabled="busy" aria-label="筛选运行" title="筛选" type="submit"><UiIcon name="search" :size="16"/></button></form></div><button v-for="r in runs" :key="r.id" class="run-list-item" :class="{ active: runDetail?.run.id === r.id }" :disabled="busy" @click="requestPage = 1; act(() => loadRun(r.id))"><div><strong>运行 #{{ r.id }}</strong><span class="status" :class="r.status">{{ labels[r.status] }}</span></div><small>{{ time(r.created_at) }}</small><span class="run-duration"><UiIcon name="clock" :size="13"/>{{ duration(r.duration_ms) }}</span></button><div v-if="!runs.length && !busy && !error" class="empty small-empty">暂无运行记录</div><div class="pagination"><button class="icon-button" :disabled="busy || runPage <= 1" aria-label="运行历史上一页" @click="runPage--; act(loadRuns)"><UiIcon name="arrow" :size="15"/></button><span>{{ runPage }} / {{ Math.max(1,Math.ceil(runTotal/20)) }}</span><button class="icon-button" :disabled="busy || runPage*20 >= runTotal" aria-label="运行历史下一页" @click="runPage++; act(loadRuns)"><UiIcon name="chevron" :size="15"/></button></div></aside>
      <section v-if="runDetail" class="surface run-detail"><div class="run-detail-heading"><div><div class="eyebrow">EXECUTION DETAIL</div><h2>运行 #{{ runDetail.run.id }}<span class="status" :class="runDetail.run.status">{{ labels[runDetail.run.status] }}</span></h2></div><button class="icon-button" :disabled="busy" aria-label="刷新运行详情" @click="act(refreshHistory)"><UiIcon name="refresh"/></button></div><div class="run-metrics"><div><small>开始时间</small><strong>{{ time(runDetail.run.started_at) }}</strong></div><div><small>结束时间</small><strong>{{ time(runDetail.run.finished_at) }}</strong></div><div><small>总耗时</small><strong>{{ duration(runDetail.run.duration_ms) }}</strong></div><div><small>执行步骤</small><strong>{{ runDetail.steps.filter(s => s.status === 'succeeded').length }} <span>/ {{ runDetail.steps.length }}</span></strong></div></div><div v-if="runDetail.run.error_code" class="alert run-error"><UiIcon name="info"/>{{ errors[runDetail.run.error_code] || runDetail.run.error_code }} · {{ runDetail.run.error_message }}</div>
        <nav class="tabs detail-tabs" aria-label="运行详情分区"><button :class="{ active: detailTab === 'steps' }" :aria-pressed="detailTab === 'steps'" @click="detailTab = 'steps'">执行步骤</button><button :class="{ active: detailTab === 'requests' }" :aria-pressed="detailTab === 'requests'" @click="detailTab = 'requests'">请求记录<span class="count">{{ requestTotal }}</span></button><button :class="{ active: detailTab === 'parameters' }" :aria-pressed="detailTab === 'parameters'" @click="detailTab = 'parameters'">参数结果</button><button :class="{ active: detailTab === 'snapshot' }" :aria-pressed="detailTab === 'snapshot'" @click="detailTab = 'snapshot'">配置快照</button></nav>
        <div class="run-detail-content">
          <template v-if="detailTab === 'steps'"><div class="section-top"><h3>顺序执行结果</h3><small>每步骤最多发送一次请求</small></div><div class="execution-timeline"><article v-for="s in runDetail.steps" :key="s.id" class="execution-step"><span class="execution-number" :class="s.status"><UiIcon v-if="s.status === 'succeeded'" name="check" :size="15"/><UiIcon v-else-if="s.status === 'failed'" name="close" :size="15"/><span v-else>{{ s.position }}</span></span><div class="execution-step-body"><div class="section-top"><div class="endpoint-title"><span class="method" :class="runDetail.config_snapshot.task.steps.find(t => t.id === s.step_id)?.method.toLowerCase()">{{ runDetail.config_snapshot.task.steps.find(t => t.id === s.step_id)?.method }}</span><code>{{ runDetail.config_snapshot.task.steps.find(t => t.id === s.step_id)?.path }}</code></div><span class="status" :class="s.status">{{ labels[s.status] }}</span></div><div class="execution-meta"><span>步骤 ID {{ s.step_id }}</span><span>{{ duration(s.duration_ms) }}</span><button v-if="s.request_id" class="text-button" :disabled="busy" @click="openRequest(s.request_id)">请求 #{{ s.request_id }}<UiIcon name="chevron" :size="14"/></button></div><small class="block">{{ time(s.started_at) }} → {{ time(s.finished_at) }}</small><p v-if="s.error_code" class="step-error">{{ errors[s.error_code] || s.error_code }} · {{ s.error_message }}</p></div></article></div></template>
          <template v-else-if="detailTab === 'parameters'"><div class="section-top"><h3>全局参数初始化</h3><small>本次运行独立结果</small></div><div v-if="!runDetail.global_parameters.length" class="empty small-empty">无全局参数。</div><div v-for="p in runDetail.global_parameters" :key="p.id" class="parameter-result"><div><b>{{ p.name }}</b><code>{{ p.value_type }}</code></div><pre>{{ p.sensitive || p.redacted ? '••••••' : pretty(p.value) }}</pre><span class="status" :class="p.status">{{ labels[p.status] }}</span><small v-if="p.error_code">{{ p.error_code }} {{ p.error_message }}</small></div></template>
          <template v-else-if="detailTab === 'requests'"><div v-for="r in requests" :key="r.id" class="request-row"><span class="method" :class="r.method.toLowerCase()">{{ r.method }}</span><div><code>{{ r.actual_url }}</code><small class="block">请求 #{{ r.id }} · 步骤 {{ r.step_id }} · {{ duration(r.duration_ms) }}</small></div><span class="http-status" :class="{ 'http-error': (r.response_status || 0) >= 300 }">{{ r.response_status ?? '等待响应' }}</span><button class="text-button" :disabled="busy" @click="openRequest(r.id)">详情<UiIcon name="chevron" :size="14"/></button></div><div v-if="!requests.length" class="empty small-empty">尚无已发送请求。</div><div class="pagination"><button :disabled="busy || requestPage <= 1" @click="requestPage--; act(loadRequests)">上一页</button><span>{{ requestPage }} / {{ Math.max(1,Math.ceil(requestTotal/20)) }}</span><button :disabled="busy || requestPage*20 >= requestTotal" @click="requestPage++; act(loadRequests)">下一页</button></div></template>
          <template v-else><div class="section-top"><h3>不可变配置快照</h3><span class="tag"><UiIcon name="lock" :size="12"/>已脱敏</span></div><p class="muted">任务或 YAML 的后续修改不会改变本次运行的配置。</p><pre class="snapshot-code">{{ pretty(safeJSON(runDetail.config_snapshot)) }}</pre></template>
        </div></section>
      <section v-else class="surface history-empty"><div class="empty"><span class="empty-icon"><UiIcon name="clock" :size="30"/></span><h3>查看一次运行</h3><p>从左侧选择记录，查看步骤状态与请求结果。</p></div></section>
    </div>
    <div v-if="requestDetail" class="overlay drawer-overlay" @click.self="requestDetail = undefined" @keydown.esc="requestDetail = undefined"><section class="request-drawer" role="dialog" aria-modal="true" aria-labelledby="request-title" tabindex="-1"><div class="drawer-heading"><div><div class="eyebrow">HTTP TRANSACTION</div><h2 id="request-title">请求 #{{ requestDetail.id }}</h2><small>运行 {{ requestDetail.run_id }} · 步骤 {{ requestDetail.step_id }} · 序号 {{ requestDetail.position }}</small></div><button class="icon-button" aria-label="关闭请求详情" @click="requestDetail = undefined"><UiIcon name="close"/></button></div><div class="drawer-endpoint"><span class="method" :class="requestDetail.method.toLowerCase()">{{ requestDetail.method }}</span><code>{{ requestDetail.actual_url }}</code></div><div class="drawer-meta"><span>状态码 <b>{{ requestDetail.response_status ?? '无响应' }}</b></span><span>耗时 <b>{{ duration(requestDetail.duration_ms) }}</b></span></div><div v-if="requestDetail.error_code" class="alert">{{ errors[requestDetail.error_code] || requestDetail.error_code }} · {{ requestDetail.error_message }}</div><nav class="tabs" aria-label="请求详情分区"><button :class="{ active: requestPart === 'request' }" :aria-pressed="requestPart === 'request'" @click="requestPart = 'request'">请求</button><button :class="{ active: requestPart === 'response' }" :aria-pressed="requestPart === 'response'" @click="requestPart = 'response'">响应</button></nav><div class="drawer-body"><div class="section-top"><h3>{{ requestPart === 'request' ? '请求头' : '响应头' }}</h3><span class="tag"><UiIcon name="lock" :size="12"/>敏感头已隐藏</span></div><pre>{{ pretty(headers(requestPart === 'request' ? requestDetail.request_headers : requestDetail.response_headers)) }}</pre><div class="section-top"><h3>{{ requestPart === 'request' ? '请求体' : '响应体' }}</h3><small v-if="requestPart === 'response'">{{ requestDetail.response_body_encoding }}</small></div><pre class="body-code">{{ (requestPart === 'request' ? requestDetail.request_body : requestDetail.response_body) ?? (requestPart === 'request' ? '无请求体' : '无响应体') }}</pre><div class="request-times"><small>开始 {{ time(requestDetail.started_at) }}</small><small>结束 {{ time(requestDetail.finished_at) }}</small></div></div></section></div>
    <div v-if="modal" class="overlay" @click.self="!busy && (modal = null)" @keydown.esc="!busy && (modal = null)"><section class="dialog" :class="{ 'task-dialog': modal === 'choose' }" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title"><div class="dialog-heading"><div><div class="eyebrow">{{ modal === 'choose' ? 'API LIBRARY' : 'TASK MANAGEMENT' }}</div><h2 id="task-dialog-title">{{ modal === 'parameter' ? (draft.parameters.some(p => p.key === editingParameter?.key) ? '修改参数' : '新增参数') : modal === 'choose' ? '添加接口步骤' : modal === 'copy' ? '复制任务' : modal === 'discard' ? '放弃未保存更改' : '确认删除任务' }}</h2></div><button :disabled="busy" class="icon-button" aria-label="关闭" @click="modal = null"><UiIcon name="close"/></button></div><div v-if="error" class="alert" role="alert">{{ error.detail }}<div v-for="(issue,i) in error.issues" :key="i">{{ issue.location }} · {{ issue.reason }}</div><small>{{ error.code }} {{ error.requestId }}</small></div>
      <ParameterEditor v-if="modal === 'parameter' && editingParameter" :parameter="editingParameter" :draft="draft" @confirm="applyParameter" @cancel="modal = null"/>
      <template v-else-if="modal === 'choose'"><p v-if="replacing !== undefined" class="inline-note">重新选择后清空该步骤的参数绑定，请重新配置。</p><div class="picker-controls"><label>YAML 文件<select aria-label="YAML 文件" v-model="selectedFile" :disabled="busy" @change="chooseFile"><option :value="undefined">选择文件</option><option v-for="f in files" :key="f.id" :value="f.id">{{ f.name }}</option></select></label><label>固定版本<select aria-label="固定版本" v-model="selectedVersion" :disabled="busy || !selectedFile" @change="act(loadChoices)"><option :value="undefined">选择版本</option><option v-for="v in versions" :key="v.version" :value="v.version">v{{ v.version }}{{ v.is_current ? ' · 当前' : ' · 历史' }}</option></select></label></div><div v-if="interfaces.length" class="picker-search search-form"><UiIcon name="search" :size="17"/><input v-model="interfaceSearch" placeholder="搜索方法、路径或摘要…" aria-label="搜索可选接口"><small>{{ matchingInterfaces.length }} 个接口</small></div><div class="picker-results"><button v-for="api in matchingInterfaces" :key="api.id" class="interface-row" :disabled="busy" @click="selectInterface(api)"><span class="method" :class="api.method.toLowerCase()">{{ api.method }}</span><div><code>{{ api.path }}</code><small>{{ api.summary || '暂无摘要' }}</small></div><UiIcon name="plus" :size="17"/></button><div v-if="!files.length" class="empty"><UiIcon name="file" :size="30"/><p>请先在接口资产中导入 YAML 文件。</p></div><div v-else-if="!matchingInterfaces.length && !busy" class="empty">{{ selectedVersion ? '该版本没有匹配的接口' : '选择文件和版本，浏览可用接口。' }}</div></div><div class="dialog-footnote"><UiIcon name="lock" :size="14"/>选择后固定版本，后续 YAML 更新不会自动替换。</div></template>
      <form v-else-if="modal === 'copy'" @submit.prevent="copyTask"><label>新任务名称<input v-model="copyName" required maxlength="120"></label><p>复制配置及版本绑定，重新分配步骤 ID，不复制运行历史。</p><div class="dialog-actions"><button type="button" :disabled="busy" @click="modal = null">取消</button><button class="primary" :disabled="busy">复制任务</button></div></form>
      <template v-else-if="modal === 'discard'"><p>未保存的任务更改将丢失。</p><div class="dialog-actions"><button @click="modal = null">继续编辑</button><button class="danger" @click="discard">放弃并返回</button></div></template>
      <template v-else-if="deletion"><p>永久删除「{{ target?.name }}」及关联记录，无法撤销。</p><div class="delete-counts"><span><b>{{ deletion.step_count }}</b>步骤</span><span><b>{{ deletion.run_count }}</b>运行</span><span><b>{{ deletion.request_count }}</b>请求</span></div><div v-if="!deletion.can_delete" class="alert"><p v-for="reason in deletion.blocking_reasons" :key="reason">{{ reason }}</p></div><div class="dialog-actions"><button :disabled="busy" @click="modal = null">取消</button><button class="danger solid" :disabled="busy || !deletion.can_delete" @click="deleteTask">确认永久删除</button></div></template>
    </section></div>
  </div>
</template>
