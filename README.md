# GT Scheduler

> Georgia Tech Scheduler lets you find the schedule that fits you best among all the possible combinations of courses.

## 📃 License & Copyright Notice

This work is a derivative of the original and spectacular [GT Scheduler](https://github.com/64json/gt-scheduler) project created by Jinseo Park. The original work and all modifications are licensed under the [AGPL v3.0](https://github.com/64json/gt-scheduler/blob/master/LICENSE) license.

### Original Work

Copyright (c) 2020 Jinseo Park (parkjs814@gmail.com)

### Modifications

Copyright (c) 2020 the Bits of Good "GT Scheduler" team

## 🔍 Overview

The app is a React single-page application (SPA) (built using [`create-react-app`](https://github.com/facebook/create-react-app)) that forms the frontend website users interact with when they go to https://gt-scheduler.org/. It is written in [TypeScript](https://www.typescriptlang.org/) (a typed superset of JavaScript), and uses [SCSS](https://sass-lang.com/) for styling (a superset of CSS that supports advanced features).

To implement its goal of facilitating schedule creation and class exploration, GT Scheduler stores all data **locally in cookies**. Then, it sources any relevant data at runtime from a variety of sources, such as:

- The list of terms (strings like `202008`, which corresponds to Fall 2020) that have been scraped by the [Crawler application](https://api.github.com/repos/gt-scheduler/crawler/): https://gt-scheduler.github.io/crawler/index.json
- The data for a single term, which is the full output of the Crawler application in a single JSON file: https://gt-scheduler.github.io/crawler/202008.json
- Seating information for a single section, which is requested on demand and sent through our CORS proxy in the [Backend application](https://api.github.com/repos/gt-scheduler/crawler/) to [Oscar](https://oscar.gatech.edu/) (Georgia Tech's registration management system): https://gt-scheduler.azurewebsites.net/proxy/class_section?term=202008&crn=87086
- Course/instructor GPA information, which is fetched from [Course Critique](https://critique.gatech.edu/)'s API: https://c4citk6s9k.execute-api.us-east-1.amazonaws.com/test/data/course?courseID=CS%201331

This personal fork has no automatic deployment, analytics, or Tag Manager. Firebase and Sentry are disabled by default. No original developers' credentials are needed.

## Running locally

Use Node.js 22 LTS and Yarn Classic 1.22.22 (also tested with Node.js 24.18.1).

```powershell
npx --yes yarn@1.22.22 install --frozen-lockfile
npm run data:fetch -- 202608 "AE 2610" "CS 1331"
Copy-Item .env.example .env.local
npm start
```

Open [localhost:3000](http://localhost:3000), select Fall 2026, and add AE 2610. Each recommendation includes its breakout and one verified lab. Add other course IDs to `data:fetch` to verify their registration options. The importer downloads public crawler data and checks OSCAR's public Linked Sections endpoint; it never registers for classes.

**The published crawler omits authoritative registration links. Courses without verified registration requirements return zero recommendations with a diagnostic.** Import every requested course and term. Section letters and instructors alone do not establish valid links. On a fetch/parse failure the importer exits nonzero and leaves that course unverified. Downloaded `public/course-data/` snapshots are ignored by Git and need periodic refresh.

Core scheduling needs no accounts, maps, ratings, or private secrets. Cloud features require your own services and explicit configuration; upstream Firebase project IDs are blocked. See [.env.example](.env.example).

```powershell
npm test -- --watchAll=false --runInBand --cacheDirectory=.local-data/jest-cache
npm run lint
npm run format:check
npx tsc --noEmit
npm run build
```

A workspace-local Jest cache avoids Windows sandbox temporary-directory rename failures. Zod 3.25.76 and TypeScript 4.9.5 align with Create React App 5's type-checker. Existing dependency peer warnings and the stale Browserslist database do not require private credentials.

See [SCHEDULE_CORRECTNESS.md](SCHEDULE_CORRECTNESS.md) for evidence, the crawler contract, and manual checks.

### Linting

The project uses pre-commit hooks using [Husky](https://typicode.github.io/husky/#/) and [`lint-staged`](https://www.npmjs.com/package/lint-staged) to run linting (via [ESLint](https://eslint.org/)) and formatting (via [Prettier](https://prettier.io/)). These can be run manually from the command line to format/lint the code on-demand, using the following commands:

- `yarn run lint` - runs ESLint and reports all linting errors without fixing them
- `yarn run lint:fix` - runs ESLint and reports all linting errors, attempting to fix any auto-fixable ones
- `yarn run format` - runs Prettier and automatically formats the entire codebase
- `yarn run format:check` - runs Prettier and reports formatting errors without fixing them

## 👩‍💻 Contributing

The GT Scheduler project welcomes (and encourages) contributions from the community. Regular development is performed by the project owners (Jason Park and [Bits of Good](https://bitsofgood.org/)), but we still encourage others to work on adding new features or fixing existing bugs and make the registration process better for the Georgia Tech community.

More information on how to contribute can be found [in the contributing guide](/CONTRIBUTING.md).
