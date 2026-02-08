// One-time build script to bundle CodeMirror 6 into a single UMD-like file
// Run: node scripts/build-codemirror.js

const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
  entryPoints: [path.join(__dirname, 'codemirror-entry.js')],
  bundle: true,
  format: 'iife',
  globalName: 'CM',
  outfile: path.join(__dirname, '..', 'public', 'vendor', 'codemirror', 'codemirror.bundle.js'),
  minify: true,
  sourcemap: false,
  target: ['es2020'],
}).then(() => {
  console.log('CodeMirror bundle built successfully.');
}).catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
