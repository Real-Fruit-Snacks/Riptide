const { defineConfig } = require('vitest/config');
module.exports = defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'routes/**', 'server.js'],
      reporter: ['text', 'text-summary']
    }
  }
});
