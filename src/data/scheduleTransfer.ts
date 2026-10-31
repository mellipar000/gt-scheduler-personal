import { z } from 'zod';

import Oscar from './beans/Oscar';

const strings = z.array(z.string().min(1).max(200)).max(500);
const days = z
  .array(z.enum(['M', 'T', 'W', 'R', 'F', 'S', 'U']))
  .min(1)
  .max(7);
export const eventSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().max(200),
    where: z.string().max(500).optional(),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        long: z.number().min(-180).max(180),
      })
      .strict()
      .nullable()
      .optional(),
    showEditForm: z.boolean().optional(),
    isSaved: z.boolean().optional(),
    days,
    period: z
      .object({
        start: z.number().int().min(0).max(1439),
        end: z.number().int().min(1).max(1440),
      })
      .strict()
      .refine((p) => p.start < p.end, 'Event must end after it starts'),
  })
  .strict();
export const scheduleSchema = z
  .object({
    desiredCourses: strings,
    pinnedCrns: strings,
    excludedCrns: strings,
    events: z.array(eventSchema).max(100),
    colorMap: z.record(z.string()),
    sortingOptionIndex: z.number().int().min(0).max(7),
    palette: z.enum(['default', 'soft', 'deep']),
  })
  .strict();
export const versionSchema = z
  .object({
    name: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
    friends: z.record(
      z
        .object({ status: z.enum(['Pending', 'Accepted']), email: z.string() })
        .strict()
    ),
    schedule: scheduleSchema,
  })
  .strict();
const safeKey = z
  .string()
  .min(1)
  .refine((s) => !['__proto__', 'constructor', 'prototype'].includes(s));
export const storeSchema = z
  .object({
    version: z.literal(3),
    terms: z.record(
      z.string().regex(/^\d{6}$/),
      z
        .object({
          versions: z.record(safeKey, versionSchema),
        })
        .strict()
    ),
  })
  .strict();
export const transferSchema = z
  .object({
    format: z.literal('gt-scheduler-version'),
    version: z.literal(1),
    term: z.string().regex(/^\d{6}$/),
    name: z.string().min(1).max(200),
    schedule: scheduleSchema,
  })
  .strict();
export type ScheduleTransfer = z.infer<typeof transferSchema>;

/** Validate against the same registration and conflict engine as the UI. */
export function validateTransfer(
  value: unknown,
  oscar: Oscar
): ScheduleTransfer {
  const transfer = transferSchema.parse(value);
  if (transfer.term !== oscar.term)
    throw new Error('Import term does not match the loaded term');
  const s = transfer.schedule;
  const result = oscar.getCombinationResult(
    s.desiredCourses,
    s.pinnedCrns,
    s.excludedCrns,
    s.events,
    { maxCombinations: 50000, maxNodes: 1000000 }
  );
  if (!result.combinations.length)
    throw new Error(result.diagnostics.join(' '));
  return transfer;
}
