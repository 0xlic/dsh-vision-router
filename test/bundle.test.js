import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Minimal React sufficient for this page: createElement plus path-stable hooks
// (same-name siblings numbered per render pass) and a whole-tree rerender on
// any store notification.
function createMiniReact(rerender) {
  const hooks = new Map();
  let counters = new Map();
  let collecting = [];
  let path = '';
  const Fragment = Symbol('fragment');
  function render(element, parentPath) {
    if (element === null || element === undefined || element === false || element === true) return [];
    if (typeof element === 'string' || typeof element === 'number') return [String(element)];
    if (Array.isArray(element)) return element.flatMap(child => render(child, parentPath));
    if (typeof element.type === 'function') {
      const name = element.type.name || 'anonymous';
      const slot = `${parentPath}/${name}`;
      const own = `${slot}#${counters.get(slot) ?? 0}`;
      counters.set(slot, (counters.get(slot) ?? 0) + 1);
      const state = hooks.get(own) ?? { list: [], index: 0 };
      state.index = 0;
      hooks.set(own, state);
      const previous = path;
      path = own;
      const result = render(element.type({ ...element.props, children: element.props?.children }), own);
      path = previous;
      return result;
    }
    if (element.type === Fragment) return (element.props?.children ?? []).flatMap(child => render(child, parentPath));
    const node = { type: element.type, props: element.props ?? {} };
    node.children = (element.props?.children ?? []).flatMap(child => render(child, parentPath));
    return [node];
  }
  const React = {
    Fragment,
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState(initial) {
      const state = hooks.get(path);
      const index = state.index++;
      if (state.list[index] === undefined) state.list[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [state.list[index].value, value => { state.list[index].value = typeof value === 'function' ? value(state.list[index].value) : value; rerender(); }];
    },
    useEffect(fn, deps) {
      const state = hooks.get(path);
      const index = state.index++;
      const previous = state.list[index];
      if (previous === undefined || !deps || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i]))) {
        if (previous?.cleanup) previous.cleanup();
        // Mark the slot before the body runs so a synchronous nested render
        // cannot re-enter this effect (React relies on commit isolation here).
        state.list[index] = { deps, cleanup: undefined };
        collecting.push(() => { state.list[index] = { deps, cleanup: fn() }; });
      } else state.list[index] = previous;
    },
    useRef(initial) {
      const state = hooks.get(path);
      const index = state.index++;
      if (state.list[index] === undefined) state.list[index] = { value: initial };
      return state.list[index];
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const state = hooks.get(path);
      const index = state.index++;
      if (state.list[index] === undefined) state.list[index] = { unsubscribe: subscribe(() => rerender()) };
      return getSnapshot();
    },
  };
  return {
    React,
    renderToTree(element) {
      collecting = [];
      counters = new Map();
      const tree = render(element, '');
      const effects = collecting;
      collecting = [];
      for (const effect of effects) effect();
      return tree[0];
    },
  };
}

// Runs the built client.js in a fresh realm and resolves the plugin definition.
function loadPlugin() {
  let loaded;
  const mini = createMiniReact(() => { if (context.rerenderRoot) context.rerenderRoot(); });
  const context = {
    effect(fn) { fn(); return () => {}; },
    on(event, handler) { (context.handlers[event] ??= []).push(handler); return () => {}; },
    handlers: {},
    locale: {
      register: () => () => {},
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'zh', revision: 0 }),
      // Locale keys are opaque here; asserting on the keys themselves keeps the
      // test independent of either dictionary.
      bind: () => key => key,
    },
  };
  const sandbox = {
    window: { __ModuleLoader__: { load(def) { loaded = def; } } },
    console,
    AbortController, queueMicrotask, setTimeout, clearTimeout, structuredClone,
  };
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox);
  const definition = loaded.factory(name => name === 'react' ? mini.React : (() => { throw new Error(`unexpected require ${name}`); }));
  return { context, definition, mini };
}

function createForm() {
  let state = {
    status: 'ready', revision: 7, writable: true,
    value: { nonMultimodalModels: [], visionModels: [], timeoutMs: 60000, maxTokens: 4096 },
  };
  const listeners = new Set();
  const calls = [];
  return {
    calls,
    form: {
      getSnapshot: () => state,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      mutate(ops, revision) {
        calls.push({ ops: structuredClone(ops), revision });
        const value = { ...state.value };
        for (const op of ops) value[op.path[0]] = op.value;
        state = { ...state, value, revision: state.revision + 1 };
        for (const fn of [...listeners]) fn();
        return Promise.resolve(true);
      },
    },
  };
}

