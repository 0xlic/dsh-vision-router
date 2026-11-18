import test from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog, installCatalogEndpoint } from '../catalog.js';

test('full catalog reads raw LLM providers, independent of native model scope', async () => {
  const calls = [];
  const llm = {
    listProviders: () => [{ id: 'codex-first', name: 'Codex first' }, { id: 'codex-second', name: 'Codex second' }, { id: 'api', name: 'API' }],
    async listModels(provider) {
      calls.push(provider);
      return [{ id: 'hidden-by-scope', name: 'Hidden model', inputModalities: ['text', 'image'], secret: 'never forward' }, { id: 'hidden-by-scope', name: 'duplicate' }];
    },
  };
  const result = await readCatalog(llm, new AbortController().signal);
  assert.deepEqual(calls, ['codex-first', 'codex-second', 'api']);
  assert.equal(result.groups.length, 3);
  assert.deepEqual(result.groups[0], { id: 'codex-first', name: 'Codex first', models: [{ id: 'hidden-by-scope', name: 'Hidden model', inputModalities: ['text', 'image'] }] });
  assert.deepEqual(result.failures, []);
  assert.equal(JSON.stringify(result).includes('never forward'), false);
});

test('provider failure is partial and raw error text is redacted', async () => {
  const result = await readCatalog({
    listProviders: () => [{ id: 'good', name: 'Good' }, { id: 'bad', name: 'Bad' }],
    async listModels(provider) { if (provider === 'bad') throw new Error('api_key=SECRET'); return [{ id: 'm', name: 'Model' }]; },
  });
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.failures, [{ id: 'bad', name: 'Bad' }]);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('provider timeout returns other providers without waiting forever', async () => {
  const result = await readCatalog({
    listProviders: () => [{ id: 'slow', name: 'Slow' }, { id: 'fast', name: 'Fast' }],
    listModels: provider => provider === 'slow' ? new Promise(() => {}) : Promise.resolve([]),
  }, undefined, 10);
  assert.deepEqual(result.failures, [{ id: 'slow', name: 'Slow' }]);
  assert.deepEqual(result.groups, [{ id: 'fast', name: 'Fast', models: [] }]);
});

test('cancellation rejects instead of returning a false missing-model catalog', async () => {
  const controller = new AbortController();
  const pending = readCatalog({
    listProviders: () => [{ id: 'slow', name: 'Slow' }],
    listModels: () => new Promise(() => {}),
  }, controller.signal);
  controller.abort(new Error('CANCEL'));
  await assert.rejects(pending, /CANCEL/);
});

test('empty registry works and pre-cancel does no I/O', async () => {
  assert.deepEqual(await readCatalog({ listProviders: () => [] }), { groups: [], failures: [] });
  await assert.rejects(readCatalog({}, AbortSignal.abort(new Error('CANCEL'))), /CANCEL/);
});

test('catalog refresh reflects new registrations without altering configuration', async () => {
  let providers = [{ id: 'p', name: 'P' }];
  const llm = { listProviders: () => providers, listModels: async provider => [{ id: `${provider}-model` }] };
  assert.equal((await readCatalog(llm)).groups.length, 1);
  providers = [...providers, { id: 'new-account', name: 'New account' }];
  const result = await readCatalog(llm);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[1].models[0].name, 'new-account-model');
});

test('exact Fetch route preserves RPC envelope without claiming the Gateway interceptor', async () => {
  let route, disposed = false;
  const cleanups = [];
  const ctx = {
    effect(fn) { cleanups.push(fn()); },
    connection: {
      rpc: { intercept() { throw new Error('Gateway owns the interceptor'); } },
      fetch: { register(value) { route = value; return () => { disposed = true; }; } },
    },
    llm: { listProviders: () => [] },
  };
  installCatalogEndpoint(ctx);
  assert.equal(route.path, '/api/vision-router/catalog');
  assert.deepEqual(route.methods, ['POST']);
  const request = payload => new Request('http://localhost' + route.path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'test-correlation', method: 'vision-router/catalog', payload }) });
  const response = await route.fetch(request({}));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { type: 'server-response', rpcId: 'test-correlation', result: { ok: true, value: { groups: [], failures: [] } } });
  for (const payload of [null, [], { settings: {} }]) assert.equal((await (await route.fetch(request(payload))).json()).result.ok, false);
  assert.equal((await route.fetch(new Request('http://localhost' + route.path, { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await route.fetch(new Request('http://localhost' + route.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' }))).status, 400);
  assert.equal((await route.fetch(new Request('http://localhost' + route.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 400);
  cleanups.forEach(fn => fn()); assert.equal(disposed, true);
});
