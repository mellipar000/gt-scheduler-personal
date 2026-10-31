import type Section from './Section';
import { hasConflictBetween } from '../../utils/misc';

// These are registration roles, not individual meetings. A CRN always carries
// all of its meetings; multiple meetings never imply multiple registrations.
function roles(section: Section): string[] {
  const type = section.scheduleType.toLowerCase();
  const result = [
    ['lecture', /lecture/],
    ['breakout', /breakout/],
    ['laboratory', /lab/],
    ['studio', /studio/],
    ['recitation', /recitation|discussion|tutorial/],
    ['exam', /common exam/],
  ] as const;
  const found = result
    .filter(([, pattern]) => pattern.test(type))
    .map(([role]) => role);
  return found.length ? found : [type.replace(/\*/g, '').trim()];
}

export default function inferRegistrationBundles(
  sections: Section[]
): Section[][] {
  const sectionRoles = new Map(sections.map((s) => [s, roles(s)]));
  const required = Array.from(
    new Set(Array.from(sectionRoles.values()).flat())
  );
  const options = new Map(
    required.map((role) => [
      role,
      sections.filter((s) => sectionRoles.get(s)?.includes(role)),
    ])
  );
  const idMatches = (a: Section, b: Section): boolean =>
    a.id.startsWith(b.id) || b.id.startsWith(a.id);
  const instructorMatches = (a: Section, b: Section): boolean =>
    a.instructors.some(
      (name) =>
        name && !/^(tba|staff)$/i.test(name) && b.instructors.includes(name)
    );
  const compatible = (a: Section, b: Section, role: string): boolean => {
    if (a.campus !== b.campus || hasConflictBetween(a, b)) return false;
    for (const otherRole of sectionRoles.get(a) ?? []) {
      const peers = (options.get(otherRole) ?? []).filter(
        (s) => s !== b && s.campus === b.campus
      );
      if (peers.some((s) => idMatches(b, s)) && !idMatches(a, b)) return false;
    }
    const alternatives = (options.get(role) ?? []).filter(
      (s) => s !== a && s.campus === a.campus
    );
    // Prefer the registrar's usual section-prefix pattern. Only fall back to
    // instructors or conflict-free choices when that evidence is unavailable.
    if (alternatives.some((s) => idMatches(a, s))) return idMatches(a, b);
    if (alternatives.some((s) => instructorMatches(a, s)))
      return instructorMatches(a, b);
    return true;
  };
  const bundles: Section[][] = [];
  const visit = (selected: Section[], covered: Set<string>): void => {
    const next = required.find((role) => !covered.has(role));
    if (!next) {
      if (selected.length) bundles.push(selected);
      return;
    }
    for (const candidate of options.get(next) ?? []) {
      const candidateRoles = sectionRoles.get(candidate) ?? [];
      // Never register two alternatives for the same component.
      if (
        !candidateRoles.some((role) => covered.has(role)) &&
        !selected.some((other) => !compatible(other, candidate, next))
      ) {
        visit(
          [...selected, candidate],
          new Set([...Array.from(covered), ...candidateRoles])
        );
      }
    }
  };
  visit([], new Set());
  return bundles;
}
