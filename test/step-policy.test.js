import test from 'node:test';
import assert from 'node:assert/strict';
import { installToolSelection, routingInstructions, VISION_ROUTING_INSTRUCTIONS } from '../step-policy.js';

const visionTool = { name: 'vision_read' };
const readImage = { name: 'read_image' };
const other = { name: 'read' };

function fixture() {
  const agent = {};
  let live = new Map([['vision_read', visionTool], ['read_image', readImage], ['read', other]]);
  let last;
  const tools = {
    async resolve(context) {
      assert.equal(this, tools, 'original receiver preserved');
      context.signal?.throwIfAborted();
      let closed = false;
      last = {
        dispose() { assert.equal(this, last); closed = true; },
        view(scope) { assert.equal(this, last); return scope === agent && !closed ? new Map(live) : new Map(); },
      };
      return last;
    },
  };
  return { tools, agent, last: () => last, setLive: value => { live = new Map(value); } };
}

test('admitted vision_read hides read_image without mutating the original set', async () => {
  const f = fixture();
  const restore = installToolSelection(f.tools, visionTool);
  const selected = await f.tools.resolve({ agent: f.agent });
  assert.deepEqual([...selected.view(f.agent).keys()], ['vision_read', 'read']);
  assert.equal(f.last().view(f.agent).get('read_image'), readImage);
  assert.equal(selected.view({}).size, 0, 'never exposes another scope');
  assert.equal(routingInstructions({ scope: f.agent, toolSet: selected }, visionTool), VISION_ROUTING_INSTRUCTIONS);
  selected.dispose();
  assert.equal(selected.view(f.agent).size, 0);
  restore();
});

test('nonmatching steps and foreign vision_read tools are left untouched', async () => {
  const f = fixture();
  const restore = installToolSelection(f.tools, visionTool);
  for (const vision of [undefined, { name: 'vision_read' }]) {
    f.setLive([['read_image', readImage], ...(vision ? [['vision_read', vision]] : [])]);
    const selected = await f.tools.resolve({ agent: f.agent });
    assert.equal(selected, f.last());
    assert.equal(selected.view(f.agent).get('read_image'), readImage);
    assert.equal(routingInstructions({ scope: f.agent, toolSet: selected }, visionTool), '');
  }
  restore();
});

test('the wrapper re-reads the underlying view so removed tools stay removed', async () => {
  const f = fixture();
  const restore = installToolSelection(f.tools, visionTool);
  const selected = await f.tools.resolve({ agent: f.agent });
  f.setLive([['read_image', readImage]]);
  assert.equal(selected.view(f.agent).size, 0);
  assert.equal(routingInstructions({ scope: f.agent, toolSet: selected }, visionTool), '');
  restore();
});

test('unload restores future steps without re-enabling read_image in an admitted step', async () => {
  const f = fixture();
  const original = f.tools.resolve;
  const restore = installToolSelection(f.tools, visionTool);
  const selected = await f.tools.resolve({ agent: f.agent });
  restore();
  assert.equal(f.tools.resolve, original);
  assert.equal(selected.view(f.agent).has('read_image'), false);
  const later = await f.tools.resolve({ agent: f.agent });
  assert.equal(later.view(f.agent).get('read_image'), readImage);
});

test('unload preserves later wrappers and makes this layer pass through', async () => {
  const f = fixture();
  const restore = installToolSelection(f.tools, visionTool);
  const wrapped = f.tools.resolve;
  const later = async function (...args) { return wrapped.apply(this, args); };
  f.tools.resolve = later;
  restore();
  assert.equal(f.tools.resolve, later);
  const selected = await f.tools.resolve({ agent: f.agent });
  assert.equal(selected, f.last());
});

test('prototype methods are restored without an own property', () => {
  const original = async () => {};
  const tools = Object.create({ resolve: original });
  const restore = installToolSelection(tools, visionTool);
  assert.equal(Object.hasOwn(tools, 'resolve'), true);
  restore();
  assert.equal(Object.hasOwn(tools, 'resolve'), false);
  assert.equal(tools.resolve, original);
});

test('Cordis-style traced method getters still restore the raw descriptor', () => {
  const original = async () => {};
  for (const own of [true, false]) {
    const target = own ? { resolve: original } : Object.create({ resolve: original });
    const before = Object.getOwnPropertyDescriptor(target, 'resolve');
    const tools = new Proxy(target, {
      get(object, key, receiver) {
        const value = Reflect.get(object, key, receiver);
        return typeof value === 'function' ? new Proxy(value, {}) : value;
      },
    });
    const restore = installToolSelection(tools, visionTool);
    assert.notEqual(tools.resolve, tools.resolve, 'each method read gets a fresh tracing proxy');
    restore();
    assert.deepEqual(Object.getOwnPropertyDescriptor(target, 'resolve'), before);
    assert.equal(target.resolve, original);
  }
});

test('in-flight resolution that finishes after unload is left untouched', async () => {
  let release;
  const selected = { view: () => new Map([['vision_read', visionTool], ['read_image', readImage]]), dispose() {} };
  const tools = { resolve: () => new Promise(resolve => { release = resolve; }) };
  const restore = installToolSelection(tools, visionTool);
  const pending = tools.resolve({ agent: {} });
  restore();
  release(selected);
  assert.equal(await pending, selected);
});

test('cancellation and resolution errors propagate unchanged', async () => {
  const f = fixture();
  const restore = installToolSelection(f.tools, visionTool);
  const controller = new AbortController();
  const reason = new Error('cancelled');
  controller.abort(reason);
  await assert.rejects(f.tools.resolve({ agent: f.agent, signal: controller.signal }), error => error === reason);
  restore();
  const failure = new Error('activation failed');
  const tools = { async resolve() { throw failure; } };
  const restoreFailure = installToolSelection(tools, visionTool);
  await assert.rejects(tools.resolve({ agent: {} }), error => error === failure);
  restoreFailure();
});

test('instructions require an admitted step and apply only to its scope', async () => {
  const f = fixture();
  const restore = installToolSelection(f.tools, visionTool);
  const selected = await f.tools.resolve({ agent: f.agent });
  assert.equal(routingInstructions({}, visionTool), '');
  assert.equal(routingInstructions({ scope: {}, toolSet: selected }, visionTool), '');
  assert.match(routingInstructions({ scope: f.agent, toolSet: selected }, visionTool), /Use vision_read directly/);
  assert.match(VISION_ROUTING_INSTRUCTIONS, /Do not call read_image first/);
  assert.match(VISION_ROUTING_INSTRUCTIONS, /sha256:/);
  restore();
});
