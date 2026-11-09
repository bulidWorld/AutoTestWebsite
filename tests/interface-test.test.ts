import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Model } from '../src/api.ts'
import { bodyTemplate, buildInterfaceTest, customTestHeader, displayTestHeaders, privateParameter, testParameters, type TestDraft } from '../src/interface-test.ts'
const definition = { id:9,file_id:3,version:2,method:'POST',path:'/items/{id}',operation_id:'create',summary:'',description:'',parameters:[
  {location:'path',name:'id',required:true,description:'',schema:{type:'string'}},
  {location:'query',name:'ids',required:false,description:'',schema:{type:'array',items:{type:'integer'}}},
  {location:'query',name:'optional',required:false,description:'',schema:{type:'boolean'}},
  {location:'header',name:'Authorization',required:false,description:'',schema:{type:'string'}}
],request_body:{description:'',required:true,content_type:'application/json',schema:{type:'object',required:['enabled','data'],properties:{enabled:{type:'boolean',default:true},data:{type:'object',required:['ids'],properties:{ids:{type:'array',items:{type:'integer'}}}}}}},responses:{},authentication:{schemes:{},requirements:[]},servers:[]} as Model<'InterfaceDetail'>
function draft(): TestDraft {
  const parameters=testParameters(definition);parameters[0]!.text='中文 /?';parameters[1]!.enabled=true;parameters[1]!.text='[1,2]'
  return {base_url:'http://localhost:31013/mock',timeout_seconds:30,parameters,bodyEnabled:true,bodyText:'{"enabled":false,"data":{"ids":[1,2]}}',bodySensitive:false}
}
test('single test payload preserves typed values and optional omission without task IDs or bindings',()=>{
 const {body,issues}=buildInterfaceTest(definition,draft());assert.deepEqual(issues,[])
 assert.deepEqual(body.parameters,[{location:'path',name:'id',value:'中文 /?',sensitive:false},{location:'query',name:'ids',value:[1,2],sensitive:false}])
 assert.deepEqual(body.request_body,{enabled:false,data:{ids:[1,2]}});assert(!Object.hasOwn(body,'steps'));assert(!Object.hasOwn(body,'method'));assert(!Object.hasOwn(body,'path'));assert(!Object.hasOwn(body,'task_id'))
})
test('missing required, invalid types, malformed JSON and nested required errors are located',()=>{
 const d=draft();d.parameters[0]!.enabled=false;d.parameters[1]!.text='["1"]';d.bodyText='{"enabled":true,"data":{}}';const issues=buildInterfaceTest(definition,d).issues
 assert(issues.some(i=>i.location.includes('path.id')));assert(issues.some(i=>i.location.includes('query.ids')));assert(issues.some(i=>i.reason.includes('/data/ids')))
 d.bodyText='{bad}';assert(buildInterfaceTest(definition,d).issues.some(i=>i.reason.includes('有效 JSON')));d.bodyEnabled=false;assert(buildInterfaceTest(definition,d).issues.some(i=>i.reason.includes('必须配置')))
})
test('objects in query and scalar-only path/header violations fail before sending',()=>{
 const def=structuredClone(definition);def.parameters[1]!.schema={type:'object'};const d=draft();d.parameters[1]!.text='{"x":1}';assert(buildInterfaceTest(def,d).issues.some(i=>i.reason.includes('对象 query')))
 def.parameters[0]!.schema={type:'array'};d.parameters[0]!.text='[1]';assert(buildInterfaceTest(def,d).issues.some(i=>i.reason.includes('path 仅支持标量')))
})
test('authentication and marked values are sensitive; default secrets are never inserted',()=>{
 const def=structuredClone(definition);def.parameters[3]!.schema.default='***';const params=testParameters(def);assert.equal(params[3]!.text,'');assert.equal(privateParameter(params[3]!),true)
 const d=draft();d.parameters[3]!.enabled=true;d.parameters[3]!.text='Bearer example';d.parameters[0]!.sensitive=true;d.bodySensitive=true;const {body,issues}=buildInterfaceTest(definition,d);assert.deepEqual(issues,[]);assert.equal(body.parameters[0]!.sensitive,true);assert.equal(body.parameters.at(-1)!.sensitive,true);assert.equal(body.body_sensitive,true)
 assert.deepEqual(displayTestHeaders([{name:'Set-Cookie',value:'never-show',redacted:false},{name:'X-Secret',value:'never-show',redacted:true},{name:'Content-Type',value:'application/json',redacted:false}]),[{name:'Set-Cookie',value:'••••••'},{name:'X-Secret',value:'••••••'},{name:'Content-Type',value:'application/json'}])
})
test('duplicate headers, forbidden configuration headers and header injection are rejected',()=>{
 for(const name of ['Host','Method','URL','base_url','timeout_seconds','Content-Length','bad name']) {const d=draft(),p=customTestHeader();p.name=name;p.text='x';d.parameters.push(p);assert(buildInterfaceTest(definition,d).issues.length>0,name)}
 const d=draft(),p=customTestHeader();p.name='x-token';p.text='x\r\nInjected: true';d.parameters.push(p,{...p,key:999,name:'X-TOKEN'});const issues=buildInterfaceTest(definition,d).issues;assert(issues.some(i=>i.reason.includes('重复')));assert(issues.some(i=>i.reason.includes('换行')))
})
test('invalid address and timeout rejected; body omitted for interfaces without a body',()=>{
 for(const base_url of ['ftp://localhost','http://localhost?x=1','http://localhost#','http://user:pass@localhost','http://local host']){const d=draft();d.base_url=base_url;assert(buildInterfaceTest(definition,d).issues.some(i=>i.location==='body.base_url'))}
 for(const seconds of [0,301,1.5]){const d=draft();d.timeout_seconds=seconds;assert(buildInterfaceTest(definition,d).issues.some(i=>i.location==='body.timeout_seconds'))}
 const def=structuredClone(definition);delete def.request_body;const d=draft();d.bodyEnabled=false;const {body,issues}=buildInterfaceTest(def,d);assert.deepEqual(issues,[]);assert(!Object.hasOwn(body,'request_body'))
})
test('JSON root arrays remain arrays, mismatched content type and null rejected',()=>{
 const def=structuredClone(definition);def.request_body!.schema={type:'array',items:{type:'boolean'}};const d=draft();d.bodyText='[true,false]';assert.deepEqual(buildInterfaceTest(def,d).body.request_body,[true,false]);d.bodyText='null';assert(buildInterfaceTest(def,d).issues.some(i=>i.location==='body.request_body'))
 d.bodyText='[true]';const h=customTestHeader();h.name='Content-Type';h.text='text/plain';d.parameters.push(h);assert(buildInterfaceTest(def,d).issues.some(i=>i.reason.includes('application/json')))
})
test('required JSON template uses defaults, nested types and empty placeholders for secrets',()=>{
 assert.deepEqual(bodyTemplate(definition.request_body!.schema),{enabled:true,data:{ids:[]}})
 assert.deepEqual(bodyTemplate({type:'object',required:['token'],properties:{token:{type:'string',default:'***'}}}),{token:''})
})
test('unsupported request media type is explicitly rejected without pretending to send JSON',()=>{
 const def=structuredClone(definition) as unknown as Model<'InterfaceDetail'>
 Object.assign(def.request_body!,{content_type:'multipart/form-data'})
 assert(buildInterfaceTest(def,draft()).issues.some(i=>i.reason.includes('仅支持 JSON')))
})
