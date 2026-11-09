<script setup lang="ts">
import { usePageHistory, isRestoringHistory } from '../usePageHistory'
import { pageId } from '../page-history'
import { useId } from 'vue'
// Keep the component instance suffix unique, including recursive and repeated components.
const divId = useId()

import { computed, onMounted, reactive, ref, watch, onBeforeUnmount } from 'vue'
import { ApiError, query, request, type Model } from '../api'
import ComputeNodeEditor from './ComputeNodeEditor.vue'
import PollPolicyEditor from './PollPolicyEditor.vue'
import SqlNodeEditor from './SqlNodeEditor.vue'
import { buildTask, controlDraft, nodeType, scope, orderedSteps, field, fieldsFor, parameterDraft, key, secretHeader, stepDraft, textValue, type Draft, type FieldDraft, type StepDraft, type TaskModel } from '../task-editor'
import { deleteSelectedTasks } from '../task-bulk'
import { appendCollectionTasks, buildCollection, toggleCollectionTask } from '../task-collection'
import { buildImportBody, validateImportFiles, MAX_IMPORT_FILES } from '../task-import'
import type { components as CollectionComponents } from '../task-collection-api-schema'
import { buildParameterPreview, type ParameterModel } from '../parameter-preview'
import { buildStepTest } from '../step-test'
import { parseValue, type ParameterDraft } from '../task-editor'
import CollectionWorkspace from './CollectionWorkspace.vue'
import RunNodeResult from './RunNodeResult.vue'
import ParameterConfig from './ParameterConfig.vue'
import ParameterEditor from './ParameterEditor.vue'
import SchemaTree from './SchemaTree.vue'
import AssertionEditor from './AssertionEditor.vue'
import UiIcon from './UiIcon.vue'
import IconAction from './IconAction.vue'
import { useDialogFocus } from '../useDialogFocus'
import { requestCurl, requestHttp, copyText } from '../request-export'
const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ busy: [value: boolean]; dirty: [value: boolean] }>()
const base = `/projects/${props.projectId}`
const tasks = ref<TaskModel<'TaskSummary'>[]>([]), task = ref<TaskModel<'Task'>>()
const listTab = ref<'tasks' | 'collections'>('tasks'), collectionDirty = ref(false)
const search = ref(''), page = ref(1), total = ref(0), busy = ref(false), error = ref<ApiError>(), notice = ref('')
const executionResult = ref<'' | TaskModel<'TaskSummary'>['last_execution_result']>('')
const executionResultLabels: Record<TaskModel<'TaskSummary'>['last_execution_result'], string> = { failed: '失败', not_executed: '未执行', queued: '排队或执行中', succeeded: '成功' }
const view = ref<'list' | 'editor' | 'history'>('list'), dirty = ref(false)
const editorTab = ref<'config' | 'parameters' | 'steps'>('config')
const selectedStepKey = ref<number>()
const selectedStep = computed(() => draft.steps.find(s => s.key === selectedStepKey.value) || draft.steps[0])
const displaySteps = computed(() => orderedSteps(draft.steps))
const parallelParents = computed(() => draft.steps.filter(s => nodeType(s) === 'parallel' && scope(s) === 'main' && !s.parent_key))
const selectedStepIndex = computed(() => draft.steps.findIndex(s => s.key === selectedStep.value?.key))
const detailTab = ref<'steps' | 'parameters' | 'requests' | 'snapshot'>('steps')
const requestPart = ref<'request' | 'response'>('response')
const interfaceSearch = ref('')
const matchingInterfaces = computed(() => interfaces.value.filter(i => `${i.method} ${i.path} ${i.summary}`.toLowerCase().includes(interfaceSearch.value.toLowerCase())))
const locations = ['path', 'query', 'header', 'body'] as const
const draft = reactive<Draft>({ name: '', description: '', base_url: '', timeout_seconds: 30, parameters: [], steps: [] })
const modal = ref<'choose' | 'copy' | 'bulk-delete' | 'delete' | 'discard' | 'parameter' | 'import' | 'collection' | 'join-collection' | null>(null)
const collectionName = ref(''), collectionDescription = ref(''), collectionSearch = ref('')
const collectionTasks = ref<TaskModel<'TaskSummary'>[]>([]), collectionSelection = ref<number[]>([])
const collectionTasksLoaded = ref(false)
const matchingCollectionTasks = computed(() => collectionTasks.value.filter(t => t.name.toLowerCase().includes(collectionSearch.value.toLowerCase())))
async function prepareCollection() {
  rememberDialogTrigger()
  collectionName.value = ''; collectionDescription.value = ''; collectionSearch.value = ''; collectionSelection.value = []; collectionTasks.value = []; collectionTasksLoaded.value = false
  modal.value = 'collection'
  await act(loadCollectionTasks)
}
async function loadCollectionTasks() {
  collectionTasks.value = await allPages<TaskModel<'TaskSummary'>>(`${base}/tasks`)
  collectionTasksLoaded.value = true
}
async function createCollection() {
  await act(async () => {
    if (!collectionTasksLoaded.value) throw new ApiError('请先成功加载项目任务。')
    const body = buildCollection(collectionName.value, collectionDescription.value, collectionSelection.value)
    const saved = await request<CollectionComponents['schemas']['Collection']>(`${base}/task-collections`, 'POST', body)
    modal.value = null
    notice.value = `任务组「${saved.name}」已创建，共 ${saved.members.length} 个任务，按勾选顺序执行。`
  })
}
const joinMode = ref<'existing' | 'new'>('existing')
const joinGroups = ref<CollectionComponents['schemas']['Collection'][]>([]), joinGroupsLoaded = ref(false)
const joinGroupId = ref<number>(), joinName = ref(''), joinDescription = ref('')
const joinTasks = ref<TaskModel<'TaskSummary'>[]>([])
const joinGroup = computed(() => joinGroups.value.find(group => group.id === joinGroupId.value))
const joinDuplicateCount = computed(() => joinTasks.value.filter(task => joinGroup.value?.members.some(member => member.task_id === task.id)).length)
async function loadJoinGroups() {
  joinGroups.value = await allPages<CollectionComponents['schemas']['Collection']>(`${base}/task-collections`)
  joinGroupsLoaded.value = true
  if (!joinGroups.value.length) joinMode.value = 'new'
}
async function prepareJoinCollection() {
  if (!selectedTasks.value.length) return
  rememberDialogTrigger()
  joinTasks.value = [...selectedTasks.value]; joinGroups.value = []; joinGroupsLoaded.value = false
  joinGroupId.value = undefined; joinName.value = ''; joinDescription.value = ''; joinMode.value = 'existing'
  modal.value = 'join-collection'
  await act(loadJoinGroups)
}
async function joinCollection() {
  await act(async () => {
    if (!joinTasks.value.length) throw new ApiError('请先选择要加入任务组的任务。')
    const ids = joinTasks.value.map(task => task.id)
    let saved: CollectionComponents['schemas']['Collection']
    let added = ids.length
    if (joinMode.value === 'new') {
      saved = await request<CollectionComponents['schemas']['Collection']>(`${base}/task-collections`, 'POST', buildCollection(joinName.value, joinDescription.value, ids))
    } else {
      if (!joinGroupsLoaded.value || !joinGroupId.value) throw new ApiError('请选择已有任务组。')
      const url = `${base}/task-collections/${joinGroupId.value}`
      const current = await request<CollectionComponents['schemas']['Collection']>(url)
      const body = appendCollectionTasks(current, ids)
      added = body.members.length - current.members.length
      saved = added ? await request<CollectionComponents['schemas']['Collection']>(url, 'PUT', body) : current
    }
    modal.value = null
    notice.value = joinMode.value === 'new'
      ? `任务组「${saved.name}」已创建，已加入 ${added} 个任务。`
      : `已向任务组「${saved.name}」加入 ${added} 个任务。${ids.length > added ? `已跳过 ${ids.length - added} 个已有任务。` : ''}`
  })
}
const importFiles = ref<File[]>([]), importBaseUrl = ref('')
function prepareImport() {
  rememberDialogTrigger(); importFiles.value = []; importBaseUrl.value = ''; error.value = undefined; modal.value = 'import'
}
async function importTask() {
  await act(async () => {
    const files = importFiles.value
    validateImportFiles(files)
    const baseUrl = importBaseUrl.value.trim()
    try {
      const url = new URL(baseUrl)
      if (baseUrl.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[?#\s]/.test(baseUrl)) throw new Error()
    } catch { throw new ApiError('请输入 HTTP/HTTPS 运行地址；允许路径前缀，禁止 query、fragment 和用户凭据。') }
    const saved = await request<TaskModel<'Task'>[]>(`${base}/tasks/import`, 'POST', buildImportBody(files, baseUrl))
    modal.value = null; importFiles.value = []; importBaseUrl.value = ''; search.value = ''; executionResult.value = ''; page.value = 1
    const nodeCount = saved.reduce((sum, task) => sum + task.steps.length, 0)
    notice.value = saved.length === 1
      ? `任务「${saved[0].name}」已导入，共 ${saved[0].steps.length} 个节点（含并行子节点及 finally）。`
      : `已导入 ${saved.length} 个任务（${saved.map(task => `「${task.name}」`).join('、')}），共 ${nodeCount} 个节点（含并行子节点及 finally）。`
    await loadTasks()
  })
}
const selectedTasks = ref<TaskModel<'TaskSummary'>[]>([])
const selectedTaskIds = computed(() => new Set(selectedTasks.value.map(t => t.id)))
const allPageTasksSelected = computed(() => tasks.value.length > 0 && tasks.value.every(t => selectedTaskIds.value.has(t.id)))
const somePageTasksSelected = computed(() => tasks.value.some(t => selectedTaskIds.value.has(t.id)) && !allPageTasksSelected.value)
const bulkPreviews = ref<{ task: TaskModel<'TaskSummary'>; preview: TaskModel<'DeletionPreview'> }[]>([])
const canBulkDelete = computed(() => bulkPreviews.value.length > 0 && bulkPreviews.value.every(t => t.preview.can_delete))
function selectTask(item: TaskModel<'TaskSummary'>, checked: boolean) {
  selectedTasks.value = selectedTasks.value.filter(t => t.id !== item.id)
  if (checked) selectedTasks.value.push(item)
}
function selectPage(checked: boolean) { for (const item of tasks.value) selectTask(item, checked) }
async function previewBulkDelete() {
  rememberDialogTrigger()
  await act(async () => {
    bulkPreviews.value = await Promise.all(selectedTasks.value.map(async task => ({ task, preview: await request<TaskModel<'DeletionPreview'>>(`${base}/tasks/${task.id}/deletion-preview`) })))
    if (bulkPreviews.value.length) modal.value = 'bulk-delete'
  })
}
async function bulkDeleteTasks() {
  if (!canBulkDelete.value) return
  await act(async () => {
    const result = await deleteSelectedTasks(bulkPreviews.value.map(t => t.task), id => request(`${base}/tasks/${id}?confirm=true`, 'DELETE'))
    const removed = new Set(result.deleted.map(t => t.id))
    selectedTasks.value = selectedTasks.value.filter(t => !removed.has(t.id))
    bulkPreviews.value = bulkPreviews.value.filter(t => !removed.has(t.task.id))
    if (task.value && removed.has(task.value.id)) { reset(); view.value = 'list' }
    if (!result.failed.length) modal.value = null
    notice.value = `已删除 ${result.deleted.length} 个任务及关联运行记录。`
    page.value = Math.max(1, Math.min(page.value, Math.ceil((total.value - result.deleted.length) / 20)))
    await loadTasks()
    if (result.failed.length) throw new ApiError(`已删除 ${result.deleted.length} 个任务，${result.failed.length} 个删除失败：` + result.failed.map(f => `${f.task.name}：${f.reason}`).join('；'))
  })
}
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
const errors: Record<string, string> = { CLEANUP_FAILED: '清理流程失败', PARALLEL_FAILED: '并行屏障失败', ASSERTION_FAILED: '业务断言未通过', ASSERTION_EXECUTION_ERROR: '业务断言执行异常', ASSERTION_RETURN_TYPE_ERROR: '业务断言必须返回布尔值', RESPONSE_NOT_JSON: '响应体不是有效 JSON', HTTP_STATUS_ERROR: 'HTTP 状态码错误', CONNECTION_ERROR: '连接失败', TIMEOUT: '请求超时', EXECUTION_INTERRUPTED: '执行中断（服务重启）' }
const assertionIssues = computed(() => (error.value?.issues || []).filter(i => issueStepIndex(i.location) === selectedStepIndex.value && i.location.endsWith('assertion_code')).map(i => i.reason))
function issueStepIndex(location: string) {
  const index = /steps(?:\[(\d+)\]|[./](\d+))/.exec(location)
  return index ? Number(index[1] ?? index[2]) : undefined
}
function locateIssue(location: string) {
  editorTab.value = location.includes('global_parameters') ? 'parameters' : location.includes('steps') ? 'steps' : 'config'
  const index = issueStepIndex(location)
  if (index !== undefined) selectedStepKey.value = draft.steps[index]?.key
}
const time = (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '—'
const duration = (v: number | null) => v === null ? '—' : `${v} ms`
const pretty = (v: unknown) => JSON.stringify(v, null, 2)
async function act(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; emit('busy', true); error.value = undefined; notice.value = ''
  try { await action() } catch (e) { error.value = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : '操作失败。'); if (view.value === 'editor' && error.value.issues[0]) locateIssue(error.value.issues[0].location) }
  finally { busy.value = false; emit('busy', false) }
}
async function allPages<T>(url: string): Promise<T[]> {
  const items: T[] = []; let page = 1
  while (true) { const result = await request<{ items: T[]; total: number }>(url + (url.includes('?') ? '&' : '?') + new URLSearchParams({ page: String(page++), page_size: '100' })); items.push(...result.items); if (items.length >= result.total || !result.items.length) return items }
}
async function loadTasks() {
  const result = await request<TaskModel<'TaskPage'>>(`${base}/tasks${query({ name: search.value, last_execution_result: executionResult.value, page: page.value, page_size: 20 })}`)
  // Preserve the API's global ordering before pagination: failed, not_executed, queued, succeeded.
  tasks.value = result.items; total.value = result.total
}
function reset() { stepResults.value.clear(); parameterPreviews.value.clear(); task.value = undefined; runDetail.value = undefined; requestDetail.value = undefined; runs.value = []; dirty.value = false }
function create() { reset(); Object.assign(draft, { name: '', description: '', base_url: '', timeout_seconds: 30, parameters: [], steps: [] }); view.value = 'editor'; editorTab.value = 'config'; selectedStepKey.value = undefined; error.value = undefined }
const stepResults = ref(new Map<number, { signature: string; result: Model<'InterfaceTestResult'> }>())
const editingParameter = ref<ParameterDraft>()
const parameterPreviews = ref(new Map<number, { signature: string; value: unknown; redacted?: boolean }>())
const parameterSignature = (p: ParameterDraft) => JSON.stringify([p.name, p.value_type, p.source_type, p.step_key, p.extract_expression, p.sensitive])
const stepSignature = (s: StepDraft) => {
  try {
    const previews = new Map<number, unknown>()
    for (const p of draft.parameters) { const v = parameterPreviews.value.get(p.key); if (v?.signature === parameterSignature(p) && !v.redacted) previews.set(p.key, v.value) }
    return JSON.stringify([s.interface_id, buildStepTest(draft, s, previews)])
  } catch { return 'invalid' }
}
watch(() => JSON.stringify([draft.base_url, draft.timeout_seconds, draft.steps.map(s => [s.key, s.interface_id, s.fields, s.raw_body, s.options, s.position, s.parent_key, s.execution_scope]), draft.parameters.filter(p => p.source_type !== 'rest').map(p => [p.name, p.value_type, p.text, p.sensitive])]), () => {
  stepResults.value.clear(); parameterPreviews.value.clear()
}, { flush: 'sync' })
watch(() => JSON.stringify(draft.parameters.filter(p => ['rest', 'expression'].includes(p.source_type || '')).map(p => [p.key, parameterSignature(p)])), () => parameterPreviews.value.clear(), { flush: 'sync' })
function validResult(s?: StepDraft) { if (!s || nodeType(s) !== 'rest') return; const stored = stepResults.value.get(s.key); return stored?.signature === stepSignature(s) ? stored.result : undefined }
function canExtract(p: ParameterDraft) { return !draft.steps.find(s => s.key === p.step_key)?.parent_key && !draft.steps.find(s => s.key === p.step_key)?.raw_body &&  !busy.value && !!draft.steps.find(s => s.key === p.step_key && nodeType(s) === 'rest' && scope(s) === 'main') && !!p.name.trim() && !!p.extract_expression?.trim() }
function previewValue(p: ParameterDraft) { const v = parameterPreviews.value.get(p.key); return v?.signature === parameterSignature(p) ? v : undefined }
function currentParameter(p: ParameterDraft) {
  if (p.sensitive || (p.retained?.redacted && !p.text)) return '••••••'
  if (p.source_type === 'expression') return '待任务运行计算'
  if (p.source_type === 'function') return '任务初始化时生成 UUID'
  if (p.source_type === 'rest') { const v = previewValue(p); return v ? v.redacted ? '••••••' : pretty(v.value) : '待预览取值' }
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
  for (const p of draft.parameters) { const v = previewValue(p); if (v && !v.redacted) values.set(p.key, v.value) }
  const { body, issues } = buildStepTest(draft, s, values)
  if (issues.length) throw new ApiError('请修正当前步骤的请求参数。', issues)
  const result = await request<Model<'InterfaceTestResult'>>(`${base}/yaml-files/${s.file_id}/interfaces/${s.interface_id}/test`, 'POST', body)
  stepResults.value.set(s.key, { signature: stepSignature(s), result })
}
async function executeStep(s: StepDraft) { await act(() => runStep(s)) }
async function previewParameter(p: ParameterDraft) {
  await act(async () => {
    if (!task.value || dirty.value || draft.steps.some(s => !s.id)) throw new ApiError('请先保存任务，再按完整执行树预览参数。')
    const result = await request<ParameterModel<'PreviewParameterResult'>>(`${taskBase.value}/parameters/preview`, 'POST', buildParameterPreview(draft, p.name))
    parameterPreviews.value.set(p.key, { signature: parameterSignature(p), value: result.value, redacted: result.redacted })
    notice.value = '流程预览完成，已执行必要的前序节点和并行屏障，不执行 finally。'
  })
}
async function extractParameter(p: ParameterDraft) {
  await act(async () => {
    if (!p.name.trim() || !p.extract_expression?.trim()) throw new ApiError('请填写参数名称和取值表达式。')
    const source = draft.steps.find(s => s.key === p.step_key)
    if (!source || nodeType(source) !== 'rest' || scope(source) !== 'main') throw new ApiError('请选择主流程 REST 来源节点。')
    if (source.parent_key) throw new ApiError('并行子节点请使用流程预览，等待整组屏障后取值。')
    if (!validResult(source)) {
      selectedStepKey.value = source.key
      await runStep(source)
    }
    const response = validResult(source)!
    if (response.status !== 'succeeded' || response.response_body === null || response.response_body_encoding !== 'utf-8') throw new ApiError(response.error_message || '来源接口未返回成功的 JSON 响应，请检查单次接口结果。')
    parameterPreviews.value.delete(p.key)
    const result = await request<ParameterModel<'ExtractRestParameterResult'>>('/parameters/rest/extract', 'POST', { parameter_name: p.name.trim(), value_type: p.value_type, extract_expression: p.extract_expression, response: { response_body: response.response_body, response_body_encoding: response.response_body_encoding } })
    parameterPreviews.value.set(p.key, { signature: parameterSignature(p), value: result.value })
    // Extraction does not change the HTTP request; keep this response usable for other bound parameters.
    for (const s of draft.steps) { const stored = stepResults.value.get(s.key); if (stored && s.key === p.step_key) stored.signature = stepSignature(s) }
    notice.value = `参数 ${p.name} 取值成功。`
  })
}
async function fillTask(saved: TaskModel<'Task'>) {
  const currentIndex = selectedStepIndex.value, currentId = selectedStep.value?.id
  const definitions = await Promise.all(saved.steps.map(s => s.step_type === 'rest' ? request<Model<'InterfaceDetail'>>(`${base}/yaml-files/${s.file_id}/interfaces/${s.interface_id}`) : undefined))
  const steps = saved.steps.map((s, i) => stepDraft(s, definitions[i]))
  saved.steps.forEach((s,i) => { steps[i]!.parent_key = steps.find(p => p.id === s.parent_step_id)?.key })
  stepResults.value.clear(); parameterPreviews.value.clear()
  Object.assign(draft, { name: saved.name, description: saved.description, base_url: saved.base_url, timeout_seconds: saved.timeout_seconds, parameters: saved.global_parameters.map(p => parameterDraft(p, steps)), steps })
  selectedStepKey.value = (draft.steps.find(s => s.id === currentId) || draft.steps[Math.max(0, currentIndex)])?.key
  task.value = saved; dirty.value = false; runDetail.value = undefined; requestDetail.value = undefined; runs.value = []; view.value = 'editor'
}
async function openTask(id: number) { editorTab.value = 'config'; selectedStepKey.value = undefined; await act(async () => fillTask(await request<TaskModel<'Task'>>(`${base}/tasks/${id}`))) }
function checkedBody(checkAvailability = false) {
  const { body, issues } = buildTask(draft, checkAvailability)
  if (issues.length) {
    const location = issues[0]!.location
    locateIssue(location)
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
function siblings(s: StepDraft) { return displaySteps.value.filter(p => p.parent_key === s.parent_key && scope(p) === scope(s)) }
function move(index: number, delta: number) {
  const s = draft.steps[index]!, group = siblings(s), other = group[group.indexOf(s)+delta]
  if (!other) return
  group.forEach((p,i) => p.position ??= i+1)
  ;[s.position, other.position] = [other.position, s.position]; dirty.value = true
}
function moveDisabled(delta: number) { const s = selectedStep.value; return !s || !siblings(s)[siblings(s).indexOf(s)+delta] }
function relocate(s: StepDraft) {
  if (scope(s) === 'finally') s.parent_key = undefined
  s.position = Math.max(0, ...draft.steps.filter(p => p !== s && p.parent_key === s.parent_key && scope(p) === scope(s)).map(p => p.position || draft.steps.indexOf(p)+1))+1
  dirty.value = true
}
function addControl(type: 'wait' | 'parallel' | 'sql' | 'compute') {
  const s = controlDraft(type); draft.steps.push(s); relocate(s); selectedStepKey.value = s.key; editorTab.value = 'steps'
}
function copyStep(index: number) {
  const source = draft.steps[index]!, originals = [source, ...draft.steps.filter(p => p.parent_key === source.key)]
  if (originals.some(s => s.fields.some(f => f.enabled && f.kind === 'literal' && f.preserved))) { error.value = new ApiError('节点包含隐藏字面值，请先重新输入或改用全局参数引用再复制。'); return }
  const copies: StepDraft[] = JSON.parse(JSON.stringify(originals))
  copies.forEach(s => { delete s.id; s.key = key(); s.fields.forEach(f => { f.key = key(); f.preserved = false }) })
  copies.forEach((copy, i) => {
    if (nodeType(copy) !== 'compute') return
    for (const p of draft.parameters.filter(p => p.source_type === 'expression' && p.step_key === originals[i]!.key)) {
      let suffix = 1, name = p.name.slice(0,110) + '_copy'
      while (draft.parameters.some(p => p.name === name)) name = p.name.slice(0,100) + '_copy' + suffix++
      draft.parameters.push({ ...p, key: key(), name, step_key: copy.key, retained: undefined, text: '' })
      copy.options?.expressions?.filter(e => e.name === p.name).forEach(e => e.name = name)
    }
  })
  copies.slice(1).forEach(s => s.parent_key = copies[0]!.key)
  draft.steps.push(...copies); relocate(copies[0]!); selectedStepKey.value = copies[0]!.key; dirty.value = true
}
function setAuth(s: StepDraft, mode: string) {
  const options = { ...s.options }
  if (!mode) delete options.auth
  else options.auth = mode === 'bearer' ? { mode, parameter: options.auth?.parameter || '' } : { mode: mode as 'none' | 'header' }
  s.options = options
  dirty.value = true
}
function toggleRaw(s: StepDraft, enabled: boolean) {
  s.raw_body = enabled ? { text: '' } : undefined
  if (enabled) s.fields.filter(f => f.location === 'body').forEach(f => f.enabled = false)
  dirty.value = true
}
function toggleField(s: StepDraft, f: FieldDraft) {
  dirty.value = true
  if (f.enabled && f.location === 'body') for (const other of s.fields) if (other !== f && other.location === 'body' && (other.name.startsWith(f.name + '/') || f.name.startsWith(other.name + '/'))) other.enabled = false
}
function privateField(f: FieldDraft) { return (f.location === 'header' && secretHeader(f.name)) || f.schema.format === 'password' || f.schema['x-sensitive'] === true }
function removeStep(index: number) { const s = draft.steps[index]!; draft.steps = draft.steps.filter(p => p.key !== s.key && p.parent_key !== s.key); selectedStepKey.value = displaySteps.value[0]?.key; dirty.value = true }
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
    const s: StepDraft = { key: previous?.key || key(), id: previous?.id, interface_id: api.id, file_id: file.id, version: api.version, file_name: file.name, method: api.method, path: api.path, has_new_version: api.version < file.current_version, definition, fields: fieldsFor(definition), options: previous?.options, assertion_code: previous?.assertion_code ?? '', step_type: 'rest', execution_scope: previous?.execution_scope || 'main', parent_key: previous?.parent_key, position: previous?.position }
    // Explicit reselection resets bindings so old types and hidden values cannot leak into another version.
    if (replacing.value === undefined) { draft.steps.push(s); relocate(s) } else draft.steps[replacing.value] = s
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
  await act(async () => { if (!deletion.value?.can_delete) return; await request(`${base}/tasks/${target.value?.id}?confirm=true`, 'DELETE'); modal.value = null; if (task.value?.id === target.value?.id) { reset(); view.value = 'list' }; if (tasks.value.length === 1 && page.value > 1) page.value--; await loadTasks(); selectedTasks.value = selectedTasks.value.filter(t => t.id !== target.value?.id); notice.value = '任务及关联运行记录已删除。' })
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
      const saved = await request<TaskModel<'Task'>>(task.value ? taskBase.value : `${base}/tasks`, task.value ? 'PUT' : 'POST', checkedBody(true))
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
async function editHistoryNode(stepId: number) {
  const taskId = task.value?.id
  if (!taskId) return
  await act(async () => {
    const saved = await request<TaskModel<'Task'>>(`${base}/tasks/${taskId}`)
    if (!saved.steps.some(s => s.id === stepId)) throw new ApiError('该节点已从当前任务中删除，无法编辑。')
    await fillTask(saved)
    selectedStepKey.value = draft.steps.find(s => s.id === stepId)!.key
    editorTab.value = 'steps'
  })
}
async function openMemberRun(taskId: number, runId: number) { await history(taskId); if (view.value === 'history') await act(() => loadRun(runId)) }
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
const replayBusy = ref(false), replayError = ref(''), replayResult = ref<Model<'InterfaceTestResult'>>()
const copyMessage = ref(''), copyError = ref(false)
watch(requestDetail, () => { replayResult.value = undefined; replayError.value = ''; copyMessage.value = '' })
async function copyRequest(format: 'curl' | 'http') {
  const selected = requestDetail.value
  if (!selected) return
  copyMessage.value = ''
  try {
    await copyText(format === 'curl' ? requestCurl(selected) : requestHttp(selected))
    if (requestDetail.value !== selected) return
    copyError.value = false
    copyMessage.value = `${format === 'curl' ? 'curl 命令' : 'HTTP 内容'}已复制，可使用 Ctrl+V 粘贴。`
  } catch {
    if (requestDetail.value !== selected) return
    copyError.value = true
    copyMessage.value = '复制失败，请检查浏览器剪贴板权限后重试。'
  }
}
async function replayRequest() {
  if (!requestDetail.value || replayBusy.value) return
  const selected = requestDetail.value
  const endpoint = `${runBase.value}/requests/${selected.id}/replay`
  replayBusy.value = true; replayError.value = ''; replayResult.value = undefined
  try {
    const result = await request<Model<'InterfaceTestResult'>>(endpoint, 'POST')
    if (requestDetail.value === selected) replayResult.value = result
  } catch (e) {
    if (requestDetail.value === selected) replayError.value = e instanceof ApiError ? e.detail : '单次执行失败。'
  } finally { replayBusy.value = false }
}
async function openRequest(id: number) { rememberDialogTrigger(); requestPart.value = 'response'; await act(async () => { requestDetail.value = await request<TaskModel<'Request'>>(`${runBase.value}/requests/${id}`) }) }
function headers(headers: TaskModel<'Header'>[] | null) { return headers?.map(h => ({ name: h.name, value: h.redacted || secretHeader(h.name) ? '••••••' : h.value })) || [] }
function safeJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeJSON)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, k === 'value' && (object.redacted || object.sensitive || (typeof object.name === 'string' && secretHeader(object.name))) ? '••••••' : secretHeader(k) || /^(password|datasource)$/i.test(k) ? '••••••' : safeJSON(v)]))
  }
  return value
}
const rememberDialogTrigger = useDialogFocus(() => modal.value !== null || requestDetail.value !== undefined)
watch([dirty, collectionDirty], ([a,b]) => emit('dirty',a || b))
function leaving(event: BeforeUnloadEvent) { if (dirty.value || collectionDirty.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => { window.addEventListener('beforeunload', leaving); if (!isRestoringHistory()) act(loadTasks) })
usePageHistory({
  capture: () => ({
    taskList: listTab.value,
    ...(view.value !== 'list' ? { task: task.value ? String(task.value.id) : 'new', taskView: view.value,
      ...(view.value === 'editor' ? { editorTab: editorTab.value, ...(selectedStep.value?.id ? { step: String(selectedStep.value.id) } : {}) } : { ...(runDetail.value ? { run: String(runDetail.value.run.id), runTab: detailTab.value } : {}), ...(requestDetail.value ? { request: String(requestDetail.value.id), requestTab: requestPart.value } : {}) }),
    } : {}),
  }),
  busy: () => busy.value,
  allow: location => !dirty.value || (pageId(location.project) === props.projectId && location.section === 'tasks' && location.task === (task.value ? String(task.value.id) : 'new') && location.taskView === 'editor') || window.confirm('任务有未保存的修改，确定离开？'),
  restore: async location => {
    if (pageId(location.project) !== props.projectId || location.section !== 'tasks') return
    modal.value = null
    listTab.value = location.taskList === 'collections' ? 'collections' : 'tasks'
    if (!location.task) { reset(); view.value = 'list'; await act(loadTasks); return }
    if (location.task === 'new') { if (view.value !== 'editor' || task.value) create() }
    else {
      const id = pageId(location.task)
      if (!id) return
      if (location.taskView === 'history') {
        if (view.value !== 'history' || task.value?.id !== id) await history(id)
        const runId = pageId(location.run)
        if (runId && runDetail.value?.run.id !== runId) await act(() => loadRun(runId))
        detailTab.value = ['steps', 'parameters', 'requests', 'snapshot'].includes(location.runTab) ? location.runTab as typeof detailTab.value : 'steps'
        const requestId = pageId(location.request)
        if (requestId && requestDetail.value?.id !== requestId) await openRequest(requestId)
        if (!requestId) requestDetail.value = undefined
        requestPart.value = location.requestTab === 'request' ? 'request' : 'response'
        return
      }
      if (view.value !== 'editor' || task.value?.id !== id) await openTask(id)
    }
    editorTab.value = ['config', 'parameters', 'steps'].includes(location.editorTab) ? location.editorTab as typeof editorTab.value : 'config'
    selectedStepKey.value = draft.steps.find(s => s.id === pageId(location.step))?.key || draft.steps[0]?.key
  },
})
onBeforeUnmount(() => { window.removeEventListener('beforeunload', leaving); emit('dirty', false) })
</script>

<template>
  <div :id="'task-workspace-task-workspace-' + divId" class="task-workspace" :class="{ 'task-editing': view === 'editor', 'task-history': view === 'history', 'task-listing': view === 'list' }">
    <div :id="'task-workspace-workspace-heading-' + divId" class="workspace-heading">
      <div :id="'task-workspace-block-' + divId"><IconAction v-if="view !== 'list'" class="back-link" :disabled="busy" @click="back" icon="arrow" label="返回任务列表"/><div :id="'task-workspace-eyebrow-' + divId" v-else class="eyebrow">TEST WORKFLOWS</div><h1>{{ view === 'list' ? '任务编排' : view === 'editor' ? (task ? draft.name || '编辑任务' : '新建任务') : task?.name }}</h1><p>{{ view === 'list' ? '将接口组成可重复执行的测试流程。' : view === 'editor' ? '配置运行环境、参数、主流程、并行节点与 finally 清理流程。' : '查看每次执行的状态、配置与请求结果。' }}</p></div>
      <div :id="'task-workspace-actions-' + divId" class="actions">
        <template v-if="view === 'list' && listTab === 'tasks'"><IconAction :disabled="busy" @click="act(loadTasks)" icon="refresh" label="刷新"/><button :disabled="busy" @click="prepareImport"><UiIcon name="file"/>导入 XML 任务</button><button :disabled="busy" @click="prepareCollection"><UiIcon name="layers"/>创建任务组</button><button class="primary" :disabled="busy" @click="create"><UiIcon name="plus"/>新建任务</button></template>
        <template v-else-if="view === 'editor'"><span v-if="dirty" class="unsaved"><span></span>未保存</span><IconAction :disabled="busy || active" form="task-editor" type="submit" icon="save" label="保存任务"/><IconAction class="primary" :disabled="busy || active || !draft.steps.length" @click="start(task?.id || 0,true)" icon="play" label="保存并运行"/></template>
        <template v-else-if="view === 'history'"><IconAction v-if="task" :disabled="busy" @click="openTask(task.id)" icon="edit" label="编辑任务"/><IconAction :disabled="busy" @click="act(refreshHistory)" icon="refresh" label="刷新历史及详情"/><IconAction v-if="task" class="primary" :disabled="busy || active" @click="start(task.id)" icon="play" label="重新运行任务"/></template>
      </div>
    </div>
    <div :id="'task-workspace-alert-' + divId" v-if="error && !modal" class="alert" role="alert"><div :id="'task-workspace-feedback-heading-' + divId" class="feedback-heading"><UiIcon name="info"/><strong>{{ error.detail }}</strong><IconAction class="icon-button" @click="error = undefined" icon="close" label="关闭错误提示"/></div><div :id="'task-workspace-block-2-' + divId + '-' + encodeURIComponent(String(i))" v-for="(issue,i) in error.issues" :key="i"><code>{{ issue.location }}</code> · {{ issue.reason }}</div><small>{{ error.code }} {{ error.requestId ? '请求 ID：' + error.requestId : '' }}</small></div>

    <div :id="'task-workspace-success-' + divId" v-if="notice" class="success" role="status"><UiIcon name="check"/>{{ notice }}<IconAction class="icon-button" @click="notice = ''" icon="close" label="关闭成功提示"/></div>
    <div :id="'task-workspace-working-' + divId" v-if="busy" class="working" role="status"><span class="spinner"></span>正在处理…</div>
    <nav v-if="view === 'list'" class="tabs"><button :class="{active: listTab === 'tasks'}" :disabled="busy || collectionDirty" @click="listTab='tasks'">任务</button><button :class="{active: listTab === 'collections'}" :disabled="busy" @click="listTab='collections'">任务组</button></nav>
    <CollectionWorkspace v-if="view === 'list' && listTab === 'collections'" :project-id="projectId" @busy="busy=$event; emit('busy',$event)" @dirty="collectionDirty=$event" @open-run="openMemberRun"/>
    <section v-else-if="view === 'list'" class="surface">
      <div :id="'task-workspace-surface-toolbar-' + divId" class="surface-toolbar"><div :id="'task-workspace-section-label-' + divId" class="section-label">全部任务 <span class="count">{{ total }}</span></div><label class="task-result-filter">上次执行结果<select v-model="executionResult" :disabled="busy" @change="page = 1; act(loadTasks)"><option value="">全部结果</option><option value="failed">失败</option><option value="not_executed">未执行</option><option value="queued">排队或执行中</option><option value="succeeded">成功</option></select></label><form class="search-form" @submit.prevent="page = 1; act(loadTasks)"><UiIcon name="search" :size="17"/><input v-model="search" placeholder="搜索任务名称…" aria-label="任务名称搜索"><button :disabled="busy">搜索</button></form></div>
      <div class="surface-toolbar task-selection-toolbar"><span>已选择 {{ selectedTasks.length }} 个任务</span><div class="actions"><button :disabled="busy || !selectedTasks.length" @click="selectedTasks = []">取消选择</button><button class="danger" :disabled="busy || !selectedTasks.length" @click="previewBulkDelete"><UiIcon name="trash" :size="15"/>批量删除</button><button :disabled="busy || !selectedTasks.length" @click="prepareJoinCollection"><UiIcon name="layers" :size="15"/>加入任务组</button></div></div>
      <div :id="'task-workspace-table-scroll-' + divId" class="table-scroll task-table-wrap"><table class="task-table"><thead><tr><th class="task-select-cell"><input type="checkbox" :checked="allPageTasksSelected" :indeterminate="somePageTasksSelected" :disabled="busy || !tasks.length" aria-label="全选当前页任务" @change="selectPage(($event.target as HTMLInputElement).checked)"></th><th>任务名称</th><th>运行环境</th><th>步骤</th><th>上次执行结果</th><th>上次执行时间</th><th>更新时间</th><th class="align-right">操作</th></tr></thead><tbody><tr v-for="item in tasks" :key="item.id"><td class="task-select-cell"><input type="checkbox" :checked="selectedTaskIds.has(item.id)" :disabled="busy" :aria-label="'选择任务 ' + item.name" @change="selectTask(item, ($event.target as HTMLInputElement).checked)"></td><td><div :id="'task-workspace-entity-cell-' + divId + '-' + encodeURIComponent(String(item.id))" class="entity-cell"><span class="entity-icon"><UiIcon name="workflow"/></span><div :id="'task-workspace-block-3-' + divId + '-' + encodeURIComponent(String(item.id))"><button class="entity-title" :disabled="busy" @click="history(item.id)">{{ item.name }}</button><small class="block">{{ item.description || '暂无描述' }}</small></div></div></td><td><code class="url-text">{{ item.base_url }}</code><small v-if="item.has_active_run" class="block"><span class="status running">有未结束运行</span></small></td><td><span class="step-count">{{ item.step_count }} <small>步</small></span></td><td><span class="status" :class="item.last_execution_result">{{ executionResultLabels[item.last_execution_result] }}</span></td><td class="muted">{{ time(item.last_execution_time) }}</td><td class="muted">{{ time(item.updated_at) }}</td><td><div :id="'task-workspace-row-actions-' + divId + '-' + encodeURIComponent(String(item.id))" class="row-actions"><button class="text-button" :disabled="busy" @click="openTask(item.id)">编辑</button><button class="text-button" :disabled="busy" @click="history(item.id)">历史</button><button class="run-button" :disabled="busy || item.has_active_run || !item.step_count" @click="start(item.id)"><UiIcon name="play" :size="13"/>运行</button><details class="action-menu"><summary aria-label="更多任务操作"><UiIcon name="more"/></summary><div :id="'task-workspace-block-4-' + divId + '-' + encodeURIComponent(String(item.id))"><button :disabled="busy" @click="prepareCopy(item)"><UiIcon name="copy" :size="15"/>复制</button><button class="danger" :disabled="busy || item.has_active_run" @click="previewDelete(item)"><UiIcon name="trash" :size="15"/>删除</button></div></details></div></td></tr></tbody></table></div>
      <div :id="'task-workspace-empty-' + divId" v-if="!tasks.length && !busy && !error" class="empty"><span class="empty-icon"><UiIcon name="workflow" :size="30"/></span><h3>{{ search || executionResult ? '没有匹配的任务' : '开始你的第一个测试流程' }}</h3><p>{{ search || executionResult ? '尝试其他名称或执行结果，或清空筛选条件。' : '选择接口，配置参数，然后按顺序执行。' }}</p><button v-if="!search && !executionResult" class="primary" @click="create"><UiIcon name="plus"/>新建任务</button></div>
      <div :id="'task-workspace-table-footer-' + divId" class="table-footer"><small>共 {{ total }} 个任务</small><div :id="'task-workspace-pagination-' + divId" class="pagination"><button :disabled="busy || page <= 1" @click="page--; act(loadTasks)">上一页</button><span>{{ page }} / {{ Math.max(1, Math.ceil(total/20)) }}</span><button :disabled="busy || page*20 >= total" @click="page++; act(loadTasks)">下一页</button></div></div>
    </section>
    <template v-else-if="view === 'editor'">
      <div :id="'task-workspace-editor-nav-' + divId" class="editor-nav"><nav class="tabs" aria-label="任务编辑分区"><button :class="{ active: editorTab === 'config' }" :aria-pressed="editorTab === 'config'" @click="editorTab = 'config'"><UiIcon name="settings" :size="16"/>基本配置</button><button :class="{ active: editorTab === 'parameters' }" :aria-pressed="editorTab === 'parameters'" @click="editorTab = 'parameters'"><UiIcon name="code" :size="16"/>全局参数<span class="count">{{ draft.parameters.length }}</span></button><button :class="{ active: editorTab === 'steps' }" :aria-pressed="editorTab === 'steps'" @click="editorTab = 'steps'"><UiIcon name="workflow" :size="16"/>执行步骤<span class="count">{{ draft.steps.length }}</span></button></nav><div :id="'task-workspace-actions-2-' + divId" class="actions compact"><IconAction class="text-button" :disabled="busy || !task || dirty" @click="validateSaved" icon="check" label="校验配置"/><IconAction v-if="task" class="text-button" :disabled="busy || dirty" @click="history(task.id)" icon="clock" label="运行历史"/></div></div>
      <form id="task-editor" @submit.prevent="save" @input="dirty = true" @change="dirty = true">
        <fieldset :disabled="busy || active" class="task-fieldset"><p v-if="active" class="alert">任务正在执行（包括 finally 清理阶段），暂时不能修改配置。</p>
          <section v-if="editorTab === 'config'" class="surface config-surface"><div :id="'task-workspace-section-intro-' + divId" class="section-intro"><span class="section-icon"><UiIcon name="settings" :size="22"/></span><div :id="'task-workspace-block-5-' + divId"><h2>运行环境</h2><p>为这项任务设置名称、服务地址与请求超时。</p></div></div><div :id="'task-workspace-task-config-' + divId" class="task-config"><label>任务名称 <span class="required">*</span><input v-model="draft.name" required maxlength="120" placeholder="例如：订单服务回归"><small>在当前项目内使用唯一名称。</small></label><label>任务描述<textarea v-model="draft.description" maxlength="2000" rows="3" placeholder="简要描述测试范围与用途"></textarea></label><div :id="'task-workspace-form-divider-' + divId" class="form-divider"></div><label>运行地址 <span class="required">*</span><input v-model="draft.base_url" required type="url" placeholder="https://api.example.com/service"><small>支持 HTTP / HTTPS 和路径前缀，不含 query、fragment。</small></label><label class="timeout-field">请求超时<div :id="'task-workspace-input-unit-' + divId" class="input-unit"><input v-model.number="draft.timeout_seconds" type="number" min="1" max="300" step="1" required><span>秒</span></div><small>每步请求的超时时间，范围 1–300 秒。</small></label></div><div :id="'task-workspace-section-bottom-' + divId" class="section-bottom"><span><UiIcon name="info" :size="16"/>草稿可不含步骤；运行前请添加至少一个步骤。</span><IconAction type="button" @click="editorTab = 'parameters'" icon="code" label="配置全局参数"/></div></section>
          <section v-else-if="editorTab === 'parameters'" class="surface parameters-surface"><ParameterConfig :draft="draft" :current-value="currentParameter" :busy="busy" show-refresh @refresh="refreshParameters" @edit="editParameter" @remove="removeParameter" @add="addParameter" @extract="extractParameter" @preview="previewParameter" :can-extract="canExtract"/><div :id="'task-workspace-section-bottom-2-' + divId" class="section-bottom"><IconAction type="button" @click="editorTab = 'steps'" icon="chevron" label="编排执行步骤"/></div></section>
          <div :id="'task-workspace-compose-layout-' + divId" v-else class="compose-layout step-compose">
            <aside class="step-outline surface"><div :id="'task-workspace-outline-heading-' + divId" class="outline-heading"><h2>执行顺序 <span class="count">{{ draft.steps.length }}</span></h2><small>按流程、层级和排序值执行</small></div><div :id="'task-workspace-step-add-actions-' + divId" class="step-add-actions" role="group" aria-label="添加执行步骤"><IconAction type="button" @click="choose()" icon="plus" label="添加接口步骤"/><IconAction type="button" @click="addControl('compute')" icon="code" label="添加计算节点"/><IconAction type="button" @click="addControl('sql')" icon="code" label="添加 SQL 节点"/><IconAction type="button" @click="addControl('wait')" icon="clock" label="添加等待节点"/><IconAction type="button" @click="addControl('parallel')" icon="workflow" label="添加并行节点"/></div><div :id="'task-workspace-step-list-' + divId" class="step-list"><button v-for="(s,index) in displaySteps" :key="s.key" type="button" class="step-nav-item" :style="s.parent_key ? { paddingLeft: '28px' } : {}" :class="{ active: selectedStep?.key === s.key }" @click="selectedStepKey = s.key"><span class="step-number">{{ String(index+1).padStart(2,'0') }}</span><div :id="'task-workspace-block-6-' + divId + '-' + encodeURIComponent(String(s.key))"><span class="method" :class="s.method.toLowerCase()">{{ s.method }}</span><code>{{ s.path }}</code><small>{{ scope(s) === 'finally' ? 'FINALLY 清理' : s.parent_key ? '并行子节点' : 'MAIN 主流程' }} · {{ nodeType(s) === 'rest' ? s.file_name+' · v'+s.version : nodeType(s) === 'wait' ? s.wait_milliseconds+' ms' : nodeType(s) === 'sql' ? s.options?.sql?.driver : nodeType(s) === 'compute' ? '表达式计算' : '最大并发 '+s.max_concurrency }}</small></div><span v-if="s.has_new_version" class="version-dot" title="存在新版本"></span></button></div><div :id="'task-workspace-outline-note-' + divId" class="outline-note"><UiIcon name="info" :size="15"/><span>主流程失败后跳过后续节点，仍执行全部 finally；并行子节点共享输入快照。</span></div></aside>
            <section v-if="selectedStep" class="surface step-editor"><div :id="'task-workspace-step-editor-heading-' + divId" class="step-editor-heading"><div :id="'task-workspace-block-7-' + divId"><div :id="'task-workspace-eyebrow-2-' + divId" class="eyebrow">STEP {{ String(selectedStepIndex+1).padStart(2,'0') }}</div><h2><span class="method" :class="selectedStep.method.toLowerCase()">{{ selectedStep.method }}</span><code>{{ selectedStep.path }}</code></h2><p><template v-if="nodeType(selectedStep) === 'rest'">{{ selectedStep.file_name }} <span class="separator">/</span> v{{ selectedStep.version }} <span class="separator">/</span></template> {{ selectedStep.id ? 'ID '+selectedStep.id : '新步骤' }}</p></div><div :id="'task-workspace-actions-3-' + divId" class="actions"><IconAction type="button" class="icon-button" :disabled="moveDisabled(-1)" @click="move(selectedStepIndex,-1)" icon="up" label="上移步骤"/><IconAction type="button" class="icon-button" :disabled="moveDisabled(1)" @click="move(selectedStepIndex,1)" icon="down" label="下移步骤"/><IconAction type="button" class="icon-button" @click="copyStep(selectedStepIndex)" icon="copy" label="复制步骤"/><IconAction type="button" class="icon-button danger" @click="removeStep(selectedStepIndex)" icon="trash" label="移除步骤"/></div></div>
              <div :id="'task-workspace-node-placement-' + divId" class="node-placement">
                <label>所属流程<select v-model="selectedStep.execution_scope" :disabled="nodeType(selectedStep) === 'parallel'" @change="relocate(selectedStep)"><option value="main">MAIN 主流程</option><option value="finally">FINALLY 清理</option></select></label>
                <label v-if="nodeType(selectedStep) !== 'parallel' && scope(selectedStep) === 'main'">父节点<select v-model="selectedStep.parent_key" @change="relocate(selectedStep)"><option :value="undefined">根节点（顺序执行）</option><option v-for="p in parallelParents" :key="p.key" :value="p.key">并行节点 · {{ p.position }} · {{ p.id ? 'ID '+p.id : '新节点' }}</option></select></label>
                <label>兄弟排序值<input v-model.number="selectedStep.position" type="number" min="1" max="2147483647" required></label>
              </div>
              <div :id="'task-workspace-node-settings-' + divId" v-if="nodeType(selectedStep) === 'wait'" class="node-settings"><label>固定等待（毫秒）<input v-model.number="selectedStep.wait_milliseconds" type="number" min="1" max="300000" required></label><p>等待 1～300000 毫秒，不发送 HTTP 请求。</p></div>
              <div :id="'task-workspace-node-settings-2-' + divId" v-else-if="nodeType(selectedStep) === 'parallel'" class="node-settings"><label>最大并发数<input v-model.number="selectedStep.max_concurrency" type="number" min="1" max="8" required></label><p>至少添加两个 REST / compute / SQL / 等待子节点。子节点共享输入快照，屏障结束后统一发布参数，禁止相互依赖。</p><p>添加接口、计算、SQL 或等待节点后，在其“父节点”中选择此并行节点。</p></div>
              <ComputeNodeEditor v-else-if="nodeType(selectedStep) === 'compute'" :step="selectedStep" :draft="draft" @add-parameter="editParameter({ key: key(), name: '', value_type: 'string', sensitive: false, text: '', source_type: 'expression', step_key: selectedStep.key })"/>
              <SqlNodeEditor v-else-if="nodeType(selectedStep) === 'sql' && selectedStep.options?.sql" :sql="selectedStep.options.sql" :parameters="draft.parameters"/>
              <template v-else>
              <div :id="'task-workspace-step-toolbar-' + divId" class="step-toolbar" role="group" aria-label="当前步骤操作">
                <button type="button" class="primary step-run-action" @click="executeStep(selectedStep)" :disabled="busy || !!selectedStep.raw_body"><UiIcon name="play" :size="16"/>单次运行</button>
                <AssertionEditor :step="selectedStep" :busy="busy" :issues="assertionIssues" @change="dirty = true"/>
                <IconAction type="button" @click="addRestParameter(selectedStep)" icon="workflow" :disabled="busy" label="设置响应全局参数"/>
                <IconAction type="button" :disabled="busy" @click="addHeader(selectedStep)" icon="plus" label="添加 Header"/>
                <IconAction type="button" class="text-button" :disabled="busy" @click="choose(selectedStepIndex)" icon="settings" label="重新选择接口 / 版本"/>
              </div>
              <p v-for="(issue,index) in assertionIssues" :key="index" class="step-error step-assertion-error" role="alert">{{ issue }}</p>
              <PollPolicyEditor :step="selectedStep"/>
              <section class="node-settings auth-settings" aria-label="步骤认证">
                <h3>认证</h3>
                <label>认证方式<select :value="selectedStep.options?.auth?.mode || ''" @change="setAuth(selectedStep, ($event.target as HTMLSelectElement).value)"><option value="">默认（使用请求头配置）</option><option value="none">无认证</option><option value="bearer">Bearer Token</option><option value="header">显式 Authorization 请求头</option></select></label>
                <template v-if="selectedStep.options?.auth?.mode === 'bearer'">
                  <label>Token 全局参数<select v-model="selectedStep.options.auth.parameter" aria-label="Token 全局参数"><option value="">选择全局参数</option><option v-if="selectedStep.options.auth.parameter && !draft.parameters.some(p => p.name === selectedStep.options?.auth?.parameter)" :value="selectedStep.options.auth.parameter">{{ selectedStep.options.auth.parameter }}（参数不存在）</option><option v-for="p in draft.parameters" :key="p.key" :value="p.name">{{ p.name }} · {{ p.value_type }}</option></select></label>
                  <small>运行时使用该参数生成 Authorization: Bearer &lt;token&gt;。</small>
                </template>
              </section>
              <div :id="'task-workspace-node-settings-3-' + divId" class="node-settings raw-body-settings"><div :id="'task-workspace-raw-body-heading-' + divId" class="raw-body-heading"><h3>请求体</h3><span class="tag">JSON</span></div><label class="check"><input type="checkbox" :checked="!!selectedStep.raw_body" @change="toggleRaw(selectedStep, ($event.target as HTMLInputElement).checked)">使用原始 JSON 文本（允许空文本或非法 JSON）</label><template v-if="selectedStep.raw_body"><textarea v-model="selectedStep.raw_body.text" rows="8" aria-label="原始请求体" spellcheck="false"></textarea><small>按原文发送，不插值、不解析、不脱敏。</small></template></div>
              <div :id="'task-workspace-bindings-area-' + divId" class="bindings-area"><div :id="'task-workspace-section-top-2-' + divId" class="section-top"><h3>请求参数绑定</h3><small>勾选字段后才会发送</small></div>
                <template v-for="location in locations" :key="location"><section v-if="!(location === 'body' && selectedStep.raw_body) && selectedStep.fields.some(f => f.location === location)" class="binding-group"><div :id="'task-workspace-binding-group-heading-' + divId + '-' + encodeURIComponent(String(location))" class="binding-group-heading"><span>{{ location === 'body' ? 'JSON 请求体' : location === 'header' ? '请求头' : location === 'query' ? 'Query 参数' : 'Path 参数' }}</span><code>{{ location.toUpperCase() }}</code></div><div :id="'task-workspace-binding-row-' + divId + '-' + encodeURIComponent(String(location)) + '-' + encodeURIComponent(String(f.key))" v-for="f in selectedStep.fields.filter(f => f.location === location)" :key="f.key" class="binding-row" :class="{ 'binding-disabled': !f.enabled }"><div :id="'task-workspace-field-identity-' + divId + '-' + encodeURIComponent(String(location)) + '-' + encodeURIComponent(String(f.key))" class="field-identity"><label class="check"><input v-model="f.enabled" type="checkbox" :aria-label="'配置 '+(f.name || 'JSON 根字段')" @change="toggleField(selectedStep,f)"><input v-if="customHeader(selectedStep,f)" v-model="f.name" class="header-name-input" aria-label="自定义 Header 名称" placeholder="Authorization"><code v-else>{{ f.name || '整个 JSON 请求体' }}</code></label><div :id="'task-workspace-field-meta-' + divId + '-' + encodeURIComponent(String(location)) + '-' + encodeURIComponent(String(f.key))" class="field-meta"><span>{{ f.schema.type || 'string' }}</span><span v-if="f.required" class="required">必填</span><span v-else>可选</span><span v-if="privateField(f)"><UiIcon name="lock" :size="12"/>敏感</span></div></div><select v-model="f.kind" :disabled="!f.enabled" aria-label="绑定方式"><option value="literal">字面值</option><option value="global">全局参数</option></select><select v-if="f.kind === 'global'" v-model="f.parameter_name" :disabled="!f.enabled" aria-label="全局参数引用"><option value="">选择全局参数</option><option v-for="p in draft.parameters" :key="p.key" :value="p.name">{{ p.name }} · {{ p.value_type }}</option></select><div :id="'task-workspace-binding-value-' + divId + '-' + encodeURIComponent(String(location)) + '-' + encodeURIComponent(String(f.key))" v-else class="binding-value"><input v-if="privateField(f) || f.preserved" v-model="f.text" type="password" autocomplete="new-password" :disabled="!f.enabled" :placeholder="f.preserved ? '留空保留隐藏值' : '输入值'" @input="f.preserved = false"><textarea v-else-if="['object','array'].includes(String(f.schema.type))" v-model="f.text" rows="3" :disabled="!f.enabled" placeholder="输入 JSON 值" @input="f.preserved = false"></textarea><input v-else v-model="f.text" :disabled="!f.enabled" :placeholder="f.schema.type && f.schema.type !== 'string' ? '输入 '+f.schema.type+' 值' : '输入字符串'" @input="f.preserved = false"></div><button v-if="customHeader(selectedStep,f)" type="button" class="remove-field icon-button" aria-label="移除 Header" @click="selectedStep.fields = selectedStep.fields.filter(item => item.key !== f.key); dirty = true"><UiIcon name="close" :size="14"/></button></div></section></template>
                <p v-if="!selectedStep.fields.length" class="muted">此接口没有必填参数，可按需添加认证 Header。</p>
                <details class="schema-reference"><summary><UiIcon name="code" :size="16"/>查看绑定版本的参数 Schema</summary><SchemaTree v-for="p in selectedStep.definition.parameters" :key="p.location+p.name" :schema="p.schema" :label="p.location+'.'+p.name" :required="p.required"/><SchemaTree v-if="selectedStep.definition.request_body" :schema="selectedStep.definition.request_body.schema" label="JSON 请求体" :required="selectedStep.definition.request_body.required"/></details>
              </div></template></section>
            <section v-else class="surface compose-empty"><div :id="'task-workspace-empty-2-' + divId" class="empty"><span class="empty-icon"><UiIcon name="layers" :size="32"/></span><h3>选择接口，开始编排</h3><p>从当前项目的 YAML 文件中选择版本和接口。<br>同一个接口可以添加多次。</p><IconAction type="button" class="primary" @click="choose()" icon="plus" label="添加接口步骤"/></div></section>
          </div>
        </fieldset>
      </form>
    </template>
    <div :id="'task-workspace-history-layout-' + divId" v-else class="history-layout">
      <aside class="surface run-list"><div :id="'task-workspace-outline-heading-2-' + divId" class="outline-heading"><h2>运行历史 <span class="count">{{ runTotal }}</span></h2><form class="run-filter" @submit.prevent="runPage = 1; act(loadRuns)"><select v-model="statusFilter" aria-label="运行状态"><option value="">全部状态</option><option v-for="s in ['queued','running','succeeded','failed']" :key="s" :value="s">{{ labels[s] }}</option></select><IconAction class="icon-button" :disabled="busy" type="submit" icon="search" label="筛选运行"/></form></div><button v-for="r in runs" :key="r.id" class="run-list-item" :class="{ active: runDetail?.run.id === r.id }" :disabled="busy" @click="requestPage = 1; act(() => loadRun(r.id))"><div :id="'task-workspace-block-8-' + divId + '-' + encodeURIComponent(String(r.id))"><strong>运行 #{{ r.id }}</strong><span class="status" :class="r.status">{{ labels[r.status] }}</span></div><small>{{ time(r.created_at) }}</small><span class="run-duration"><UiIcon name="clock" :size="13"/>{{ duration(r.duration_ms) }}</span></button><div :id="'task-workspace-empty-3-' + divId" v-if="!runs.length && !busy && !error" class="empty small-empty">暂无运行记录</div><div :id="'task-workspace-pagination-2-' + divId" class="pagination"><IconAction class="icon-button" :disabled="busy || runPage <= 1" @click="runPage--; act(loadRuns)" icon="arrow" label="运行历史上一页"/><span>{{ runPage }} / {{ Math.max(1,Math.ceil(runTotal/20)) }}</span><button class="icon-button" :disabled="busy || runPage*20 >= runTotal" aria-label="运行历史下一页" @click="runPage++; act(loadRuns)"><UiIcon name="chevron" :size="15"/></button></div></aside>
      <section v-if="runDetail" class="surface run-detail"><div :id="'task-workspace-run-detail-heading-' + divId" class="run-detail-heading"><div :id="'task-workspace-block-9-' + divId"><div :id="'task-workspace-eyebrow-3-' + divId" class="eyebrow">EXECUTION DETAIL</div><h2>运行 #{{ runDetail.run.id }}<span class="status" :class="runDetail.run.status">{{ labels[runDetail.run.status] }}</span></h2></div><IconAction class="icon-button" :disabled="busy" @click="act(refreshHistory)" icon="refresh" label="刷新运行详情"/></div><div :id="'task-workspace-run-metrics-' + divId" class="run-metrics"><div :id="'task-workspace-block-10-' + divId"><small>开始时间</small><strong>{{ time(runDetail.run.started_at) }}</strong></div><div :id="'task-workspace-block-11-' + divId"><small>结束时间</small><strong>{{ time(runDetail.run.finished_at) }}</strong></div><div :id="'task-workspace-block-12-' + divId"><small>总耗时</small><strong>{{ duration(runDetail.run.duration_ms) }}</strong></div><div :id="'task-workspace-block-13-' + divId"><small>执行步骤</small><strong>{{ runDetail.leaf_counts.succeeded }} <span>/ {{ runDetail.leaf_counts.total }} 个叶子步骤</span></strong></div></div><details v-if="runDetail.run.error_code || runDetail.run.primary_error" :key="runDetail.run.id" class="run-error-details">
          <summary><UiIcon name="info"/><span>{{ errors[runDetail.run.error_code || ''] || runDetail.run.error_code || '主流程执行失败' }}</span><small>错误详情</small></summary>
          <pre>{{ runDetail.run.primary_error ? pretty(runDetail.run.primary_error) : runDetail.run.error_message }}</pre>
        </details>
        <div :id="'task-workspace-run-phase-summary-' + divId" class="run-phase-summary"><span>执行阶段：{{ runDetail.run.execution_stage === 'finished' ? '已结束' : runDetail.run.execution_stage }}</span><span>清理：{{ labels[runDetail.run.cleanup_status] || runDetail.run.cleanup_status }}</span><span v-if="runDetail.control_counts.total">控制节点：{{ runDetail.control_counts.succeeded }} / {{ runDetail.control_counts.total }}</span><span>请求：{{ runDetail.request_count }}<template v-if="runDetail.request_count !== requestTotal">（{{ requestTotal }} 条可查看详情）</template></span></div>
        <nav class="tabs detail-tabs" aria-label="运行详情分区"><button :class="{ active: detailTab === 'steps' }" :aria-pressed="detailTab === 'steps'" @click="detailTab = 'steps'">执行步骤</button><button :class="{ active: detailTab === 'requests' }" :aria-pressed="detailTab === 'requests'" @click="detailTab = 'requests'">请求记录<span class="count">{{ requestTotal }}</span></button><button :class="{ active: detailTab === 'parameters' }" :aria-pressed="detailTab === 'parameters'" @click="detailTab = 'parameters'">参数结果</button><button :class="{ active: detailTab === 'snapshot' }" :aria-pressed="detailTab === 'snapshot'" @click="detailTab = 'snapshot'">配置快照</button></nav>
        <div :id="'task-workspace-run-detail-content-' + divId" class="run-detail-content">
          <template v-if="detailTab === 'steps'"><div :id="'task-workspace-section-top-3-' + divId" class="section-top"><h3>执行树运行结果</h3><small>并行子节点只提供汇总统计</small></div><div :id="'task-workspace-execution-timeline-' + divId" class="execution-timeline"><RunNodeResult v-for="s in runDetail.steps" :key="s.id" :node="s" :snapshot="runDetail.config_snapshot.task.steps.find(t => t.id === s.step_id)" :busy="busy" @request="openRequest" @edit="editHistoryNode"/></div></template>
          <template v-else-if="detailTab === 'parameters'"><div :id="'task-workspace-section-top-4-' + divId" class="section-top"><h3>全局参数初始化</h3><small>本次运行独立结果</small></div><div :id="'task-workspace-empty-4-' + divId" v-if="!runDetail.global_parameters.length" class="empty small-empty">无全局参数。</div><div :id="'task-workspace-parameter-result-' + divId + '-' + encodeURIComponent(String(p.id))" v-for="p in runDetail.global_parameters" :key="p.id" class="parameter-result"><div :id="'task-workspace-block-14-' + divId + '-' + encodeURIComponent(String(p.id))"><b>{{ p.name }}</b><code>{{ p.value_type }}</code></div><pre>{{ p.sensitive || p.redacted ? '••••••' : pretty(p.value) }}</pre><span class="status" :class="p.status">{{ labels[p.status] }}</span><span class="tag">{{ p.published ? '已发布到任务上下文' : '未发布到任务上下文' }}</span><small v-if="p.error_code">{{ p.error_code }} {{ p.error_message }}</small></div></template>
          <template v-else-if="detailTab === 'requests'"><div :id="'task-workspace-request-row-' + divId + '-' + encodeURIComponent(String(r.id))" v-for="r in requests" :key="r.id" class="request-row"><span class="method" :class="r.method.toLowerCase()">{{ r.method }}</span><div :id="'task-workspace-block-15-' + divId + '-' + encodeURIComponent(String(r.id))"><code>{{ r.actual_url }}</code><small class="block">请求 #{{ r.id }} · 步骤 {{ r.step_id }} · {{ duration(r.duration_ms) }}</small></div><span class="http-status" :class="{ 'http-error': !!r.error_code }">{{ r.response_status ?? '等待响应' }}</span><button class="text-button" :disabled="busy" @click="openRequest(r.id)">详情<UiIcon name="chevron" :size="14"/></button></div><div :id="'task-workspace-empty-5-' + divId" v-if="!requests.length" class="empty small-empty">暂无可查看的请求记录；并行子请求仅提供统计。</div><div :id="'task-workspace-pagination-3-' + divId" class="pagination"><button :disabled="busy || requestPage <= 1" @click="requestPage--; act(loadRequests)">上一页</button><span>{{ requestPage }} / {{ Math.max(1,Math.ceil(requestTotal/20)) }}</span><button :disabled="busy || requestPage*20 >= requestTotal" @click="requestPage++; act(loadRequests)">下一页</button></div></template>
          <template v-else><div :id="'task-workspace-section-top-5-' + divId" class="section-top"><h3>不可变配置快照</h3><span class="tag"><UiIcon name="lock" :size="12"/>已脱敏</span></div><p class="muted">任务或 YAML 的后续修改不会改变本次运行的配置。</p><pre class="snapshot-code">{{ pretty(safeJSON(runDetail.config_snapshot)) }}</pre></template>
        </div></section>
      <section v-else class="surface history-empty"><div :id="'task-workspace-empty-6-' + divId" class="empty"><span class="empty-icon"><UiIcon name="clock" :size="30"/></span><h3>查看一次运行</h3><p>从左侧选择记录，查看步骤状态与请求结果。</p></div></section>
    </div>
    <div :id="'task-workspace-overlay-' + divId" v-if="requestDetail" class="overlay drawer-overlay" @click.self="requestDetail = undefined" @keydown.esc="requestDetail = undefined"><section class="request-drawer" role="dialog" aria-modal="true" aria-labelledby="request-title" tabindex="-1"><div :id="'task-workspace-drawer-heading-' + divId" class="drawer-heading"><div :id="'task-workspace-block-16-' + divId"><div :id="'task-workspace-eyebrow-4-' + divId" class="eyebrow">HTTP TRANSACTION</div><div :id="'task-workspace-request-title-actions-' + divId" class="request-title-actions"><h2 id="request-title">请求 #{{ requestDetail.id }}</h2><div :id="'task-workspace-actions-4-' + divId" class="actions"><IconAction icon="code" label="提取命令（复制 curl）" @click="copyRequest('curl')"/><IconAction icon="play" :label="replayBusy ? '正在执行…' : '使用原参数单次执行'" :disabled="busy || replayBusy" @click="replayRequest"/><IconAction icon="copy" label="提取 HTTP 内容" @click="copyRequest('http')"/></div></div><small>运行 {{ requestDetail.run_id }} · 步骤 {{ requestDetail.step_id }} · 序号 {{ requestDetail.position }}</small></div><IconAction class="icon-button" @click="requestDetail = undefined" icon="close" label="关闭请求详情"/></div><div :id="'task-workspace-drawer-endpoint-' + divId" class="drawer-endpoint"><span class="method" :class="requestDetail.method.toLowerCase()">{{ requestDetail.method }}</span><code>{{ requestDetail.actual_url }}</code></div><p v-if="copyMessage" :class="copyError ? 'alert' : 'success'" role="status">{{ copyMessage }}</p><p v-if="replayError" class="alert" role="alert">{{ replayError }}</p><section v-if="replayResult" class="single-test-result" aria-live="polite"><div :id="'task-workspace-section-top-6-' + divId" class="section-top"><h3>本次单次执行结果</h3><span class="status" :class="replayResult.status">{{ replayResult.status === 'succeeded' ? '成功' : '失败' }}</span></div><p>HTTP {{ replayResult.response_status ?? '无响应' }} · {{ duration(replayResult.duration_ms) }}</p><p v-if="replayResult.error_code" class="alert">{{ replayResult.error_code }} · {{ replayResult.error_message }}</p><h4>响应头</h4><pre>{{ pretty(headers(replayResult.response_headers)) }}</pre><h4>响应体</h4><pre class="body-code">{{ replayResult.response_body ?? '无响应体' }}</pre></section><div :id="'task-workspace-drawer-meta-' + divId" class="drawer-meta"><span>状态码 <b>{{ requestDetail.response_status ?? '无响应' }}</b></span><span>耗时 <b>{{ duration(requestDetail.duration_ms) }}</b></span></div><div :id="'task-workspace-alert-2-' + divId" v-if="requestDetail.error_code" class="alert">{{ errors[requestDetail.error_code] || requestDetail.error_code }} · {{ requestDetail.error_message }}</div><nav class="tabs" aria-label="请求详情分区"><button :class="{ active: requestPart === 'request' }" :aria-pressed="requestPart === 'request'" @click="requestPart = 'request'">请求</button><button :class="{ active: requestPart === 'response' }" :aria-pressed="requestPart === 'response'" @click="requestPart = 'response'">响应</button></nav><div :id="'task-workspace-drawer-body-' + divId" class="drawer-body"><details :key="`${requestDetail.id}-${requestPart}`" class="request-header-details" :open="requestPart === 'response'"><summary><span>{{ requestPart === 'request' ? '请求头' : '响应头' }}</span><span class="tag"><UiIcon name="lock" :size="12"/>敏感头已隐藏</span></summary><pre>{{ pretty(headers(requestPart === 'request' ? requestDetail.request_headers : requestDetail.response_headers)) }}</pre></details><div :id="'task-workspace-section-top-7-' + divId" class="section-top"><h3>{{ requestPart === 'request' ? '请求体' : '响应体' }}</h3><small v-if="requestPart === 'response'">{{ requestDetail.response_body_encoding }}</small></div><pre class="body-code">{{ (requestPart === 'request' ? requestDetail.request_body : requestDetail.response_body) ?? (requestPart === 'request' ? '无请求体' : '无响应体') }}</pre><div :id="'task-workspace-request-times-' + divId" class="request-times"><small>开始 {{ time(requestDetail.started_at) }}</small><small>结束 {{ time(requestDetail.finished_at) }}</small></div></div></section></div>
    <div :id="'task-workspace-overlay-2-' + divId" v-if="modal" class="overlay" @click.self="!busy && (modal = null)" @keydown.esc="!busy && (modal = null)"><section class="dialog" :class="{ 'task-dialog': modal === 'choose' || modal === 'collection' || modal === 'join-collection' }" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title"><div :id="'task-workspace-dialog-heading-' + divId" class="dialog-heading"><div :id="'task-workspace-block-17-' + divId"><div :id="'task-workspace-eyebrow-5-' + divId" class="eyebrow">{{ modal === 'choose' ? 'API LIBRARY' : 'TASK MANAGEMENT' }}</div><h2 id="task-dialog-title">{{ modal === 'parameter' ? (draft.parameters.some(p => p.key === editingParameter?.key) ? '修改参数' : '新增参数') : modal === 'choose' ? '添加接口步骤' : modal === 'join-collection' ? '加入任务组' : modal === 'collection' ? '创建任务组' : modal === 'import' ? '导入 XML 任务' : modal === 'copy' ? '复制任务' : modal === 'bulk-delete' ? '批量删除任务' : modal === 'discard' ? '放弃未保存更改' : '确认删除任务' }}</h2></div><IconAction :disabled="busy" class="icon-button" @click="modal = null" icon="close" label="关闭"/></div><div :id="'task-workspace-alert-3-' + divId" v-if="error" class="alert" role="alert">{{ error.detail }}<div :id="'task-workspace-block-18-' + divId + '-' + encodeURIComponent(String(i))" v-for="(issue,i) in error.issues" :key="i">{{ issue.location }} · {{ issue.reason }}</div><small>{{ error.code }} {{ error.requestId }}</small></div>
      <ParameterEditor v-if="modal === 'parameter' && editingParameter" :parameter="editingParameter" :draft="draft" @confirm="applyParameter" @cancel="modal = null"/>
      <template v-else-if="modal === 'choose'"><p v-if="replacing !== undefined" class="inline-note">重新选择后清空该步骤的参数绑定，请重新配置。</p><div :id="'task-workspace-picker-controls-' + divId" class="picker-controls"><label>YAML 文件<select aria-label="YAML 文件" v-model="selectedFile" :disabled="busy" @change="chooseFile"><option :value="undefined">选择文件</option><option v-for="f in files" :key="f.id" :value="f.id">{{ f.name }}</option></select></label><label>固定版本<select aria-label="固定版本" v-model="selectedVersion" :disabled="busy || !selectedFile" @change="act(loadChoices)"><option :value="undefined">选择版本</option><option v-for="v in versions" :key="v.version" :value="v.version">v{{ v.version }}{{ v.is_current ? ' · 当前' : ' · 历史' }}</option></select></label></div><div :id="'task-workspace-picker-search-' + divId" v-if="interfaces.length" class="picker-search search-form"><UiIcon name="search" :size="17"/><input v-model="interfaceSearch" placeholder="搜索方法、路径或摘要…" aria-label="搜索可选接口"><small>{{ matchingInterfaces.length }} 个接口</small></div><div :id="'task-workspace-picker-results-' + divId" class="picker-results"><button v-for="api in matchingInterfaces" :key="api.id" class="interface-row" :disabled="busy" @click="selectInterface(api)"><span class="method" :class="api.method.toLowerCase()">{{ api.method }}</span><div :id="'task-workspace-block-19-' + divId + '-' + encodeURIComponent(String(api.id))"><code>{{ api.path }}</code><small>{{ api.summary || '暂无摘要' }}</small></div><UiIcon name="plus" :size="17"/></button><div :id="'task-workspace-empty-7-' + divId" v-if="!files.length" class="empty"><UiIcon name="file" :size="30"/><p>请先在接口资产中导入 YAML 文件。</p></div><div :id="'task-workspace-empty-8-' + divId" v-else-if="!matchingInterfaces.length && !busy" class="empty">{{ selectedVersion ? '该版本没有匹配的接口' : '选择文件和版本，浏览可用接口。' }}</div></div><div :id="'task-workspace-dialog-footnote-' + divId" class="dialog-footnote"><UiIcon name="lock" :size="14"/>选择后固定版本，后续 YAML 更新不会自动替换。</div></template>
      <form v-else-if="modal === 'join-collection'" class="join-collection-form" @submit.prevent="joinCollection">
        <fieldset :disabled="busy" class="task-fieldset">
          <div class="join-selection-summary"><UiIcon name="workflow" :size="20"/><div><strong>已选择 {{ joinTasks.length }} 个任务</strong><p>新任务按勾选顺序逐批执行，加入已有组时追加到最后批次之后。</p></div></div>
          <div class="join-selected-tasks"><span v-for="item in joinTasks" :key="item.id" class="tag">{{ item.name }}</span></div>
          <nav class="tabs join-mode-tabs" aria-label="加入任务组方式"><button type="button" :class="{ active: joinMode === 'existing' }" :aria-pressed="joinMode === 'existing'" @click="joinMode = 'existing'">选择已有任务组</button><button type="button" :class="{ active: joinMode === 'new' }" :aria-pressed="joinMode === 'new'" @click="joinMode = 'new'">新建任务组</button></nav>
          <template v-if="joinMode === 'existing'">
            <p v-if="busy" class="muted" role="status">正在处理…</p>
            <div v-else-if="!joinGroupsLoaded" class="join-collection-empty"><p>任务组加载失败，请重试或新建任务组。</p><button type="button" @click="act(loadJoinGroups)">重新加载</button></div>
            <div v-else-if="!joinGroups.length" class="join-collection-empty"><p>当前项目还没有任务组。</p><button type="button" @click="joinMode = 'new'">新建任务组</button></div>
            <template v-else>
              <label>任务组<select v-model="joinGroupId" required><option :value="undefined" disabled>请选择任务组</option><option v-for="group in joinGroups" :key="group.id" :value="group.id">{{ group.name }}（{{ group.members.length }} 个任务）</option></select></label>
              <div v-if="joinGroup" class="join-group-preview"><p v-if="joinGroup.description">{{ joinGroup.description }}</p><p>保留组内已有任务和批次。<span v-if="joinDuplicateCount">已选任务中有 {{ joinDuplicateCount }} 个已在组内，将自动跳过。</span><span v-else>重复任务会自动跳过。</span></p></div>
            </template>
          </template>
          <template v-else>
            <label>任务组名称 <span class="required">必填</span><input v-model="joinName" required maxlength="120" placeholder="例如：核心业务回归测试"></label>
            <label>描述<textarea v-model="joinDescription" maxlength="2000" rows="3" placeholder="选填，说明这组任务的测试范围或用途"></textarea></label>
          </template>
          <div class="dialog-actions"><button type="button" @click="modal = null">取消</button><button class="primary" type="submit" :disabled="joinMode === 'existing' && (!joinGroupsLoaded || !joinGroupId)">{{ busy ? '正在保存…' : joinMode === 'new' ? '创建并加入' : '确认加入' }}</button></div>
        </fieldset>
      </form>
      <form v-else-if="modal === 'collection'" @submit.prevent="createCollection">
        <fieldset :disabled="busy">
          <label>任务组名称<input v-model="collectionName" required maxlength="120" placeholder="输入任务组名称"></label>
          <label>描述<textarea v-model="collectionDescription" maxlength="2000" rows="2" placeholder="选填"></textarea></label>
          <p class="muted">按勾选先后依次执行。取消后重新勾选会排到末尾，也可不选任务创建空组草稿。</p>
          <label>搜索项目任务<input v-model="collectionSearch" type="search" placeholder="输入任务名称"></label>
          <div :id="'task-workspace-collection-picker-' + divId" class="collection-picker">
            <label v-for="item in matchingCollectionTasks" :key="item.id" class="collection-choice">
              <input type="checkbox" :checked="collectionSelection.includes(item.id)" @change="collectionSelection = toggleCollectionTask(collectionSelection, item.id)">
              <span><strong>{{ item.name }}</strong><small class="block">{{ item.description || '暂无描述' }}</small></span>
              <span v-if="collectionSelection.includes(item.id)" class="tag">第 {{ collectionSelection.indexOf(item.id) + 1 }} 个执行</span>
            </label>
            <p v-if="!matchingCollectionTasks.length && !busy" class="muted">{{ collectionSearch ? '没有匹配的任务' : '当前项目暂无任务' }}</p>
          </div>
          <div :id="'task-workspace-dialog-actions-' + divId" v-if="!collectionTasksLoaded && !busy" class="dialog-actions"><button type="button" @click="act(loadCollectionTasks)">重新加载任务</button></div>
          <h3>执行顺序 · 已选 {{ collectionSelection.length }} 个任务</h3>
          <ol class="collection-order"><li v-for="id in collectionSelection" :key="id">{{ collectionTasks.find(t => t.id === id)?.name }} <button type="button" class="text-button" :aria-label="'移除任务 ' + collectionTasks.find(t => t.id === id)?.name" @click="collectionSelection = toggleCollectionTask(collectionSelection, id)">移除</button></li></ol>
          <div :id="'task-workspace-dialog-actions-2-' + divId" class="dialog-actions"><button type="button" @click="modal = null">取消</button><button class="primary" type="submit" :disabled="!collectionTasksLoaded">{{ busy ? '正在创建…' : '创建任务组' }}</button></div>
        </fieldset>
      </form>
      <form v-else-if="modal === 'import'" @submit.prevent="importTask">
        <fieldset :disabled="busy">
          <label>任务 XML 文件<input type="file" accept=".xml,application/xml,text/xml" multiple required @change="importFiles = Array.from(($event.target as HTMLInputElement).files ?? []); error = undefined"></label>
          <p v-if="importFiles.length" class="muted">已选 {{ importFiles.length }} 个文件：{{ importFiles.map(f => f.name).join('、') }}</p>
          <p class="muted">可一次选择 1-{{ MAX_IMPORT_FILES }} 个文件，每个最大 5 MiB，整批原子导入（任一文件失败则全部不导入）。禁止 DTD 和实体；完整格式由服务端校验。</p>
          <label>运行地址<input v-model="importBaseUrl" type="url" required maxlength="2048" placeholder="https://api.example.com"></label>
          <p class="muted">支持路径前缀，不允许用户凭据、query 或 fragment。按方法和路径匹配本项目当前版本的唯一接口，创建任务及有序步骤。</p>
          <div :id="'task-workspace-dialog-actions-3-' + divId" class="dialog-actions"><button type="button" @click="modal = null">取消</button><button class="primary" type="submit">{{ busy ? '正在导入…' : '导入任务' }}</button></div>
        </fieldset>
      </form>
      <form v-else-if="modal === 'copy'" @submit.prevent="copyTask"><label>新任务名称<input v-model="copyName" required maxlength="120"></label><p>复制配置及版本绑定，重新分配步骤 ID，不复制运行历史。</p><div :id="'task-workspace-dialog-actions-4-' + divId" class="dialog-actions"><button type="button" :disabled="busy" @click="modal = null">取消</button><button class="primary" :disabled="busy">复制任务</button></div></form>
      <template v-else-if="modal === 'discard'"><p>未保存的任务更改将丢失。</p><div :id="'task-workspace-dialog-actions-5-' + divId" class="dialog-actions"><button @click="modal = null">继续编辑</button><button class="danger" @click="discard">放弃并返回</button></div></template>
      <template v-else-if="modal === 'bulk-delete'">
        <p>将永久删除以下 {{ bulkPreviews.length }} 个任务及其步骤、运行和请求记录，无法撤销。</p>
        <div class="bulk-delete-list"><div v-for="entry in bulkPreviews" :key="entry.task.id" class="bulk-delete-item"><strong>{{ entry.task.name }}</strong><small>{{ entry.preview.step_count }} 步骤 · {{ entry.preview.run_count }} 运行 · {{ entry.preview.request_count }} 请求</small><p v-for="reason in entry.preview.blocking_reasons" :key="reason" class="step-error">{{ reason }}</p></div></div>
        <p v-if="!canBulkDelete" class="alert">所选任务中有暂不可删除的任务，请取消并调整选择后重试。</p>
        <div class="dialog-actions"><button :disabled="busy" @click="modal = null">取消</button><button class="danger solid" :disabled="busy || !canBulkDelete" @click="bulkDeleteTasks">确认永久删除 {{ bulkPreviews.length }} 个任务</button></div>
      </template>
      <template v-else-if="deletion"><p>永久删除「{{ target?.name }}」及关联记录，无法撤销。</p><div :id="'task-workspace-delete-counts-' + divId" class="delete-counts"><span><b>{{ deletion.step_count }}</b>步骤</span><span><b>{{ deletion.run_count }}</b>运行</span><span><b>{{ deletion.request_count }}</b>请求</span></div><div :id="'task-workspace-alert-4-' + divId" v-if="!deletion.can_delete" class="alert"><p v-for="reason in deletion.blocking_reasons" :key="reason">{{ reason }}</p></div><div :id="'task-workspace-dialog-actions-6-' + divId" class="dialog-actions"><button :disabled="busy" @click="modal = null">取消</button><button class="danger solid" :disabled="busy || !deletion.can_delete" @click="deleteTask">确认永久删除</button></div></template>
    </section></div>
  </div>
</template>

<style scoped>
.surface-toolbar:has(.task-result-filter) { flex-wrap: wrap; gap: 16px; }
.task-result-filter { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.task-result-filter select { width: auto; }
</style>
