import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDir } from '../src/load.js';

describe('dataDir', () => {
  it('prefers ISITREAL_DATA, then the plugin data folder', () => {
    expect(dataDir({ ISITREAL_DATA: '/a', CLAUDE_PLUGIN_DATA: '/b' })).toBe('/a');
    expect(dataDir({ CLAUDE_PLUGIN_DATA: '/b' })).toBe('/b');
  });

  it('ignores placeholders that were not filled in, and relative paths', () => {
    expect(dataDir({ ISITREAL_DATA: '${CLAUDE_PLUGIN_DATA}', CLAUDE_PLUGIN_DATA: '/b' })).toBe(
      '/b',
    );
    expect(dataDir({ ISITREAL_DATA: 'relative/dir' })).toBe(join(homedir(), '.is-it-real'));
    expect(dataDir({})).toBe(join(homedir(), '.is-it-real'));
  });
});
