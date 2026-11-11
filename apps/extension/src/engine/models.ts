import type { ModelsState } from '../messages.js';

/**
 * The two model files of the picture check, kept in the extension's own private storage.
 * They are downloaded once, when the person asks for it, from the authors' pinned versions, and
 * used only after their SHA-256 checksum matches. After that the picture check needs no network.
 */
export interface ModelFile {
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}

const FOLDER = 'models';

async function folder(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(FOLDER, { create: true });
}

async function stored(spec: ModelFile): Promise<File | null> {
  try {
    const file = await (await (await folder()).getFileHandle(spec.file)).getFile();
    return file.size === spec.bytes ? file : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class ModelStore {
  private installing: Promise<void> | null = null;
  private progress: ModelsState = { state: 'absent' };

  constructor(private readonly files: readonly ModelFile[]) {}

  async state(): Promise<ModelsState> {
    if (this.installing !== null || this.progress.state === 'failed') return this.progress;
    for (const spec of this.files) if ((await stored(spec)) === null) return { state: 'absent' };
    return { state: 'ready' };
  }

  /** The file's bytes, or null when it has not been downloaded. */
  async read(spec: ModelFile): Promise<Uint8Array<ArrayBuffer> | null> {
    const file = await stored(spec);
    return file === null ? null : new Uint8Array(await file.arrayBuffer());
  }

  /**
   * Downloads what is missing. Safe to call twice: the second call joins the first.
   * @param baseUrl Developers and tests: fetch the files from this folder instead of the authors'
   * pages. The checksum is checked all the same, so only the genuine files are accepted.
   */
  install(onChange: (state: ModelsState) => void, baseUrl?: string): Promise<void> {
    this.installing ??= this.run(onChange, baseUrl).finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  private async run(onChange: (state: ModelsState) => void, base?: string): Promise<void> {
    const total = this.files.reduce((sum, f) => sum + f.bytes, 0);
    let done = 0;
    const report = (state: ModelsState) => {
      this.progress = state;
      onChange(state);
    };
    try {
      report({ state: 'downloading', done, total });
      // Ask the browser not to clear this storage when disk space runs low.
      void navigator.storage.persist?.();
      const dir = await folder();
      for (const spec of this.files) {
        if ((await stored(spec)) !== null) {
          done += spec.bytes;
          report({ state: 'downloading', done, total });
          continue;
        }
        const url = base === undefined ? spec.url : `${base.replace(/\/$/, '')}/${spec.file}`;
        const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status} for ${spec.file}`);
        const data = new Uint8Array(spec.bytes);
        let at = 0;
        let lastReport = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done: finished, value } = await reader.read();
          if (finished) break;
          if (at + value.length > spec.bytes)
            throw new Error(`${spec.file} is larger than expected`);
          data.set(value, at);
          at += value.length;
          if (at - lastReport >= 2_000_000) {
            lastReport = at;
            report({ state: 'downloading', done: done + at, total });
          }
        }
        if (at !== spec.bytes) throw new Error(`${spec.file} is smaller than expected`);
        if ((await sha256Hex(data)) !== spec.sha256)
          throw new Error(`${spec.file} does not match its checksum`);
        const writable = await (
          await dir.getFileHandle(spec.file, { create: true })
        ).createWritable();
        await writable.write(data);
        await writable.close();
        done += spec.bytes;
        report({ state: 'downloading', done, total });
      }
      report({ state: 'ready' });
    } catch (err) {
      console.error('model download failed', err);
      report({ state: 'failed', detail: String(err) });
    }
  }

  /** Lets the person try again after a failed download. */
  clearFailure(): void {
    if (this.progress.state === 'failed') this.progress = { state: 'absent' };
  }
}
