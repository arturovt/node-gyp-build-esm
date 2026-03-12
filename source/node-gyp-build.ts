import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// These globals are injected by webpack at bundle time.
// __webpack_require__: webpack's internal module resolver (replaces require).
// __non_webpack_require__: the original Node.js require, preserved by webpack
// so bundled code can still load native .node files from the filesystem.
declare const __webpack_require__: typeof require;
declare const __non_webpack_require__: typeof require;

// Webpack replaces `require` with its own internal version at bundle time.
// To get the real Node.js require (needed to load .node files at runtime),
// we must use `__non_webpack_require__` when inside a webpack bundle.
// In ESM environments, the caller is responsible for ensuring `require` is
// available — e.g. via a banner that polyfills it with `createRequire`:
//   globalThis["require"] ??= createRequire(import.meta.url);
const runtimeRequire: typeof require =
  typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;

const vars = process.config?.variables || {};

// When set, skip looking for local build/Release or build/Debug directories
// and only consider prebuilt binaries.
const prebuildsOnly = !!process.env.PREBUILDS_ONLY;

// ABI version identifies binary compatibility between Node.js versions.
// A .node file compiled for one ABI version won't load on a different one.
const abi = process.versions.modules;

// Determine the JS runtime — affects which prebuild directory is selected.
const runtime = isElectron() ? 'electron' : isNwjs() ? 'node-webkit' : 'node';

// Allow overriding arch/platform via npm config for cross-install scenarios
// (e.g. installing arm64 binaries on an x64 CI machine).
const arch = process.env.npm_config_arch || os.arch();
const platform = process.env.npm_config_platform || os.platform();

// libc flavor affects binary compatibility on Linux.
// Alpine uses musl instead of the standard glibc.
const libc = process.env.LIBC || (isAlpine(platform) ? 'musl' : 'glibc');

// ARM version (e.g. '7' for armv7, '8' for arm64).
// Only relevant on ARM platforms — empty string on all others.
const armv =
  process.env.ARM_VERSION ||
  (arch === 'arm64' ? '8' : (vars as any)['arm_version']) ||
  '';

// Major libuv version — affects binary compatibility for some native addons
// that link against libuv directly.
const uv = (process.versions.uv || '').split('.')[0];

type PrebuildMap = Record<string, () => unknown>;

/**
 * Loads the most appropriate native .node file for the current
 * platform/runtime/ABI from the given package directory.
 *
 * @param dir - Path to the package directory containing prebuilds/
 * @param prebuildsFactory - Optional factory function returning a map of
 *                           platform-arch keys to lazy require functions.
 *                           Use this for bundler compatibility (webpack, esbuild)
 *                           since bundlers can statically analyze the require calls
 *                           inside the factory. The factory is only called when
 *                           needed, so unused platforms are never required.
 *
 * @example
 * // Without bundler (standard filesystem resolution):
 * load(__dirname);
 *
 * @example
 * // With bundler (explicit prebuild map):
 * load(import.meta.dirname, () => ({
 *   'linux-x64+ia32': () => require('./prebuilds/linux-x64+ia32/procstat-napi.node'),
 *   'darwin-x64+arm64': () => require('./prebuilds/darwin-x64+arm64/procstat-napi.node'),
 *   'win32-x64+ia32': () => require('./prebuilds/win32-x64+ia32/procstat-napi.node'),
 * }));
 */
export function load(dir: string, prebuildsFactory?: () => PrebuildMap) {
  if (prebuildsFactory) {
    const prebuilds = prebuildsFactory();

    // Find the matching entry for the current platform-arch combination.
    // The key format mirrors the prebuilds/ directory naming convention:
    // "<platform>-<arch>[+<arch>...]", e.g. "linux-x64+ia32", "darwin-x64+arm64".
    const key = Object.keys(prebuilds).find((k) => {
      const tuple = parseTuple(k);
      return tuple && matchTuple(platform, arch)(tuple);
    });

    if (key) return prebuilds[key]();

    // If a factory was explicitly provided but contains no entry for the current
    // platform/arch, the map is incomplete — throw rather than silently falling
    // back to filesystem resolution, since this is likely a bug in the caller.
    throw new Error(
      `No prebuild was found for platform=${platform} arch=${arch} in the provided prebuilds map.\n` +
        `Available keys: ${Object.keys(prebuilds).join(', ')}\n`,
    );
  }

  return runtimeRequire(load.resolve(dir));
}

/**
 * Resolves the path to the most appropriate .node file without loading it.
 * Exposed as both `load.resolve` and `load.path` for backwards compatibility.
 *
 * Resolution order:
 *  1. build/Release (local compiled build)
 *  2. build/Debug (local debug build)
 *  3. prebuilds/ directory inside the package
 *  4. prebuilds/ directory next to the Node.js executable (global install)
 */
