// Restart and role-scoping regression: read real host API without activating Agents.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMembers, readView, apply } from '../lib/index.js';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const home = mkdtempSync(join(tmpdir(), 'atm-restart-'));
process.env.DSH_HOME = home;
process.on('exit', () => rmSync(home, {recursive: true, force: true}));

const leadRoute = { provider: 'openai-codex', model: 'gpt-6-astra', reasoningEffort: 'xhigh' };
const childRoute = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' };
const descriptor = (route = childRoute) => ({ type: 'subagent/descriptor', data: {
  version: 3, mode: 'continuable', provider: 'spawn', label: 'worker',
  agentProvider: route.provider, agentModel: route.model, agentReasoningEffort: route.reasoningEffort
} });
const member = { id: 'child-a', name: 'worker', provider: 'spawn', context: 'fresh', phase: 'active' };
const row = { ...member, role: 'teammate', status: 'inactive', model: leadRoute.model, diagnostics: [] };
function world() {
  const root = { id: 'root-a', status: 'idle', options: leadRoute, session: { requestHeader: () => ({config: leadRoute}) } };
  const agents = new Map([[root.id, root]]);
  const stores = new Map([
    ['child-a', { header: { id: 'child-a', parentSession: root.id, origin: 'subagent' }, inheritedEventCount: 0, events: [descriptor()] }],
    [root.id, { header: { id: root.id }, inheritedEventCount: 0, events: [{ type: 'team/member', data: { version: 2, teamId: root.id, member } }] }]
  ]);
  let opened = 0, disposed = 0;
  const services = {
    agents: { get: id => agents.get(id) },
    agentTeams: {
      tryMembership: a => a.id === root.id ? { root, id: root.id, role: 'lead', name: 'lead' } : undefined,
      listMembers: a => { assert.equal(a.id, root.id); return [{ id: root.id, name: 'lead', role: 'lead', status: root.status, model: leadRoute.model }, { ...row }]; }
    },
    sessionQuery: { observeSession: async id => {
      const stored = stores.get(id);
      if (!stored) throw Error('not found');
      opened++;
      return { ...stored, [Symbol.dispose]: () => { disposed++; } };
    } },
    subagents: { startContinuable() { throw Error('must not spawn or wake any Agent'); } }
  };
  const ctx = { get: key => services[key] };
  return { root, agents, stores, services, ctx, leases: () => ({opened, disposed}) };
}
const routeOf = row => ({ provider: row.provider, model: row.model, reasoningEffort: row.reasoningEffort });

function ordinaryForkWorld() {
  const w = world(), stored = w.stores.get(w.root.id);
  const sourceId = 'source-a';
  const inheritedMember = { type: 'team/member', data: {
    version: 2, teamId: sourceId, member: { ...member, id: 'source-child' }
  } };
  w.stores.set(sourceId, { header: { id: sourceId }, inheritedEventCount: 0, events: [inheritedMember] });
  // Ordinary UI forks set ancestry and inherit events, but have no subagent origin or own descriptor.
  stored.header = { ...stored.header, parentSession: sourceId, isSeeded: true };
  stored.inheritedEventCount = 1;
  stored.events.unshift(inheritedMember);
  return { ...w, sourceId };
}

test('restart: inactive teammate uses durable descriptor, not Lead fallback', async () => {
  const w = world();
  for (let i = 0; i < 2; i++) {
    const result = await readMembers(w.ctx, w.root.id);
    assert.deepEqual(routeOf(result.members[1]), childRoute);
    assert.equal(result.members[1].routeSource, 'persisted-descriptor');
    assert.equal(result.members[1].status, 'inactive');
    assert.deepEqual(routeOf(result.members[0]), leadRoute);
  }
  assert.ok(w.leases().opened > 0);
  assert.equal(w.leases().opened, w.leases().disposed);
});

test('unreadable or unknown descriptor never presents the Lead model as a child model', async () => {
  for (const mode of ['missing', 'unsupported', 'wrong-parent', 'partial', 'wrong-backend', 'missing-label', 'unknown-field', 'invalid-filter']) {
    const w = world(), stored = w.stores.get('child-a');
    if (mode === 'missing') w.stores.delete('child-a');
    if (mode === 'unsupported') stored.events[0].data.version = 99;
    if (mode === 'wrong-parent') stored.header.parentSession = 'someone-else';
    if (mode === 'partial') delete stored.events[0].data.agentProvider;
    if (mode === 'wrong-backend') stored.events[0].data.provider = 'fork';
    if (mode === 'missing-label') delete stored.events[0].data.label;
    if (mode === 'unknown-field') stored.events[0].data.unknown = true;
    if (mode === 'invalid-filter') stored.events[0].data.toolFilter = {};
    const result = await readMembers(w.ctx, w.root.id);
    assert.equal(result.members[1].model, undefined, mode);
    assert.equal(result.members[1].routeSource, 'unavailable', mode);
    assert.ok(result.members[1].routeError, mode);
    assert.equal(w.leases().opened, w.leases().disposed);
  }
});

