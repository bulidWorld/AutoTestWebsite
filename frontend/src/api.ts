import type { components } from './api-schema'
export type Model<K extends keyof components['schemas']> = components['schemas'][K]
export class ApiError extends Error {
  constructor(public detail: string, public issues: Model<'ValidationIssue'>[] = [], public code = '', public requestId = '') { super(detail) }
}
export async function request<T>(path: string, method = 'GET', body?: object | FormData): Promise<T> {
  let response: Response
  try { response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/v1${path}`, { method, headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }) }
  catch { throw new ApiError('无法连接后端服务，请检查服务地址后重试。') }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(data?.detail || `请求失败（${response.status}）`, data?.issues || [], data?.code || '', response.headers.get('X-Request-ID') || '')
  if (data === null) throw new ApiError('服务返回了无效的 JSON 响应。')
  return data as T
}
export function query(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value))
  return `?${params}`
}
