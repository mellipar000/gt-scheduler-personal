import type Course from '../data/beans/Course';

export type CreditEstimate = { min: number; max: number } | null;

// The snapshot has only one number per CRN, with no variable-credit flag.
// Multiple positive components cannot safely be distinguished from repeated
// course-level credit values, so do not guess whether to add them.
export function courseCredits(
  course: Course | undefined,
  pinnedCrns: readonly string[] = [],
  excludedCrns: readonly string[] = []
): CreditEstimate {
  if (!course) return null;
  course.prepareRegistrationBundles();
  if (course.registrationIssue) return null;
  const pins = course.sections.filter((s) => pinnedCrns.includes(s.crn));
  const bundles = course.registrationBundles.filter(
    (bundle) =>
      pins.every((pin) => bundle.includes(pin)) &&
      bundle.every((section) => !excludedCrns.includes(section.crn))
  );
  if (!bundles.length) return null;
  const values: number[] = [];
  for (const bundle of bundles) {
    const credits = bundle.map((section) => section.credits);
    if (credits.some((value) => !Number.isFinite(value) || value < 0))
      return null;
    const positive = credits.filter((value) => value > 0);
    // The crawler also uses zero as a missing-value fallback.
    if (positive.length !== 1) return null;
    values.push(positive[0] as number);
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function totalCourseCredits(
  estimates: CreditEstimate[]
): CreditEstimate {
  if (estimates.some((estimate) => estimate === null)) return null;
  return estimates.reduce<{ min: number; max: number }>(
    (total, estimate) => ({
      min: total.min + (estimate?.min ?? 0),
      max: total.max + (estimate?.max ?? 0),
    }),
    { min: 0, max: 0 }
  );
}

export function formatCredits(estimate: CreditEstimate): string {
  if (!estimate) return 'Unresolved';
  return estimate.min === estimate.max
    ? String(estimate.min)
    : `${estimate.min}–${estimate.max}`;
}
