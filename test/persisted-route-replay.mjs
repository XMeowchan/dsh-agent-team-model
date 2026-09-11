// Optional, read-only integration replay of existing zstd Sessions + installed SDK coldResume.
// No model call, real activation, session append, or host restart is allowed in this harness.
// node test/persisted-route-replay.mjs <workspace-session-dir> <lead-id> <installed-dsh-dir>
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zstdDecompressSync} from 'node:zlib';
import {readView} from '../lib/index.js';
const [directory, rootId, install] = process.argv.slice(2);
if (!install) throw Error('requires workspace session directory, lead id, installed DSH directory');
const {SubagentContinuationManager} = await import(pathToFileURL(join(install, 'node_modules/@deepseek-ai/dsh-subagent/lib/types/continuation.js')));
function load(id) {
  const b = readFileSync(join(directory,id,'session.v3.jsonl.zstd')); let offset=0; const chunks=[];
  while(offset < b.length) {
    const result=zstdDecompressSync(b.subarray(offset),{info:true});
    assert.ok(result.engine.bytesWritten>0); offset+=result.engine.bytesWritten; chunks.push(result.buffer);
  }
  const [header,...events]=Buffer.concat(chunks).toString('utf8').trim().split('\n').map(JSON.parse);
  assert.equal(header.isSeeded ?? false,false,'replay fixture must be fresh, not guessed inherited boundary');
  return {header,events,inheritedEventCount:0,[Symbol.dispose]() {}};
}
const sources = new Map();
const query={observeSession:async id=> { if(!sources.has(id)) sources.set(id,load(id)); return sources.get(id); }};
const services={sessionQuery:query, agents:{get:()=>undefined},agentTeams:{}};
const ctx={get:key=>services[key]};
const team = await readView(ctx, rootId);
assert.equal(team.membersError,null);
const results=[];
for (const member of team.members.filter(m=>m.role==='teammate')) {
  const parent={id:rootId}; let options;
  const harness={
    requireSessionQuery:()=>query,
    activations:{
      assertAdmitting:()=>{},
      authorizeLineage:(_parent,_id,lineage)=>assert.equal(lineage,rootId),
      materialize:async spec=> {options=spec.agentOptions; return {marker:'test-only-no-agent'};}
    },
    submitMaterialized:async activation=> {assert.equal(activation.marker,'test-only-no-agent'); return 'test-message-not-sent';}
  };
  await SubagentContinuationManager.prototype.coldResume.call(harness,parent,member.id,[],{signal:new AbortController().signal});
  const self=await readView(ctx,member.id);
  assert.equal(self.viewer.role,'teammate'); assert.equal(self.members.length,1); assert.equal(self.config,null);
  const route={provider:member.provider,model:member.model,reasoningEffort:member.reasoningEffort};
  assert.deepEqual(route,options,'UI restored route must equal actual installed SDK coldResume agentOptions');
  results.push({id:member.id,name:member.name,status:member.status,workState:member.workState,routeSource:member.routeSource,route,coldResumeOptions:options});
}
assert.ok(results.length>0);
mkdirSync('_evidence',{recursive:true});
writeFileSync('_evidence/persisted-route-replay.json',JSON.stringify({rootId,verifiedAgainst:'installed SDK SubagentContinuationManager.coldResume',noAgentsActivated:true,results},null,2));
console.log(JSON.stringify(results,null,2));
console.log('PASS: persisted UI routes equal installed SDK cold-resume routes; no Agents activated');