const catalog = {
  groups: [
    { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }, { id: 'gpt-4o', name: 'GPT-4o' }] },
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }, { id: 'deepseek-vl', name: 'DeepSeek VL', inputModalities: ['text', 'image'] }] },
  ],
  failures: [],
};
const flatten = node => typeof node === 'string' ? [node] : (node?.children ?? []).flatMap(flatten);
const textOf = node => flatten(node).join(' ');
const findAll = (node, pred, found = []) => {
  if (!node || typeof node !== 'object') return found;
  if (pred(node)) found.push(node);
  for (const child of node.children ?? []) if (typeof child === 'object') findAll(child, pred, found);
  return found;
};
const buttons = node => findAll(node, child => child.type === 'button');
const inputs = node => findAll(node, child => child.type === 'input');
const byLabel = (node, label) => buttons(node).find(button => (button.props['aria-label'] ?? '').includes(label));
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const keyEvent = key => ({ key, preventDefault() {}, stopPropagation() {}, nativeEvent: { isComposing: false } });

function mount(catalogValue, rpcResult) {
  const harness = loadPlugin();
  const { calls, form } = createForm();
  let rpcCalls = 0;
  harness.context.configForms = { get: () => form };
  harness.context.connection = { rpc: { call: async () => { rpcCalls++; return rpcResult ?? { ok: true, value: catalogValue }; } } };
  const captured = [];
  harness.context.slots = {
    inject: (key, callback) => { callback(); },
    register: (options, component) => { captured.push({ key: options.name, options, component }); return () => {}; },
  };
  harness.definition.apply(harness.context);
  const page = captured.find(entry => entry.key === 'settings.section');
  assert.ok(page, 'settings.section registered');
  assert.equal(captured.find(entry => entry.key === 'settings.section.icon').options.id, 'vision-router');
  assert.equal(captured.find(entry => entry.key === 'plugins.bundle.config').options.key, '@lichen/dsh-vision-router');
  const render = () => { const tree = harness.mini.renderToTree({ type: page.component, props: {} }); return tree; };
  let current;
  harness.context.rerenderRoot = () => { current = render(); };
  current = render();
  const open = listIndex => {
    const toggles = buttons(current).filter(button => textOf(button).includes('add'));
    if (!toggles[listIndex].props['aria-expanded']) toggles[listIndex].props.onClick();
    current = render();
  };
  return {
    calls,
    rpcCalls: () => rpcCalls,
    resetHandlers: harness.context.handlers['connection/reset'] ?? [],
    entries: captured,
    icon: captured.find(entry => entry.key === 'settings.section.icon'),
    bundle: captured.find(entry => entry.key === 'plugins.bundle.config'),
    page,
    get tree() { return current; },
    render,
    async add(listIndex, query, pick) {
      open(listIndex);
      await tick();
      const search = inputs(current).find(input => input.props.type === 'search');
      assert.ok(search, 'picker opened with a search input');
      search.props.onChange({ target: { value: query } });
      current = render();
      const candidates = buttons(current).filter(button => button.props.className === 'vr-option');
      assert.ok(candidates.length, `query ${JSON.stringify(query)} matched something`);
      candidates[pick ?? 0].props.onClick();
      await tick();
      current = render();
    },
    openPicker: async listIndex => { open(listIndex); await tick(); },
    searchInput: () => inputs(current).find(input => input.props.type === 'search'),
    pickerRegion: () => findAll(current, node => node.props?.className === 'vr-picker')[0],
  };
}