test('fork skips inherited descriptors and later duplicate descriptors cannot override first own descriptor', async () => {
  const w = world(), stored = w.stores.get('child-a');
  stored.inheritedEventCount = 1;
  stored.events = [descriptor(leadRoute), descriptor(), descriptor(leadRoute)];
  assert.deepEqual(routeOf((await readMembers(w.ctx, w.root.id)).members[1]), childRoute);
});

test('live last-request wins and no persisted child observation is opened', async () => {
  const w = world();
  w.agents.set('child-a', { id: 'child-a', options: childRoute, session: { requestHeader: () => ({config: childRoute}) } });
  const result = await readMembers(w.ctx, w.root.id);
  assert.deepEqual(routeOf(result.members[1]), childRoute);
  assert.equal(result.members[1].routeSource, 'last-request');
  assert.equal(w.leases().opened, 0);
});

test('cold teammate viewer sees only self and cannot access global model settings', async () => {
  const w = world();
  const result = await readView(w.ctx, 'child-a');
  assert.equal(result.viewer.role, 'teammate');
  assert.equal(result.viewer.canEditModel, false);
  assert.ok(result.viewer.modelEditReason);
  assert.deepEqual(result.members.map(m => m.id), ['child-a']);
  assert.deepEqual(routeOf(result.members[0]), childRoute);
  assert.equal(result.config, null);
  assert.equal(result.effectiveDefault, null);
  assert.deepEqual(result.recent, []);
  assert.equal(w.leases().opened, w.leases().disposed);
});

test('cold teammate can be identified from durable roster even when Lead is not live', async () => {
  const w = world();
  w.agents.delete(w.root.id);
  const result = await readView(w.ctx, 'child-a');
  assert.equal(result.viewer.role, 'teammate');
  assert.deepEqual(result.members.map(m => m.id), ['child-a']);
  assert.deepEqual(routeOf(result.members[0]), childRoute);
  assert.equal(w.leases().opened, w.leases().disposed);
});

test('ordinary fork Lead retains its own roster when cold, not its source roster', async () => {
  const w = ordinaryForkWorld();
  for (const cold of [false, true]) {
    if (cold) w.agents.clear();
    const result = await readView(w.ctx, w.root.id);
    assert.equal(result.membersError, null);
    assert.equal(result.viewer.role, 'lead');
    assert.equal(result.viewer.rootId, w.root.id);
    assert.equal(result.viewer.memberId, w.root.id);
    assert.deepEqual(result.members.map(m => m.id), [w.root.id, 'child-a']);
    assert.deepEqual(routeOf(result.members[1]), childRoute);
    assert.equal(result.members[1].routeSource, 'persisted-descriptor');
    assert.equal(w.leases().opened, w.leases().disposed);
  }
});

test('own cold child of an ordinary cold fork Lead resolves exact membership', async () => {
  const w = ordinaryForkWorld();
  w.agents.clear();
  const result = await readView(w.ctx, 'child-a');
  assert.equal(result.membersError, null);
  assert.equal(result.viewer.role, 'teammate');
  assert.equal(result.viewer.rootId, w.root.id);
  assert.equal(result.viewer.memberId, 'child-a');
  assert.deepEqual(result.members.map(m => m.id), ['child-a']);
  assert.deepEqual(routeOf(result.members[0]), childRoute);
  assert.equal(result.config, null);
  assert.equal(result.effectiveDefault, null);
  assert.deepEqual(result.recent, []);
  assert.equal(w.leases().opened, w.leases().disposed);
});

test('cold ordinary fork Lead and its child do not require the original source', async () => {
  const w = ordinaryForkWorld();
  w.agents.clear();
  w.stores.delete(w.sourceId);
  for (const sessionId of [w.root.id, 'child-a']) {
    const result = await readView(w.ctx, sessionId);
    assert.equal(result.membersError, null);
    assert.equal(result.viewer.role, sessionId === w.root.id ? 'lead' : 'teammate');
    assert.equal(result.viewer.rootId, w.root.id);
    assert.deepEqual(result.members.map(m => m.id), sessionId === w.root.id ? [w.root.id, 'child-a'] : ['child-a']);
    assert.deepEqual(routeOf(result.members.at(-1)), childRoute);
    assert.equal(w.leases().opened, w.leases().disposed);
  }
});

