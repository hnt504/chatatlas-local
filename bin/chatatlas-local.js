#!/usr/bin/env node
// ChatAtlas Local's command line. Node's built-in SQLite still prints an "experimental" warning
// when it loads; that's noise for people using this, so it's left out (other warnings still show).

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write(`ChatAtlas Local needs Node 22.13 or newer; this is Node ${process.versions.node}. Get a newer one at https://nodejs.org\n`);
  process.exit(1);
}

const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
  if (type === 'ExperimentalWarning' && /SQLite/i.test(String(warning?.message ?? warning))) return;
  return emitWarning.call(process, warning, ...rest);
};

// Output piped into something that stopped reading (`… | head`): that's the end, not an error.
process.stdout.on('error', (err) => {
  if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EPIPE') process.exit(0);
  throw err;
});

const { main } = await import('../src/cli.js');
process.exitCode = await main();
