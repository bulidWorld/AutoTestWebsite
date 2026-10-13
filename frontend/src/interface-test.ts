import type { Model } from './api'
import { checkSchema, key, parseValue, secretHeader, textValue, type Schema } from './task-editor.ts'
export interface TestParameterDraft {
  key: number; location: 'path' | 'query' | 'header'; name: string; schema: Schema
  required: boolean; enabled: boolean; text: string; sensitive: boolean; custom: boolean; description: string
}
export interface TestDraft {
  base_url: string; timeout_seconds: number; parameters: TestParameterDraft[]
  bodyEnabled: boolean; bodyText: string; bodySensitive: boolean
}
export const sensitiveName = (name: string) => secretHeader(name) || /password|secret|token|api[_-]?key/i.test(name)
export const privateParameter = (p: TestParameterDraft) => p.sensitive || sensitiveName(p.name) || p.schema.format === 'password' || p.schema['x-sensitive'] === true
export function testParameters(definition: Model<'InterfaceDetail'>): TestParameterDraft[] {
  return definition.parameters.map(p => {
    const sensitive = sensitiveName(p.name) || p.schema.format === 'password' || p.schema['x-sensitive'] === true
    return { ...p, key: key(), custom: false, enabled: p.required || p.schema.default !== undefined,
      sensitive, text: sensitive ? '' : textValue(p.schema.default, String(p.schema.type || 'string')) }
  })
}
export function customTestHeader(): TestParameterDraft {
  return { key: key(), location: 'header', name: '', schema: { type: 'string' }, required: false,
    enabled: true, text: '', sensitive: false, custom: true, description: '' }
}
function cleanDefault(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanDefault)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, sensitiveName(name) ? '' : cleanDefault(child)]))
  return value
}
export function bodyTemplate(schema: Schema): unknown {
  if (schema.default !== undefined) return schema.format === 'password' || schema['x-sensitive'] === true ? '' : cleanDefault(schema.default)
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum.find(v => v !== null)
  if (schema.type === 'object' || schema.properties) {
    const properties = (schema.properties || {}) as Record<string, Schema>
    return Object.fromEntries(Object.entries(properties).filter(([name, child]) => ((schema.required || []) as string[]).includes(name) || child.default !== undefined).map(([name, child]) => [name, sensitiveName(name) ? '' : bodyTemplate(child)]))
  }
  if (schema.type === 'array') return []
  if (schema.type === 'integer' || schema.type === 'number') return typeof schema.minimum === 'number' ? schema.minimum : 0
  if (schema.type === 'boolean') return false
  return ''
}
export function buildInterfaceTest(definition: Model<'InterfaceDetail'>, draft: TestDraft) {
  const issues: Model<'ValidationIssue'>[] = []
  const issue = (location: string, reason: string) => issues.push({ location, reason })
  try {
    const address = draft.base_url.trim(), url = new URL(address)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[?#\s]/.test(address)) throw new Error()
  } catch { issue('body.base_url', '请输入 HTTP/HTTPS 运行地址，允许路径前缀，不含 query、fragment 或用户凭据。') }
  if (!Number.isInteger(draft.timeout_seconds) || draft.timeout_seconds < 1 || draft.timeout_seconds > 300) issue('body.timeout_seconds', '请求超时应为 1～300 秒的整数。')
  const configured = draft.parameters.filter(p => p.enabled)
  const parameters: Model<'InterfaceTestParameter'>[] = configured.map((p, index) => {
    const at = `body.parameters[${index}] (${p.location}.${p.name || '未命名'})`
    const declared = definition.parameters.find(d => d.location === p.location && (p.location === 'header' ? d.name.toLowerCase() === p.name.toLowerCase() : d.name === p.name))
    if (!declared && p.location !== 'header') issue(at, '参数不在当前接口定义中。')
    if (!p.name) issue(at, '参数名称必填。')
    if (configured.slice(0, index).some(other => other.location === p.location && (p.location === 'header' ? other.name.toLowerCase() === p.name.toLowerCase() : other.name === p.name))) issue(at, '不能重复配置同一参数。')
    if (p.location === 'header' && (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(p.name) || /^(host|content-length|transfer-encoding|connection|method|url|base_url|timeout_seconds)$/i.test(p.name))) issue(at, '请求头名称无效，或覆盖方法、地址等执行配置。')
    let value: unknown
    const schema = declared?.schema || { type: 'string' }
    try {
      value = parseValue(p.text, String(schema.type || 'string'))
      const reason = checkSchema(value, schema)
      if (reason) issue(at, reason)
      if (p.location === 'query' && (schema.type === 'object' || (typeof value === 'object' && !Array.isArray(value)) || (Array.isArray(value) && value.some(v => v === null || typeof v === 'object')))) issue(at, '暂不支持对象 query；数组仅支持标量元素，以重复键发送。')
      if ((p.location === 'path' || p.location === 'header') && typeof value === 'object') issue(at, `${p.location} 仅支持标量值。`)
      if (p.location === 'header' && typeof value === 'string' && /[\r\n]/.test(value)) issue(at, '请求头值不能包含换行符。')
    } catch (e) { issue(at, (e as Error).message) }
    return { location: p.location, name: p.name, value, sensitive: privateParameter(p) }
  })
  for (const p of definition.parameters.filter(p => p.required || p.location === 'path')) {
    if (!configured.some(c => c.location === p.location && (p.location === 'header' ? c.name.toLowerCase() === p.name.toLowerCase() : c.name === p.name))) issue(`body.parameters (${p.location}.${p.name})`, '缺少必填参数。')
  }
  let request_body: unknown
  if (definition.request_body && String(definition.request_body.content_type) !== 'application/json') issue('body.request_body', '单次测试当前仅支持 JSON 请求体。')
  if (definition.request_body?.required && !draft.bodyEnabled) issue('body.request_body', '此接口必须配置 JSON 请求体。')
  if (draft.bodyEnabled) {
    if (!definition.request_body) issue('body.request_body', '此接口未声明请求体。')
    else {
      try { request_body = JSON.parse(draft.bodyText) } catch { issue('body.request_body', '请求体必须为有效 JSON。') }
      if (request_body !== undefined) {
        const reason = checkSchema(request_body, definition.request_body.schema)
        if (reason) issue('body.request_body', reason)
      }
    }
  }
  if (draft.bodyEnabled) for (const p of parameters) if (p.location === 'header' && p.name.toLowerCase() === 'content-type' && typeof p.value === 'string' && p.value.split(';')[0]!.trim().toLowerCase() !== 'application/json') issue('body.parameters (header.Content-Type)', 'JSON 请求体的 Content-Type 必须为 application/json。')
  const body: Model<'InterfaceTestInput'> = { base_url: draft.base_url.trim(), timeout_seconds: draft.timeout_seconds, parameters,
    ...(draft.bodyEnabled && request_body !== undefined ? { request_body } : {}), body_sensitive: draft.bodySensitive }
  return { body, issues }
}
export function displayTestHeaders(headers: Model<'TestHeader'>[] | null) {
  return (headers || []).map(h => ({ name: h.name, value: h.redacted || sensitiveName(h.name) ? '••••••' : h.value }))
}
