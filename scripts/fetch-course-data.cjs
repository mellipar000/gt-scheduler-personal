/* Fetch public data only. No Firebase or deployment credentials are used. */
const fs = require('node:fs/promises');
const path = require('node:path');
const cheerio = require('cheerio');

const BANNER =
  'https://registration.banner.gatech.edu/StudentRegistrationSsb/ssb/searchResults/getLinkedSections';

// A response's options contain companions; the queried CRN is added by caller.
// Reject login pages, empty/error responses, and unrecognized markup.
function parseLinkedSections(html) {
  const $ = cheerio.load(html);
  const root = $('section[aria-labelledby="linked"]');
  if (root.length !== 1)
    throw new Error('Unrecognized linked-section response');
  const tables = root.find('table.basePreqTable');
  if (!tables.length) {
    if (root.text().trim() === 'No linked course information available.')
      return [[]];
    throw new Error('Linked-section status is unknown');
  }
  if (tables.length !== 1) throw new Error('Unexpected linked-section tables');
  const options = [];
  const headings = root.find('.linkedSectionsAddAll');
  const bodies = root.find('tbody');
  if (!headings.length || headings.length !== bodies.length) {
    throw new Error('Incomplete linked-section options');
  }
  bodies.each((_, body) => {
    const crns = [];
    $(body)
      .find('tr')
      .each((__, row) => {
        const cells = $(row).find('td');
        const crn = cells.eq(3).text().trim();
        if (cells.length !== 4 || !/^\d{5}$/.test(crn)) {
          throw new Error('Invalid linked-section row');
        }
        crns.push(crn);
      });
    if (!crns.length || new Set(crns).size !== crns.length) {
      throw new Error('Empty or duplicate linked-section option');
    }
    options.push(crns);
  });
  return options;
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.text();
}

async function main() {
  const [term, ...courseIds] = process.argv.slice(2);
  if (!/^\d{6}$/.test(term || '') || !courseIds.length) {
    throw new Error('Usage: npm run data:fetch -- 202608 "AE 2610" "CS 1331"');
  }
  const data = JSON.parse(
    await fetchText(`https://gt-scheduler.github.io/crawler-v2/${term}.json`)
  );
  let failed = false;
  for (const courseId of new Set(courseIds)) {
    const course = data.courses[courseId];
    if (!course) throw new Error(`Course not found: ${courseId}`);
    const sections = Object.values(course[1]);
    const known = new Set(sections.map((section) => section[0]));
    const source = `${BANNER}?term=${term}`;
    course[5] = { status: 'unknown', source, bundles: [] };
    try {
      const alternatives = new Map();
      for (const section of sections) {
        const crn = section[0];
        const html = await fetchText(`${source}&courseReferenceNumber=${crn}`);
        const bundles = parseLinkedSections(html).map((companions) => {
          const bundle = [crn, ...companions].sort();
          if (
            new Set(bundle).size !== bundle.length ||
            bundle.some((id) => !known.has(id))
          ) {
            throw new Error(
              'Links include duplicate or missing CRNs (possibly another course); refusing partial data'
            );
          }
          return bundle;
        });
        alternatives.set(crn, bundles);
      }
      const unique = new Map();
      for (const bundles of alternatives.values()) {
        for (const bundle of bundles) {
          const key = bundle.join(',');
          // A complete option must be confirmed from every member's view.
          if (
            !bundle.every((id) =>
              alternatives.get(id).some((other) => other.join(',') === key)
            )
          ) {
            throw new Error(
              'Linked-section responses disagree; refresh after the crawler updates'
            );
          }
          unique.set(key, bundle);
        }
      }
      course[5] = { status: 'complete', source, bundles: [...unique.values()] };
      console.log(
        `${courseId}: verified ${unique.size} complete registration options`
      );
    } catch (error) {
      failed = true;
      console.error(
        `${courseId}: ${error.message}. Requirements remain unknown.`
      );
    }
  }
  const output = path.resolve(__dirname, '../public/course-data');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `${term}.json`), JSON.stringify(data));
  await fs.writeFile(
    path.join(output, 'index.json'),
    JSON.stringify({ terms: [{ term, finalized: false }] })
  );
  console.log(
    `Saved ${output}. Set REACT_APP_LOCAL_CRAWLER_URL=/course-data in .env.local.`
  );
  if (failed) process.exitCode = 1;
}

module.exports = { parseLinkedSections };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
