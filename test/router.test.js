import test from 'node:test';
import assert from 'node:assert/strict';
import { recognize, matchesModel } from '../router.js';
const models = [{ provider: 'p', model: 'first' }, { provider: 'q', model: 'second' }];
const image = { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: 'image/png', bytes: 10, width: 2, height: 2 };
const base = { models, image, prompt: '抄录', timeoutMs: 100, maxTokens: 1024, signal: new AbortController().signal, sessionId: 's' };
async function* success() { yield { type: 'text-delta', index: 0, text: '答案' }; yield { type: 'block-end', index: 0, block: { type: 'text', text: '答案' } }; yield { type: 'finish', reason: { kind: 'stop' } }; }

test('whitelist matches exact provider and model, including case', () => {
  assert.equal(matchesModel([], models[0]), false);
  assert.equal(matchesModel(models, models[0]), true);
  assert.equal(matchesModel(models, { provider: 'x', model: 'first' }), false);
  assert.equal(matchesModel(models, { provider: 'p', model: 'First' }), false);
  assert.equal(matchesModel([{ provider: 'p', model: '*' }], models[0]), false);
});
test('successful model stops chain, final blocks do not duplicate deltas', async () => {
  let calls = 0;
  const result = await recognize({ ...base, stream(options) {
    calls++; assert.equal(options.provider, 'p'); assert.equal(options.maxTokens, 1024);
    assert.deepEqual(options.messages[0].content[1], { type: 'image', attachment: image });
    assert.deepEqual(options.tools, []); assert.equal(options.sessionId, 's'); return success();
  } });
  assert.equal(calls, 1); assert.equal(result.text, '答案'); assert.equal(result.attempts.length, 1);
});
for (const mode of ['throw', 'error', 'empty', 'incomplete', 'max-tokens', 'tool-calls', 'aborted']) {
  test(`fallback on ${mode} discards partial text`, async () => {
    const calls = [];
    const result = await recognize({ ...base, stream: async function* (options) {
      calls.push(options.model);
      if (options.model === 'second') { yield* success(); return; }
      if (mode === 'throw') throw new Error('SECRET API BODY');
      if (mode !== 'empty') yield { type: 'text-delta', index: 0, text: '坏的部分输出' };
      if (mode === 'incomplete') return;
      yield { type: 'finish', reason: { kind: mode === 'empty' ? 'stop' : mode, failure: { message: 'SECRET', code: 'X' } } };
    } });
    assert.deepEqual(calls, ['first', 'second']); assert.equal(result.text, '答案'); assert.equal(result.provider, 'q');
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  });
}
test('total timeout, including stalled text after first token, advances', async () => {
  let firstSignal;
  const result = await recognize({ ...base, timeoutMs: 15, stream: async function* (options) {
    if (options.model === 'second') { yield* success(); return; }
    firstSignal = options.signal;
    yield { type: 'text-delta', index: 0, text: 'partial' };
    await new Promise(() => {});
  } });
  assert.equal(firstSignal.aborted, true); assert.equal(result.model, 'second'); assert.equal(result.attempts[0].status, 'TIMEOUT');
});
test('caller cancellation does not fall back even if adapter ignores signal', async () => {
  const controller = new AbortController(); let calls = 0; let providerSignal;
  const pending = recognize({ ...base, signal: controller.signal, stream: options => {
    calls++; providerSignal = options.signal;
    return (async function* () { await new Promise(() => {}); })();
  } });
  controller.abort(new Error('USER_CANCELLED'));
  await assert.rejects(pending, /USER_CANCELLED/); assert.equal(calls, 1); assert.equal(providerSignal.aborted, true);
});
test('pre-abort and missing model list perform no I/O', async () => {
  let calls = 0; const stream = () => { calls++; return success(); };
  await assert.rejects(recognize({ ...base, models: [], stream }), /列表为空/);
  await assert.rejects(recognize({ ...base, stream, signal: AbortSignal.abort(new Error('cancel')) }), /cancel/);
  assert.equal(calls, 0);
});
test('all failures expose only categories, never adapter message', async () => {
  await assert.rejects(recognize({ ...base, stream() { throw new Error('api_key=SECRET'); } }), error => {
    assert.match(error.message, /p\/first: MODEL_ERROR/); assert.match(error.message, /q\/second: MODEL_ERROR/);
    assert.equal(error.message.includes('SECRET'), false); return true;
  });
});
test('oversized output triggers fallback', async () => {
  const result = await recognize({ ...base, stream: async function* (options) {
    if (options.model === 'second') { yield* success(); return; }
    yield { type: 'text-delta', index: 0, text: 'x'.repeat(131073) };
  } });
  assert.equal(result.attempts[0].status, 'OUTPUT_TOO_LARGE');
});
