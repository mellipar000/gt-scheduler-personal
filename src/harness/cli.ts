import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import Oscar from '../data/beans/Oscar';
import Section from '../data/beans/Section';
import scheduleMetrics from '../data/beans/scheduleMetrics';
import { CrawlerTermData, Combination } from '../types';
import { defaultSchedule } from '../data/types';
import { ASYNC_DELIVERY_MODE } from '../constants';
import {
  eventSchema,
  scheduleSchema,
  storeSchema,
  transferSchema,
  validateTransfer,
} from '../data/scheduleTransfer';

const ids = z.array(z.string().min(1).max(200)).max(500);
const day = z.enum(['M', 'T', 'W', 'R', 'F', 'S', 'U']);
const requestSchema = z
  .object({
    op: z.enum([
      'courses',
      'sections',
      'read',
      'search',
      'inspect',
      'export',
      'import',
    ]),
    dataFile: z.string().optional(),
    term: z.string().regex(/^\d{6}$/),
    query: z.string().max(200).default(''),
    course: z.string().optional(),
    offset: z.number().int().min(0).default(0),
    topK: z.number().int().min(1).max(50).default(5),
    scheduleFile: z.string().optional(),
    versionId: z.string().optional(),
    storeFile: z.string().optional(),
    name: z.string().min(1).max(200).default('CLI alternative'),
    courses: ids.optional(),
    crns: ids.optional(),
    hard: z
      .object({
        pinnedCrns: ids.optional(),
        excludedCrns: ids.optional(),
        avoidDays: z.array(day).max(7).default([]),
        earliestStart: z.number().int().min(0).max(1439).optional(),
        latestEnd: z.number().int().min(1).max(1440).optional(),
        events: z.array(eventSchema).max(100).optional(),
      })
      .strict()
      .default({}),
    soft: z
      .object({
        sort: z.number().int().min(0).max(7).default(6),
        preferCrns: ids.default([]),
        avoidDays: z.array(day).max(7).default([]),
      })
      .strict()
      .default({}),
  })
  .strict();
type Request = z.infer<typeof requestSchema>;

