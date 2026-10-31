#!/usr/bin/env node
// Load the application's TypeScript directly; no generated copy of the engine.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');

if (!process.env.GT_SCHEDULER_CHILD) {
  const result = spawnSync(
    process.execPath,
    [__filename, ...process.argv.slice(2)],
    {
      env: { ...process.env, GT_SCHEDULER_CHILD: '1', TZ: 'America/New_York' },
      input: process.argv.includes('--request')
        ? undefined
        : fs.readFileSync(0),
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  if (result.error) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: 'Runtime/output limit reached; narrow the request',
      })}\n`
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exitCode = result.status || 0;
  }
} else {
  const source = path.resolve(__dirname, '../src');
  const originalJs = require.extensions['.js'];
  const compile = (module, filename) => {
    const text = fs.readFileSync(filename, 'utf8');
    module._compile(
      ts.transpileModule(text, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
        fileName: filename,
      }).outputText,
      filename
    );
  };
  require.extensions['.ts'] = compile;
  require.extensions['.tsx'] = compile;
  require.extensions['.js'] = (module, filename) =>
    filename.startsWith(`${source}${path.sep}`)
      ? compile(module, filename)
      : originalJs(module, filename);
  console.log =
    console.warn =
    console.error =
      (...args) => process.stderr.write(`${args.join(' ')}\n`);
  void require('../src/harness/cli').main();
}
