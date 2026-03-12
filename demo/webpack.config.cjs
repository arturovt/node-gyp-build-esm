const path = require('node:path');

module.exports = {
  entry: './source/index.js',
  target: 'node',
  mode: 'development',
  resolve: {
    extensions: ['.js', '.mjs', '.cjs', '.json', '.node'],
  },
  output: {
    filename: 'webpack-bundle.cjs',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.node$/,
        loader: 'node-loader',
      },
    ],
  },
  devtool: false,
};
