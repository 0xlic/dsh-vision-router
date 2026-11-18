import { basename } from 'node:path';
import { checkAbort } from './router.js';

export function sniffImageType(data) {
  const has = (offset, bytes) => bytes.every((byte, i) => data[offset + i] === byte);
  const ascii = (offset, text) => has(offset, [...text].map(char => char.charCodeAt(0)));
  if (has(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (has(0, [255, 216, 255])) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  throw new Error('Unsupported image: expected PNG, JPEG, WebP or GIF.');
}

export async function loadImage(ctx, agent, input, signal) {
  checkAbort(signal);
  if (input.startsWith('sha256:')) {
    const digest = input.slice('sha256:'.length);
    // Text-model placeholders expose an 8-hex prefix of the full ID, so a
    // shorter unambiguous prefix is accepted beside the complete digest.
    if (!/^[a-f0-9]{4,64}$/.test(digest)) throw new Error('Invalid sha256 attachment ID.');
    // Resolve only real image references visible in this session, never guess
    // metadata or probe the deployment-wide content-addressed store by ID.
    const found = new Map();
    for (const message of agent.session.deriveMessages()) {
      for (const block of message.content) {
        if (block.type !== 'image') continue;
        const candidate = block.attachment.attachmentId;
        if (candidate === input || (digest.length < 64 && candidate.startsWith(input))) {
          found.set(candidate, block.attachment);
        }
      }
    }
    if (found.size > 1) throw new Error('Attachment prefix is ambiguous; use the full sha256 ID.');
    const attachment = found.values().next().value;
    if (!attachment) throw new Error('Image attachment not found in current session messages; use its local path or attach it again.');
    const { ref } = await ctx.attachments.readImage(attachment, signal);
    checkAbort(signal);
    return ref;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || input.startsWith('data:')) {
    throw new Error('Image URLs and data URLs are not supported; use a local path or session attachment ID.');
  }
  const cwd = await ctx.workingDirectory.ensure(agent, signal);
  const target = await ctx.fs.resolve(input, { cwd, signal });
  const info = await ctx.fs.stat(target, signal);
  if (!info || info.type !== 'file') throw new Error('Image path must point to an existing regular file.');
  const limits = ctx.attachments.imageLimits;
  const cap = Math.min(limits.maxImageBytes, limits.maxMessageImageBytes);
  const data = await ctx.fs.readBytes(target, signal, cap);
  checkAbort(signal);
  const mediaType = sniffImageType(data);
  if (!limits.mediaTypes.includes(mediaType)) throw new Error('Image format is disabled by this DSH deployment.');
  // The attachment service authoritatively decodes, validates dimensions, and
  // normalizes the image; no image processing library is bundled here.
  const ref = await ctx.attachments.saveImage({ data, mediaType, name: basename(target.displayPath) });
  checkAbort(signal);
  return ref;
}
