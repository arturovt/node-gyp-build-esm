const esbuild = require('esbuild');

// https://github.com/evanw/esbuild/issues/1051
const nativeNodeModulesPlugin = {
  name: 'native-node-modules',
  setup(build) {
    // Resolve .node imports to absolute paths and move them into
    // the "node-file" virtual namespace for custom loading.
    build.onResolve({ filter: /\.node$/, namespace: 'file' }, args => ({
      path: require.resolve(args.path, { paths: [args.resolveDir] }),
      namespace: 'node-file',
    }));

    // Emit a small wrapper that requires the .node file at runtime
    // using the path esbuild copies it to in the output directory.
    build.onLoad({ filter: /.*/, namespace: 'node-file' }, args => ({
      contents: `
        import path from ${JSON.stringify(args.path)}
        try { module.exports = require(path) }
        catch {}
      `,
    }));

    // When a .node file is referenced from within the "node-file" namespace,
    // hand it back to the "file" namespace so esbuild's default file loader
    // copies it to the output directory.
    build.onResolve({ filter: /\.node$/, namespace: 'node-file' }, args => ({
      path: args.path,
      namespace: 'file',
    }));

    // Use the "file" loader for .node files — copies them to output
    // and returns the output path as a string.
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
  outfile: 'dist/esbuild-bundle.cjs',
  plugins: [nativeNodeModulesPlugin],
});
