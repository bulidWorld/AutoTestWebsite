import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTask, field, fieldsFor, key, parseValue, stepDraft, type Draft, type TaskModel } from '../src/task-editor.ts'
import type { Model } from '../src/api.ts'
const definition = { id:9,file_id:3,version:1,method:'POST',path:'/orders/{id}',operation_id:'create',summary:'',description:'', parameters:[{location:'path',name:'id',required:true,description:'',schema:{type:'integer'}},{location:'query',name:'tag',required:false,description:'',schema:{type:'array',items:{type:'string'}}}], request_body:{description:'',required:true,content_type:'application/json',schema:{type:'object',required:['data'],properties:{data:{type:'object',required:['enabled'],properties:{enabled:{type:'boolean',default:true},ids:{type:'array',items:{type:'integer'}}}}}}},responses:{},authentication:{schemes:{},requirements:[]},servers:[] } as Model<'InterfaceDetail'>
function draft(): Draft {
 const fields=fieldsFor(definition), id=fields.find(f=>f.location==='path')!; id.enabled=true; id.kind='global'; id.parameter_name='id'
 return {name:'任务',description:'',base_url:'http://localhost:8000/prefix',timeout_seconds:30,parameters:[{key:key(),name:'id',value_type:'integer',sensitive:false,text:'10'}],steps:[{key:key(),id:2,interface_id:9,file_id:3,version:1,file_name:'orders',method:'POST',path:'/orders/{id}',has_new_version:true,fields,definition}]}
}
test('JSON values preserve type and invalid values never coerce',()=>{
 for (const [text,type,value] of [['10','integer',10],['false','boolean',false],['{"x":[1]}','object',{x:[1]}],['[1,2]','array',[1,2]],['hello','string','hello']] as const) assert.deepEqual(parseValue(text,type),value)
 for (const [text,type] of [['"1"','integer'],['1.5','integer'],['null','object'],['[]','object'],['NaN','number'],['False','boolean']]) assert.throws(()=>parseValue(text!,type!))
})
test('save preserves stable IDs, pinned versions, typed bindings, optional omission',()=>{
 const {body,issues}=buildTask(draft()); assert.deepEqual(issues,[]); assert.equal(body.steps[0]!.id,2); assert.equal(body.steps[0]!.version,1)
 assert.deepEqual(body.steps[0]!.bindings,[{location:'path',name:'id',binding:{kind:'global',parameter_name:'id'}},{location:'body',name:'/data/enabled',binding:{kind:'literal',value:true}}]); assert.equal(body.global_parameters[0]!.value,10)
})
test('required fields, missing references, duplicate names, and type errors are located',()=>{
 const d=draft(); d.parameters[0]!.text='"10"'; d.parameters.push({...d.parameters[0]!,key:key()}); d.steps[0]!.fields.find(f=>f.location==='path')!.parameter_name='missing'; d.steps[0]!.fields.find(f=>f.name==='/data/enabled')!.enabled=false
 const issues=buildTask(d).issues; assert(issues.some(i=>i.location.endsWith('.value'))); assert(issues.some(i=>i.reason.includes('唯一'))); assert(issues.some(i=>i.reason.includes('不存在'))); assert(issues.some(i=>i.reason.includes('请求体')))
})
test('hidden sensitive values are omitted; renaming requires a new value',()=>{
 const d=draft(),p=d.parameters[0]!; p.sensitive=true; p.text=''; p.retained={id:1,name:'id',source_type:'fixed',value_type:'integer',sensitive:true,redacted:true,position:1}
 assert.deepEqual(buildTask(d).issues,[]); assert(!Object.hasOwn(buildTask(d).body.global_parameters[0]!,'value')); p.name='renamed'; assert(buildTask(d).issues.some(i=>i.location.endsWith('.value')))
})
test('redacted literals only retained for stable steps',()=>{
 const d=draft(),f=field('header','Authorization',{type:'string'}); f.enabled=true; f.preserved=true; d.steps[0]!.fields.push(f)
 assert.deepEqual(buildTask(d).body.steps[0]!.bindings.at(-1)!.binding,{kind:'literal'}); delete d.steps[0]!.id; assert.deepEqual(buildTask(d).body.steps[0]!.bindings.at(-1)!.binding,{kind:'literal',value:''})
})
test('JSON roots remain structured, nested required fields and overlaps checked',()=>{
 const d=draft(),s=d.steps[0]!; s.fields.filter(f=>f.location==='body').forEach(f=>f.enabled=false); const root=s.fields.find(f=>f.location==='body'&&f.name==='')!; root.enabled=true; root.text='{"data":{"enabled":false,"ids":[1,2]}}'
 assert.deepEqual(buildTask(d).issues,[]); assert.deepEqual(buildTask(d).body.steps[0]!.bindings.at(-1)!.binding,{kind:'literal',value:{data:{enabled:false,ids:[1,2]}}})
 s.fields.find(f=>f.name==='/data/enabled')!.enabled=true; assert(buildTask(d).issues.some(i=>i.reason.includes('父字段'))); s.fields.filter(f=>f.name!=='').forEach(f=>{if(f.location==='body')f.enabled=false}); root.text='{"data":{}}'; assert(buildTask(d).issues.some(i=>i.reason.includes('enabled')))
})
test('query scalar arrays accepted, object queries and execution headers rejected',()=>{
 const d=draft(),s=d.steps[0]!,tags=s.fields.find(f=>f.location==='query')!; tags.enabled=true; tags.text='["a b","中文"]'; assert.deepEqual(buildTask(d).issues,[])
 const object=field('query','filter',{type:'object'}); object.enabled=true; object.text='{"x":1}'; s.fields.push(object); assert(buildTask(d).issues.some(i=>i.reason.includes('对象 query')))
 const header=field('header','Host'); header.enabled=true; s.fields.push(header); assert(buildTask(d).issues.some(i=>i.reason.includes('执行配置')))
})
test('invalid URL and timeout blocked; empty drafts permitted',()=>{
 for(const url of ['ftp://localhost','http://localhost?a=1','http://localhost#','http://user:pass@localhost']){const d=draft();d.base_url=url;assert(buildTask(d).issues.some(i=>i.location==='body.base_url'))}
 for(const timeout of [0,301,1.5]){const d=draft();d.timeout_seconds=timeout;assert(buildTask(d).issues.some(i=>i.location==='body.timeout_seconds'))}
 const d=draft();d.steps=[];assert.deepEqual(buildTask(d).issues,[])
})
test('reload never refills defaults or updates pinned versions',()=>{
 const s=stepDraft({id:2,interface_id:9,file_id:3,version:1,file_name:'orders',current_version:2,has_new_version:true,method:'POST',path:'/orders/{id}',position:1,bindings:[],execution_phase:'steps'} as TaskModel<'Step'>,definition)
 assert.equal(s.version,1);assert.equal(s.fields.filter(f=>f.enabled).length,0)
})
test('object default suppresses child defaults',()=>{
 const def=structuredClone(definition);def.request_body!.schema.default={data:{enabled:true}};assert.deepEqual(fieldsFor(def).filter(f=>f.location==='body'&&f.enabled).map(f=>f.name),[''])
})

