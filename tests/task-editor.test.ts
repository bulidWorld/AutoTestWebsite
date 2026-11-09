import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTask, controlDraft, field, fieldsFor, key, parseValue, stepDraft, type Draft, type TaskModel } from '../src/task-editor.ts'
import type { Model } from '../src/api.ts'
const definition = { id:9,file_id:3,version:1,method:'POST',path:'/orders/{id}',operation_id:'create',summary:'',description:'', parameters:[{location:'path',name:'id',required:true,description:'',schema:{type:'integer'}},{location:'query',name:'tag',required:false,description:'',schema:{type:'array',items:{type:'string'}}}], request_body:{description:'',required:true,content_type:'application/json',schema:{type:'object',required:['data'],properties:{data:{type:'object',required:['enabled'],properties:{enabled:{type:'boolean',default:true},ids:{type:'array',items:{type:'integer'}}}}}}},responses:{},authentication:{schemes:{},requirements:[]},servers:[] } as Model<'InterfaceDetail'>
function draft(): Draft {
 const fields=fieldsFor(definition), id=fields.find(f=>f.location==='path')!; id.enabled=true; id.kind='global'; id.parameter_name='id'
 return {name:'任务',description:'',base_url:'http://localhost:8000/prefix',timeout_seconds:30,parameters:[{key:key(),name:'id',value_type:'integer',sensitive:false,text:'10'}],steps:[{key:key(),id:2,interface_id:9,file_id:3,version:1,file_name:'orders',method:'POST',path:'/orders/{id}',has_new_version:true,fields,definition}]}
}
test('SQL nodes round-trip credentials and exact statements without REST definitions or fields',()=>{
 const sql={driver:'postgresql' as const,datasource:'host=127.0.0.1 port=5432 dbname=business',username:'test_user',password:'secret',statement:"\nINSERT INTO test_data (id, name) VALUES (10001, 'SQL 节点示例');\n",timeout_seconds:30}
 const saved={id:91,step_type:'sql',execution_scope:'main',position:10,parent_step_id:null,options:{sql,condition:{parameter:'id',operator:'notEmpty',on_false:'skip'}}} as TaskModel<'Step'>
 const restored=stepDraft(saved), d=draft();d.steps=[restored]
 const result=buildTask(d)
 assert.deepEqual(result.issues,[])
 assert.deepEqual(result.body.steps,[{id:91,step_type:'sql',execution_scope:'main',position:10,options:saved.options}])
 assert.equal(restored.method,'SQL');assert.deepEqual(restored.fields,[])
 assert.notEqual(restored.options?.sql,saved.options?.sql)
})
test('SQL works in main, parallel children and finally; omitted credentials and timeout stay omitted',()=>{
 const d=draft(), main=controlDraft('sql'), cleanup=controlDraft('sql'), group=controlDraft('parallel'), child=controlDraft('sql'), wait=controlDraft('wait')
 for (const s of [main,cleanup,child]) s.options!.sql={driver:'sqlite',datasource:'/srv/test.db',statement:'DELETE FROM test_data WHERE id = 10001'}
 main.position=10;group.position=20;child.parent_key=group.key;child.position=10;wait.parent_key=group.key;wait.position=20;cleanup.execution_scope='finally';cleanup.position=10
 d.steps=[main,group,child,wait,cleanup]
 const {body,issues}=buildTask(d);assert.deepEqual(issues,[])
 assert.equal(body.steps[2]!.parent_step_index,1);assert.equal(body.steps[4]!.execution_scope,'finally')
 assert.deepEqual(body.steps[0]!.options?.sql,{driver:'sqlite',datasource:'/srv/test.db',statement:'DELETE FROM test_data WHERE id = 10001'})
})
test('SQL configuration validates backend driver, required fields, credentials and timeout rules',()=>{
 const d=draft(), s=controlDraft('sql');d.steps=[s]
 assert(buildTask(d).issues.some(i=>i.location.endsWith('sql.datasource')))
 assert(buildTask(d).issues.some(i=>i.location.endsWith('sql.statement')))
 const sql=s.options!.sql!;sql.datasource='host=localhost';sql.statement='SELECT 1'
 for (const timeout of [0,301,1.5,NaN]) {sql.timeout_seconds=timeout;assert(buildTask(d).issues.some(i=>i.location.endsWith('sql.timeout_seconds')))}
 for (const timeout of [1,30,300,undefined]) {sql.timeout_seconds=timeout;assert.deepEqual(buildTask(d).issues,[])}
 sql.driver='mysql' as 'postgresql';assert(buildTask(d).issues.some(i=>i.location.endsWith('sql.driver')))
 sql.driver='sqlite';sql.username='test';sql.password='secret'
 assert(buildTask(d).issues.some(i=>i.location.endsWith('sql.username')));assert(buildTask(d).issues.some(i=>i.location.endsWith('sql.password')))
})
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
 assert.deepEqual(buildTask(d).body.steps[0]!.headers.at(-1)!.binding,{kind:'literal'}); delete d.steps[0]!.id; assert.deepEqual(buildTask(d).body.steps[0]!.headers.at(-1)!.binding,{kind:'literal',value:''})
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

