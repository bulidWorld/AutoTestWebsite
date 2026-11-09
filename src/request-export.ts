import type { components } from './task-api-schema'

type RequestRecord = components['schemas']['Request']
function headerLines(headers: RequestRecord['response_headers']) {
  return (headers ?? []).map(h => `${h.name}: ${h.redacted || /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(h.name) ? '••••••' : h.value}`)
}
function quote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }

export function requestCurl(record: RequestRecord): string {
  const parts = ['curl', '-X', quote(record.method), '--url', quote(record.actual_url)]
  for (const header of headerLines(record.request_headers)) parts.push('-H', quote(header))
  if (record.request_body !== null) parts.push('--data-raw', quote(record.request_body))
  return parts.join(' ')
}

export function requestHttp(record: RequestRecord): string {
  return [
    `地址: ${record.actual_url}`, '', '=== HTTP 请求 ===',
    `${record.method} ${record.actual_url}`, ...headerLines(record.request_headers), '', record.request_body ?? '',
    '', '=== HTTP 响应 ===', record.response_status === null ? '无响应' : `HTTP ${record.response_status}`,
    ...headerLines(record.response_headers),
    ...(record.response_body_encoding === 'base64' ? ['响应体编码: base64'] : []),
    '', record.response_body ?? '',
  ].join('\n')
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return } catch { /* Try legacy clipboard on HTTP deployments. */ }
  }
  const active = document.activeElement as HTMLElement | null
  const selection = document.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
  const input = document.createElement('textarea')
  input.value = value
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  input.readOnly = true
  document.body.append(input)
  try {
    input.focus(); input.select()
    if (!document.execCommand('copy')) throw new Error('复制失败')
  } finally {
    input.remove(); active?.focus({ preventScroll: true })
    if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)) }
  }
}