function readJson(filename: string): unknown {
  if (fs.statSync(filename).size > 50 * 1024 * 1024)
    throw new Error('Input exceeds 50 MiB');
  return JSON.parse(fs.readFileSync(filename, 'utf8')) as unknown;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readSchedule(r: Request): z.infer<typeof scheduleSchema> {
  if (!r.scheduleFile) return scheduleSchema.parse(defaultSchedule);
  const raw = readJson(r.scheduleFile);
  const transfer = transferSchema.safeParse(raw);
  if (transfer.success) {
    if (transfer.data.term !== r.term)
      throw new Error('Schedule term mismatch');
    return transfer.data.schedule;
  }
  const store = storeSchema.parse(raw);
  const versions = store.terms[r.term]?.versions;
  const id =
    r.versionId ??
    (versions && Object.keys(versions).length === 1
      ? Object.keys(versions)[0]
      : undefined);
  const version = id ? versions?.[id] : undefined;
  if (!version)
    throw new Error('Supply versionId for an existing schedule version');
  return version.schedule;
}

function describe(s: Section): Record<string, unknown> {
  return {
    crn: s.crn,
    course: s.course.id,
    section: s.id,
    type: s.scheduleType,
    instructors: s.instructors,
    campus: s.campus,
    deliveryMode: s.deliveryMode,
    meetings: s.meetings,
    restrictions: s.restrictions,
    issue: s.schedulingIssue,
  };
}

export function run(value: unknown): unknown {
  const r = requestSchema.parse(value);
  if (r.op === 'read') {
    required(r.scheduleFile, 'scheduleFile');
    return { schedule: readSchedule(r) };
  }
  const raw = readJson(required(r.dataFile, 'dataFile'));
  // Oscar is the canonical crawler decoder. Reject malformed top-level inputs,
  // and surface its per-course decoding diagnostics on stderr.
  z.object({
    courses: z.record(z.array(z.unknown())),
    caches: z.object({
      periods: z.array(z.string()),
      dateRanges: z.array(z.string()),
      scheduleTypes: z.array(z.string()),
      campuses: z.array(z.string()),
      attributes: z.array(z.string()),
      gradeBases: z.array(z.string()),
      locations: z.array(z.unknown()),
    }),
    updatedAt: z.string().datetime(),
    version: z.number().int(),
  }).parse(raw);
  const oscar = new Oscar(raw as CrawlerTermData, r.term);
  const page = <T>(items: T[]): unknown => ({
    total: items.length,
    offset: r.offset,
    nextOffset: r.offset + r.topK < items.length ? r.offset + r.topK : null,
    items: items.slice(r.offset, r.offset + r.topK),
  });
  if (r.op === 'courses')
    return page(
      oscar.courses
        .filter((c) =>
          `${c.id} ${c.title}`.toLowerCase().includes(r.query.toLowerCase())
        )
        .map((c) => ({ id: c.id, title: c.title, sections: c.sections.length }))
    );
  if (r.op === 'sections') {
    const course = oscar.findCourse(required(r.course, 'course'));
    if (!course) throw new Error('Unknown course');
    course.prepareRegistrationBundles();
    return {
      ...(page(course.sections.map(describe)) as object),
      registrationIssue: course.registrationIssue,
      registrationLinks: course.registrationInferred ? 'inferred' : 'verified',
    };
  }
  if (r.op === 'import') {
    const transfer = validateTransfer(
      readJson(required(r.scheduleFile, 'scheduleFile')),
      oscar
    );
    const store = storeSchema.parse(
      readJson(required(r.storeFile, 'storeFile'))
    );
    const id = `sv_${randomUUID().replace(/-/g, '')}`;
    const termData = store.terms[r.term] ?? { versions: {} };
    store.terms[r.term] = termData;
    termData.versions[id] = {
      name: transfer.name,
      createdAt: new Date().toISOString(),
      friends: {},
      schedule: transfer.schedule,
    };
    return { versionId: id, store };
  }
  const schedule = readSchedule(r);
  const courses = r.courses ?? schedule.desiredCourses;
  const pins = r.hard.pinnedCrns ?? schedule.pinnedCrns;
  const sourceExclusions = r.hard.excludedCrns ?? schedule.excludedCrns;
  const events = r.hard.events ?? schedule.events;
  const sections = (crns: string[]): Section[] =>
    crns.map((crn) => {
      const section = oscar.findSection(crn);
      if (!section) throw new Error(`Unknown CRN ${crn}`);
      return section;
    });
  if (r.op === 'inspect') {
    const selected = sections(r.crns ?? pins);
    return {
      sections: selected.map(describe),
      metrics: scheduleMetrics(selected),
    };
  }
  // Turn section-local hard constraints into exclusions; conflict and bundle
  // decisions stay in Oscar. Remote synchronous meetings count for these rules.
  const hardExcluded = oscar.courses
    .filter((c) => courses.includes(c.id))
    .flatMap((c) => c.sections)
    .filter((s) => s.deliveryMode !== ASYNC_DELIVERY_MODE)
    .filter((s) =>
      s.meetings.some(
        (m) =>
          m.period &&
          (m.days.some((d) =>
            r.hard.avoidDays.includes(d as z.infer<typeof day>)
          ) ||
            m.period.start < (r.hard.earliestStart ?? 0) ||
            m.period.end > (r.hard.latestEnd ?? 1440))
      )
    )
    .map((s) => s.crn);
  const exclusions = Array.from(
    new Set([...sourceExclusions, ...hardExcluded])
  );
  if (r.op === 'export') {
    const selected = sections(r.crns ?? pins);
    if (pins.some((crn) => !selected.some((s) => s.crn === crn)))
      throw new Error('Candidate omits a required pinned CRN');
    const transfer = validateTransfer(
      {
        format: 'gt-scheduler-version',
        version: 1,
        term: r.term,
        name: r.name,
        schedule: {
          ...schedule,
          desiredCourses: courses,
          pinnedCrns: selected.map((s) => s.crn),
          excludedCrns: exclusions,
          events,
          sortingOptionIndex: r.soft.sort,
        },
      },
      oscar
    );
    const complete = oscar.getCombinationResult(
      courses,
      transfer.schedule.pinnedCrns,
      exclusions,
      events,
      { maxCombinations: 50000, maxNodes: 1000000 }
    );
    if (!complete.combinations.some((c) => c.crns.length === 0))
      throw new Error(
        'Export requires every CRN of a complete candidate, including labs'
      );
    return transfer;
  }
  if (!courses.length) throw new Error('Search requires at least one course');
  sections(r.soft.preferCrns);
  const result = oscar.getCombinationResult(courses, pins, exclusions, events, {
    maxCombinations: 50000,
    maxNodes: 1000000,
  });
  const ranked = oscar.sortCombinations(
    result.combinations,
    r.soft.sort,
    events
  );
  const penalty = (c: Combination): number => {
    const crns = c.scheduledCrns ?? c.crns;
    return (
      r.soft.preferCrns.filter((crn) => !crns.includes(crn)).length +
      sections(crns).reduce(
        (sum, s) =>
          sum +
          s.meetings.filter((m) =>
            m.days.some((d) =>
              r.soft.avoidDays.includes(d as z.infer<typeof day>)
            )
          ).length,
        0
      )
    );
  };
  const scored = ranked
    .map((c) => ({ c, penalty: penalty(c) }))
    .sort((a, b) => a.penalty - b.penalty);
  return {
    total: scored.length,
    dataUpdatedAt: oscar.updatedAt.toISOString(),
    returned: Math.min(r.topK, scored.length),
    sort: oscar.sortingOptions[r.soft.sort]?.label,
    diagnostics: [
      ...result.diagnostics,
      ...courses
        .filter((id) => oscar.findCourse(id)?.registrationInferred)
        .map(
          (id) =>
            `${id}: Registration links inferred; verify in OSCAR before registration.`
        ),
    ],
    candidates: scored.slice(0, r.topK).map(({ c, penalty: p }, i) => {
      const crns = c.scheduledCrns ?? c.crns;
      return {
        rank: i + 1,
        crns,
        preferencePenalty: p,
        metrics: scheduleMetrics(sections(crns)),
      };
    }),
  };
}

/** Exclusive lock, byte-for-byte backup, and atomic rename. */
function writeOutput(
  filename: string,
  contents: string,
  expected?: string
): string | null {
  const destination = path.resolve(filename);
  const lock = `${destination}.lock`;
  const fd = fs.openSync(lock, 'wx');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  let backup: string | null = null;
  try {
    if (
      expected !== undefined &&
      fs.readFileSync(destination, 'utf8') !== expected
    )
      throw new Error(
        'Store changed during import; re-run against the latest export'
      );
    if (fs.existsSync(destination)) {
      if (!fs.lstatSync(destination).isFile())
        throw new Error('Output must be a regular file');
      backup = `${destination}.${randomUUID()}.bak`;
      fs.copyFileSync(destination, backup, fs.constants.COPYFILE_EXCL);
    }
    fs.writeFileSync(temporary, contents, { flag: 'wx' });
    fs.renameSync(temporary, destination);
    return backup;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function main(): void {
  try {
    const args = process.argv.slice(2);
    const options: Record<string, string | boolean> = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? '';
      const next = args[i + 1];
      if (arg === '--confirm-write') options[arg] = true;
      else if (
        ['--request', '--output'].includes(arg) &&
        next &&
        !next.startsWith('--')
      ) {
        options[arg] = next;
        i += 1;
      } else throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    const input = options['--request'];
    const request =
      typeof input === 'string'
        ? readJson(input)
        : (JSON.parse(fs.readFileSync(0, 'utf8')) as unknown);
    const parsed = requestSchema.parse(request);
    const output = options['--output'];
    const expected =
      parsed.op === 'import' &&
      typeof output === 'string' &&
      parsed.storeFile &&
      path.resolve(output) === path.resolve(parsed.storeFile)
        ? fs.readFileSync(parsed.storeFile, 'utf8')
        : undefined;
    const result = run(parsed);
    const summary =
      parsed.op === 'import'
        ? {
            versionId: (result as { versionId: string }).versionId,
            term: parsed.term,
            action: 'append-version',
            existingVersionsPreserved: true,
          }
        : result;
    if (typeof output === 'string') {
      if (!options['--confirm-write']) {
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            dryRun: true,
            output,
            result: summary,
          })}\n`
        );
        return;
      }
      const payload =
        parsed.op === 'import' ? (result as { store: unknown }).store : result;
      const backup = writeOutput(
        output,
        `${JSON.stringify(payload)}\n`,
        expected
      );
      process.stdout.write(
        `${JSON.stringify({ ok: true, written: output, backup })}\n`
      );
    } else
      process.stdout.write(
        `${JSON.stringify({ ok: true, result: summary })}\n`
      );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error:
          error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; ')
            : String(error),
      })}\n`
    );
    process.exitCode = 1;
  }
}
