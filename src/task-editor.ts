import type { components } from './task-api-schema'
import type { Model } from './api'
export type TaskModel<K extends keyof components['schemas']> = components['schemas'][K]
export type ValueType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
export type Schema = Record<string, unknown>
export interface ParameterDraft {
  key: number; name: string; value_type: ValueType; sensitive: boolean; text: string; source_type?: 'fixed' | 'function' | 'rest' | 'expression'; step_key?: number; extract_expression?: string; retained?: TaskModel<'GlobalParameter'>
}
export interface FieldDraft {
  key: number; location: 'path' | 'query' | 'header' | 'body'; name: string; schema: Schema; required: boolean
  enabled: boolean; kind: 'literal' | 'global'; text: string; parameter_name: string; preserved: boolean
}
export interface StepDraft {
  key: number; id?: number; interface_id: number; file_id: number; version: number; file_name: string
  step_type?: 'rest' | 'wait' | 'parallel' | 'sql' | 'compute'; execution_scope?: 'main' | 'finally'; position?: number; parent_key?: number
  wait_milliseconds?: number; max_concurrency?: number; raw_body?: { text: string }
  options?: TaskModel<'ExecutionOptions'>
  assertion_code?: string | null
  method: string; path: string; has_new_version: boolean; fields: FieldDraft[]; definition: Model<'InterfaceDetail'>
}
let nextKey = 0
export const key = () => ++nextKey
export const secretHeader = (name: string) => /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(name)
export function parseValue(text: string, type: string): unknown {
  if (type.includes(',')) { const types = type.split(','); try { const value = JSON.parse(text); if (types.some(t => matches(value, t))) return value } catch {}
    if (types.includes('string')) return text
    throw new Error(`值必须为 ${types.join(' / ')} 类型。`)
  }
  if (type === 'string' || !type) return text
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('请输入有效 JSON 值；布尔值使用 true 或 false。') }
  if (type === 'json') return value
  if (!matches(value, type)) throw new Error(`值必须为 ${type} 类型，不支持 null 或隐式类型转换。`)
  return value
}
export function matches(value: unknown, type: string): boolean {
  if (type === 'null') return value === null
  if (value === null || value === undefined) return false
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'object') return typeof value === 'object' && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  return !type || typeof value === type
}
export function checkSchema(value: unknown, schema: Schema, at = ''): string | undefined {
  for (const branch of (schema.allOf as Schema[] || [])) { const error = checkSchema(value, branch, at); if (error) return error }
  for (const mode of ['anyOf', 'oneOf'] as const) {
    const branches = schema[mode] as Schema[] | undefined
    if (branches) { const passed = branches.filter(branch => !checkSchema(value, branch, at)).length; if (mode === 'anyOf' ? passed === 0 : passed !== 1) return `${at || '值'}不满足 ${mode} 组合约束` }
  }
  if (schema.not && !checkSchema(value, schema.not as Schema, at)) return `${at || '值'}不满足 not 约束`
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (value === undefined || (types.length && !types.some(t => matches(value, String(t))) && !(value === null && schema.nullable === true)) || (value === null && !types.length && !schema.anyOf && !schema.oneOf && !schema.allOf && schema.nullable !== true)) return `${at || '值'}类型应为 ${types.join(' / ') || '非 null JSON'}`
  if (Object.hasOwn(schema, 'const') && JSON.stringify(schema.const) !== JSON.stringify(value)) return `${at || '值'}必须等于 const 值`
  if (Array.isArray(schema.enum) && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return `${at || '值'}不在允许枚举中`
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    for (const name of (schema.required as string[] || [])) if (object[name] === undefined) return `${at}/${name} 为必填字段`
    for (const [name, child] of Object.entries((schema.properties as Record<string, Schema>) || {})) {
      if (object[name] !== undefined) { const error = checkSchema(object[name], child, `${at}/${name}`); if (error) return error }
    }
  }
  if (Array.isArray(value) && schema.items) for (let i = 0; i < value.length; i++) { const error = checkSchema(value[i], schema.items as Schema, `${at}/${i}`); if (error) return error }
  return undefined
}
export function schemaInputType(schema: Schema): string { return schema.type ? String(schema.type) : schema.properties ? 'object' : schema.allOf || schema.oneOf || schema.anyOf ? 'json' : 'string' }
export function textValue(value: unknown, type: string) { return value === undefined ? '' : type === 'string' ? String(value) : JSON.stringify(value, null, 2) }
export function field(location: FieldDraft['location'], name: string, schema: Schema = {}, required = false): FieldDraft {
  return { key: key(), location, name, schema, required, enabled: schema.default !== undefined, kind: 'literal', text: textValue(schema.default, schemaInputType(schema)), parameter_name: '', preserved: false }
}
export function fieldsFor(definition: Model<'InterfaceDetail'>): FieldDraft[] {
  const fields = definition.parameters.map(p => field(p.location, p.name, p.schema, p.required))
  if (definition.request_body) {
    const body = definition.request_body
    fields.push(field('body', '', body.schema, body.required))
    const walk = (schema: Schema, prefix: string, required: boolean) => {
      for (const [name, child] of Object.entries((schema.properties as Record<string, Schema>) || {})) {
        const pointer = `${prefix}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`
        const isRequired = required && ((schema.required as string[]) || []).includes(name)
        fields.push(field('body', pointer, child, isRequired)); walk(child, pointer, isRequired)
      }
    }
    walk(body.schema, '', body.required)
    // A default parent replaces its children; do not create overlapping bindings.
    for (const f of fields.filter(f => f.location === 'body' && f.enabled)) for (const child of fields) if (child.location === 'body' && child.name.startsWith(f.name + '/')) child.enabled = false
  }
  return fields
}
export const nodeType = (s: StepDraft) => s.step_type || 'rest'
export const scope = (s: StepDraft) => s.execution_scope || 'main'
export function controlDraft(type: 'wait' | 'parallel' | 'sql' | 'compute', saved?: TaskModel<'Step'>): StepDraft {
  return { key: key(), interface_id: 0, file_id: 0, version: 0, file_name: '', method: type.toUpperCase(), path: type === 'wait' ? '固定等待' : type === 'sql' ? 'SQL 执行' : type === 'compute' ? '表达式计算' : '并行屏障', has_new_version: false, fields: [], definition: { parameters: [] } as unknown as Model<'InterfaceDetail'>, execution_scope: 'main', wait_milliseconds: type === 'wait' ? 1000 : undefined, max_concurrency: type === 'parallel' ? 2 : undefined, ...saved, options: type === 'sql' ? { ...saved?.options, sql: { driver: 'postgresql', datasource: '', statement: '', ...saved?.options?.sql } } : type === 'compute' ? { timezone: 'Asia/Shanghai', expressions: [], ...saved?.options } : saved?.options, step_type: type }
}
export function orderedSteps(steps: StepDraft[]): StepDraft[] {
  const siblings = (parent?: number, executionScope = 'main') => steps.filter(s => s.parent_key === parent && scope(s) === executionScope).sort((a,b) => (a.position ?? steps.indexOf(a)+1) - (b.position ?? steps.indexOf(b)+1) || (a.id || 0)-(b.id || 0))
  const main = siblings().flatMap(s => [s, ...siblings(s.key)])
  const result = [...main, ...siblings(undefined, 'finally')]
  return [...result, ...steps.filter(s => !result.includes(s))]
}
export function canReadSource(steps: StepDraft[], consumer: StepDraft, source?: StepDraft): boolean {
  if (!source || !['rest', 'compute'].includes(nodeType(source))) return false
  if (scope(source) === 'finally') return scope(consumer) === 'finally' && (source.position ?? steps.indexOf(source)+1) < (consumer.position ?? steps.indexOf(consumer)+1)
  if (scope(consumer) === 'finally') return true
  const sourceRoot = steps.find(s => s.key === source.parent_key) || source
  const consumerRoot = steps.find(s => s.key === consumer.parent_key) || consumer
  return sourceRoot !== consumerRoot && (sourceRoot.position ?? steps.indexOf(sourceRoot)+1) < (consumerRoot.position ?? steps.indexOf(consumerRoot)+1)
}
export function stepDraft(step: TaskModel<'Step'>, definition?: Model<'InterfaceDetail'>): StepDraft {
  if (step.step_type === 'wait' || step.step_type === 'parallel' || step.step_type === 'sql' || step.step_type === 'compute') return controlDraft(step.step_type, step)
  if (!definition) throw new Error('REST 节点缺少接口定义。')
  const fields = fieldsFor(definition)
  for (const f of fields) f.enabled = false // defaults apply only when selecting a new interface
  for (const saved of [...step.bindings, ...(step.headers || []).map(h => ({ ...h, location: 'header' as const }))]) {
    let f = fields.find(f => f.location === saved.location && (saved.location === 'header' ? f.name.toLowerCase() === saved.name.toLowerCase() : f.name === saved.name))
    if (!f) { f = field(saved.location, saved.name); fields.push(f) }
    f.enabled = true; f.kind = saved.binding.kind
    if (saved.binding.kind === 'global') f.parameter_name = saved.binding.parameter_name
    else { f.preserved = saved.binding.redacted; f.text = textValue(saved.binding.value, schemaInputType(f.schema)) }
  }
  return { ...step, assertion_code: step.assertion_code ?? '', key: key(), fields, definition }
}
export function parameterDraft(p: TaskModel<'GlobalParameter'>, steps: StepDraft[]): ParameterDraft {
  return { key: key(), name: p.name, value_type: p.value_type, sensitive: p.sensitive, text: p.redacted ? '' : textValue(p.value, p.value_type), retained: p, source_type: p.source_type, step_key: steps.find(s => s.id === (p.source_type === 'expression' ? p.expression_source?.step_id : p.rest_source?.step_id))?.key, extract_expression: p.rest_source?.extract_expression }
}
export interface Draft { name: string; description: string; base_url: string; timeout_seconds: number; parameters: ParameterDraft[]; steps: StepDraft[] }
export function buildTask(draft: Draft, checkAvailability = true): { body: TaskModel<'TaskWrite'>; issues: TaskModel<'ValidationIssue'>[] } {
  const issues: TaskModel<'ValidationIssue'>[] = []
  const issue = (location: string, reason: string) => issues.push({ location, reason })
  if (!draft.name.trim() || draft.name.trim().length > 120) issue('body.name', '名称必填，最多 120 字。')
  if (draft.description.length > 2000) issue('body.description', '描述最多 2000 字。')
  try { const url = new URL(draft.base_url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (/[?#\s]/.test(draft.base_url.trim()) || draft.base_url.trim().length > 2048)) throw new Error() } catch { issue('body.base_url', '请输入 HTTP/HTTPS 地址；允许路径前缀，禁止 query、fragment 和用户凭据。') }
  if (!Number.isInteger(draft.timeout_seconds) || draft.timeout_seconds < 1 || draft.timeout_seconds > 300) issue('body.timeout_seconds', '超时必须为 1～300 秒的整数。')
  const values = new Map<string, { type: string; value?: unknown; retained: boolean }>()
  const global_parameters: TaskModel<'GlobalParameterEdit'>[] = draft.parameters.map((p, index) => {
    const at = `body.global_parameters[${index}]`
    if (!p.name.trim() || p.name.length > 120) issue(`${at}.name`, '名称必填，最多 120 字。')
    if (values.has(p.name)) issue(`${at}.name`, '参数名称必须唯一。')
    if (p.source_type === 'expression') {
      const sourceIndex = draft.steps.findIndex(s => s.key === p.step_key)
      const source = draft.steps[sourceIndex]
      if (!source || nodeType(source) !== 'compute') issue(`${at}.expression_source`, '请选择本任务的 compute 来源节点。')
      values.set(p.name, { type: p.value_type, retained: true })
      return { name: p.name, value_type: p.value_type, sensitive: p.sensitive, source_type: 'expression', expression_source: { ...(source?.id ? { step_id: source.id } : { step_index: sourceIndex }) } }
    }
    if (p.source_type === 'function') {
      if (p.value_type !== 'string') issue(`${at}.value_type`, 'UUID 函数参数必须为 string。')
      values.set(p.name, { type: 'string', retained: true })
      return { name: p.name, value_type: 'string', sensitive: p.sensitive, source_type: 'function', value: 'generateUUID()' }
    }
    if (p.source_type === 'rest') {
      const sourceIndex = draft.steps.findIndex(s => s.key === p.step_key)
      const source = draft.steps[sourceIndex]
      if (!source || nodeType(source) !== 'rest') issue(`${at}.rest_source.step_id`, '请选择本任务主流程或 finally 清理流程中的 REST 来源步骤。')
      if (!p.extract_expression || !/^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d+\]))*$/.test(p.extract_expression)) issue(`${at}.rest_source.extract_expression`, '请输入点分字段或数组下标表达式，例如 data.items[0].id。')
      values.set(p.name, { type: p.value_type, retained: true })
      return { name: p.name, value_type: p.value_type, sensitive: p.sensitive, source_type: 'rest', rest_source: { ...(source?.id ? { step_id: source.id } : { step_index: sourceIndex }), extract_expression: p.extract_expression || '' } }
    }
    const retained = !!(p.retained?.source_type === 'fixed' && p.retained?.redacted && p.retained.sensitive && p.sensitive && p.retained.name === p.name && p.retained.value_type === p.value_type && !p.text)
    let value: unknown
    if (!retained) try { value = parseValue(p.text, p.value_type) } catch (e) { issue(`${at}.value`, (e as Error).message) }
    values.set(p.name, { type: p.value_type, value, retained })
    return { name: p.name, value_type: p.value_type, source_type: 'fixed', sensitive: p.sensitive, ...(retained ? {} : { value: value as TaskModel<'Value'> }) }
  })
  const checkReference = (name: string, consumer: StepDraft, at: string, scalar = false) => {
    const p = draft.parameters.find(p => p.name === name)
    if (!p) { issue(at, '引用的全局参数不存在。'); return }
    if (scalar && ['object', 'array'].includes(p.value_type)) issue(at, 'SQL 绑定只接受标量或 null，不支持对象或数组参数。')
    if (checkAvailability && ['rest', 'expression'].includes(p.source_type || '') && !canReadSource(draft.steps, consumer, draft.steps.find(s => s.key === p.step_key))) issue(at, '只能引用前序节点或已完成并行屏障的参数，不能引用自身或同组兄弟节点。')
  }
  if (draft.steps.length > 1000) issue('body.steps', '节点总数最多 1000。')
  const steps: TaskModel<'StepInput'>[] = draft.steps.map((s, index) => {
    const at = `body.steps[${index}]`
    const parent = draft.steps.find(p => p.key === s.parent_key)
    const position = s.position ?? index+1
    if (!Number.isInteger(position) || position < 1 || position > 2147483647) issue(`${at}.position`, '排序值必须为正 int32。')
    if (draft.steps.some((p,i) => i < index && p.parent_key === s.parent_key && scope(p) === scope(s) && (p.position ?? i+1) === position)) issue(`${at}.position`, '同一流程的兄弟节点排序值必须唯一。')
    if (s.parent_key !== undefined && (!parent || nodeType(parent) !== 'parallel' || parent.parent_key !== undefined || scope(parent) !== 'main' || scope(s) !== 'main' || nodeType(s) === 'parallel')) issue(`${at}.parent_step_index`, '父节点只能是主流程根并行节点，禁止嵌套并行或清理子节点。')
    const common = { ...(s.options ? { options: s.options } : {}), ...(s.id ? { id: s.id } : {}), execution_scope: scope(s), position, ...(parent ? { parent_step_index: draft.steps.indexOf(parent) } : {}) }
    if (s.options?.poll && nodeType(s) !== 'rest') issue(`${at}.options.poll`, '轮询仅适用于 REST 节点。')
    if (nodeType(s) === 'compute') {
      const expressions = s.options?.expressions || []
      if (!expressions.length || expressions.length > 100) issue(`${at}.options.expressions`, '请配置 1～100 个输出表达式。')
      try { new Intl.DateTimeFormat('en', { timeZone: s.options?.timezone || 'Asia/Shanghai' }) } catch { issue(`${at}.options.timezone`, '请输入有效的 IANA 时区。') }
      expressions.forEach((e, i) => {
        const location = `${at}.options.expressions[${i}]`
        if (!draft.parameters.some(p => p.name === e.name && p.source_type === 'expression' && p.step_key === s.key)) issue(location + '.name', '输出名称必须对应绑定到本节点的表达式参数。')
        if (expressions.slice(0,i).some(p => p.name === e.name)) issue(location + '.name', '输出参数名称不能重复。')
        if (!e.expression.trim() || e.expression.length > 2000) issue(location + '.expression', '表达式必填，最多 2000 字。')
        for (const name of expressionReferences(e.expression)) checkReference(name, s, location + '.expression')
      })
      for (const p of draft.parameters.filter(p => p.source_type === 'expression' && p.step_key === s.key)) if (!expressions.some(e => e.name === p.name)) issue(`${at}.options.expressions`, `缺少参数 ${p.name} 的输出表达式。`)
      return { ...common, step_type: 'compute', options: s.options! }
    }
    if (nodeType(s) === 'sql') {
      const sql = s.options?.sql
      if (!sql || !['postgresql', 'sqlite'].includes(sql.driver)) issue(`${at}.options.sql.driver`, '请选择 PostgreSQL 或 SQLite。')
      for (const name of ['datasource', 'statement'] as const) {
        if (typeof sql?.[name] !== 'string' || !sql[name].trim()) issue(`${at}.options.sql.${name}`, { datasource: '请输入数据源。', statement: '请输入 SQL 语句。' }[name])
      }
      if (sql?.timeout_seconds !== undefined && (!Number.isInteger(sql.timeout_seconds) || sql.timeout_seconds < 1 || sql.timeout_seconds > 300)) issue(`${at}.options.sql.timeout_seconds`, 'SQL 超时必须为 1～300 秒的整数，或留空使用默认值 30 秒。')
      for (const name of ['username', 'password'] as const) {
        if (sql?.[name] !== undefined && typeof sql[name] !== 'string') issue(`${at}.options.sql.${name}`, '请输入字符串。')
        if (sql?.driver === 'sqlite' && sql[name]) issue(`${at}.options.sql.${name}`, 'SQLite 不支持用户名或密码。')
      }
      if (sql?.parameters && sql.parameters.length > 100) issue(`${at}.options.sql.parameters`, 'SQL 绑定参数最多 100 个。')
      sql?.parameters?.forEach((name, i) => checkReference(name, s, `${at}.options.sql.parameters[${i}]`, true))
      return { ...common, step_type: 'sql', options: s.options! }
    }
    if (nodeType(s) === 'wait') {
      if (!Number.isInteger(s.wait_milliseconds) || s.wait_milliseconds! < 1 || s.wait_milliseconds! > 300000) issue(`${at}.wait_milliseconds`, '等待时间必须为 1～300000 毫秒的整数。')
      return { ...common, step_type: 'wait', wait_milliseconds: s.wait_milliseconds! }
    }
    if (nodeType(s) === 'parallel') {
      if (scope(s) !== 'main' || s.parent_key !== undefined) issue(at, '并行节点只能位于主流程根层。')
      if (!Number.isInteger(s.max_concurrency) || s.max_concurrency! < 1 || s.max_concurrency! > 8) issue(`${at}.max_concurrency`, '最大并发必须为 1～8 的整数。')
      if (draft.steps.filter(p => p.parent_key === s.key).length < 2) issue(at, '并行节点至少需要两个 REST / compute / SQL / 等待子节点。')
      return { ...common, execution_scope: 'main', step_type: 'parallel', max_concurrency: s.max_concurrency! }
    }
    if (s.options?.poll) {
      for (const [name, max] of [['max_attempts', 1000], ['interval_milliseconds', 3600000], ['timeout_seconds', 86400]] as const) {
        const value = s.options.poll[name]
        if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > max)) issue(`${at}.options.poll.${name}`, `必须为 1～${max} 的整数。`)
      }
    }
    const configured = s.fields.filter(f => f.enabled)
    const auth = s.options?.auth
    const authorization = configured.filter(f => f.location === 'header' && f.name.toLowerCase() === 'authorization')
    if (auth && auth.mode !== 'header' && authorization.length) issue(`${at}.options.auth`, '认证配置与显式 Authorization 请求头互斥。')
    if (auth?.mode === 'header' && authorization.length !== 1) issue(`${at}.options.auth`, 'Header 认证需要一个显式 Authorization 请求头。')
    if (auth?.mode === 'bearer') {
      const parameter = draft.parameters.find(p => p.name === auth.parameter)
      if (!parameter) issue(`${at}.options.auth.parameter`, '认证引用的全局参数不存在。')
      else {
        if (parameter.value_type !== 'string') issue(`${at}.options.auth.parameter`, 'Bearer 认证参数必须为字符串。')
        if (checkAvailability && ['rest', 'expression'].includes(parameter.source_type || '') && !canReadSource(draft.steps, s, draft.steps.find(source => source.key === parameter.step_key))) issue(`${at}.options.auth.parameter`, '认证参数必须来自前序步骤或已完成的并行屏障。')
      }
    }
    if (s.raw_body) {
      if (configured.some(f => f.location === 'body')) issue(`${at}.raw_body`, '原始请求体与 body 绑定互斥。')
      if (s.definition.request_body?.content_type !== 'application/json') issue(`${at}.raw_body`, '原始请求体要求接口声明 application/json。')
    }
    const resolved = new Map<number, unknown>()
    for (let i = 0; i < configured.length; i++) {
      const f = configured[i]!; const location = `${at}.${f.location === 'header' ? 'headers' : 'bindings'}[${configured.slice(0,i).filter(p => (p.location === 'header') === (f.location === 'header')).length}]`
      if (!f.name && f.location !== 'body') issue(location, '字段名称必填。')
      if (f.location === 'body' && f.name && !/^(\/(?:[^~]|~[01])*)+$/.test(f.name)) issue(location, 'JSON 字段必须使用 JSON Pointer，例如 /data/id；根字段留空。')
      if (configured.slice(0, i).some(p => p.location === f.location && (f.location === 'header' ? p.name.toLowerCase() === f.name.toLowerCase() : p.name === f.name))) issue(location, '字段绑定重复。')
      if (f.location === 'body' && configured.some(p => p !== f && p.location === 'body' && f.name.startsWith(p.name + '/'))) issue(location, '不能同时绑定 JSON 父字段与子字段。')
      if (f.location === 'header' && /^(host|content-length|transfer-encoding|connection|method|url|base_url|timeout_seconds|:.*)$/i.test(f.name)) issue(location, '该请求头由执行配置管理，不允许覆盖。')
      if (f.location === 'header' && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(f.name)) issue(location, '请求头名称无效。')
      let value: unknown; let retained = false
      if (f.kind === 'global') {
        const p = values.get(f.parameter_name)
        if (!p) issue(location, '引用的全局参数不存在。')
        else {
          const parameter = draft.parameters.find(p => p.name === f.parameter_name)
          if (checkAvailability && parameter && ['rest', 'expression'].includes(parameter.source_type || '') && !canReadSource(draft.steps, s, draft.steps.find(s => s.key === parameter.step_key))) issue(location, '只能引用前序步骤或已完成并行屏障的全局参数，不能依赖同组兄弟节点。')
          value = p.value; retained = p.retained; if (f.schema.type && !(Array.isArray(f.schema.type) ? f.schema.type : [f.schema.type]).some(t => t === p.type || (t === 'number' && p.type === 'integer'))) issue(location, `全局参数类型应为 ${f.schema.type}。`) }
      } else {
        retained = f.preserved && !!s.id
        if (!retained) try { value = parseValue(f.text, schemaInputType(f.schema)) } catch (e) { issue(location, (e as Error).message) }
      }
      if (!retained && value !== undefined) { const reason = checkSchema(value, f.schema); if (reason) issue(location, reason); resolved.set(f.key, value) }
      if (f.location === 'query' && (f.schema.type === 'object' || (value !== null && typeof value === 'object' && !Array.isArray(value)) || (Array.isArray(value) && value.some(v => typeof v === 'object')))) issue(location, '暂不支持对象 query；数组仅支持标量，执行时使用重复键。')
      if ((f.location === 'header' || f.location === 'path') && value !== null && typeof value === 'object') issue(location, 'Path 和 Header 仅支持标量值。')
      if (f.location === 'header' && typeof value === 'string' && /[\r\n]/.test(value)) issue(location, '请求头值不得含换行符。')
    }
    for (const p of s.definition.parameters.filter(p => p.required || p.location === 'path')) if (!configured.some(f => f.location === p.location && (p.location === 'header' ? f.name.toLowerCase() === p.name.toLowerCase() : f.name === p.name))) issue(at, `${p.location}.${p.name} 为必填字段。`)
    // Validate the assembled JSON structure, including nested required fields and optional parent objects.
    const bodyFields = configured.filter(f => f.location === 'body')
    const root = bodyFields.find(f => f.name === '')
    if (s.definition.request_body && !root && !s.raw_body) {
      let body: Record<string, unknown> | undefined = bodyFields.length ? {} : undefined
      for (const f of bodyFields) {
        const parts = f.name.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))
        let current = body!
        for (let i = 0; i < parts.length; i++) {
          const name = parts[i]!
          if (['__proto__', 'constructor', 'prototype'].includes(name)) { issue(at, '该 JSON 字段名称暂不支持。'); break }
          if (i === parts.length - 1) current[name] = resolved.has(f.key) ? resolved.get(f.key) : placeholder(f.schema)
          else { if (!current[name] || typeof current[name] !== 'object') current[name] = {}; current = current[name] as Record<string, unknown> }
        }
      }
      if (body === undefined && s.definition.request_body.required) issue(at, 'JSON 请求体为必填。')
      if (body !== undefined) { const reason = checkSchema(body, s.definition.request_body.schema); if (reason) issue(`${at}.body`, reason) }
    }
    const binding = (f: FieldDraft): TaskModel<'BindingEdit'> => f.kind === 'global' ? { kind: 'global', parameter_name: f.parameter_name } : { kind: 'literal', ...(f.preserved && s.id ? {} : { value: resolved.get(f.key) as TaskModel<'Value'> }) }
    const contentType = configured.find(f => f.location === 'header' && f.name.toLowerCase() === 'content-type')
    if ((s.raw_body || bodyFields.length) && contentType && resolved.has(contentType.key) && String(resolved.get(contentType.key)).split(';')[0]!.trim().toLowerCase() !== 'application/json') issue(`${at}.headers`, 'JSON 请求体的 Content-Type 必须为 application/json。')
    return { ...common, step_type: 'rest', interface_id: s.interface_id, file_id: s.file_id, version: s.version, assertion_code: s.assertion_code?.trim() ? s.assertion_code : null,
      bindings: configured.filter(f => f.location !== 'header').map(f => ({ location: f.location as 'path' | 'query' | 'body', name: f.name, binding: binding(f) })),
      headers: configured.filter(f => f.location === 'header').map(f => ({ name: f.name, binding: binding(f) })), ...(s.raw_body ? { raw_body: { text: s.raw_body.text } } : {}) }

  })
  return { body: { name: draft.name.trim(), description: draft.description, base_url: draft.base_url.trim(), timeout_seconds: draft.timeout_seconds, global_parameters, steps }, issues }
}
function placeholder(schema: Schema): unknown {
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum)) { const value = schema.enum.find(v => v !== null); if (value !== undefined) return value }
  if (schema.type === 'object') return Object.fromEntries(((schema.required as string[]) || []).map(name => [name, placeholder(((schema.properties as Record<string, Schema>) || {})[name] || {})]))
  return { string: '', integer: 0, number: 0, boolean: false, array: [] }[String(schema.type)] ?? ''
}

export function expressionReferences(expression: string): string[] {
  const references: string[] = []
  const tokens = /\bparam\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
  for (const token of expression.matchAll(tokens)) {
    if (!token[1]) continue
    try {
      const raw = token[1]
      references.push(raw.startsWith('"') ? JSON.parse(raw) : raw.slice(1,-1).replace(/\\(['\\])/g, '$1'))
    } catch { /* The API validates expression syntax. */ }
  }
  return references
}
