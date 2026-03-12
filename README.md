# node-gyp-build-esm

> Build tool and bindings loader for [`node-gyp`][node-gyp] that supports prebuilds. ESM-compatible fork of [`node-gyp-build`][node-gyp-build].

```
npm install node-gyp-build-esm
```

Use together with [`prebuildify`][prebuildify] to easily support prebuilds for your native modules.

## Usage

Add `node-gyp-build-esm` as an install script to your native project:

```json
{
  "scripts": {
    "install": "node-gyp-build-esm"
  }
}
```

Then load your binding in your entry point:

```js
// CJS
const { load } = require('node-gyp-build-esm');
const binding = load(__dirname);

// ESM
import { load } from 'node-gyp-build-esm';
const binding = load(import.meta.dirname);
```

If you bundle prebuilds with [`prebuildify`][prebuildify], your native module will work across most platforms without compiling on install, and in both Node.js and Electron without recompiling between usage.

Users can force recompilation from source with:

```sh
npm install --build-from-source
```

Prebuilds are loaded from `MODULE_PATH/prebuilds/...` and then `EXEC_PATH/prebuilds/...` (the latter allowing use with `pkg`).

## Bundler Usage (webpack, esbuild)

Native `.node` addons require special handling in bundlers. Use the prebuilds factory to explicitly list the `.node` files per platform — this makes the `require()` calls statically visible so bundlers can copy and rewrite them correctly.

```js
import { load } from 'node-gyp-build-esm';

const binding = load(import.meta.dirname, () => ({
  'linux-x64': () => require('your-addon/prebuilds/linux-x64/your-addon.node'),
  'darwin-x64': () =>
    require('your-addon/prebuilds/darwin-x64+arm64/your-addon.node'),
  'win32-x64': () =>
    require('your-addon/prebuilds/win32-x64+ia32/your-addon.node'),
}));
```

The factory is called lazily — only the matching platform's `require()` is executed.

If a factory is provided but no entry matches the current platform/arch, an error is thrown listing the available keys and the current target.

### webpack

Install [`node-loader`](https://github.com/webpack-contrib/node-loader):

```sh
npm install --save-dev node-loader
```

```js
// webpack.config.js
const path = require('node:path');

module.exports = {
  entry: './source/index.js',
  target: 'node',
  output: {
    filename: 'bundle.cjs',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        // node-loader handles .node files — copies them to output
        // and rewrites require() paths automatically.
        test: /\.node$/,
        loader: 'node-loader',
      },
    ],
  },
};
```

### esbuild

Use the official plugin from [esbuild#1051](https://github.com/evanw/esbuild/issues/1051):

```js
// esbuild.config.js
const esbuild = require('esbuild');

const nativeNodeModulesPlugin = {
  name: 'native-node-modules',
  setup(build) {
    // Resolve .node imports to absolute paths and move them into
    // the "node-file" virtual namespace for custom loading.
    build.onResolve({ filter: /\.node$/, namespace: 'file' }, (args) => ({
      path: require.resolve(args.path, { paths: [args.resolveDir] }),
      namespace: 'node-file',
    }));

    // Emit a small wrapper that requires the .node file at runtime
    // using the path esbuild copies it to in the output directory.
    build.onLoad({ filter: /.*/, namespace: 'node-file' }, (args) => ({
      contents: `
        import path from ${JSON.stringify(args.path)}
        try { module.exports = require(path) }
        catch {}
      `,
    }));

    // Hand .node files back to the "file" namespace so esbuild's
    // default file loader copies them to the output directory.
    build.onResolve({ filter: /\.node$/, namespace: 'node-file' }, (args) => ({
      path: args.path,
      namespace: 'file',
    }));

    const opts = build.initialOptions;
    opts.loader = opts.loader || {};
    opts.loader['.node'] = 'file';
  },
};

esbuild.build({
  entryPoints: ['./source/index.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/bundle.cjs',
  plugins: [nativeNodeModulesPlugin],
});
```

## Supported prebuild names

Prebuild filenames are composed of _tags_. The runtime tag takes precedence, as does an `abi` tag over `napi`. More specific flavors (e.g. `musl` builds for Alpine, numbered ARM architecture versions) can be bundled alongside generic prebuilds — `node-gyp-build-esm` will find the most specific match first.

Values for the `libc` and `armv` tags are auto-detected but can be overridden via the `LIBC` and `ARM_VERSION` environment variables.

## License

MIT

[node-gyp-build]: https://github.com/prebuild/node-gyp-build
[prebuildify]: https://github.com/prebuild/prebuildify
[node-gyp]: https://www.npmjs.com/package/node-gyp
