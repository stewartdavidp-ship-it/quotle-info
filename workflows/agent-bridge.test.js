'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validate,collect,contracts}=require('./agent-bridge');
const schema={type:'object',additionalProperties:false,required:['answer'],properties:{answer:{type:'string',enum:['known','uncertain']}}};
const p={stage:'research',runtime:'codex-agents',tasks:[{id:0},{id:1}],schema};
const row=id=>({id,agent:'research-a',completedAt:'2026-11-09T18:00:00Z',result:{answer:'known'}});
test('collection requires exact coverage and unique task identities',()=>{
 assert.throws(()=>collect(p,[[row(0)]]),/missing task ids: 1/);
 assert.throws(()=>collect(p,[[row(0),row(0),row(1)]]),/duplicate/);
 assert.throws(()=>collect(p,[[row(0),row(2)]]),/unexpected/);
 assert.equal(collect(p,[[row(1)],[row(0)]]).length,4);
});
test('real completion receipt and strict schema are required',()=>{
 assert.throws(()=>collect(p,[[{...row(0),agent:''},row(1)]]),/agent identity/);
 assert.throws(()=>collect(p,[[{...row(0),completedAt:'tomorrow'},row(1)]]),/timestamp/);
 assert.throws(()=>validate({answer:'probably'},schema),/enum/);
 assert.throws(()=>validate({answer:'known',fabricated:true},schema),/unexpected/);
 assert.throws(()=>validate({},schema),/required/);
});
test('audit must cover the planned page and cannot hide a blocking issue behind PASS',()=>{
 const q={...p,stage:'audit',tasks:[{id:0,item:{slug:'example'}}],schema:{type:'object'}};
 const a={...row(0),result:{page:'other/index.html',verdict:'PASS',issues:[]}};
 assert.throws(()=>collect(q,[[a]]),/page mismatch/);
 a.result.page='example/index.html';a.result.issues=[{severity:'high'}];
 assert.throws(()=>collect(q,[[a]]),/inconsistent/);
 a.result.verdict='FAIL';assert.equal(collect(q,[[a]]).length,2);
});
test('native adapter reuses the exact existing research and audit contracts',()=>{
 const path=require('node:path'),repo=path.resolve(__dirname,'..');
 const r=contracts(repo,'research',{items:[],verifiedDate:'9 Nov 2026',dateModified:'2026-11-09'});
 assert.match(r.prompt({text:'An example',author:'Example'}),/FETCH each source/);
 assert.equal(r.schema.properties.confidence.enum.join(','),'verified,attributed,disputed');
 const a=contracts(repo,'audit',{pages:[],repo});
 assert.match(a.prompt({slug:'example',confidence:'attributed',rights:'uncertain'}),new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.ok(a.skepticPrompt);assert.ok(a.verdictSchema);
});
