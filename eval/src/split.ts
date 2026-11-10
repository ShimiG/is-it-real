/** Deterministic train / calib / test split by group (40 / 35 / 25). */
export type Split = 'train' | 'calib' | 'test';

export function splitOf(group: string): Split {
  let h = 0x811c9dc5;
  for (let i = 0; i < group.length; i++) {
    h ^= group.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const b = (h >>> 0) % 20;
  return b < 8 ? 'train' : b < 15 ? 'calib' : 'test';
}
