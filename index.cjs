const runtimeRequire =
  typeof __webpack_require__ === 'function' // eslint-disable-line
    ? __non_webpack_require__ // eslint-disable-line
    : require;

// If the platform supports native addon resolving (e.g. Electron's custom
// require.addon), prefer that over the manual node-gyp-build resolution.
if (typeof runtimeRequire.addon === 'function') {
  module.exports = runtimeRequire.addon.bind(runtimeRequire);
} else {
  module.exports = require('./dist/node-gyp-build.cjs');
}
