import type { components } from './task-api-schema'
import type { Model } from './api'
export type TaskModel<K extends keyof components['schemas']> = components['schemas'][K]
export type ValueType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
export type Schema = Record<string, unknown>
export interface ParameterDraft {
  key: number; name: string; value_type: ValueType; sensitive: boolean; text: string; source_type?: 'fixed' | 'rest'; step_key?: number; extract_expression?: string; retained?: TaskModel<'GlobalParameter'>
}
export interface FieldDraft {
  key: number; location: 'path' | 'query' | 'header' | 'body'; name: string; schema: Schema; required: boolean
  enabled: boolean; kind: 'literal' | 'global'; text: string; parameter_name: string; preserved: boolean
}
export interface StepDraft {
  key: number; id?: number; interface_id: number; file_id: number; version: number; file_name: string
  method: string; path: string; has_new_version: boolean; fields: FieldDraft[]; definition: Model<'InterfaceDetail'>
}
let nextKey = 0
export const key = () => ++nextKey
export const secretHeader = (name: string) => /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(name)
export function parseValue(text: string, type: string): unknown {
  if (type === 'string' || !type) return text
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('请输入有效 JSON 值；布尔值使用 true 或 false。') }
  if (!matches(value, type)) throw new Error(`值必须为 ${type} 类型，不支持 null 或隐式类型转换。`)
  return value
}
export function matches(value: unknown, type: string): boolean {
  if (value === null || value === undefined) return false
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'object') return typeof value === 'object' && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  return !type || typeof value === type
}
export function checkSchema(value: unknown, schema: Schema, at = ''): string | undefined {
  if (!matches(value, String(schema.type || ''))) return `${at || '值'}类型应为 ${schema.type || '非 null JSON'}`
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
export function textValue(value: unknown, type: string) { return value === undefined ? '' : type === 'string' ? String(value) : JSON.stringify(value, null, 2) }
export function field(location: FieldDraft['location'], name: string, schema: Schema = {}, required = false): FieldDraft {
  return { key: key(), location, name, schema, required, enabled: schema.default !== undefined, kind: 'literal', text: textValue(schema.default, String(schema.type || 'string')), parameter_name: '', preserved: false }
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
export function stepDraft(step: TaskModel<'Step'>, definition: Model<'InterfaceDetail'>): StepDraft {
  const fields = fieldsFor(definition)
  for (const f of fields) f.enabled = false // defaults apply only when selecting a new interface
  for (const saved of step.bindings) {
    let f = fields.find(f => f.location === saved.location && (f.location === 'header' ? f.name.toLowerCase() === saved.name.toLowerCase() : f.name === saved.name))
    if (!f) { f = field(saved.location, saved.name); fields.push(f) }
    f.enabled = true; f.kind = saved.binding.kind
    if (saved.binding.kind === 'global') f.parameter_name = saved.binding.parameter_name
    else { f.preserved = saved.binding.redacted; f.text = textValue(saved.binding.value, String(f.schema.type || 'string')) }
  }
  return { ...step, key: key(), fields, definition }
}
export interface Draft { name: string; description: string; base_url: string; timeout_seconds: number; parameters: ParameterDraft[]; steps: StepDraft[] }
export function buildTask(draft: Draft): { body: TaskModel<'TaskWrite'>; issues: TaskModel<'ValidationIssue'>[] } {
  const issues: TaskModel<'ValidationIssue'>[] = []
  const issue = (location: string, reason: string) => issues.push({ location, reason })
  if (!draft.name.trim() || draft.name.trim().length > 120) issue('body.name', '名称必填，最多 120 字。')
  if (draft.description.length > 2000) issue('body.description', '描述最多 2000 字。')
  try { const url = new URL(draft.base_url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[?#\s]/.test(draft.base_url.trim())) throw new Error() } catch { issue('body.base_url', '请输入 HTTP/HTTPS 地址；允许路径前缀，禁止 query、fragment 和用户凭据。') }
  if (!Number.isInteger(draft.timeout_seconds) || draft.timeout_seconds < 1 || draft.timeout_seconds > 300) issue('body.timeout_seconds', '超时必须为 1～300 秒的整数。')
  const values = new Map<string, { type: string; value?: unknown; retained: boolean }>()
  const global_parameters: TaskModel<'GlobalParameterEdit'>[] = draft.parameters.map((p, index) => {
    const at = `body.global_parameters[${index}]`
    if (!p.name.trim() || p.name.length > 120) issue(`${at}.name`, '名称必填，最多 120 字。')
    if (values.has(p.name)) issue(`${at}.name`, '参数名称必须唯一。')
    if (p.source_type === 'rest') {
      const sourceIndex = draft.steps.findIndex(s => s.key === p.step_key)
      const source = draft.steps[sourceIndex]
      if (!source) issue(`${at}.rest_source.step_id`, '请选择本任务中存在的来源步骤。')
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
  const steps: TaskModel<'StepInput'>[] = draft.steps.map((s, index) => {
    const at = `body.steps[${index}]`; const configured = s.fields.filter(f => f.enabled)
    const resolved = new Map<number, unknown>()
    for (let i = 0; i < configured.length; i++) {
      const f = configured[i]!; const location = `${at}.bindings[${i}]`
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
          if (parameter?.source_type === 'rest' && draft.steps.findIndex(s => s.key === parameter.step_key) >= index) issue(location, '只能引用前序步骤已赋值的全局参数。')
          value = p.value; retained = p.retained; if (f.schema.type && p.type !== f.schema.type && !(f.schema.type === 'number' && p.type === 'integer')) issue(location, `全局参数类型应为 ${f.schema.type}。`) }
      } else {
        retained = f.preserved && !!s.id
        if (!retained) try { value = parseValue(f.text, String(f.schema.type || 'string')) } catch (e) { issue(location, (e as Error).message) }
      }
      if (!retained && value !== undefined) { const reason = checkSchema(value, f.schema); if (reason) issue(location, reason); resolved.set(f.key, value) }
      if (f.location === 'query' && (f.schema.type === 'object' || (value !== null && typeof value === 'object' && !Array.isArray(value)) || (Array.isArray(value) && value.some(v => typeof v === 'object')))) issue(location, '暂不支持对象 query；数组仅支持标量，执行时使用重复键。')
      if (f.location === 'header' && typeof value === 'string' && /[\r\n]/.test(value)) issue(location, '请求头值不得含换行符。')
    }
    for (const p of s.definition.parameters.filter(p => p.required || p.location === 'path')) if (!configured.some(f => f.location === p.location && (p.location === 'header' ? f.name.toLowerCase() === p.name.toLowerCase() : f.name === p.name))) issue(at, `${p.location}.${p.name} 为必填字段。`)
    // Validate the assembled JSON structure, including nested required fields and optional parent objects.
    const bodyFields = configured.filter(f => f.location === 'body')
    const root = bodyFields.find(f => f.name === '')
    if (s.definition.request_body && !root) {
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
    return { ...(s.id ? { id: s.id } : {}), interface_id: s.interface_id, file_id: s.file_id, version: s.version, bindings: configured.map(f => ({ location: f.location, name: f.name, binding: f.kind === 'global' ? { kind: 'global', parameter_name: f.parameter_name } : { kind: 'literal', ...(f.preserved && s.id ? {} : { value: resolved.get(f.key) as TaskModel<'Value'> }) } })) }
  })
  return { body: { name: draft.name.trim(), description: draft.description, base_url: draft.base_url.trim(), timeout_seconds: draft.timeout_seconds, global_parameters, steps }, issues }
}
function placeholder(schema: Schema): unknown {
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum)) { const value = schema.enum.find(v => v !== null); if (value !== undefined) return value }
  if (schema.type === 'object') return Object.fromEntries(((schema.required as string[]) || []).map(name => [name, placeholder(((schema.properties as Record<string, Schema>) || {})[name] || {})]))
  return { string: '', integer: 0, number: 0, boolean: false, array: [] }[String(schema.type)] ?? ''
}