load.resolve = load.path = function (dir: string) {
  dir = path.resolve(dir || '.');

  try {
    // Allow overriding the prebuild directory entirely via an env var named
    // after the package. e.g. for package "my-addon": MY_ADDON_PREBUILD=/path
    const name = runtimeRequire(path.join(dir, 'package.json'))
      .name.toUpperCase()
      .replace(/-/g, '_');

    if (process.env[name + '_PREBUILD']) dir = process.env[name + '_PREBUILD']!;
  } catch {
    // package.json unreadable or missing — continue with original dir.
  }

  if (!prebuildsOnly) {
    // Prefer a locally compiled Release build if one exists.
    const release = getFirst(path.join(dir, 'build/Release'), matchBuild);
    if (release) return release;

    // Fall back to a Debug build (e.g. during local development).
    const debug = getFirst(path.join(dir, 'build/Debug'), matchBuild);
    if (debug) return debug;
  }

  // Look for a prebuild shipped inside the package (standard prebuildify layout).
  const prebuild = resolve(dir);
  if (prebuild) return prebuild;

  // Look for a prebuild next to the Node.js binary — handles global installs
  // where prebuilds are placed alongside the executable.
  const nearby = resolve(path.dirname(process.execPath));
  if (nearby) return nearby;

  // Nothing found — build a descriptive error showing exactly what was needed
  // so the user knows what prebuild is missing.
  const target = [
    'platform=' + platform,
    'arch=' + arch,
    'runtime=' + runtime,
    'abi=' + abi,
    'uv=' + uv,
    armv ? 'armv=' + armv : '',
    'libc=' + libc,
    'node=' + process.versions.node,
    process.versions.electron ? 'electron=' + process.versions.electron : '',
    typeof __webpack_require__ === 'function' ? 'webpack=true' : '', // eslint-disable-line
  ]
    .filter(Boolean)
    .join(' ');

  throw new Error(
    'No native build was found for ' +
      target +
      '\n    loaded from: ' +
      dir +
      '\n',
  );

  function resolve(dir: string): string | undefined {
    // Find all prebuilds/<platform>-<arch> directories and pick the best match.
    const tuples = readdirSync(path.join(dir, 'prebuilds')).map(parseTuple);
    const tuple = tuples
      .filter(matchTuple(platform, arch))
      .sort(compareTuples)[0]; // sort prefers single-arch over multi-arch (universal) builds
    if (!tuple) return undefined;

    // Within the matched platform/arch directory, find the most specific
    // .node file that matches the current runtime and ABI.
    const prebuilds = path.join(dir, 'prebuilds', tuple.name);
    const parsed = readdirSync(prebuilds).map(parseTags);
    const candidates = parsed.filter(matchTags(runtime, abi));
    const winner = candidates.sort(compareTags(runtime))[0];
    if (winner) return path.join(prebuilds, winner.file);
    return undefined;
  }
};

/**
 * Safe wrapper around fs.readdirSync — returns an empty array if the
 * directory doesn't exist instead of throwing.
 */
function readdirSync(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
}

/**
 * Returns the first file in a directory that passes the filter,
 * or undefined if none match.
 */
function getFirst(dir: string, filter: (predicate: string) => boolean) {
  const files = readdirSync(dir).filter(filter);
  return files[0] && path.join(dir, files[0]);
}

/** Matches any native addon file. */
function matchBuild(name: string) {
  return /\.node$/.test(name);
}

interface Tuple {
  name: string;
  platform: string;
  architectures: string[];
}

/**
 * Parses a prebuild directory name into its platform and architecture parts.
 * Expected format: "<platform>-<arch>[+<arch>...]"
 * Example: "darwin-x64+arm64" → { platform: "darwin", architectures: ["x64", "arm64"] }
 */
function parseTuple(name: string): Tuple | undefined {
  const arr = name.split('-');
  if (arr.length !== 2) return;

  const platform = arr[0];
  const architectures = arr[1].split('+');

  if (!platform) return;
  if (!architectures.length) return;
  if (!architectures.every(Boolean)) return;

  return { name, platform, architectures };
}

/** Returns true if the tuple matches the current platform and architecture. */
function matchTuple(platform: string, arch: string) {
  return function (tuple: Tuple | undefined): tuple is Tuple {
    if (tuple == null) return false;
    if (tuple.platform !== platform) return false;
    return tuple.architectures.includes(arch);
  };
}

/**
 * Sorts tuples so single-arch prebuilds are preferred over multi-arch
 * (universal) ones — more specific is better.
 */
