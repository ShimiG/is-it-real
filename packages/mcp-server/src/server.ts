import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ENGINE_VERSION } from '@isitreal/core';
import { z } from 'zod';
import { dataDir, lazyC2pa, lazyImageCheck, loadLanguageModel, type LoadSettings } from './load.js';
import {
  MAX_IMAGES,
  checkImageTool,
  checkPageTool,
  checkTextTool,
  type Capabilities,
} from './tools.js';

export const SERVER_NAME = 'is-it-real';
export const SERVER_VERSION = '0.3.0';

const link = z.object({ text: z.string().max(500), href: z.string().max(4000) });
const labels = z
  .array(z.string().max(200))
  .max(50)
  .optional()
  .describe(
    'Short texts shown right next to the item (badges, captions, alt text), e.g. "AI info".',
  );
const imageRef = z.object({
  url: z
    .string()
    .max(100_000)
    .optional()
    .describe('Image address as used on the page (http, https or data:image).'),
  path: z
    .string()
    .max(4000)
    .optional()
    .describe('Full path of a local image file, e.g. a saved screenshot.'),
  nearby_labels: labels,
});

const json = (result: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 1) }],
});

const REPORT_RULE =
  'Results come from fixed rules and measurements, not from an AI opinion: report them as given, scam warnings first, and never call content real, human or safe.';

export function createServer(caps: Capabilities): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'check_page',
    {
      title: 'Check a web page',
      description:
        'Checks the page the user is looking at: scam warning signs in its text and links, whether the text shows signs of AI writing, ' +
        `whether its images (up to ${MAX_IMAGES}) carry AI labels or Content Credentials, and AI labels the site itself shows. ` +
        "Everything runs on this computer; only the page's own images are downloaded. " +
        REPORT_RULE,
      inputSchema: {
        page_url: z.string().max(4000).optional().describe('Address of the page.'),
        text: z
          .string()
          .max(200_000)
          .optional()
          .describe('The main visible text of the page or message.'),
        links: z
          .array(link)
          .max(300)
          .optional()
          .describe('Links on the page: visible text and real destination.'),
        images: z
          .array(imageRef)
          .max(50)
          .optional()
          .describe('Main images on the page, largest first.'),
        page_labels: labels,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => json(await checkPageTool(args, caps)),
  );

  server.registerTool(
    'check_text',
    {
      title: 'Check a message or text',
      description:
        'Checks a message, email or any text for scam warning signs and for signs of AI writing (needs about 110 words or more for the AI check). ' +
        REPORT_RULE,
      inputSchema: {
        text: z.string().min(1).max(200_000),
        page_url: z.string().max(4000).optional().describe('Where the text was found, if known.'),
        links: z.array(link).max(300).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => json(await checkTextTool(args, caps)),
  );

  server.registerTool(
    'check_image',
    {
      title: 'Check an image',
      description:
        'Checks one image for AI labels: Content Credentials (signed records from the maker), file metadata, and an AI label shown next to it. ' +
        'Give the original image link or file: a screenshot or a re-shared copy has usually lost these labels. ' +
        REPORT_RULE,
      inputSchema: {
        url: imageRef.shape.url,
        path: imageRef.shape.path,
        nearby_labels: labels,
        page_url: z
          .string()
          .max(4000)
          .optional()
          .describe("Page the image is on, so the site's own AI labels can be recognised."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => json(await checkImageTool(args, caps)),
  );

  return server;
}

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): LoadSettings {
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    dataDir: dataDir(env),
    trustDir: env['ISITREAL_TRUST_DIR'] ?? join(here, 'trust'),
    autoInstall: env['ISITREAL_NO_INSTALL'] !== '1',
    gpt2ModelPath: env['ISITREAL_GPT2_MODEL'],
    c2paFrom: env['ISITREAL_C2PA_FROM'],
    imageModel: env['ISITREAL_NO_IMAGE_MODEL'] !== '1',
    nativeFrom: env['ISITREAL_NATIVE_FROM'],
    imageModelPath: env['ISITREAL_IMAGE_MODEL_PATH'],
    gateModelPath: env['ISITREAL_GATE_MODEL_PATH'],
  };
}

export async function main(): Promise<void> {
  const settings = settingsFromEnv();
  const caps: Capabilities = {
    c2pa: lazyC2pa(settings),
    lm: await loadLanguageModel(settings),
    imageCheck: lazyImageCheck(settings),
    ...(process.env['ISITREAL_ALLOW_PRIVATE_NETWORK'] === '1'
      ? { media: { allowPrivateNetwork: true } }
      : {}),
  };
  // Start installing Content Credentials support in the background, so the first image check is quick.
  void caps.c2pa();
  void caps.imageCheck?.();
  await createServer(caps).connect(new StdioServerTransport());
  process.stderr.write(`[is-it-real] server ${SERVER_VERSION} (engine ${ENGINE_VERSION}) ready\n`);
}
