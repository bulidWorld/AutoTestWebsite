import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStepTest } from '../src/step-test.ts'
import { fieldsFor, key, type Draft, type StepDraft } from '../src/task-editor.ts'
import type { Model } from '../src/api.ts'
const definition = {id:1,file_id:1,version:1,method:'POST',path:'/test',parameters:[{name:'id',location:'query',required:true,description:'',schema:{type:'integer'}}],request_body:{required:true,content_type:'application/json',description:'',schema:{type:'object',required:['enabled'],properties:{enabled:{type:'boolean'}}}}} as Model<'InterfaceDetail'>
function fixture() {
 const s: StepDraft={key:key(),id:1,interface_id:1,file_id:1,version:1,file_name:'test',method:'POST',path:'/test',has_new_version:false,definition,fields:fieldsFor(definition)}
 const q=s.fields.find(f=>f.location==='query')!;q.enabled=true;q.kind='global';q.parameter_name='id'
 const b=s.fields.find(f=>f.name==='/enabled')!;b.enabled=true;b.text='false'
 const d: Draft={name:'',description:'',base_url:'http://localhost',timeout_seconds:30,parameters:[{key:key(),name:'id',value_type:'integer',text:'42',sensitive:false}],steps:[s]}
 return {d,s}
}
test('single step resolves current globals and JSON pointers without validating unrelated task fields',()=>{
 const {d,s}=fixture(), {body,issues}=buildStepTest(d,s,new Map());assert.deepEqual(issues,[])
 assert.equal(body.parameters[0]!.value,42);assert.deepEqual(body.request_body,{enabled:false});assert(!Object.hasOwn(body,'steps'))
})
test('single step requires extracted values from earlier steps and never sends redacted placeholders',()=>{
 const {d,s}=fixture(),p=d.parameters[0]!;p.source_type='rest';p.step_key=s.key
 assert.throws(()=>buildStepTest(d,s,new Map([[p.key,7]])),/前序/)
 const earlier={...s,key:key(),id:2,fields:[]};d.steps.unshift(earlier);p.step_key=earlier.key
 assert.throws(()=>buildStepTest(d,s,new Map()),/单次取值/)
 assert.equal(buildStepTest(d,s,new Map([[p.key,7]])).body.parameters[0]!.value,7)
 p.source_type='fixed';p.text='';p.retained={redacted:true} as never
 assert.throws(()=>buildStepTest(d,s,new Map()),/隐藏参数/)
})