function compareTuples(a: Tuple, b: Tuple) {
  return a.architectures.length - b.architectures.length;
}

interface Tags {
  file: string;
  specificity: number; // number of recognized tags — higher = more specific
  runtime?: string;
  napi?: boolean;
  abi?: string;
  uv?: string;
  armv?: string;
  libc?: string;
}

/**
 * Parses a prebuild filename into structured tags.
 * Filename format: "<runtime>.<tag>[.<tag>...].node"
 * Example: "node.napi.uv1.node" → { runtime: "node", napi: true, uv: "1", specificity: 3 }
 */
function parseTags(file: string) {
  const arr = file.split('.');
  const extension = arr.pop();
  const tags: Tags = { file, specificity: 0 };

  if (extension !== 'node') return;

  for (let i = 0; i < arr.length; i++) {
    const tag = arr[i];

    if (tag === 'node' || tag === 'electron' || tag === 'node-webkit') {
      tags.runtime = tag;
    } else if (tag === 'napi') {
      // N-API binaries are ABI-stable — compatible across Node.js versions.
      tags.napi = true;
    } else if (tag.slice(0, 3) === 'abi') {
      // ABI version number, e.g. "abi115" → "115"
      tags.abi = tag.slice(3);
    } else if (tag.slice(0, 2) === 'uv') {
      // libuv major version, e.g. "uv1" → "1"
      tags.uv = tag.slice(2);
    } else if (tag.slice(0, 4) === 'armv') {
      // ARM version, e.g. "armv7" → "7"
      tags.armv = tag.slice(4);
    } else if (tag === 'glibc' || tag === 'musl') {
      tags.libc = tag;
    } else {
      continue;
    }

    // Only increment specificity for recognized tags.
    tags.specificity++;
  }

  return tags;
}

/**
 * Returns true if the prebuild tags are compatible with the current
 * runtime and ABI. All specified tags must match — unspecified tags are
 * treated as wildcards (compatible with anything).
 */
function matchTags(runtime: string, abi: string) {
  return function (tags: Tags | undefined) {
    if (tags == null) return false;
    if (tags.runtime && tags.runtime !== runtime && !runtimeAgnostic(tags))
      return false;
    if (tags.abi && tags.abi !== abi && !tags.napi) return false;
    if (tags.uv && tags.uv !== uv) return false;
    if (tags.armv && tags.armv !== armv) return false;
    if (tags.libc && tags.libc !== libc) return false;

    return true;
  };
}

/**
 * N-API node builds are runtime-agnostic — they work in both Node.js and
 * Electron without recompilation, because N-API is ABI-stable across runtimes.
 */
function runtimeAgnostic(tags: Tags) {
  return tags.runtime === 'node' && tags.napi;
}

/**
 * Sorts prebuild candidates so the most specific and appropriate one wins.
 * Precedence:
 *  1. Runtime-specific build over runtime-agnostic (N-API node) build
 *  2. ABI-versioned build over N-API build (more specific)
 *  3. Higher specificity (more tags) over lower
 */
function compareTags(runtime: string) {
  return function (a: Tags | undefined, b: Tags | undefined) {
    if (a == null || b == null) {
      return 0;
    }

    if (a.runtime !== b.runtime) {
      return a.runtime === runtime ? -1 : 1;
    } else if (a.abi !== b.abi) {
      return a.abi ? -1 : 1;
    } else if (a.specificity !== b.specificity) {
      return a.specificity > b.specificity ? -1 : 1;
    } else {
      return 0;
    }
  };
}

/** Detects NW.js (node-webkit) runtime. */
function isNwjs() {
  return !!(process.versions && process.versions.nw);
}

/**
 * Detects Electron runtime via multiple signals:
 *  - process.versions.electron (main/renderer process)
 *  - ELECTRON_RUN_AS_NODE env var (Electron running as plain Node)
 *  - window.process.type === 'renderer' (browser/renderer process)
 */
function isElectron() {
  if (process.versions && process.versions.electron) return true;
  if (process.env.ELECTRON_RUN_AS_NODE) return true;
  const electronProcess = typeof window !== 'undefined' && window.process;
  return (electronProcess as any)?.type === 'renderer';
}

/** Detects Alpine Linux by checking for its release file. */
function isAlpine(platform: string) {
  return platform === 'linux' && fs.existsSync('/etc/alpine-release');
}

// Exposed for unit tests
// TODO: move to lib
load.parseTags = parseTags;
load.matchTags = matchTags;
load.compareTags = compareTags;
load.parseTuple = parseTuple;
load.matchTuple = matchTuple;
load.compareTuples = compareTuples;