test('assertion code survives load and save verbatim, with IDs and versions preserved',()=>{
 const d=draft(),code='def assert(responseBody, globalParam):\n    return responseBody.get("code") == 0 and globalParam["id"] == 10\n'
 const saved={...buildTask(d).body.steps[0]!,id:2,position:1,file_name:'orders',method:'POST',path:definition.path,has_new_version:true,assertion_code:code} as TaskModel<'Step'>
 d.steps=[stepDraft(saved,definition)]
 const {body,issues}=buildTask(d);assert.deepEqual(issues,[]);assert.equal(body.steps[0]!.assertion_code,code);assert.equal(body.steps[0]!.id,2);assert.equal(body.steps[0]!.version,1)
 const copy=JSON.parse(JSON.stringify(d.steps[0]!));delete copy.id;copy.key=key();d.steps.push(copy)
 assert.equal(buildTask(d).body.steps[1]!.assertion_code,code);assert.equal(buildTask(d).body.steps[1]!.id,undefined)
})
test('unset and cleared assertion codes explicitly serialize null on full save',()=>{
 const d=draft()
 for(const code of [undefined,null,'',' \n\t ']){d.steps[0]!.assertion_code=code;assert.equal(buildTask(d).body.steps[0]!.assertion_code,null)}
 d.steps[0]!.assertion_code='def assert(responseBody, globalParam):\n    return True\n';assert.equal(buildTask(d).body.steps[0]!.assertion_code,d.steps[0]!.assertion_code)
 d.steps[0]!.assertion_code='';assert.equal(buildTask(d).body.steps[0]!.assertion_code,null)
})
test('legacy task steps without assertion codes load as an empty editor',()=>{
 const d=draft(),saved={...buildTask(d).body.steps[0]!,id:2,position:1,file_name:'orders',method:'POST',path:definition.path,has_new_version:false} as TaskModel<'Step'>
 delete saved.assertion_code
 assert.equal(stepDraft(saved,definition).assertion_code,'')
})

