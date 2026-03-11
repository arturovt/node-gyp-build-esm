import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Replicate webpack require detection — import.meta.url is never available
// inside a webpack bundle so runtimeRequire will always be the CJS require here.
const runtimeRequire = require;

let load;

if (typeof runtimeRequire.addon === 'function') {
  load = runtimeRequire.addon.bind(runtimeRequire);
} else {
  load = (await import('./dist/node-gyp-build.mjs')).load;
}

export default load;