test('REST parameters preserve stable source IDs and expressions and omit preview values', () => {
 const d=draft(), source=d.steps[0]!
 d.parameters.push({key:key(),name:'result',value_type:'integer',sensitive:false,text:'999',source_type:'rest',step_key:source.key,extract_expression:'data.items[0].id'})
 const {body,issues}=buildTask(d);assert.deepEqual(issues,[])
 assert.deepEqual(body.global_parameters[1],{name:'result',value_type:'integer',source_type:'rest',sensitive:false,rest_source:{step_id:2,extract_expression:'data.items[0].id'}})
 delete source.id
 const created=buildTask(d);assert.deepEqual(created.issues,[])
 assert.deepEqual(created.body.global_parameters[1],{name:'result',value_type:'integer',source_type:'rest',sensitive:false,rest_source:{step_index:0,extract_expression:'data.items[0].id'}})
})
test('new REST sources use their current submission index alongside existing stable sources', () => {
 const d=draft(), existing=d.steps[0]!, added={...existing,key:key(),id:undefined}
 d.steps.push(added)
 d.parameters.push({key:key(),name:'existing',value_type:'integer',sensitive:false,text:'',source_type:'rest',step_key:existing.key,extract_expression:'data.id'}, {key:key(),name:'added',value_type:'integer',sensitive:false,text:'',source_type:'rest',step_key:added.key,extract_expression:'data.id'})
 let result=buildTask(d);assert.deepEqual(result.issues,[])
 assert.deepEqual(result.body.global_parameters[1]!.rest_source,{step_id:2,extract_expression:'data.id'})
 assert.deepEqual(result.body.global_parameters[2]!.rest_source,{step_index:1,extract_expression:'data.id'})
 d.steps.reverse();result=buildTask(d);assert.deepEqual(result.issues,[])
 assert.deepEqual(result.body.global_parameters[1]!.rest_source,{step_id:2,extract_expression:'data.id'})
 assert.deepEqual(result.body.global_parameters[2]!.rest_source,{step_index:0,extract_expression:'data.id'})
})
test('REST parameters cannot reference self or later steps and cannot lose their source', () => {
 const d=draft(), s=d.steps[0]!, p=d.parameters[0]!
 p.source_type='rest';p.step_key=s.key;p.extract_expression='data.id'
 assert(buildTask(d).issues.some(i=>i.reason.includes('前序')))
 d.steps=[];assert(buildTask(d).issues.some(i=>i.location.endsWith('rest_source.step_id')))
})
