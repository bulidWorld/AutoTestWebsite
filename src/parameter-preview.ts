import type { components } from './parameter-api-schema'
import { buildTask, type Draft } from './task-editor.ts'
export type ParameterModel<K extends keyof components['schemas']> = components['schemas'][K]
export function buildParameterPreview(draft: Draft, parameterName: string): ParameterModel<'PreviewParameterRequest'> {
  if (draft.steps.some(s => !s.id)) throw new Error('请先保存全部节点后再流程预览。')
  const { body, issues } = buildTask(draft)
  if (issues.length) throw new Error(issues.map(i => `${i.location}：${i.reason}`).join('\n'))
  if (!body.global_parameters.some(p => p.name === parameterName && p.source_type === 'rest')) throw new Error('预览目标必须是 REST 参数。')
  if (body.global_parameters.some(p => (p.source_type === 'fixed' || !p.source_type) && !Object.hasOwn(p,'value')) || body.steps.some(s => s.step_type === 'rest' && [...s.bindings,...(s.headers || [])].some(f => f.binding.kind === 'literal' && !Object.hasOwn(f.binding,'value')))) throw new Error('流程预览需要真实固定值和字面值，请重新输入隐藏值后保存。')
  return { base_url: body.base_url, timeout_seconds: body.timeout_seconds, global_parameters: body.global_parameters as ParameterModel<'GlobalParameterInput'>[], steps: body.steps, parameter_name: parameterName }
}