test('inherited-only subagent descriptors do not own an ordinary cold fork', async () => {
  const w = ordinaryForkWorld(), stored = w.stores.get(w.root.id);
  w.agents.clear();
  stored.events.unshift(descriptor(leadRoute));
  stored.inheritedEventCount++;
  for (const sessionId of [w.root.id, 'child-a']) {
    const result = await readMembers(w.ctx, sessionId);
    assert.equal(result.error, null);
    assert.equal(result.viewer.role, sessionId === w.root.id ? 'lead' : 'teammate');
    assert.equal(result.viewer.rootId, w.root.id);
    assert.deepEqual(result.members.map(m => m.id), sessionId === w.root.id ? [w.root.id, 'child-a'] : ['child-a']);
    assert.equal(w.leases().opened, w.leases().disposed);
  }
});

test('exact parent membership takes precedence over missing subagent ownership metadata', async () => {
  const w = ordinaryForkWorld(), stored = w.stores.get('child-a');
  w.agents.clear();
  delete stored.header.origin;
  stored.events = [];
  const result = await readMembers(w.ctx, 'child-a');
  assert.equal(result.error, null);
  assert.equal(result.viewer.role, 'teammate');
  assert.equal(result.viewer.rootId, w.root.id);
  assert.deepEqual(result.members.map(m => m.id), ['child-a']);
  assert.equal(result.members[0].routeSource, 'unavailable');
  assert.equal(w.leases().opened, w.leases().disposed);
});

test('genuine non-Team subagents are not classified as teammates or independent Leads', async () => {
  for (const ownership of ['origin', 'descriptor', 'both']) {
    for (const cold of [false, true]) {
      const w = ordinaryForkWorld();
      if (cold) w.agents.clear();
      w.stores.set('ordinary-sub', {
        header: { id: 'ordinary-sub', parentSession: w.root.id, ...(ownership !== 'descriptor' ? { origin: 'subagent' } : {}) },
        inheritedEventCount: 0, events: ownership !== 'origin' ? [descriptor()] : []
      });
      const result = await readView(w.ctx, 'ordinary-sub');
      assert.equal(result.membersError, null);
      assert.equal(result.viewer.role, 'none');
      assert.deepEqual(result.members, []);
      assert.equal(w.leases().opened, w.leases().disposed);
    }
  }
});

test('completion survives inactivity/restart without losing own identity and route', async () => {
  const w = world(), stored = w.stores.get('child-a');
  stored.events.push({type: 'turn/start', data: {turn: 1}}, {type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}});
  const result = await readView(w.ctx, 'child-a');
  assert.equal(result.viewer.role, 'teammate');
  assert.deepEqual(routeOf(result.members[0]), childRoute);
  assert.equal(result.members[0].status, 'inactive');
  assert.equal(result.members[0].workState, 'completed');
  stored.events.push({type: 'agent/inbox/spliced', data: {inserted: [{id: 'new-work'}]}});
  assert.equal((await readView(w.ctx, 'child-a')).members[0].workState, 'pending');
  stored.events.push({type: 'turn/start', data: {turn: 2}});
  assert.notEqual((await readView(w.ctx, 'child-a')).members[0].workState, 'completed');
  stored.events.push({type: 'turn/end', data: {turn: 2, reason: {kind: 'canceled'}}});
  assert.equal((await readView(w.ctx, 'child-a')).members[0].workState, 'canceled');
});

test('teammate-scoped global mutations are refused at HTTP boundary', async () => {
  const w = world(); let handler;
  Object.assign(w.ctx, {
    inject: (_names, cb) => cb({get: w.ctx.get, logger: {info() {}, warn() {}}, effect: run => run()}),
    effect: run => run(), webRuntime: {trustedHosts: []},
    webServer: {register: route => {handler = route.handler; return () => {};}}
  });
  apply(w.ctx);
  for (const method of ['set', 'clear-recent']) {
    const req = Readable.from([Buffer.from(JSON.stringify({method, sessionId: 'child-a', config: {enabled: false}}))]);
    req.method = 'POST'; req.headers = {host: '127.0.0.1:3080', 'content-type': 'application/json'};
    let status; let body;
    await handler(req, {writeHead: s => {status = s;}, end: text => {body = JSON.parse(text);}});
    assert.equal(status, 403);
    assert.equal(body.error.code, 'teammate-read-only');
  }
});
