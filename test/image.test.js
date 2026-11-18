import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImage, sniffImageType } from '../image.js';
const id = 'sha256:' + 'a'.repeat(64);
const ref = { attachmentId: id, mediaType: 'image/png', bytes: 8, width: 2, height: 2 };
const png = Uint8Array.from([137,80,78,71,13,10,26,10]);
const signal = new AbortController().signal;
const agent = { session: { deriveMessages: () => [{ content: [{ type: 'text', text: id }, { type: 'image', attachment: ref }] }] } };
test('signature detection supports formats and refuses short/unsupported bytes', () => {
  assert.equal(sniffImageType(png), 'image/png');
  assert.equal(sniffImageType(Uint8Array.from([255,216,255])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(sniffImageType(Buffer.from('RIFF1234WEBP')), 'image/webp');
  assert.throws(() => sniffImageType(Buffer.from('RIFF')), /Unsupported/);
  assert.throws(() => sniffImageType(Buffer.from('<svg>')), /Unsupported/);
});
test('only references from current session messages can be read', async () => {
  let reads = 0;
  const ctx = { attachments: { async readImage(found, s) { reads++; assert.deepEqual(found, ref); assert.equal(s, signal); return { ref }; } } };
  assert.deepEqual(await loadImage(ctx, agent, id, signal), ref);
  await assert.rejects(loadImage(ctx, agent, 'sha256:' + 'b'.repeat(64), signal), /not found/);
  await assert.rejects(loadImage(ctx, agent, 'sha256:invalid', signal), /Invalid/);
  await assert.rejects(loadImage(ctx, agent, 'sha256:' + 'c'.repeat(3), signal), /Invalid/);
  assert.equal(reads, 1);
});
test('placeholder prefixes resolve uniquely and reject ambiguity', async () => {
  const prefix = id.slice(0, 'sha256:'.length + 8);
  const other = { ...ref, attachmentId: 'sha256:' + 'a'.repeat(55) + 'b' + '9' };
  const twoRefs = { session: { deriveMessages: () => [
    { content: [{ type: 'image', attachment: ref }] },
    { content: [{ type: 'image', attachment: other }] },
  ] } };
  let read = null;
  const ctx = { attachments: { async readImage(found) { read = found; return { ref: found }; } } };
  assert.deepEqual(await loadImage(ctx, agent, prefix, signal), ref, 'unique 8-hex placeholder prefix resolves');
  assert.deepEqual(read, ref);
  assert.deepEqual(await loadImage(ctx, agent, id, signal), ref, 'full ID still resolves');
  await assert.rejects(loadImage(ctx, twoRefs, 'sha256:' + 'a'.repeat(8), signal), /ambiguous/);
  await assert.rejects(loadImage(ctx, twoRefs, 'sha256:' + 'a'.repeat(55) + 'b' + '8', signal), /not found/);
  await assert.rejects(loadImage(ctx, { session: { deriveMessages: () => [] } }, prefix, signal), /not found/);
});
test('URLs and pre-aborted requests perform no file I/O', async () => {
  for (const url of ['https://private/image.png', 'file:///etc/passwd', 'data:image/png;base64,abc']) {
    await assert.rejects(loadImage({}, agent, url, signal), /not supported/);
  }
  await assert.rejects(loadImage({}, agent, 'a.png', AbortSignal.abort(new Error('cancel'))), /cancel/);
});
test('local files go through filesystem cap and authoritative image save', async () => {
  const ctx = {
    workingDirectory: { async ensure(a, s) { assert.equal(a, agent); assert.equal(s, signal); return '/workspace'; } },
    fs: {
      async resolve(path, options) { assert.equal(path, './image'); assert.deepEqual(options, { cwd: '/workspace', signal }); return { displayPath: '/workspace/image' }; },
      async stat() { return { type: 'file' }; },
      async readBytes(target, s, cap) { assert.equal(cap, 100); assert.equal(s, signal); return png; },
    },
    attachments: {
      imageLimits: { maxImageBytes: 200, maxMessageImageBytes: 100, mediaTypes: ['image/png'] },
      async saveImage(input) { assert.deepEqual(input, { data: png, mediaType: 'image/png', name: 'image' }); return ref; },
    },
  };
  assert.deepEqual(await loadImage(ctx, agent, './image', signal), ref);
  ctx.fs.stat = async () => ({ type: 'directory' });
  await assert.rejects(loadImage(ctx, agent, './image', signal), /regular file/);
});
