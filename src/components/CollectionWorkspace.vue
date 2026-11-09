<script setup lang="ts">
import { usePageHistory, isRestoringHistory } from '../usePageHistory'
import { pageId } from '../page-history'
import { useId } from 'vue'
import UiIcon from './UiIcon.vue'
// Keep the component instance suffix unique, including recursive and repeated components.
const divId = useId()

import { onMounted, onBeforeUnmount, ref } from 'vue'
import { ApiError, query, request } from '../api'
import type { components } from '../task-collection-api-schema'
import type { TaskModel } from '../task-editor'
import { buildCollectionMembers } from '../task-collection'
import { useDialogFocus } from '../useDialogFocus'
type Group = components['schemas']['Collection']
type Run = components['schemas']['Run']
const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ openRun: [taskId: number, runId: number]; busy: [value: boolean]; dirty: [value: boolean] }>()
const base = `/projects/${props.projectId}/task-collections`
const groups = ref<Group[]>([]), search = ref(''), page = ref(1), total = ref(0), busy = ref(false), error = ref<ApiError>(), notice = ref('')
const selected = ref<Group>(), editing = ref(false), name = ref(''), description = ref(''), baseUrl = ref(''), datasourceEnabled = ref(false), driver = ref<'postgresql' | 'sqlite'>('postgresql'), datasource = ref(''), username = ref(''), password = ref(''), members = ref<components['schemas']['Member'][]>([])
const tasks = ref<TaskModel<'TaskSummary'>[]>([]), pickTask = ref<number>(), pickBatch = ref(1)
const runs = ref<Run[]>([]), runPage = ref(1), runTotal = ref(0)
const detail = ref<components['schemas']['RunDetail']>(), overrides = ref<components['schemas']['Override'][]>([]), auditPage = ref(1), auditTotal = ref(0)
const deleting = ref<Group>()
const remember = useDialogFocus(() => !!deleting.value)
const labels: Record<string, string> = { pending: '待执行', queued: '待运行', running: '运行中（含清理）', succeeded: '成功', failed: '失败', skipped: '已跳过' }
const date = (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '—'
async function act(fn: () => Promise<void>) { if (busy.value) return; busy.value = true; emit('busy',true); error.value = undefined; notice.value = ''; try { await fn() } catch(e) { error.value = e instanceof ApiError ? e : new ApiError((e as Error).message) } finally { busy.value = false; emit('busy',false) } }
async function load() { const result = await request<components['schemas']['CollectionPage']>(base+query({ page: page.value, page_size: 20 })); groups.value = result.items; total.value = result.total }
async function open(group: Group) { await act(async () => { selected.value = await request<Group>(`${base}/${group.id}`); editing.value = false; detail.value = undefined; overrides.value = []; runPage.value = 1; await loadRuns() }) }
async function loadRuns() { if (!selected.value) return; const result = await request<components['schemas']['RunPage']>(`${base}/${selected.value.id}/runs${query({ page: runPage.value, page_size: 20 })}`); runs.value = result.items; runTotal.value = result.total }
async function edit(group?: Group) {
  await act(async () => {
    const current = group ? await request<Group>(`${base}/${group.id}`) : undefined
    selected.value = current; detail.value = undefined; overrides.value = []; runs.value = []; runPage.value = 1; if (current) await loadRuns(); name.value = current?.name || ''; description.value = current?.description || ''; baseUrl.value = current?.base_url || ''; datasourceEnabled.value = !!current?.datasource; driver.value = current?.datasource?.driver || 'postgresql'; datasource.value = current?.datasource?.datasource || ''; username.value = current?.datasource?.username || ''; password.value = current?.datasource?.password || ''; members.value = current?.members.map(m => ({ ...m })) || []
    const list: TaskModel<'TaskSummary'>[] = []; let currentPage = 1
    while (true) { const result = await request<TaskModel<'TaskPage'>>(`/projects/${props.projectId}/tasks${query({page: currentPage++, page_size:100})}`); list.push(...result.items); if (list.length >= result.total || !result.items.length) break }
    tasks.value = list; pickTask.value = undefined; pickBatch.value = 1; editing.value = true; emit('dirty',true)
  })
}
function addMember() { if (!pickTask.value || members.value.some(m => m.task_id === pickTask.value)) return; members.value.push({ task_id: pickTask.value, position: pickBatch.value }); pickTask.value = undefined }
async function save() { await act(async () => { const body = buildCollectionMembers(name.value, description.value, members.value); if (baseUrl.value.trim()) { const value = baseUrl.value.trim(); let url: URL; try { url = new URL(value) } catch { throw new Error('请输入有效的 HTTP/HTTPS 运行地址。') }; if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('运行地址只支持 HTTP/HTTPS，不能包含凭据、query 或 fragment。'); body.base_url = value }; if (datasourceEnabled.value) { if (!datasource.value.trim()) throw new Error('请输入任务组数据源。'); body.datasource = { driver: driver.value, datasource: datasource.value.trim(), ...(driver.value === 'postgresql' ? { username: username.value, password: password.value } : {}) } }; selected.value = await request<Group>(selected.value ? `${base}/${selected.value.id}` : base, selected.value ? 'PUT' : 'POST', body); editing.value = false; emit('dirty',false); runPage.value = 1; await load(); await loadRuns(); notice.value = '任务组已保存。' }) }
async function start(group: Group) { await act(async () => { const run = await request<Run>(`${base}/${group.id}/runs`, 'POST'); selected.value = group; runPage.value = 1; await loadRuns(); await loadDetail(run.id); notice.value = '任务组运行已接受，请手动刷新查看结果。' }) }
async function loadDetail(id: number) { if (!selected.value) return; detail.value = await request<components['schemas']['RunDetail']>(`${base}/${selected.value.id}/runs/${id}`); auditPage.value = 1; await loadAudit() }
async function loadAudit() { if (!detail.value || !selected.value) return; const result = await request<components['schemas']['OverridePage']>(`${base}/${selected.value.id}/runs/${detail.value.id}/overrides${query({page:auditPage.value,page_size:20})}`); overrides.value = result.items; auditTotal.value = result.total }
async function refresh() { await load(); if (selected.value && !editing.value) { await loadRuns(); if(detail.value) { const id = detail.value.id; detail.value = await request<components['schemas']['RunDetail']>(`${base}/${selected.value.id}/runs/${id}`); await loadAudit() } } }
async function remove() { await act(async () => { if(!deleting.value) return; const id = deleting.value.id; await request(`${base}/${id}?confirm=true`, 'DELETE'); deleting.value = undefined; if(selected.value?.id === id) { selected.value = undefined; detail.value = undefined; editing.value = false; emit('dirty',false) }; if(groups.value.length === 1 && page.value > 1) page.value--; await load(); notice.value = '任务组配置已删除，任务及运行历史已保留。' }) }
function taskName(id: number) { return tasks.value.find(t => t.id === id)?.name || `任务 #${id}` }
usePageHistory({
  capture: () => ({ ...(selected.value ? { collection: String(selected.value.id) } : {}), ...(editing.value ? { collectionEdit: '1' } : {}), ...(detail.value ? { collectionRun: String(detail.value.id) } : {}) }),
  busy: () => busy.value,
  allow: location => !editing.value || (pageId(location.project) === props.projectId && location.section === 'tasks' && location.taskList === 'collections' && location.collectionEdit === '1' && location.collection === (selected.value ? String(selected.value.id) : undefined)) || window.confirm('任务组有未保存的修改，确定离开？'),
  restore: async location => {
    if (pageId(location.project) !== props.projectId || location.section !== 'tasks' || location.taskList !== 'collections' || location.task) return
    deleting.value = undefined
    await act(load)
    const id = pageId(location.collection)
    if (location.collectionEdit === '1') {
      if (!editing.value || selected.value?.id !== id) await edit(id ? { id } as Group : undefined)
      return
    }
    editing.value = false; emit('dirty', false)
    if (!id) { selected.value = undefined; detail.value = undefined; return }
    if (selected.value?.id !== id) await open({ id } as Group)
    const runId = pageId(location.collectionRun)
    if (runId && detail.value?.id !== runId) await act(() => loadDetail(runId))
    if (!runId) detail.value = undefined
  },
})
onMounted(() => { if (!isRestoringHistory()) act(load) })
onBeforeUnmount(() => emit('dirty', false))
</script>
<template>
  <section class="surface collection-workspace">
    <header class="surface-toolbar collection-header">
      <div class="collection-heading">
        <span class="collection-heading-icon"><UiIcon name="layers" :size="22"/></span>
        <div><h2>{{ editing ? (selected ? '编辑任务组' : '新建任务组') : '任务组' }}</h2><p>{{ editing ? '设置基本信息，添加任务并安排执行批次。' : '组合多个测试任务，按批次执行与共享参数。' }}</p></div>
      </div>
      <div v-if="!editing" class="actions"><button :disabled="busy" @click="act(refresh)"><UiIcon name="refresh" :size="16"/>刷新</button><button class="primary" :disabled="busy" @click="edit()"><UiIcon name="plus" :size="16"/>新建任务组</button></div>
      <span v-else class="collection-draft">{{ selected ? '编辑中' : '未保存' }}</span>
    </header>
    <div class="collection-rule"><UiIcon name="info" :size="17"/><p>按批次升序执行，同批任务并发。每批任务全部成功且完成 finally 清理后，输出参数将传递给后续批次。</p></div>
    <div :id="'collection-workspace-alert-' + divId" v-if="error" class="alert" role="alert">{{ error.detail }}<div :id="'collection-workspace-block-' + divId + '-' + encodeURIComponent(String(i.location))" v-for="i in error.issues" :key="i.location">{{ i.location }} · {{ i.reason }}</div><small>{{ error.code }} {{ error.requestId }}</small></div><p v-if="notice" class="success" role="status">{{ notice }}</p>
    <form v-if="editing" class="collection-form" @submit.prevent="save">
      <fieldset :disabled="busy" class="collection-fieldset">
        <div class="collection-editor-layout">
          <section class="collection-form-section" aria-labelledby="collection-basics-title">
            <div class="collection-section-heading"><span class="collection-section-number">01</span><div><h3 id="collection-basics-title">基本信息</h3><p>为这组测试任务设置清晰的名称和说明。</p></div></div>
            <div class="collection-fields">
              <label>任务组名称 <span class="collection-required">必填</span><input v-model="name" required maxlength="120" placeholder="例如：核心业务回归测试"><small>最多 120 个字符</small></label>
              <label>描述 <span class="collection-optional">选填</span><textarea v-model="description" maxlength="2000" rows="4" placeholder="描述测试范围、使用场景或执行注意事项…"></textarea></label>
              <label>运行地址 <span class="collection-optional">选填</span><input v-model="baseUrl" type="url" placeholder="https://api.example.com/service"><small>组运行时覆盖所有成员任务的运行地址；留空使用各任务配置。</small></label>
              <label class="collection-checkbox"><input v-model="datasourceEnabled" type="checkbox">配置全局数据源<small>组运行时覆盖所有成员 SQL 节点的连接配置。</small></label>
              <template v-if="datasourceEnabled">
                <label>数据库类型<select v-model="driver"><option value="postgresql">PostgreSQL</option><option value="sqlite">SQLite</option></select></label>
                <label>数据源 <span class="collection-required">必填</span><textarea v-model="datasource" required rows="2" :placeholder="driver === 'sqlite' ? '/path/to/database.db' : 'host=127.0.0.1 port=5432 dbname=business'"></textarea></label>
                <label v-if="driver === 'postgresql'">用户名 <span class="collection-optional">选填</span><input v-model="username" autocomplete="off"></label>
                <label v-if="driver === 'postgresql'">密码 <span class="collection-optional">选填</span><input v-model="password" type="password" autocomplete="new-password"></label>
              </template>
            </div>
          </section>
          <section class="collection-form-section collection-members-section" aria-labelledby="collection-members-title">
            <div class="collection-section-heading"><span class="collection-section-number">02</span><div><h3 id="collection-members-title">任务与批次 <span class="count">{{ members.length }}</span></h3><p>选择项目任务，相同批次的任务将同时执行。</p></div></div>
            <div class="collection-member-picker">
              <label>项目任务<select v-model="pickTask"><option :value="undefined">选择要添加的任务</option><option v-for="t in tasks.filter(t => !members.some(m => m.task_id === t.id))" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
              <label>执行批次<input v-model.number="pickBatch" type="number" min="1" max="2147483647"></label>
              <button type="button" @click="addMember" :disabled="!pickTask"><UiIcon name="plus" :size="16"/>添加任务</button>
            </div>
            <div class="collection-member-list" v-if="members.length">
              <div v-for="(m,i) in members" :key="m.task_id" class="collection-editor-member">
                <span class="collection-member-index">{{ String(i + 1).padStart(2, '0') }}</span>
                <strong>{{ taskName(m.task_id) }}</strong>
                <label>批次<input v-model.number="m.position" type="number" min="1" max="2147483647" required :aria-label="taskName(m.task_id) + '的执行批次'"></label>
                <button type="button" class="text-button danger" @click="members.splice(i,1)" :aria-label="'移除 ' + taskName(m.task_id)"><UiIcon name="trash" :size="15"/>移除</button>
              </div>
            </div>
            <div v-else class="collection-members-empty"><UiIcon name="layers" :size="26"/><strong>尚未添加任务</strong><p>从上方选择项目任务，开始安排执行批次。</p></div>
          </section>
        </div>
        <footer class="collection-form-footer"><span><UiIcon name="info" :size="15"/>保存后可在任务组列表中发起运行</span><div class="actions"><button type="button" @click="editing = false; $emit('dirty',false)">取消</button><button type="submit" class="primary"><UiIcon name="check" :size="16"/>保存任务组</button></div></footer>
      </fieldset>
    </form>
    <template v-else>
      <form class="search-form collection-search" @submit.prevent><input v-model="search" aria-label="搜索任务组" placeholder="筛选当前页任务组名称"><button :disabled="busy">搜索</button></form>
      <div :id="'collection-workspace-table-scroll-' + divId" class="table-scroll"><table><thead><tr><th>名称</th><th>成员 / 批次</th><th>更新时间</th><th>操作</th></tr></thead><tbody><tr v-for="g in groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()))" :key="g.id"><td><button class="entity-title" :disabled="busy" @click="open(g)">{{ g.name }}</button><small class="block">{{ g.description }}</small></td><td>{{ g.members.length }} / {{ new Set(g.members.map(m => m.position)).size }}</td><td>{{ date(g.updated_at) }}</td><td><div :id="'collection-workspace-actions-3-' + divId + '-' + encodeURIComponent(String(g.id))" class="actions"><button :disabled="busy" @click="open(g)">历史</button><button :disabled="busy" @click="edit(g)">编辑</button><button :disabled="busy || !g.members.length" @click="start(g)">运行</button><button class="danger" :disabled="busy" @click="remember(); deleting=g">删除</button></div></td></tr></tbody></table></div><p v-if="!groups.length && !busy" class="empty">暂无任务组</p>
      <div :id="'collection-workspace-pagination-' + divId" class="pagination"><button :disabled="busy || page<=1" @click="page--; act(load)">上一页</button><span>{{ page }} / {{ Math.max(1,Math.ceil(total/20)) }}</span><button :disabled="busy || page*20>=total" @click="page++; act(load)">下一页</button></div>
      <section v-if="selected"><h3>{{ selected.name }} · 运行历史</h3><div :id="'collection-workspace-collection-member-2-' + divId + '-' + encodeURIComponent(String(r.id))" v-for="r in runs" :key="r.id" class="collection-member"><button :disabled="busy" @click="act(() => loadDetail(r.id))">运行 #{{ r.id }}</button><span>{{ labels[r.status] }}</span><small>{{ date(r.created_at) }}</small></div><p v-if="!runs.length">暂无运行记录</p><div :id="'collection-workspace-pagination-2-' + divId" class="pagination"><button :disabled="busy || runPage<=1" @click="runPage--; act(loadRuns)">上一页</button><span>{{ runPage }} / {{ Math.max(1,Math.ceil(runTotal/20)) }}</span><button :disabled="busy || runPage*20>=runTotal" @click="runPage++; act(loadRuns)">下一页</button></div></section>
      <section v-if="detail"><h3>组运行 #{{ detail.id }} · {{ labels[detail.status] }}</h3><p v-if="detail.error_code" class="alert">{{ detail.error_code }} · {{ detail.error_message }}</p><div :id="'collection-workspace-collection-member-3-' + divId + '-' + encodeURIComponent(String(m.task_id))" v-for="m in detail.members" :key="m.task_id" class="collection-member"><span>批次 {{ m.position }} · 任务 #{{ m.task_id }}</span><span>{{ labels[m.status] }}</span><button :disabled="busy" @click="$emit('openRun',m.task_id,m.task_run_id)">查看任务运行 #{{ m.task_run_id }}</button></div><h4>已提交全局参数</h4><div :id="'collection-workspace-collection-member-4-' + divId + '-' + encodeURIComponent(String(p.name))" v-for="p in detail.global_parameters" :key="p.name" class="collection-member"><code>{{ p.name }} · {{ p.value_type }}</code><pre>{{ p.sensitive ? '••••••' : JSON.stringify(p.value,null,2) }}</pre></div><h4>参数覆盖记录（{{ auditTotal }}）</h4><div :id="'collection-workspace-collection-member-5-' + divId + '-' + encodeURIComponent(String(a.id))" v-for="a in overrides" :key="a.id" class="collection-member"><code>{{ a.parameter_name }}</code><span>任务 {{ a.old_task_id }} / 运行 {{ a.old_task_run_id }} → 任务 {{ a.new_task_id }} / 运行 {{ a.new_task_run_id }}</span><small>{{ date(a.created_at) }}</small></div><div :id="'collection-workspace-pagination-3-' + divId" class="pagination"><button :disabled="busy || auditPage<=1" @click="auditPage--; act(loadAudit)">上一页</button><span>{{ auditPage }} / {{ Math.max(1,Math.ceil(auditTotal/20)) }}</span><button :disabled="busy || auditPage*20>=auditTotal" @click="auditPage++; act(loadAudit)">下一页</button></div></section>
    </template>
    <div :id="'collection-workspace-overlay-' + divId" v-if="deleting" class="overlay" @keydown.esc="!busy && (deleting=undefined)"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-group-title"><h2 id="delete-group-title">删除任务组「{{ deleting.name }}」？</h2><p>删除配置及成员，保留任务和全部运行历史。</p><p v-if="error" class="alert">{{ error.detail }}</p><div :id="'collection-workspace-actions-4-' + divId" class="actions"><button :disabled="busy" @click="deleting=undefined">取消</button><button class="danger" :disabled="busy" @click="remove">确认删除</button></div></section></div>
  </section>
</template>

<style scoped>
.collection-workspace { padding: 0; color: var(--ink); font-size: 14px; }
.collection-header { padding: 24px 28px; flex-wrap: wrap; }
.collection-heading { display: flex; align-items: center; gap: 14px; min-width: 0; }
.collection-heading-icon { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; background: var(--primary-soft); color: var(--primary); border-radius: 12px; }
.collection-heading h2 { font-size: 19px; line-height: 1.5; }
.collection-heading p { font-size: 13px; line-height: 1.6; margin-top: 3px; }
.collection-draft { padding: 5px 10px; border-radius: 6px; background: #f4f6fa; color: #65738a; font-size: 12px; }
.collection-rule { display: flex; gap: 10px; align-items: flex-start; margin: 20px 28px 0; padding: 12px 16px; border-radius: 8px; background: #f4f7ff; color: #627ab8; }
.collection-rule .ui-icon { margin-top: 2px; }
.collection-rule p { color: #5e7197; font-size: 13px; line-height: 1.7; }
.collection-workspace > .alert, .collection-workspace > .success { margin: 20px 28px 0; }
.collection-fieldset { border: 0; padding: 0; margin: 0; }
.collection-editor-layout { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.4fr); padding: 28px; gap: 32px; }
.collection-form-section { min-width: 0; }
.collection-members-section { border-left: 1px solid var(--border); padding-left: 32px; }
.collection-section-heading { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 24px; }
.collection-section-number { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px; background: #f0f3fa; color: #7384a4; font-size: 12px; font-weight: 600; }
.collection-section-heading h3 { font-size: 15px; line-height: 28px; }
.collection-section-heading p { margin-top: 4px; font-size: 12px; line-height: 1.6; }
.collection-fields { display: grid; gap: 22px; }
.collection-fields label, .collection-member-picker label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: #43516a; font-size: 13px; font-weight: 500; min-width: 0; }
.collection-fields input, .collection-fields textarea { flex-basis: 100%; width: 100%; }
.collection-fields input, .collection-fields textarea, .collection-member-picker input, .collection-member-picker select { font-size: 14px; font-weight: 400; padding: 9px 12px; }
.collection-fields textarea { min-height: 122px; }
.collection-fields small { font-size: 12px; font-weight: 400; color: #8490a3; }
.collection-fields .collection-checkbox input { flex-basis: auto; width: auto; }
.collection-fields .collection-checkbox small { flex-basis: 100%; }
.collection-required { font-size: 11px; color: #bc6270; font-weight: 400; }
.collection-optional { font-size: 11px; color: #8a95a6; font-weight: 400; }
.collection-member-picker { display: grid; grid-template-columns: minmax(0, 1fr) 108px auto; gap: 12px; align-items: end; padding: 16px; background: #f8fafd; border: 1px solid #e9edf4; border-radius: 10px; }
.collection-member-picker label { display: flex; flex-direction: column; align-items: stretch; }
.collection-member-picker input, .collection-member-picker select { width: 100%; height: 42px; }
.collection-member-picker button { height: 42px; font-size: 13px; white-space: nowrap; }
.collection-members-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 36px 16px; border: 1px dashed #dce3ef; border-radius: 10px; margin-top: 16px; color: #99a7c0; }
.collection-members-empty strong { font-size: 14px; color: #62718b; font-weight: 500; }
.collection-members-empty p { font-size: 12px; }
.collection-member-list { margin-top: 16px; }
.collection-editor-member { display: grid; grid-template-columns: 24px minmax(0,1fr) auto auto; gap: 12px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--border); }
.collection-member-index { color: #99a5b8; font-size: 12px; font-variant-numeric: tabular-nums; }
.collection-editor-member strong { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.collection-editor-member label { display: flex; align-items: center; gap: 8px; color: #758197; font-size: 12px; }
.collection-editor-member input { width: 76px; padding: 7px 8px; font-size: 13px; }
.collection-editor-member button { font-size: 12px; }
.collection-form-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 28px; border-top: 1px solid var(--border); background: #fafbfe; border-radius: 0 0 12px 12px; }
.collection-form-footer > span { display: flex; align-items: center; gap: 7px; color: #8490a5; font-size: 12px; }
.collection-form-footer button { min-height: 40px; padding: 9px 18px; font-size: 14px; }
.collection-search { margin: 24px 28px; max-width: 380px; }
.collection-search input { width: 100%; font-size: 13px; }
.collection-workspace th { font-size: 12px; color: #738097; }
.collection-workspace td { font-size: 13px; }
.collection-workspace td small { max-width: 360px; white-space: normal; margin-top: 5px; }
.collection-workspace > .pagination { padding: 18px 24px; border-top: 1px solid var(--border); }
.collection-workspace > section { margin: 0 28px; padding: 24px 0; border-top: 1px solid var(--border); }
.collection-workspace > section h3 { font-size: 16px; margin-bottom: 16px; }
.collection-workspace > section h4 { margin: 20px 0 12px; }
.collection-workspace .collection-member { font-size: 13px; gap: 12px; }
.collection-workspace .collection-member pre { max-width: 100%; }
@media (max-width: 1100px) {
  .collection-editor-layout { grid-template-columns: minmax(0,1fr); gap: 28px; }
  .collection-members-section { border-left: 0; padding-left: 0; border-top: 1px solid var(--border); padding-top: 28px; }
  .collection-fields { grid-template-columns: minmax(0,1fr) minmax(0,1fr); align-items: start; }
}
@media (max-width: 640px) {
  .collection-header { padding: 20px; gap: 16px; }
  .collection-heading-icon { width: 38px; height: 38px; }
  .collection-heading h2 { font-size: 17px; }
  .collection-heading p { font-size: 12px; }
  .collection-rule { margin: 16px 18px 0; padding: 12px; }
  .collection-editor-layout { padding: 24px 18px; }
  .collection-fields { grid-template-columns: minmax(0,1fr); }
  .collection-member-picker { grid-template-columns: minmax(0,1fr) 90px; }
  .collection-member-picker button { grid-column: 1 / -1; }
  .collection-editor-member { grid-template-columns: 20px minmax(0,1fr) auto; gap: 8px; }
  .collection-editor-member label { grid-column: 2; grid-row: 2; }
  .collection-editor-member button { grid-column: 3; grid-row: 1 / 3; padding: 6px; }
  .collection-form-footer { flex-wrap: wrap; padding: 16px 18px; }
  .collection-form-footer .actions { width: 100%; justify-content: flex-end; }
  .collection-search { margin: 20px 18px; }
  .collection-workspace > section { margin: 0 18px; }
}
</style>
