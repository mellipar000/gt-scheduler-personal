import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { Integrations } from '@sentry/tracing';

import RouterComponent from './components/RouterComponent';
import { ErrorWithFields } from './log';

import 'normalize.css';
import 'react-tooltip/dist/react-tooltip.css';
import './stylesheet.scss';

// Only initialize sentry on production
if (
  process.env.NODE_ENV === 'production' &&
  process.env['REACT_APP_SENTRY_DSN']
) {
  // eslint-disable-next-line no-console
  console.log('Initializing Sentry');

  Sentry.init({
    dsn: process.env['REACT_APP_SENTRY_DSN'],
    integrations: [new Integrations.BrowserTracing()],
    tracesSampleRate: 1.0,
    ignoreErrors: ['ResizeObserver loop limit exceeded'],
    release: process.env['REACT_APP_SENTRY_VERSION'],
  });
}

const container = document.getElementById('root');
if (container === null) {
  throw new ErrorWithFields({
    message: "couldn't find root element (failed to mount app)",
  });
}
const root = createRoot(container);
root.render(<RouterComponent />);
