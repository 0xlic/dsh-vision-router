// Run with the installed DSH Electron runtime, not an arbitrary npm SDK.
// ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" test/runtime-smoke.mjs
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
if (!process.env.DSH_INSTALL_DIR) throw new Error('DSH_INSTALL_DIR required');
const routes = new Map(['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tool-executor-native']
  .map(name => [name, pathToFileURL(require.resolve(name, { paths: [process.env.DSH_INSTALL_DIR] })).href]));
registerHooks({
  resolve(specifier, context, next) {
    if (routes.has(specifier)) return { url: routes.get(specifier), shortCircuit: true };
    return next(specifier, context);
  },
});
const { Context } = await import('@deepseek-ai/cordis');
const { ToolsService } = await import('@deepseek-ai/dsh-tools');
const { Config, apply } = await import('../index.js');
const { createScope } = await import('@deepseek-ai/dsh-scope');
const { SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt');
const { NativeToolExecutor } = await import('@deepseek-ai/dsh-tool-executor-native');
const ctx = new Context();
const systemPrompt = new SystemPrompt(ctx, {});
const tools = new ToolsService(ctx);
const nativeExecutor = new NativeToolExecutor(ctx);
tools.setExecutor(nativeExecutor);
const config = Config({
  nonMultimodalModels: [{ provider: 'text', model: 'model-a' }],
  visionModels: [{ provider: 'vision', model: 'model-b' }],
});
const signal = new AbortController().signal;
const textSelection = { provider: 'text', model: 'model-a' };
const otherSelection = { provider: 'other', model: 'model-a' };
let readCalls = 0;
const nativeRead = {
  name: 'read_image', description: 'Runtime smoke image reader',
  parameters: { type: 'object', properties: {} },
  output: { schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    render: () => [{ type: 'text', text: 'read image executed' }] },
  async execute() { readCalls += 1; return { ok: true }; },
};
tools.register(nativeRead);
const originalResolve = tools.resolve;
const originalResolveDescriptor = Object.getOwnPropertyDescriptor(ctx.tools, 'resolve');
ctx.provide('llm', {}); // No network calls are made in this registry/execution test.
const plugin = ctx.plugin({ name: 'vision-router-smoke', inject: ['tools', 'llm', 'systemPrompt'],
  apply(pluginCtx) { apply(pluginCtx, config); } });
await plugin;
const agent = { id: 'runtime-smoke' };
const agentScope = createScope(ctx, agent);
agent.ctx = agentScope.ctx;
// Presets can own the native tool in the SAME layer as the agent. Filtering
// the admitted set must neither re-register nor collide with this definition.
const localRead = { ...nativeRead, description: 'Agent-preset-local image reader' };
agent.ctx.tools.register(localRead);
const otherAgent = { id: 'runtime-other' };
const otherScope = createScope(ctx, otherAgent);
otherAgent.ctx = otherScope.ctx;
const childAgent = { id: 'runtime-child' };
const childScope = createScope(ctx, childAgent, { parent: agent });
childAgent.ctx = childScope.ctx;
const resolve = (owner, modelSelection) => owner.ctx.tools.resolve({ agent: owner, signal, modelSelection });
const names = (owner, set) => tools.schemas(owner, set).map(tool => tool.name);
const instructions = async (owner, set, modelSelection) => {
  const assembly = await systemPrompt.assemble({ scope: owner, signal, toolSet: set, modelSelection });
  assert.deepEqual(assembly.tools.map(tool => tool.name).sort(), names(owner, set).sort(),
    'real prompt tool schemas agree with the admitted executable set');
  return assembly.sections.find(section => section.name === 'vision-router:recognition')?.text ?? '';
};
try {
  const denied = await resolve(agent, otherSelection);
  assert.equal(names(agent, denied).includes('vision_read'), false);
  assert.equal(tools.executable('vision_read', agent, denied), undefined);
  assert.equal(tools.executable('read_image', agent, denied), localRead);
  assert.equal(await instructions(agent, denied, otherSelection), '');
  denied.dispose();

  const admitted = await resolve(agent, textSelection);
  const definition = tools.executable('vision_read', agent, admitted);
  assert.ok(definition);
  assert.equal(names(agent, admitted).includes('vision_read'), true);
  assert.equal(names(agent, admitted).includes('read_image'), false);
  assert.equal(tools.executable('read_image', agent, admitted), undefined);
  assert.equal(tools.get('read_image', agent), localRead, 'raw preset registration stays intact');
  assert.match(await instructions(agent, admitted, textSelection), /Use vision_read directly/);
  assert.equal(await instructions(otherAgent, admitted, textSelection), '', 'step admission cannot leak scope');
  await assert.rejects(definition.execute({}, { agent, signal }), /image must/);

  const callRead = (owner, toolSet) => nativeExecutor.execute({
    agent: owner, toolSet, signal,
    calls: [{ type: 'tool-call', id: 'smoke-read', name: 'read_image', arguments: {} }],
  });
  const blocked = await callRead(agent, admitted);
  assert.equal(readCalls, 0, 'real NativeToolExecutor must not dispatch hidden body');
  assert.equal(blocked.results.length, 1);
  assert.equal(blocked.results[0].result.isError, true);
  assert.equal(blocked.results[0].result.error?.info?.code, 'UNKNOWN_TOOL');

  const switched = await resolve(agent, otherSelection);
  assert.equal(tools.executable('read_image', agent, switched), localRead, 'same-agent model switch restores read_image');
  assert.equal(await instructions(agent, switched, otherSelection), '');
  const allowed = await callRead(agent, switched);
  assert.equal(allowed.results[0].result.isError, false);
  assert.equal(readCalls, 1, 'real executor permits the unlisted step');
  assert.equal(names(agent, admitted).includes('read_image'), false, 'old whitelist step remains frozen');

  const other = await resolve(otherAgent, otherSelection);
  assert.equal(tools.executable('read_image', otherAgent, other), nativeRead);
  const child = await resolve(childAgent, otherSelection);
  assert.equal(tools.executable('read_image', childAgent, child), localRead, 'child scope retains inherited preset reader');
  assert.equal(await instructions(childAgent, child, otherSelection), '');
  const childText = await resolve(childAgent, textSelection);
  assert.equal(names(childAgent, childText).includes('read_image'), false);
  assert.match(await instructions(childAgent, childText, textSelection), /vision_read/);
  assert.equal(names(otherAgent, other).includes('read_image'), true, 'independent agent remains unaffected');

  // A nearer plugin replacing vision_read must not trigger this plugin's policy.
  const replacement = { ...nativeRead, name: 'vision_read' };
  const unshadow = otherAgent.ctx.tools.register(replacement);
  const shadowed = await resolve(otherAgent, textSelection);
  assert.equal(tools.executable('vision_read', otherAgent, shadowed), replacement);
  assert.equal(names(otherAgent, shadowed).includes('read_image'), true);
  assert.equal(await instructions(otherAgent, shadowed, textSelection), '');
  shadowed.dispose();
  unshadow();

  const removeRestriction = otherAgent.ctx.tools.restrict({ deny: ['vision_read'] });
  const restricted = await resolve(otherAgent, textSelection);
  assert.equal(names(otherAgent, restricted).includes('vision_read'), false);
  assert.equal(names(otherAgent, restricted).includes('read_image'), true, 'existing restrictions are not bypassed');
  assert.equal(await instructions(otherAgent, restricted, textSelection), '');
  restricted.dispose();
  removeRestriction();

  // A complete third-party system prompt can intentionally suppress sections;
  // tool admission must still prevent read_image even without our extra text.
  const removeComplete = systemPrompt.section({ name: 'smoke:complete', order: 1,
    complete: true, text: 'Third-party complete prompt.' });
  const completeAssembly = await systemPrompt.assemble({ scope: agent, signal, toolSet: admitted, modelSelection: textSelection });
  assert.deepEqual(completeAssembly.sections.map(section => section.name), ['smoke:complete']);
  assert.equal(completeAssembly.tools.some(tool => tool.name === 'read_image'), false);
  removeComplete();

  // Only unregister this plugin, keeping services/preset tools alive.
  await plugin.dispose();
  while (plugin.inertia !== undefined) await plugin.inertia;
  assert.equal(tools.resolve, originalResolve, 'unload restores raw public resolver');
  assert.deepEqual(Object.getOwnPropertyDescriptor(agent.ctx.tools, 'resolve'), originalResolveDescriptor,
    'unload restores the own descriptor observed through a traced agent service');
  const afterUnload = await resolve(agent, textSelection);
  assert.equal(tools.executable('read_image', agent, afterUnload), localRead);
  assert.equal(names(agent, afterUnload).includes('vision_read'), false);
  assert.equal(await instructions(agent, afterUnload, textSelection), '');
  assert.equal(names(agent, admitted).includes('read_image'), false, 'unload cannot reopen old filtered step');
  assert.equal(tools.executable('vision_read', agent, admitted), undefined, 'removed tool invalidates old step admission');
  for (const set of [admitted, switched, other, child, childText, afterUnload]) set.dispose();
  assert.equal(admitted.view(agent).size, 0, 'dispose delegates to real step lifetime');
  assert.equal(tools.executable('vision_read', agent), undefined);
  assert.throws(() => Config({ timeoutMs: 500 }));
  assert.throws(() => Config({ maxTokens: 1.5 }));
  assert.throws(() => Config({ nonMultimodalModels: [{ provider: ' ', model: 'x' }] }));
  console.log('Installed DSH smoke passed: real registry, scopes, prompt assembly, NativeToolExecutor denial, model switches, identity isolation and unload.');
} finally {
  await ctx.fiber.dispose();
}

// Regression: the real Gateway interceptor already occupies /api. The catalog
// must use the exact Fetch-route path, and preserve browser RPC framing.
const { HostConnectionService } = await import('@deepseek-ai/dsh-client-connection');const { installCatalogEndpoint } = await import('../catalog.js');
const endpointCtx = new Context();
try {
  const connection = new HostConnectionService(endpointCtx, [], {});
  endpointCtx.provide('llm', {
    listProviders: () => [{ id: 'raw-provider', name: 'Raw provider' }],
    listModels: async () => [{ id: 'hidden-model', name: 'Unfiltered model' }],
  });
  connection.rpc.intercept('/api', endpoint => endpoint === 'gateway/ping', async () => ({ ok: true, value: 'gateway alive' }));
  assert.throws(() => connection.rpc.intercept('/api', () => true, async () => ({ ok: true, value: null })), /already has an interceptor/);
  installCatalogEndpoint(endpointCtx);
  const shared = connection.createSharedFetchHandler('/api');
  const call = async method => shared.fetch(new Request(`http://runtime-test/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'regression-id', method, payload: {} }),
  }), connection.browserPeer);
  const response = await call('vision-router/catalog');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    type: 'server-response', rpcId: 'regression-id', result: { ok: true, value: {
      groups: [{ id: 'raw-provider', name: 'Raw provider', models: [{ id: 'hidden-model', name: 'Unfiltered model' }] }], failures: [],
    } },
  });
  const gateway = await call('gateway/ping');
  assert.equal((await gateway.json()).result.value, 'gateway alive');
  console.log('Real Connection regression passed: catalog returns models while Gateway retains its /api interceptor.');
} finally {
  await endpointCtx.fiber.dispose();
}

// Admission bypass against the real LlmRuntime: the public resolveModelInfo
// (used by prompt admission) sees image support for whitelisted text-only
// models, while prepareCall — the dispatch path — still sees declared values.
const { LlmRuntime, LlmAdapter } = await import('@deepseek-ai/dsh-llm');
const { installAdmissionBypass } = await import('../admission.js');
const llmCtx = new Context();
try {
  const llm = new LlmRuntime(llmCtx);
  class StubAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model, inputModalities: ['text'] }; }
    stream() { return (async function* () {})(); }
  }
  llm.registerAdapter(['stub-route'], new StubAdapter());
  const restore = installAdmissionBypass(llm, (_provider, model) => model === 'text-model');
  const admission = await llm.resolveModelInfo('stub-route', 'text-model');
  assert.deepEqual(admission.inputModalities, ['text', 'image'], 'admission view widened');
  const prepared = await llm.prepareCall({ provider: 'stub-route', model: 'text-model' });
  assert.deepEqual(prepared.inputModalities, ['text'], 'dispatch path still sees declared text-only modalities');
  restore();
  assert.deepEqual((await llm.resolveModelInfo('stub-route', 'text-model')).inputModalities, ['text'], 'restore returns declared values');
  console.log('Real LlmRuntime regression passed: admission view widened for whitelisted models while dispatch keeps declared modalities.');
} finally {
  await llmCtx.fiber.dispose();
}
