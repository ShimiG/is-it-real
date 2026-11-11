/**
 * Builds two fixtures that mimic what Google does to Gemini images: the AI declaration sits in an
 * earlier manifest, and a later "opened, transcoded" manifest wraps it.
 *   history-parent.jpg   parentOf  ai-declared.jpg  -> must count as AI (history)
 *   history-input.jpg    inputTo   ai-declared.jpg  -> must NOT count (an input is not the image's history)
 * Signed with the public C2PA test certificate. Usage (from packages/c2pa-node):
 *   node test/fixtures/make-history-fixtures.mjs <path to es256.pub> <path to es256.pem>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { Builder, LocalSigner } from '@contentauth/c2pa-node';

const [certPath, keyPath] = process.argv.slice(2);
const signer = LocalSigner.newSigner(await readFile(certPath), await readFile(keyPath), 'es256');
const parent = await readFile(new URL('./ai-declared.jpg', import.meta.url));
const plain = await readFile(new URL('./plain.jpg', import.meta.url));
const ENHANCED = 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced';

const cases = [
  {
    name: 'history-parent.jpg',
    relationship: 'parentOf',
    source: parent,
    first: { action: 'c2pa.opened', description: 'Opened by a platform' },
  },
  {
    name: 'history-input.jpg',
    relationship: 'inputTo',
    source: plain,
    // A photo-editing step that used the AI image only as a reference: the result itself is a
    // camera photo, so its own source type is digitalCapture.
    first: {
      action: 'c2pa.created',
      description: 'Created with a reference image',
      digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
    },
  },
];

for (const { name, relationship, source, first } of cases) {
  const builder = await Builder.withJsonAsync({
    claim_generator_info: [{ name: 'IsItReal test fixtures', version: '0.2.0' }],
    title: name,
    format: 'image/jpeg',
    assertions: [
      {
        label: 'c2pa.actions.v2',
        data: {
          actions: [
            { ...first, parameters: { ingredientIds: ['ingredient-1'] } },
            { action: 'c2pa.transcoded', digitalSourceType: ENHANCED },
          ],
        },
      },
    ],
  });
  await builder.addIngredient(
    JSON.stringify({
      title: 'ai-declared.jpg',
      format: 'image/jpeg',
      relationship,
      label: 'ingredient-1',
      instance_id: 'ingredient-1',
    }),
    { buffer: parent, mimeType: 'image/jpeg' },
  );
  const output = { buffer: null };
  builder.sign(signer, { buffer: source, mimeType: 'image/jpeg' }, output);
  await writeFile(new URL(`./${name}`, import.meta.url), output.buffer);
  console.log(`wrote ${name} (${output.buffer.length} bytes)`);
}
