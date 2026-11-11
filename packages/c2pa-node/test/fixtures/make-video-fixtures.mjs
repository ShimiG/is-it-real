/**
 * Builds video fixtures from packages/video-node/test/fixtures/testsrc.mp4 (a generated test pattern):
 *   ai-declared.mp4      signed with the public C2PA test certificate, declaring trainedAlgorithmicMedia
 *   ai-declared-cut.mp4  the same file with one byte of the video data changed after signing
 * Usage (from packages/c2pa-node):
 *   node test/fixtures/make-video-fixtures.mjs <path to es256.pub> <path to es256.pem>
 */
import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { Builder, LocalSigner } from '@contentauth/c2pa-node';

const [certPath, keyPath] = process.argv.slice(2);
const signer = LocalSigner.newSigner(await readFile(certPath), await readFile(keyPath), 'es256');
const source = await readFile(
  new URL('../../../video-node/test/fixtures/testsrc.mp4', import.meta.url),
);
const builder = await Builder.withJsonAsync({
  claim_generator_info: [{ name: 'IsItReal test fixtures', version: '0.3.0' }],
  title: 'ai-declared.mp4',
  format: 'video/mp4',
  assertions: [
    {
      label: 'c2pa.actions.v2',
      data: {
        actions: [
          {
            action: 'c2pa.created',
            softwareAgent: { name: 'Test video generator' },
            digitalSourceType:
              'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
          },
        ],
      },
    },
  ],
});
const output = { buffer: null };
builder.sign(signer, { buffer: source, mimeType: 'video/mp4' }, output);
await writeFile(new URL('./ai-declared.mp4', import.meta.url), output.buffer);
console.log(`wrote ai-declared.mp4 (${output.buffer.length} bytes)`);

// Change one byte inside the video data (the last quarter of the file is picture data).
const changed = Buffer.from(output.buffer);
const at = Math.floor(changed.length * 0.9);
changed[at] = changed[at] ^ 0xff;
await writeFile(new URL('./ai-declared-cut.mp4', import.meta.url), changed);
console.log('wrote ai-declared-cut.mp4');
