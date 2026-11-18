import test from 'node:test';
import assert from 'node:assert/strict';
import { installAdmissionBypass } from '../admission.js';

const textInfo = { provider: 'capinfo', id: 'glm-5.3', name: 'GLM 5.3', inputModalities: ['text'] };
const visionInfo = { provider: 'capinfo', id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', inputModalities: ['text', 'image'] };
const unknownInfo = { provider: 'capinfo', id: 'mystery', name: 'Mystery' };

function fakeLlm() {
  const llm = {
    async resolveModelInfo(provider, model) {
      if (model === 'glm-5.3-flash') return { ...visionInfo };
      if (model === 'mystery') return { ...unknownInfo };
      return { ...textInfo, id: model };
    },
  };
  return llm;
}
const whitelisted = (provider, model) => model === 'glm-5.3';

test('admission view widens only whitelisted text-only models', async () => {
  const llm = fakeLlm();
  const restore = installAdmissionBypass(llm, whitelisted);
  const widened = await llm.resolveModelInfo('capinfo', 'glm-5.3');
  assert.deepEqual(widened.inputModalities, ['text', 'image']);
  assert.deepEqual(widened, { ...textInfo, inputModalities: ['text', 'image'] }, 'original fields pass through');
  assert.deepEqual((await llm.resolveModelInfo('capinfo', 'other')).inputModalities, ['text'], 'non-whitelisted untouched');
  assert.deepEqual((await llm.resolveModelInfo('capinfo', 'glm-5.3-flash')).inputModalities, ['text', 'image'], 'already capable untouched');
  assert.equal((await llm.resolveModelInfo('capinfo', 'mystery')).inputModalities, undefined, 'undeclared modalities untouched');
  restore();
});

test('wrapper copies the info and never mutates adapter results', async () => {
  const llm = fakeLlm();
  const seen = [];
  llm.resolveModelInfo = async (...args) => { const info = await fakeLlm().resolveModelInfo(...args); seen.push(info); return info; };
  const restore = installAdmissionBypass(llm, whitelisted);
  await llm.resolveModelInfo('capinfo', 'glm-5.3');
  restore();
  assert.deepEqual(seen[0].inputModalities, ['text'], 'adapter result object is not modified in place');
});

test('restore puts back the original and survives later wrappers', async () => {
  const llm = fakeLlm();
  const restore = installAdmissionBypass(llm, whitelisted);
  // A second plugin chains on top of ours.
  const inner = llm.resolveModelInfo;
  let outerCalled = false;
  llm.resolveModelInfo = async (...args) => { outerCalled = true; return inner(...args); };
  restore();
  assert.deepEqual((await llm.resolveModelInfo('capinfo', 'glm-5.3')).inputModalities, ['text'],
    'our stage degrades to pass-through instead of dropping the chain');
  assert.equal(outerCalled, true, 'chained wrapper still callable after our dispose');
  llm.resolveModelInfo = fakeLlm().resolveModelInfo;
  // Direct dispose without chaining restores the previous function object.
  const restore2 = installAdmissionBypass(llm, whitelisted);
  restore2();
  assert.deepEqual((await llm.resolveModelInfo('capinfo', 'glm-5.3')).inputModalities, ['text']);
});

test('prototype-defined methods restore cleanly', async () => {
  class Llm { async resolveModelInfo(provider, model) { return { ...textInfo, id: model }; } }
  const llm = new Llm();
  const restore = installAdmissionBypass(llm, whitelisted);
  assert.equal(Object.prototype.hasOwnProperty.call(llm, 'resolveModelInfo'), true, 'own property shadows prototype');
  restore();
  assert.equal(Object.prototype.hasOwnProperty.call(llm, 'resolveModelInfo'), false, 'own property removed');
  assert.deepEqual((await llm.resolveModelInfo('capinfo', 'glm-5.3')).inputModalities, ['text']);
});

test('missing resolveModelInfo installs nothing', () => {
  const restore = installAdmissionBypass({}, whitelisted);
  restore();
});
