<script setup lang="ts">
import type { ParameterDraft, TaskModel } from '../task-editor'
const props = defineProps<{ sql: NonNullable<TaskModel<'ExecutionOptions'>['sql']>; parameters: ParameterDraft[] }>()
function changeDriver() {
  if (props.sql.driver === 'sqlite') {
    delete props.sql.username
    delete props.sql.password
  }
}
function changeTimeout(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (value === '') delete props.sql.timeout_seconds
  else props.sql.timeout_seconds = Number(value)
}
</script>

<template>
  <section class="node-settings sql-settings" aria-label="SQL 节点配置">
    <h3>SQL 配置</h3>
    <label>数据库驱动<select v-model="sql.driver" @change="changeDriver"><option value="postgresql">PostgreSQL</option><option value="sqlite">SQLite</option></select></label>
    <label>数据源 <span class="required">*</span><textarea v-model="sql.datasource" required rows="2" spellcheck="false" :placeholder="sql.driver === 'sqlite' ? '/path/to/database.db' : 'host=127.0.0.1 port=5432 dbname=business'"></textarea><small>{{ sql.driver === 'sqlite' ? '填写服务端可访问的数据库文件路径。' : '支持 libpq 连接串或 PostgreSQL URI。' }}</small></label>
    <template v-if="sql.driver === 'postgresql'">
      <label>用户名<input v-model="sql.username" autocomplete="off" placeholder="可选；覆盖数据源中的用户名"></label>
      <label>密码<input v-model="sql.password" type="password" autocomplete="new-password" placeholder="可选；覆盖数据源中的密码"></label>
    </template>
    <label>SQL 超时（秒）<input :value="sql.timeout_seconds" @input="changeTimeout" type="number" min="1" max="300" step="1" placeholder="默认 30"><small>范围 1～300 秒；分别限制连接等待与语句执行，并非节点总耗时上限。</small></label>
    <label>SQL 语句 <span class="required">*</span><textarea v-model="sql.statement" class="sql-statement" required rows="10" spellcheck="false" :placeholder="sql.driver === 'sqlite' ? 'INSERT INTO test_data (id) VALUES (?)' : 'INSERT INTO test_data (id) VALUES (%s)'"></textarea></label>
    <div class="sql-parameters">
      <h3>顺序绑定参数</h3>
      <small>PostgreSQL 占位符使用 %s，SQLite 使用 ?。参数按列表顺序绑定，可重复选择同一参数；只支持标量或 null。</small>
      <label v-for="(name,index) in sql.parameters" :key="index">参数 {{ index+1 }}
        <select v-model="sql.parameters![index]"><option value="">选择全局参数</option><option v-if="name && !parameters.some(p => p.name === name)" :value="name">{{ name }}（参数不存在）</option><option v-for="p in parameters" :key="p.key" :value="p.name" :disabled="['object','array'].includes(p.value_type)">{{ p.name }} · {{ p.value_type }}</option></select>
        <button type="button" @click="sql.parameters!.splice(index,1)">移除参数 {{ index+1 }}</button>
      </label>
      <button type="button" :disabled="(sql.parameters?.length || 0) >= 100" @click="(sql.parameters ||= []).push('')">添加绑定参数</button>
    </div>
    <p class="muted">每个节点执行一条 SQL，独立事务，成功提交、失败回滚。请勿使用 BEGIN、COMMIT、ROLLBACK。SQL 使用驱动参数绑定，不做字符串插值，也不提取查询结果。</p>
    <small>保存配置不会连接数据库；保存并运行任务或预览后续参数时会执行 SQL。</small>
  </section>
</template>

<style scoped>
.sql-parameters { display: grid; gap: 12px; }
.sql-statement { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; }
</style>
