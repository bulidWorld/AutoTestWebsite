import type { Model } from './api'
import { buildInterfaceTest, type TestDraft } from './interface-test.ts'
import { canReadSource, nodeType, schemaInputType, parseValue, textValue, type Draft, type StepDraft } from './task-editor.ts'

export function buildStepTest(draft: Draft, step: StepDraft, previews: Map<number, unknown>) {
  if (nodeType(step) !== 'rest') throw new Error('仅 REST 节点支持单次接口运行。')
  if (step.raw_body) throw new Error('单次接口测试不接受原始请求体，请保存并运行任务验证。')
  const configured = step.fields.filter(f => f.enabled)
  const resolve = (f: typeof configured[number]) => {
    if (f.kind === 'literal') {
      if (f.preserved) throw new Error(`请重新输入隐藏字段 ${f.name} 后单次运行。`)
      return parseValue(f.text, schemaInputType(f.schema))
    }
    const p = draft.parameters.find(p => p.name === f.parameter_name)
    if (!p) throw new Error(`全局参数 ${f.parameter_name} 不存在。`)
    if (p.source_type === 'function' || p.source_type === 'expression') throw new Error(`参数 ${p.name} 需要保存并运行任务计算。单次接口运行不执行计算节点或初始化函数。`)
    if (p.source_type === 'rest') {
      const sourceIndex = draft.steps.findIndex(s => s.key === p.step_key)
      if (!canReadSource(draft.steps, step, draft.steps[sourceIndex])) throw new Error(`参数 ${p.name} 必须绑定前序步骤。`)
      if (!previews.has(p.key)) throw new Error(`请先对参数 ${p.name} 执行单次取值。`)
      return previews.get(p.key)
    }
    if (p.retained?.redacted && !p.text) throw new Error(`请重新输入隐藏参数 ${p.name} 后单次运行。`)
    return parseValue(p.text, p.value_type)
  }
  const auth = step.options?.auth
  const authorization = configured.filter(f => f.location === 'header' && f.name.toLowerCase() === 'authorization')
  if (auth && auth.mode !== 'header' && authorization.length) throw new Error('认证配置与显式 Authorization 请求头互斥。')
  if (auth?.mode === 'header') throw new Error('显式 Header 认证请保存并运行任务验证。')
  if (auth?.mode === 'bearer') {
    const token = resolve({ kind: 'global', parameter_name: auth.parameter || '' } as typeof configured[number])
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('Bearer 认证参数必须为非空字符串且不含换行。')
    configured.push({ key: -1, location: 'header', name: 'Authorization', schema: { type: 'string' }, required: false, enabled: true, kind: 'literal', text: `Bearer ${token}`, parameter_name: '', preserved: false })
  }
  const bodyFields = configured.filter(f => f.location === 'body')
  const root = bodyFields.find(f => !f.name)
  let body: unknown = root ? resolve(root) : {}
  if (!root) for (const f of bodyFields) {
    const parts = f.name.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    let node = body as Record<string, unknown>
    for (const [index, name] of parts.entries()) {
      if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('该 JSON 字段名称暂不支持。')
      if (index === parts.length - 1) node[name] = resolve(f)
      else { node[name] ||= {}; node = node[name] as Record<string, unknown> }
    }
  }
  const test: TestDraft = {
    base_url: draft.base_url, timeout_seconds: draft.timeout_seconds,
    parameters: configured.filter(f => f.location !== 'body').map(f => ({
      key: f.key, location: f.location as 'path' | 'query' | 'header', name: f.name, schema: f.schema,
      required: f.required, enabled: true, text: textValue(resolve(f), schemaInputType(f.schema)),
      sensitive: f.kind === 'global' && !!draft.parameters.find(p => p.name === f.parameter_name)?.sensitive,
      custom: false, description: '',
    })),
    bodyEnabled: bodyFields.length > 0, bodyText: JSON.stringify(body),
    bodySensitive: bodyFields.some(f => f.schema.format === 'password' || f.schema['x-sensitive'] === true || (f.kind === 'global' && draft.parameters.find(p => p.name === f.parameter_name)?.sensitive === true)),
  }
  const result = buildInterfaceTest(step.definition, test)
  if (bodyFields.some(f => f.name && bodyFields.some(p => p !== f && f.name.startsWith(p.name + '/')))) result.issues.push({ location: 'body.request_body', reason: '不能同时绑定 JSON 父字段与子字段。' })
  return result as { body: Model<'InterfaceTestInput'>; issues: Model<'ValidationIssue'>[] }
}
