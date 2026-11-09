import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, request } from '../src/api.ts'

test('204 deletion is successful without a JSON response', async () => {
 const original=globalThis.fetch
 try { globalThis.fetch=async()=>new Response(null,{status:204});assert.equal(await request('/projects/1/task-collections/2?confirm=true','DELETE'),undefined) } finally {globalThis.fetch=original}
})
test('JSON writes and validation errors preserve contract fields and request IDs', async()=>{
 const original=globalThis.fetch
 try {
  globalThis.fetch=async(url,init)=>{assert.equal(url,'/api/v1/projects/1/task-collections');assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),{name:'组',members:[]});return Response.json({detail:'活动运行禁止修改',code:'CONFLICT',issues:[{location:'body.members',reason:'占用'}]},{status:409,headers:{'X-Request-ID':'contract-check'}})}
  await assert.rejects(request('/projects/1/task-collections','POST',{name:'组',members:[]}),e=>e instanceof ApiError&&e.code==='CONFLICT'&&e.requestId==='contract-check'&&e.issues[0]?.location==='body.members')
 } finally {globalThis.fetch=original}
})
test('network and malformed successful JSON responses report actionable errors',async()=>{
 const original=globalThis.fetch
 try {globalThis.fetch=async()=>{throw Error('offline')};await assert.rejects(request('/projects'),/无法连接后端/);globalThis.fetch=async()=>new Response('invalid');await assert.rejects(request('/projects'),/无效的 JSON/)} finally {globalThis.fetch=original}
})
