#!/usr/bin/env node

// Set NODE_ENV to 'test' so native addons and loaders can detect
// they're being invoked as part of a prebuild compatibility check.
process.env.NODE_ENV = 'test';

const path = require('node:path');

let test = null;

try {
  const packageJson = require(path.join(process.cwd(), 'package.json'));

  // Allow packages to opt out of the prebuild test entirely by setting an
  // environment variable named after the package (uppercased, dashes → underscores).
  // e.g. package "my-addon" → MY_ADDON=1 skips the test and exits successfully.
  if (
    packageJson.name &&
    process.env[packageJson.name.toUpperCase().replace(/-/g, '_')]
  ) {
    process.exit(0);
  }

  // Packages can define a custom test script path in package.json:
  // "prebuild": { "test": "test/load.js" }
  // This allows running a more meaningful smoke test than the default.
  test = packageJson.prebuild.test;
} catch {
  // package.json missing, unreadable, or no prebuild.test defined — fall through
  // to the default test below.
}

if (test) {
  // Run the custom test script defined in package.json.
  require(path.join(process.cwd(), test));
} else {
  // Default test: attempt to load the prebuild via node-gyp-build.
  // If no compatible prebuild exists this will throw, causing a non-zero exit
  // which signals to bin.js that a build from source is needed.
  require('./')();
}
