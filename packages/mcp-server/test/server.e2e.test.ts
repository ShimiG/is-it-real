import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as createHttp, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the BUILT plugin server (plugin/server/server.mjs) the way Claude Code does: as a child
 * process speaking MCP over stdio. Content Credentials support is loaded from the workspace
 * instead of being installed, and private addresses are allowed for the local test web server.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const fixtures = join(root, 'packages', 'c2pa-node', 'test', 'fixtures');

let client: Client;
let http: Server;
let base = '';

const call = async (name: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
  };
  return JSON.parse(res.content[0]!.text) as {
    summary: string[];
    scam: { risk: string } | null;
    items: {
      kind: string;
      outcome: string;
      reasons: { code: string }[];
      evidence?: Record<string, unknown>;
    }[];
    checks_available: Record<string, boolean>;
  };
};

beforeAll(async () => {
  const built = spawnSync(process.execPath, [join(here, '..', 'build.mjs')], { encoding: 'utf8' });
  if (built.status !== 0) throw new Error(built.stderr);
  http = createHttp(async (req, res) => {
    const name = (req.url ?? '').slice(1);
    let body: Buffer;
    try {
      body = await readFile(join(fixtures, name));
    } catch {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        'content-type': name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
      })
      .end(body);
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  client = new Client({ name: 'is-it-real-test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'plugin', 'server', 'server.mjs')],
      env: {
        ...(process.env as Record<string, string>),
        ISITREAL_DATA: mkdtempSync(join(tmpdir(), 'isitreal-')),
        ISITREAL_NO_INSTALL: '1',
        ISITREAL_C2PA_FROM: join(root, 'packages', 'c2pa-node'),
        ISITREAL_ALLOW_PRIVATE_NETWORK: '1',
        // Picture check: libraries from the workspace, and tiny stand-in models instead of the real ones.
        ISITREAL_NATIVE_FROM: join(root, 'packages', 'image-node'),
        ISITREAL_IMAGE_MODEL_PATH: join(
          root,
          'packages',
          'image-node',
          'test',
          'fixtures',
          'standin-classifier.onnx',
        ),
        // Video frames: the packaged ffmpeg from the workspace.
        ISITREAL_FFMPEG: createRequire(join(root, 'packages', 'video-node', 'package.json'))(
          'ffmpeg-static',
        ) as string,
        ISITREAL_GATE_MODEL_PATH: join(
          root,
          'packages',
          'image-node',
          'test',
          'fixtures',
          'standin-gate.onnx',
        ),
      },
      stderr: 'ignore',
    }),
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
  http?.close();
});

describe('plugin MCP server (built bundle, stdio)', () => {
  it('offers the four tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_image',
      'check_page',
      'check_text',
      'check_video',
    ]);
    for (const t of tools) expect(t.description).toMatch(/never call content real, human or safe/);
  });

  it('checks a page end to end: scam text, a signed AI image by URL, a local file, a platform label', async () => {
    const r = await call('check_page', {
      page_url: 'https://www.facebook.com/some.post',
      text: 'Your account is locked. Pay the release fee with Google Play gift cards today and do not tell anyone.',
      images: [
        { url: `${base}/history-parent.jpg` },
        { path: join(fixtures, 'plain.jpg') },
        { url: `${base}/missing.jpg`, nearby_labels: ['AI info'] },
      ],
    });
    expect(r.scam?.risk).toBe('high');
    expect(r.checks_available).toMatchObject({
      content_credentials: true,
      picture_model: true,
      deep_text_check: false,
    });
    expect(r.items.map((i) => `${i.kind}:${i.outcome}`)).toEqual([
      'text:not_assessed',
      'image:verified_ai',
      'image:no_clear_signs',
      'image:verified_ai',
    ]);
    expect(r.items[1]!.reasons.map((x) => x.code)).toEqual([
      'c2pa_history_declares_ai',
      'c2pa_signer_unrecognised',
    ]);
    expect(r.items[3]!.reasons.map((x) => x.code)).toEqual(['platform_label_ai']);
  }, 30_000);

  it('checks a signed AI video by link and an unsigned local one', async () => {
    const signed = await call('check_video', { url: `${base}/ai-declared.mp4` });
    expect(signed.items[0]).toMatchObject({ kind: 'video', outcome: 'verified_ai' });
    expect(signed.items[0]!.reasons.map((x) => x.code)).toEqual([
      'c2pa_declares_ai',
      'c2pa_signer_unrecognised',
    ]);
    const changed = await call('check_video', { url: `${base}/ai-declared-cut.mp4` });
    expect(changed.items[0]!.reasons.map((x) => x.code)).toContain('c2pa_invalid_signature');
    expect(changed.items[0]!.outcome).not.toBe('verified_ai');
    const plain = await call('check_video', {
      path: join(root, 'packages', 'video-node', 'test', 'fixtures', 'testsrc.mp4'),
    });
    // The frame check is calibrated and on: frames are really read with the packaged ffmpeg and
    // scored (here by the tiny stand-in models).
    expect(plain.checks_available.video_frames).toBe(true);
    expect(plain.items[0]).toMatchObject({
      kind: 'video',
      outcome: 'no_clear_signs',
      evidence: { frames: 6, framesChecked: 6 },
    });
    // A broken signature stays in the answer even though the frames were then checked.
    expect(changed.items[0]!.evidence).toMatchObject({ state: 'invalid', framesChecked: 6 });
    const stream = await call('check_video', { url: 'blob:https://example.com/1' });
    expect(stream.items[0]).toMatchObject({ kind: 'video', outcome: 'not_assessed' });
  }, 60_000);

  it('rejects bad input instead of guessing', async () => {
    const res = (await client.callTool({ name: 'check_text', arguments: { text: '' } })) as {
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
  });
});
