const path = require('node:path');

module.exports = {
  entry: './source/index.mjs',
  target: 'node',
  mode: 'development',
  output: {
    filename: 'bundle.cjs',
    path: path.resolve(__dirname, 'dist'),
    // Required for native .node files to be copied and referenced correctly
    assetModuleFilename: '[name][ext]',
  },
  module: {
    rules: [
      {
        // Handle .node native addons
        test: /\.node$/,
        loader: 'node-loader',
      },
    ],
  },
  resolve: {
    extensionAlias: {
      '.js': ['.js'],
    },
  },
  externalsPresets: { node: true },
  devtool: false,
};
