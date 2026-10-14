<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { request, query, ApiError, type Model } from './api'
import SchemaTree from './components/SchemaTree.vue'
import TaskWorkspace from './components/TaskWorkspace.vue'
import InterfaceTest from './components/InterfaceTest.vue'
import UiIcon from './components/UiIcon.vue'
import { useDialogFocus } from './useDialogFocus'
const projectTab = ref<'assets' | 'tasks'>('assets'), taskDirty = ref(false)
const projects = ref<Model<'Project'>[]>([]), project = ref<Model<'ProjectDetail'>>()
const files = ref<Model<'YamlFile'>[]>([]), file = ref<Model<'YamlFile'>>()
const versions = ref<Model<'YamlVersion'>[]>([]), version = ref<number>()
const interfaces = ref<Model<'Interface'>[]>([]), detail = ref<Model<'InterfaceDetail'>>()
const content = ref<Model<'VersionContent'>>()
const interfaceTab = ref<'definition' | 'test'>('definition')
const search = ref(''), method = ref(''), path = ref(''), page = ref(1), total = ref(0)
const interfacePage = ref(1), interfaceTotal = ref(0), busy = ref(false), error = ref<ApiError>(), notice = ref('')
const modal = ref<'project' | 'upload' | 'delete' | null>(null), editing = ref<Model<'Project'>>()
const rememberDialogTrigger = useDialogFocus(() => modal.value !== null)
const name = ref(''), description = ref(''), upload = ref<File>(), updating = ref(false)
const deletion = ref<Model<'DeletionPreview'>>(), deleteFile = ref<Model<'YamlFile'>>()
const deleteProject = ref<Model<'Project'>>()
const base = computed(() => `/projects/${project.value?.id}`)
const fileBase = computed(() => `${base.value}/yaml-files/${file.value?.id}`)
const pretty = (v: unknown) => JSON.stringify(v, null, 2)
const time = (v: string) => new Date(v).toLocaleString('zh-CN')
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = undefined; notice.value = ''
  try { await action() } catch (e) { error.value = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : '操作失败') }
  finally { busy.value = false }
}
async function loadProjects() {
  const result = await request<Model<'ProjectPage'>>('/projects' + query({ name: search.value, page: page.value, page_size: 12 }))
  projects.value = result.items; total.value = result.total
}
async function allPages<T>(url: string): Promise<T[]> {
  const items: T[] = []; let p = 1
  while (true) { const result = await request<{ items: T[]; total: number }>(url + query({ page: p++, page_size: 100 })); items.push(...result.items); if (items.length >= result.total || !result.items.length) return items }
}
async function refreshProject() {
  project.value = await request<Model<'ProjectDetail'>>(base.value)
  files.value = await allPages<Model<'YamlFile'>>(`${base.value}/yaml-files`)
}
async function openProject(id: number) {
  await run(async () => {
    const result = await request<Model<'ProjectDetail'>>(`/projects/${id}`)
    projectTab.value = 'assets'; project.value = result; file.value = undefined; detail.value = undefined; content.value = undefined
    files.value = await allPages<Model<'YamlFile'>>(`${base.value}/yaml-files`)
  })
}
async function openInterface(id: number) {
  await run(async () => { detail.value = await request<Model<'InterfaceDetail'>>(fileBase.value + '/interfaces/' + id); interfaceTab.value = 'definition'; await nextTick(); if (window.innerWidth <= 760) document.querySelector('.api-detail')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) })
}
async function loadInterfaces() {
  const result = await request<Model<'InterfacePage'>>(fileBase.value + '/interfaces' + query({ version: version.value, method: method.value, path: path.value, page: interfacePage.value, page_size: 20 }))
  interfaces.value = result.items; interfaceTotal.value = result.total; detail.value = undefined
}
async function openFile(item: Model<'YamlFile'>) {
  await run(async () => {
    file.value = await request<Model<'YamlFile'>>(`${base.value}/yaml-files/${item.id}`)
    versions.value = await allPages<Model<'YamlVersion'>>(`${fileBase.value}/versions`)
    version.value = file.value.current_version; interfacePage.value = 1; method.value = ''; path.value = ''; content.value = undefined
    await loadInterfaces()
  })
}
async function changeVersion() {
  await run(async () => { await request(`${fileBase.value}/versions/${version.value}`); content.value = undefined; interfacePage.value = 1; await loadInterfaces() })
}
function projectForm(item?: Model<'Project'>) { editing.value = item; name.value = item?.name || ''; description.value = item?.description || ''; error.value = undefined; modal.value = 'project' }
async function saveProject() {
  await run(async () => {
    if (!name.value.trim()) throw new ApiError('请输入项目名称。')
    const result = await request<Model<'Project'>>(editing.value ? `/projects/${editing.value.id}` : '/projects', editing.value ? 'PATCH' : 'POST', { name: name.value.trim(), description: description.value })
    if (project.value?.id === result.id) await refreshProject()
    await loadProjects(); modal.value = null; notice.value = '项目已保存'
  })
}
function uploadForm(update: boolean) { updating.value = update; upload.value = undefined; name.value = update ? file.value?.name || '' : ''; error.value = undefined; modal.value = 'upload' }
function pickFile(event: Event) { upload.value = (event.target as HTMLInputElement).files?.[0] }
async function saveUpload() {
  await run(async () => {
    const selected = upload.value
    if (!selected) throw new ApiError('请选择 YAML 文件。')
    if (!/\.ya?ml$/i.test(selected.name)) throw new ApiError('仅接受 .yaml、.yml 文件。')
    if (!selected.size || selected.size > 5 * 1024 * 1024) throw new ApiError('文件不能为空，且不得超过 5 MiB。')
    try { new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer()) } catch { throw new ApiError('文件必须采用 UTF-8 编码。') }
    if (!updating.value && !name.value.trim()) throw new ApiError('请输入逻辑文件名。')
    const body = new FormData(); body.append('file', selected); if (!updating.value) body.append('name', name.value.trim())
    const result = await request<Model<'ImportResult'>>(updating.value ? `${fileBase.value}/versions` : `${base.value}/yaml-files`, 'POST', body)
    await refreshProject(); file.value = result.file; version.value = result.version.version
    versions.value = await allPages<Model<'YamlVersion'>>(`${fileBase.value}/versions`)
    interfacePage.value = 1; method.value = ''; path.value = ''; content.value = undefined; await loadInterfaces()
    modal.value = null; notice.value = `已保存版本 v${result.version.version}，包含 ${result.version.interface_count} 个接口`
  })
}
async function previewDelete(item?: Model<'YamlFile'>, target: Model<'Project'> | undefined = project.value) {
  if (!target || taskDirty.value) return
  rememberDialogTrigger()
  await run(async () => {
    const preview = await request<Model<'DeletionPreview'>>(`/projects/${target.id}${item ? `/yaml-files/${item.id}` : ''}/deletion-preview`)
    deleteProject.value = target; deleteFile.value = item; deletion.value = preview; modal.value = 'delete'
  })
}
async function confirmDelete() {
  await run(async () => {
    if (!deletion.value?.can_delete || !deleteProject.value) return
    await request(`/projects/${deleteProject.value.id}${deleteFile.value ? `/yaml-files/${deleteFile.value.id}` : ''}?confirm=true`, 'DELETE')
    if (deleteFile.value) { if (file.value?.id === deleteFile.value.id) { file.value = undefined; detail.value = undefined }; await refreshProject() }
    else { project.value = undefined; file.value = undefined; detail.value = undefined; content.value = undefined; files.value = []; page.value = 1; await loadProjects() }
    modal.value = null; notice.value = '删除成功'
  })
}
function back() { project.value = undefined; file.value = undefined; run(loadProjects) }
onMounted(() => run(loadProjects))
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><span class="brand-icon"><UiIcon name="workflow" :size="22"/></span><span>AutoTest<small>API TESTING WORKSPACE</small></span></div>
      <div class="nav-label">工作空间</div>
      <button class="nav" :class="{ 'nav-active': !project }" :disabled="busy || taskDirty" @click="back"><UiIcon name="grid"/>项目管理</button>
      <template v-if="project">
        <div class="nav-label">当前项目</div><div class="project-context"><span class="project-avatar">{{ project.name.slice(0,1) }}</span><div><strong>{{ project.name }}</strong><small>项目 #{{ project.id }}</small></div></div>
        <button class="nav" :class="{ 'nav-active': projectTab === 'assets' }" :disabled="busy || taskDirty" @click="projectTab = 'assets'"><UiIcon name="layers"/>接口资产</button>
        <button class="nav" :class="{ 'nav-active': projectTab === 'tasks' }" :disabled="busy" @click="projectTab = 'tasks'"><UiIcon name="workflow"/>任务编排与运行</button>
        <small v-if="taskDirty" class="nav-hint">保存任务或返回任务列表后可切换页面。</small>
      </template>
      <div class="sidebar-bottom"><div class="workspace-mark"><UiIcon name="code"/><span>OpenAPI 3.0.x<small>接口定义 · 编排 · 执行</small></span></div></div>
    </aside>
    <main>
      <header class="app-header"><div class="breadcrumbs"><button class="link" :disabled="busy || taskDirty" @click="back">工作空间</button><UiIcon name="chevron" :size="13"/><span>{{ project?.name || '项目管理' }}</span><template v-if="project"><UiIcon name="chevron" :size="13"/><strong>{{ projectTab === 'assets' ? '接口资产' : '任务编排' }}</strong></template></div><div v-if="project" class="actions"><button class="text-button" :disabled="busy" @click="projectForm(project)"><UiIcon name="settings"/>项目设置</button><button class="text-button danger" :disabled="busy || taskDirty" @click="previewDelete()"><UiIcon name="trash"/>删除项目</button></div><span v-else class="header-label">自动化接口测试</span></header>
      <div class="page-content">
      <div v-if="error && !modal" class="alert" role="alert"><strong>{{ error.detail }}</strong><div v-for="issue in error.issues" :key="issue.location"><code>{{ issue.location }}</code> · {{ issue.reason }}</div><small v-if="error.code">{{ error.code }}</small><small v-if="error.requestId"> 请求 ID：{{ error.requestId }}</small><button :disabled="busy" @click="run(project ? refreshProject : loadProjects)">重试</button></div>
      <div v-if="notice" class="success" role="status">{{ notice }}</div><div v-if="busy && (!project || projectTab === 'assets')" class="loading" role="status">正在处理…</div>
      <template v-if="!project">
        <section class="heading"><div><div class="eyebrow">PROJECTS</div><h1>项目管理</h1><p>集中管理项目、YAML 文件与接口定义。</p></div><button class="primary" :disabled="busy" @click="projectForm()"><UiIcon name="plus"/>新建项目</button></section>
        <form class="toolbar" @submit.prevent="page = 1; run(loadProjects)"><input v-model="search" placeholder="按项目名称搜索" aria-label="项目名称搜索"><button :disabled="busy">搜索</button><span>共 {{ total }} 个项目</span></form>
        <div class="project-grid"><article v-for="item in projects" :key="item.id" class="project-card"><div class="card-top"><span class="folder"><UiIcon name="folder" :size="24"/></span><div class="actions"><button class="link" :disabled="busy" @click="projectForm(item)">编辑</button><button class="text-button danger" :disabled="busy" :aria-label="`删除项目 ${item.name}`" @click="previewDelete(undefined, item)"><UiIcon name="trash" :size="14"/>删除</button></div></div><button class="project-title" :disabled="busy" @click="openProject(item.id)">{{ item.name }}</button><p>{{ item.description || '暂无描述' }}</p><div class="metrics"><span><b>{{ item.yaml_file_count }}</b> YAML 文件</span><span><b>{{ item.interface_count }}</b> 个接口</span></div><footer><small>更新于 {{ time(item.updated_at) }}</small><button class="link" :disabled="busy" @click="openProject(item.id)">进入项目 →</button></footer></article></div>
        <div v-if="!projects.length && !busy && !error" class="empty"><h3>{{ search ? '未找到匹配项目' : '创建你的第一个项目' }}</h3><p>创建项目后即可导入 OpenAPI YAML，浏览接口与历史版本。</p></div>
        <div class="pagination"><button :disabled="busy || page <= 1" @click="page--; run(loadProjects)">上一页</button><span>{{ page }} / {{ Math.max(1, Math.ceil(total / 12)) }}</span><button :disabled="busy || page * 12 >= total" @click="page++; run(loadProjects)">下一页</button></div>
      </template>
      <template v-else>
        <TaskWorkspace v-if="projectTab === 'tasks'" :key="project.id" :project-id="project.id" @busy="busy = $event" @dirty="taskDirty = $event" />
        <template v-if="projectTab === 'assets'">
        <section class="heading"><div><div class="eyebrow">API LIBRARY</div><h1>接口资产</h1><p>统一管理 YAML 定义与版本，为测试任务提供接口。</p></div><button class="primary" :disabled="busy" @click="uploadForm(false)"><UiIcon name="plus"/>导入 YAML</button></section>
        <div class="asset-stats"><span><UiIcon name="file"/><b>{{ project.yaml_file_count }}</b> YAML 文件</span><span><UiIcon name="code"/><b>{{ project.interface_count }}</b> 当前接口</span><span class="muted">{{ project.description || project.name }}</span></div>
        <section class="panel"><h2>YAML 文件 <small>{{ files.length }} 个文件</small></h2><div class="table-scroll"><table><thead><tr><th>逻辑文件名</th><th>当前版本</th><th>接口数量</th><th>更新时间</th><th>操作</th></tr></thead><tbody><tr v-for="item in files" :key="item.id" :class="{ selected: file?.id === item.id }"><td><button class="link" :disabled="busy" @click="openFile(item)">{{ item.name }}</button></td><td><span class="tag">v{{ item.current_version }}</span></td><td>{{ item.interface_count }}</td><td>{{ time(item.updated_at) }}</td><td><button :disabled="busy" @click="openFile(item)">浏览</button> <button class="danger" :disabled="busy" @click="previewDelete(item)">删除</button></td></tr></tbody></table></div><div v-if="!files.length" class="empty"><h3>暂无 YAML 文件</h3><p>上传接口定义文件，开始管理你的接口资产。</p></div></section>
        <section v-if="file" class="panel"><div class="section-top"><h2>{{ file.name }}</h2><button class="primary" :disabled="busy" @click="uploadForm(true)">上传新版本</button></div>
          <div class="toolbar"><label>浏览版本 <select v-model="version" :disabled="busy" @change="changeVersion"><option v-for="v in versions" :key="v.version" :value="v.version">v{{ v.version }}{{ v.is_current ? ' · 当前版本' : ' · 历史版本' }} · {{ v.interface_count }} 个接口</option></select></label><button :disabled="busy" @click="run(async () => { content = await request(fileBase + '/versions/' + version + '/content') })">查看原始内容</button></div>
          <details class="history"><summary>版本历史（只读）</summary><div v-for="v in versions" :key="v.version" class="history-row"><b>v{{ v.version }}</b><span>{{ v.filename }} · {{ v.title }} · API {{ v.api_version }} · OpenAPI {{ v.openapi_version }}</span><small>{{ time(v.imported_at) }}</small><button :disabled="busy" @click="version = v.version; changeVersion()">查看</button></div></details>
          <div v-if="content"><div class="section-top"><h3>v{{ content.version }} 原始内容 <small>{{ content.redacted ? '敏感信息已脱敏' : '已由服务端进行敏感信息检查' }}</small></h3><button @click="content = undefined">收起</button></div><pre>{{ content.content }}</pre></div>
          <form class="toolbar" @submit.prevent="interfacePage = 1; run(loadInterfaces)"><select v-model="method" aria-label="HTTP 方法"><option value="">全部方法</option><option v-for="m in ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','TRACE']" :key="m">{{ m }}</option></select><input v-model="path" placeholder="按接口路径筛选" aria-label="接口路径"><button :disabled="busy">筛选</button><span>{{ interfaceTotal }} 个接口 · v{{ version }}</span></form>
          <div class="interface-layout"><div class="asset-interface-list"><div class="interface-choices"><button v-for="api in interfaces" :key="api.id" class="interface-row" :class="{ selected: detail?.id === api.id }" :disabled="busy" @click="openInterface(api.id)"><span class="method" :class="api.method.toLowerCase()">{{ api.method }}</span><div><code>{{ api.path }}</code><small>{{ api.summary || api.operation_id || '暂无摘要' }}</small></div><span>›</span></button><div v-if="!interfaces.length" class="empty">该版本没有匹配的接口</div></div><div class="pagination"><button :disabled="busy || interfacePage <= 1" @click="interfacePage--; run(loadInterfaces)">上一页</button><span>{{ interfacePage }} / {{ Math.max(1, Math.ceil(interfaceTotal / 20)) }}</span><button :disabled="busy || interfacePage * 20 >= interfaceTotal" @click="interfacePage++; run(loadInterfaces)">下一页</button></div></div>
          <article v-if="detail" class="api-detail"><span class="method" :class="detail.method.toLowerCase()">{{ detail.method }}</span><h3>{{ detail.path }}</h3><p>{{ detail.summary }}</p><p>{{ detail.description }}</p><small>operationId：{{ detail.operation_id || '未提供' }} · v{{ detail.version }}</small><nav class="tabs asset-detail-tabs" aria-label="接口详情分区"><button :class="{ active: interfaceTab === 'definition' }" :aria-pressed="interfaceTab === 'definition'" @click="interfaceTab = 'definition'"><UiIcon name="file" :size="15"/>接口定义</button><button :class="{ active: interfaceTab === 'test' }" :aria-pressed="interfaceTab === 'test'" @click="interfaceTab = 'test'"><UiIcon name="play" :size="14"/>单次测试</button></nav><InterfaceTest v-show="interfaceTab === 'test'" :key="project.id + '-' + detail.id" :project-id="project.id" :definition="detail"/><div v-show="interfaceTab === 'definition'" class="interface-definition"><h3>参数</h3><p v-if="!detail.parameters.length">无参数</p><div v-for="parameter in detail.parameters" :key="parameter.location + parameter.name"><span class="tag">{{ parameter.location }}</span><p>{{ parameter.description }}</p><SchemaTree :schema="parameter.schema" :label="parameter.name" :required="parameter.required" /></div><h3>请求体</h3><template v-if="detail.request_body"><p>{{ detail.request_body.description }} · {{ detail.request_body.content_type }}</p><SchemaTree :schema="detail.request_body.schema" :required="detail.request_body.required" /></template><p v-else>无请求体</p><h3>响应定义</h3><pre>{{ pretty(detail.responses) }}</pre><h3>认证定义</h3><small>仅供浏览，不自动生成认证请求头。</small><pre>{{ pretty(detail.authentication) }}</pre><h3>Servers</h3><small>仅供浏览。</small><pre>{{ pretty(detail.servers) }}</pre></div></article><div v-else class="empty">选择接口查看参数、请求体及响应定义</div></div>
        </section>
        </template>
      </template>
      </div>
    </main>
    <div v-if="modal" class="overlay" @click.self="!busy && (modal = null)" @keydown.esc="!busy && (modal = null)"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="section-top"><h2 id="dialog-title">{{ modal === 'project' ? (editing ? '编辑项目' : '新建项目') : modal === 'upload' ? (updating ? '上传新版本' : '导入 YAML 文件') : '确认删除' }}</h2><button :disabled="busy" aria-label="关闭" class="icon-button" @click="modal = null"><UiIcon name="close"/></button></div>
      <div v-if="error" class="alert" role="alert"><strong>{{ error.detail }}</strong><div v-for="issue in error.issues" :key="issue.location"><code>{{ issue.location }}</code><p>{{ issue.reason }}</p></div><small>{{ error.code }} {{ error.requestId ? '请求 ID：' + error.requestId : '' }}</small></div>
      <form v-if="modal === 'project'" @submit.prevent="saveProject"><label>项目名称 <input v-model="name" required maxlength="120" autofocus placeholder="例如：订单服务"></label><label>项目描述 <textarea v-model="description" maxlength="2000" rows="4" placeholder="描述项目用途"></textarea></label><div class="dialog-actions"><button type="button" :disabled="busy" @click="modal = null">取消</button><button class="primary" :disabled="busy">{{ busy ? '保存中…' : '保存项目' }}</button></div></form>
      <form v-else-if="modal === 'upload'" @submit.prevent="saveUpload"><label>逻辑文件名 <input v-model="name" :disabled="updating" required maxlength="120" placeholder="例如：订单接口"></label><label class="upload-box">选择 YAML 文件<input type="file" accept=".yaml,.yml" required @change="pickFile"><span>{{ upload?.name || 'UTF-8 · OpenAPI 3.0.x · 最大 5 MiB' }}</span></label><p v-if="updating">成功后新增版本，并将其设为当前版本；历史版本保持只读。</p><p>不支持外部引用、组合 Schema、cookie 参数及非 JSON 请求体。解析错误会显示具体位置。</p><div class="dialog-actions"><button type="button" :disabled="busy" @click="modal = null">取消</button><button class="primary" :disabled="busy">{{ busy ? '正在校验并上传…' : '上传并保存' }}</button></div></form>
      <template v-else-if="deletion"><p>将永久删除「{{ deleteFile?.name || deleteProject?.name }}」及以下关联数据，此操作无法撤销。</p><div class="delete-counts"><span>文件 {{ deletion.yaml_file_count }}</span><span>版本 {{ deletion.version_count }}</span><span>接口 {{ deletion.interface_count }}</span><span>任务 {{ deletion.task_count }}</span><span>运行记录 {{ deletion.run_count }}</span></div><div v-if="!deletion.can_delete" class="alert"><strong>当前无法删除</strong><p v-for="reason in deletion.blocking_reasons" :key="reason">{{ reason }}</p></div><div class="dialog-actions"><button :disabled="busy" @click="modal = null">取消</button><button class="danger solid" :disabled="busy || !deletion.can_delete" @click="confirmDelete">{{ busy ? '删除中…' : '确认永久删除' }}</button></div></template>
    </section></div>
  </div>
</template>