test('tree serialization preserves explicit positions, new parent indices and finally without REST fields on controls', async () => {
 const {controlDraft,orderedSteps}=await import('../src/task-editor.ts')
 const d=draft(), rest=d.steps[0]!, parallel=controlDraft('parallel'), wait=controlDraft('wait'), cleanup=controlDraft('wait')
 parallel.position=20;rest.parent_key=parallel.key;rest.position=7;wait.parent_key=parallel.key;wait.position=30;cleanup.execution_scope='finally';cleanup.position=9
 d.steps=[cleanup,rest,wait,parallel]
 const result=buildTask(d);assert.deepEqual(result.issues,[])
 assert.equal(result.body.steps[1]!.parent_step_index,3);assert.equal(result.body.steps[1]!.position,7)
 assert.equal(result.body.steps[0]!.execution_scope,'finally')
 for(const index of [0,2,3]) for(const name of ['interface_id','file_id','version','bindings','headers','raw_body','assertion_code']) assert(!Object.hasOwn(result.body.steps[index]!,name),name)
 assert.deepEqual(orderedSteps(d.steps).map(s=>s.key),[parallel.key,rest.key,wait.key,cleanup.key])
})
test('parallel inputs use the barrier position rather than array order; siblings cannot consume each other', async()=>{
 const {controlDraft,canReadSource}=await import('../src/task-editor.ts')
 const d=draft(), source=d.steps[0]!, group=controlDraft('parallel'), sibling={...source,key:key(),id:3,fields:fieldsFor(definition)}, consumer={...source,key:key(),id:4,fields:source.fields.map(f=>({...f,key:key()}))}
 group.position=20;source.parent_key=group.key;source.position=1;sibling.parent_key=group.key;sibling.position=2;consumer.position=30
 d.steps=[consumer,source,sibling,group]
 const p=d.parameters[0]!;p.source_type='rest';p.step_key=source.key;p.extract_expression='data.id'
 source.fields=source.fields.filter(f=>f.location!=='path');const path=field('path','id',{type:'integer'},true);path.enabled=true;path.text='1';source.fields.push(path)
 assert(canReadSource(d.steps,consumer,source));assert(!canReadSource(d.steps,sibling,source));assert(!canReadSource(d.steps,source,source))
 assert(!buildTask(d).issues.some(i=>i.location.startsWith('body.steps[0]')&&i.reason.includes('前序')))
 consumer.parent_key=group.key;consumer.position=3
 assert(buildTask(d).issues.some(i=>i.location.startsWith('body.steps[0]')&&i.reason.includes('前序')))
 assert(!buildTask(d,false).issues.some(i=>i.reason.includes('前序')), 'draft availability can be supplied by preceding collection batches')
 consumer.parent_key=undefined;consumer.execution_scope='finally';consumer.position=1
 assert(canReadSource(d.steps,consumer,source))
})
test('invalid tree structures, duplicate sibling positions and control limits are located', async()=>{
 const {controlDraft}=await import('../src/task-editor.ts')
 const d=draft(), group=controlDraft('parallel'), wait=controlDraft('wait');group.position=1;group.max_concurrency=9;wait.position=1;wait.wait_milliseconds=0;wait.parent_key=group.key;d.steps=[group,wait]
 let result=buildTask(d);assert(result.issues.some(i=>i.reason.includes('两个')));assert(result.issues.some(i=>i.location.endsWith('max_concurrency')));assert(result.issues.some(i=>i.location.endsWith('wait_milliseconds')))
 group.execution_scope='finally';assert(buildTask(d).issues.some(i=>i.reason.includes('主流程根')))
 group.execution_scope='main';group.parent_key=wait.key;assert(buildTask(d).issues.some(i=>i.location.includes('parent_step_index')))
 group.parent_key=undefined;wait.parent_key=undefined;assert(buildTask(d).issues.some(i=>i.location.endsWith('position')))
 wait.parent_key=999999;assert(buildTask(d).issues.some(i=>i.location.includes('parent_step_index')))
})
test('REST parameter sources allow finally REST and exclude control nodes', async()=>{
 const {controlDraft}=await import('../src/task-editor.ts')
 const d=draft(),s=d.steps[0]!,p=d.parameters[0]!;p.source_type='rest';p.extract_expression='data.id';p.step_key=s.key
 s.execution_scope='finally';s.fields.find(f=>f.location==='path')!.kind='literal';s.fields.find(f=>f.location==='path')!.text='10';assert.deepEqual(buildTask(d).issues,[])
 assert.deepEqual(buildTask(d).body.global_parameters[0]!.rest_source,{step_id:2,extract_expression:'data.id'})
 const wait=controlDraft('wait');d.steps=[wait];p.step_key=wait.key;assert(buildTask(d).issues.some(i=>i.location.endsWith('rest_source.step_id')))
})
test('headers use independent wire fields and round-trip redacted and global values',()=>{
 const d=draft(),s=d.steps[0]!,header=field('header','Authorization');header.enabled=true;header.preserved=true;s.fields.push(header)
 const result=buildTask(d);assert(!result.body.steps[0]!.bindings.some(f=>f.location==='header'));assert.deepEqual(result.body.steps[0]!.headers,[{name:'Authorization',binding:{kind:'literal'}}])
 const saved={...result.body.steps[0]!,id:2,file_name:'orders',method:'POST',path:definition.path,has_new_version:false,headers:[{name:'Authorization',binding:{kind:'literal',redacted:true}},{name:'X-ID',binding:{kind:'global',parameter_name:'id'}}]} as TaskModel<'Step'>
 const loaded=stepDraft(saved,definition);assert(loaded.fields.find(f=>f.name==='Authorization')!.preserved);assert.equal(loaded.fields.find(f=>f.name==='X-ID')!.parameter_name,'id')
})
test('raw body retains whitespace, invalid JSON and empty text without schema parsing; bindings conflict rejected',()=>{
 const d=draft(),s=d.steps[0]!;s.fields.filter(f=>f.location==='body').forEach(f=>f.enabled=false)
 for(const text of ['', '  {"invalid":\n  ', '{"data":{}}']) {s.raw_body={text};const result=buildTask(d);assert.deepEqual(result.issues,[]);assert.deepEqual(result.body.steps[0]!.raw_body,{text})}
 s.fields.find(f=>f.name==='/data/enabled')!.enabled=true;assert(buildTask(d).issues.some(i=>i.location.endsWith('raw_body')))
 s.fields.filter(f=>f.location==='body').forEach(f=>f.enabled=false);const header=field('header','Content-Type');header.enabled=true;header.text='text/plain';s.fields.push(header);assert(buildTask(d).issues.some(i=>i.location.endsWith('headers')))
 s.fields.pop();s.definition={...definition,request_body:undefined};assert(buildTask(d).issues.some(i=>i.reason.includes('application/json')))
})
test('OpenAPI 3.1 schema composition and union types validate structured JSON', async()=>{
 const {checkSchema,schemaInputType}=await import('../src/task-editor.ts')
 const schema={allOf:[{type:'object',required:['a'],properties:{a:{type:'integer'}}},{type:'object',required:['b'],properties:{b:{type:['string','null']}}}]}
 assert.equal(checkSchema({a:1,b:null},schema),undefined);assert(checkSchema({a:1},schema)?.includes('/b'));assert(checkSchema({a:'1',b:'b'},schema)?.includes('/a'))
 assert.equal(schemaInputType(schema),'json');assert.deepEqual(parseValue('{"a":1,"b":null}',schemaInputType(schema)),{a:1,b:null})
 assert.equal(checkSchema(1,{oneOf:[{type:'integer'},{type:'number'}]}),'值不满足 oneOf 组合约束');assert.equal(checkSchema('x',{anyOf:[{type:'string'},{type:'integer'}]}),undefined)
})

 test('finally REST outputs are available to later cleanup but never main or earlier cleanup', async()=>{
 const {canReadSource}=await import('../src/task-editor.ts')
 const d=draft(),main=d.steps[0]!,source={...main,key:key(),id:3,execution_scope:'finally' as const,position:2},later={...main,key:key(),id:4,execution_scope:'finally' as const,position:3},earlier={...main,key:key(),id:5,execution_scope:'finally' as const,position:1}
 d.steps=[later,main,source,earlier]
 assert.equal(canReadSource(d.steps,later,source),true)
 for(const consumer of [main,earlier,source]) assert.equal(canReadSource(d.steps,consumer,source),false)
 assert.equal(canReadSource(d.steps,source,main),true)
 d.parameters.push({key:key(),name:'cleanup_result',value_type:'integer',sensitive:false,text:'',source_type:'rest',step_key:source.key,extract_expression:'data.id'})
 const f=later.fields=structuredClone(main.fields);f.find(f=>f.location==='path')!.parameter_name='cleanup_result'
 assert.deepEqual(buildTask(d).issues,[])
 main.fields.find(f=>f.location==='path')!.parameter_name='cleanup_result'
 assert(buildTask(d).issues.some(i=>i.location.startsWith('body.steps[1].bindings')))
 })

test('imported auth options survive editing and saving with other execution options',()=>{
 const d=draft();d.parameters.push({key:key(),name:'TOKEN_A',value_type:'string',text:'token-a',sensitive:true})
 const options={timezone:'Asia/Shanghai',auth:{mode:'bearer' as const,parameter:'TOKEN_A'},condition:{parameter:'TOKEN_A',operator:'notEmpty' as const,on_false:'skip' as const}}
 const saved={...d.steps[0],step_type:'rest',bindings:[],headers:[],options} as unknown as TaskModel<'Step'>
 const restored=stepDraft(saved,definition);assert.deepEqual(restored.options,options)
 d.steps[0]!.options=restored.options
 const result=buildTask(d);assert.deepEqual(result.issues,[]);assert.deepEqual(result.body.steps[0]!.options,options)
 d.steps[0]!.options!.auth!.parameter='missing'
 assert(buildTask(d).issues.some(i=>i.location.endsWith('options.auth.parameter')))
})
