#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

// Entry point: if --build-from-source was passed, skip prebuild check and
// compile immediately. Otherwise, test if a compatible prebuild already exists.
if (!buildFromSource()) {
  // node-gyp-build-test attempts to load the prebuild for the current
  // platform/runtime. If it succeeds (exit 0), nothing needs to be done.
  // If it fails, no compatible prebuild exists — fall back to compiling from source.
  childProcess.exec('node-gyp-build-test', (error, stdout, stderr) => {
    if (error) {
      if (verbose()) console.error(stderr);
      preinstall();
    }
  });
} else {
  preinstall();
}

function build() {
  const win32 = os.platform() === 'win32';
  // On Windows, spawning node-gyp requires a shell to resolve .cmd shims.
  let shell = win32;
  // Default: invoke node-gyp via its platform-specific shell shim.
  let args = [win32 ? 'node-gyp.cmd' : 'node-gyp', 'rebuild'];

  try {
    // Preferred: resolve node-gyp's entry point directly via its package.json
    // so we can invoke it with the current Node.js executable instead of relying
    // on a shell shim. This avoids shell overhead and works in more environments.
    const packageJson = require('node-gyp/package.json');
    args = [
      process.execPath, // current node binary
      path.join(
        require.resolve('node-gyp/package.json'),
        '..',
        // packageJson.bin can be either a string or a { "node-gyp": "path" } map
        typeof packageJson.bin === 'string'
          ? packageJson.bin
          : packageJson.bin['node-gyp'],
      ),
      'rebuild',
    ];
    // No shell needed when invoking node directly.
    shell = false;
  } catch (_) {
    // node-gyp not found as a local dependency — fall back to the shell shim above.
  }

  childProcess
    .spawn(args[0], args.slice(1), {
      stdio: 'inherit',
      shell,
      // Prevent a console window from flashing open on Windows during the build.
      windowsHide: true,
    })
    .on('exit', (code) => {
      // If build failed or no postinstall command was provided, exit with
      // the same code as node-gyp (0 = success, non-zero = failure).
      if (code || !process.argv[3]) process.exit(code);

      // If a postinstall command was passed as the third CLI argument,
      // run it after a successful build.
      exec(process.argv[3]).on('exit', (code) => {
        process.exit(code);
      });
    });
}

/**
 * Runs an optional preinstall command before building.
 * The preinstall command is passed as the first CLI argument to this script
 * (e.g. `node bin.js "git submodule update --init"`).
 * If no preinstall command is provided, jumps straight to build().
 */
function preinstall() {
  if (!process.argv[2]) return build();

  // Run the preinstall command and only proceed to build() if it exits cleanly.
  // Non-zero exit code means the preinstall failed — abort with the same code.
  exec(process.argv[2]).on('exit', (code) => {
    if (code) process.exit(code);
    build();
  });
}

/**
 * Spawns a shell command, with platform-specific options.
 * stdio: 'inherit' pipes the child process stdout/stderr directly to the
 * parent process, so build output is visible in the terminal.
 */
function exec(cmd: string) {
  if (process.platform !== 'win32') {
    // Android ships with a minimal 'sh' instead of the default system shell —
    // passing shell: true on Android would fail since bash/zsh may not exist.
    const shell = os.platform() === 'android' ? 'sh' : true;
    return childProcess.spawn(cmd, [], {
      shell,
      stdio: 'inherit',
    });
  }

  return childProcess.spawn(cmd, [], {
    // windowsVerbatimArguments: prevents Node.js from escaping/quoting the
    // command string, which is necessary for cmd.exe to parse it correctly.
    windowsVerbatimArguments: true,
    stdio: 'inherit',
    shell: true,
    // windowsHide: prevents a visible console window from flashing open
    // during the build on Windows.
    windowsHide: true,
  });
}

/**
 * Returns true if the user explicitly requested to compile from source
 * instead of using a prebuilt binary.
 * Two ways to enable:
 *   - `npm install --build-from-source`
 *   - `npm_config_build_from_source=true npm install`
 */
function buildFromSource(): boolean {
  return (
    hasFlag('--build-from-source') ||
    process.env.npm_config_build_from_source === 'true'
  );
}

/**
 * Returns true if the current npm invocation is running in verbose mode.
 * Two ways to enable verbose mode:
 *   - `npm install --verbose`
 *   - `npm_config_loglevel=verbose npm install`
 */
function verbose(): boolean {
  return hasFlag('--verbose') || process.env.npm_config_loglevel === 'verbose';
}

/**
 * Checks whether a specific flag was passed to the npm CLI invocation
 * that triggered this script (e.g. `npm install --ignore-scripts`).
 *
 * Reads from `npm_config_argv`, a legacy JSON-encoded env var that npm injected
 * into install scripts containing the original CLI arguments. For example:
 *   npm install --ignore-scripts
 *   → npm_config_argv = '{"original":["install","--ignore-scripts"],...}'
 *
 * TODO (next major): remove in favor of `process.env.npm_config_*` which has
 * been available since npm 0.1.8. `npm_config_argv` was removed in npm 7.
 * See https://github.com/npm/rfcs/pull/90
 */
function hasFlag(flag: string): boolean {
  if (!process.env.npm_config_argv) return false;

  try {
    // Parse the JSON blob and check if the flag appears in the original args array.
    return (
      JSON.parse(process.env.npm_config_argv).original.indexOf(flag) !== -1
    );
  } catch (_) {
    // Malformed JSON — treat as if the flag was not present.
    return false;
  }
}
