import { z } from 'zod';
import { NOT_ASSESSED_REASONS, OUTCOMES, REASON_CODES, SCAM_RISKS, SIGNAL_KINDS } from './types.js';

/** Runtime schemas for host boundaries (MCP tool I/O, extension messaging). Mirror `types.ts`. */
export const ModalitySchema = z.enum(['text', 'image', 'video', 'page']);
export const OutcomeSchema = z.enum(OUTCOMES);
export const ReasonCodeSchema = z.enum(REASON_CODES);

export const SignalSchema = z.object({
  detector: z.string().min(1),
  modality: ModalitySchema,
  kind: z.enum(SIGNAL_KINDS),
  score: z.number().min(0).max(1),
  reasons: z.array(ReasonCodeSchema),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const DetectorResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('assessed'), signal: SignalSchema }),
  z.object({
    status: z.literal('not_assessed'),
    detector: z.string().min(1),
    reason: z.enum(NOT_ASSESSED_REASONS),
  }),
]);

export const VerdictSchema = z.object({
  modality: ModalitySchema,
  outcome: OutcomeSchema,
  confidence: z.number().min(0).max(1).nullable(),
  alert: z.boolean(),
  signals: z.array(SignalSchema),
  reasons: z.array(ReasonCodeSchema),
});

export const PageReportSchema = z.object({
  scamRisk: z.enum(SCAM_RISKS),
  scamReasons: z.array(ReasonCodeSchema),
  items: z.array(VerdictSchema),
  engine: z.string(),
});
