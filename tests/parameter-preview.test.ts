import test from 'node:test'
import assert from 'node:assert/strict'
import { buildParameterPreview } from '../src/parameter-preview.ts'
import { controlDraft, field, key, type Draft, type StepDraft } from '../src/task-editor.ts'
import type { Model } from '../src/api.ts'
const definition={parameters:[]} as unknown as Model<'InterfaceDetail'>
function fixture(): Draft {
 const group=controlDraft('parallel');group.id=10;group.position=3
 const rest: StepDraft={key:key(),id:11,step_type:'rest',execution_scope:'main',position:7,parent_key:group.key,interface_id:9,file_id:4,version:2,file_name:'test',method:'GET',path:'/test',has_new_version:false,definition,fields:[]}
 const wait=controlDraft('wait');wait.id=12;wait.parent_key=group.key;wait.position=10
 return {name:'test',description:'',base_url:'http://localhost',timeout_seconds:30,steps:[wait,group,rest],parameters:[{key:key(),name:'result',source_type:'rest',value_type:'integer',sensitive:false,text:'cached-value',step_key:rest.key,extract_expression:'data.id'}]}
}
test('flow preview sends the entire saved execution tree and configuration without cached preview values',()=>{
 const d=fixture(),body=buildParameterPreview(d,'result')
 assert.equal(body.steps.length,3);assert.equal(body.steps[2]!.parent_step_index,1);assert.equal(body.steps[2]!.position,7);assert.equal(body.parameter_name,'result');assert.deepEqual(body.global_parameters[0]!.rest_source,{step_id:11,extract_expression:'data.id'});assert(!Object.hasOwn(body.global_parameters[0]!,'value'));assert(!Object.hasOwn(body,'name'))
})
test('flow preview rejects unsaved nodes and omitted hidden values instead of sending placeholders',()=>{
 const d=fixture();delete d.steps[0]!.id;assert.throws(()=>buildParameterPreview(d,'result'),/保存/);d.steps[0]!.id=12
 d.parameters.push({key:key(),name:'token',value_type:'string',sensitive:true,text:'',source_type:'fixed',retained:{name:'token',value_type:'string',sensitive:true,redacted:true,source_type:'fixed'} as never});assert.throws(()=>buildParameterPreview(d,'result'),/隐藏值/)
 d.parameters.pop();const header=field('header','Authorization');header.enabled=true;header.preserved=true;d.steps[2]!.fields.push(header);assert.throws(()=>buildParameterPreview(d,'result'),/隐藏值/)
})
