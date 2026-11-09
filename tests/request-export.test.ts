import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestCurl, requestHttp } from '../src/request-export.ts'
import type { components } from '../src/task-api-schema'
const record = {
  method: 'POST', actual_url: 'https://example.com/api?q=a%20b&n=1',
  request_headers: [{ name: 'Content-Type', value: 'application/json', redacted: false }, { name: 'Authorization', value: 'secret', redacted: false }],
  request_body: '{"name":"O\'Brien","line":"a\\nb"}',
  response_status: 201, response_headers: [{ name: 'X-Test', value: 'ok', redacted: false }],
  response_body: '{"ok":true}', response_body_encoding: 'utf-8', error_code: null,
} as components['schemas']['Request']
test('curl preserves actual query, headers, body and shell-quotes apostrophes', () => {
  const curl = requestCurl(record)
  assert.ok(curl.includes(`--url '${record.actual_url}'`))
  assert.ok(curl.includes(`-H 'Content-Type: application/json'`))
  assert.ok(curl.includes(`O'"'"'Brien`))
  assert.ok(!curl.includes('secret'))
  assert.ok(curl.includes('--data-raw'))
  assert.ok(requestCurl({ ...record, request_body: '' }).endsWith("--data-raw ''"))
  assert.ok(!requestCurl({ ...record, request_body: null }).includes('--data-raw'))
})
test('HTTP export includes request and response and labels missing or encoded responses', () => {
  const http = requestHttp(record)
  for (const value of [record.actual_url, record.request_body!, 'HTTP 201', 'X-Test: ok', record.response_body!]) assert.ok(http.includes(value))
  assert.ok(!http.includes('secret'))
  assert.ok(requestHttp({ ...record, response_body_encoding: 'base64' }).includes('响应体编码: base64'))
  assert.ok(requestHttp({ ...record, response_status: null }).includes('无响应'))
  const failed = requestHttp({ ...record, error_code: 'ASSERTION_EXECUTION_ERROR', error_message: '断言异常及内部运行信息' })
  assert.equal(failed, http)
})