test('page keeps the add flow, fuzzy search, autosave, and no save or confirm buttons', async () => {
  const page = mount(catalog);
  const everyText = textOf(page.tree);
  assert.ok(everyText.includes('whitelist'));
  assert.ok(everyText.includes('fallback'));
  assert.equal(everyText.includes('save'), false, 'no save action');
  assert.equal(everyText.includes('保存'), false);
  const style = findAll(page.tree, node => node.type === 'style').map(textOf).join('');
  assert.equal(style.includes('vr-savebar'), false, 'no sticky save bar');
  assert.equal(style.includes('vr-catalog'), false, 'no full catalog browsing pane');
  assert.equal(page.bundle.component, page.page.component, 'bundle config renders the settings page itself');

  // Batch adding: the picker stays open, each pick commits on its own.
  await page.add(0, 'gpt41', 0);
  assert.deepEqual(page.calls[0].ops, [
    { op: 'set', path: ['nonMultimodalModels'], value: [{ provider: 'openai', model: 'gpt-4.1' }] },
  ], 'fuzzy subsequence gpt41 adds gpt-4.1 to the allowlist');
  assert.equal(page.calls[0].revision, 7);
  assert.ok(page.searchInput(), 'picker stays open after a pick');
  assert.ok(textOf(page.tree).includes('openai / gpt-4.1'), 'picked model appears in the list');
  await page.add(0, 'vl', 0);
  assert.deepEqual(page.calls[1].ops[0].value, [
    { provider: 'openai', model: 'gpt-4.1' },
    { provider: 'deepseek', model: 'deepseek-vl' },
  ], 'a second add works without reopening the picker');

  await page.add(1, 'deepseek', 1);
  assert.deepEqual(page.calls[2].ops[0].value, [{ provider: 'deepseek', model: 'deepseek-vl' }]);
  await page.add(1, '4o', 0);
  assert.deepEqual(page.calls[3].ops[0].value, [
    { provider: 'deepseek', model: 'deepseek-vl' },
    { provider: 'openai', model: 'gpt-4o' },
  ]);

  byLabel(page.tree, 'up gpt-4o').props.onClick();
  await tick();
  assert.deepEqual(page.calls.at(-1).ops[0].value, [
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'deepseek', model: 'deepseek-vl' },
  ], 'reorder commits immediately');

  byLabel(page.tree, 'remove gpt-4o').props.onClick();
  await tick();
  assert.deepEqual(page.calls.at(-1).ops[0].value, [{ provider: 'deepseek', model: 'deepseek-vl' }]);

  // Numbers commit on blur or Enter, never per keystroke.
  const numberInput = () => inputs(page.tree).find(input => input.props.type === 'number' && input.props.max === 300);
  const before = page.calls.length;
  numberInput().props.onFocus();
  numberInput().props.onChange({ target: { value: '9' } });
  await tick();
  assert.equal(page.calls.length, before, 'typing an intermediate digit does not write');
  numberInput().props.onChange({ target: { value: '90' } });
  numberInput().props.onBlur();
  await tick();
  assert.deepEqual(page.calls.at(-1).ops, [{ op: 'set', path: ['timeoutMs'], value: 90000 }]);
  numberInput().props.onFocus();
  numberInput().props.onChange({ target: { value: '999' } });
  numberInput().props.onBlur();
  await tick();
  assert.equal(page.calls.length, before + 1, 'out-of-range input never reaches the form');

  assert.equal(page.icon.component({ size: 20 }).type, 'svg');
});

test('keyboard semantics: empty Enter adds nothing, Escape clears before closing, pickers are exclusive', async () => {
  const page = mount(catalog);
  await page.openPicker(0);
  assert.equal(page.calls.length, 0);
  page.searchInput().props.onKeyDown(keyEvent('Enter'));
  await tick();
  assert.equal(page.calls.length, 0, 'Enter on an empty query never adds the first catalog row');

  page.searchInput().props.onChange({ target: { value: 'gpt' } });
  page.render();
  page.searchInput().props.onKeyDown(keyEvent('Escape'));
  page.render();
  assert.ok(page.searchInput(), 'picker still open after first Escape');
  assert.equal(page.searchInput().props.value, '', 'first Escape cleared the term');
  page.pickerRegion().props.onKeyDown(keyEvent('Escape'));
  page.render();
  assert.equal(page.searchInput(), undefined, 'second Escape closed the picker');

  await page.openPicker(0);
  assert.ok(page.searchInput(), 'whitelist picker open');
  await page.openPicker(1);
  assert.equal(page.tree ? findAll(page.tree, node => node.props?.className === 'vr-picker').length : 0, 1,
    'opening the vision picker closes the whitelist picker');
});

test('opening a picker refreshes the catalog, and connection reset reloads it', async () => {
  const page = mount(catalog);
  await tick();
  const initial = page.rpcCalls();
  assert.equal(initial, 1, 'page mount loads the catalog once');
  await page.openPicker(0);
  assert.equal(page.rpcCalls(), initial + 1, 'picker open forces a refresh');
  page.resetHandlers.forEach(handler => handler());
  await tick();
  assert.ok(page.rpcCalls() >= initial + 2, 'connection reset reloads while the page is open');
});

test('catalog failure surfaces an inline error with retry inside the picker', async () => {
  const page = mount({ groups: [], failures: [] }, { ok: false });
  buttons(page.tree).filter(button => textOf(button).includes('add'))[0].props.onClick();
  await tick();
  assert.ok(textOf(page.tree).includes('catalogError'));
  assert.ok(buttons(page.tree).some(button => textOf(button).includes('retry')));
  assert.equal(page.calls.length, 0, 'a failed catalog never writes settings');
});
