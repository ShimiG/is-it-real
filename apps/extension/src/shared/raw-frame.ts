import { yuvFrameFromPlanes, type YuvFrame } from '@isitreal/core';

/** Refuse frames larger than this (width x height), as the plugin does. */
export const MAX_FRAME_PIXELS = 40_000_000;

/**
 * The raw planes of the frame a video element is showing right now, copied straight from the
 * decoder (WebCodecs), not through a canvas: a canvas gives the browser's own idea of RGB, which
 * differs between browsers and graphics cards and moves the picture model's score. The core
 * converts these planes with one fixed rule in every host (packages/core/src/video/yuv.ts).
 *
 * Null when the frame is not 8-bit 4:2:0 or is too large. Throws when the browser does not allow
 * reading the video (protected video, or video from another site without permission).
 */
export async function rawFrameOf(
  video: HTMLVideoElement,
): Promise<(YuvFrame & { time: number }) | null> {
  const frame = new VideoFrame(video);
  try {
    const rect = frame.visibleRect;
    if (rect === null || rect.width * rect.height > MAX_FRAME_PIXELS) return null;
    const data = new Uint8Array(frame.allocationSize());
    const layout = await frame.copyTo(data);
    const yuv = yuvFrameFromPlanes(
      frame.format,
      data,
      layout,
      rect.width,
      rect.height,
      frame.colorSpace.fullRange === true,
    );
    return yuv === null ? null : { ...yuv, time: frame.timestamp / 1_000_000 };
  } finally {
    frame.close();
  }
}

/** A raw frame packed for a message between parts of the extension (messages carry text only). */
export interface PackedFrame {
  width: number;
  height: number;
  fullRange: boolean;
  /** Seconds into the video. */
  time: number;
  /** The three planes one after another (Y, U, V), base64. */
  planes: string;
}

export function packFrame(frame: YuvFrame & { time: number }): PackedFrame {
  const bytes = new Uint8Array(frame.y.length + frame.u.length + frame.v.length);
  bytes.set(frame.y);
  bytes.set(frame.u, frame.y.length);
  bytes.set(frame.v, frame.y.length + frame.u.length);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    width: frame.width,
    height: frame.height,
    fullRange: frame.fullRange,
    time: frame.time,
    planes: btoa(binary),
  };
}

export function unpackFrame(packed: PackedFrame): YuvFrame | null {
  const { width, height } = packed;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    return null;
  if (width * height > MAX_FRAME_PIXELS) return null;
  const cw = (width + 1) >> 1;
  const ch = (height + 1) >> 1;
  const binary = atob(packed.planes);
  if (binary.length !== width * height + 2 * cw * ch) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return {
    width,
    height,
    y: bytes.subarray(0, width * height),
    u: bytes.subarray(width * height, width * height + cw * ch),
    v: bytes.subarray(width * height + cw * ch),
    fullRange: packed.fullRange === true,
  };
}
