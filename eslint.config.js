const globals = require('globals');

const sharedRules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-constant-condition': 'warn',
  'no-debugger': 'warn',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'warn',
  'eqeqeq': ['warn', 'always'],
  'no-var': 'warn',
  'prefer-const': 'warn'
};

module.exports = [
  {
    // Backend: Node.js
    files: ['server.js', 'lib/**/*.js', 'routes/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: { ...sharedRules }
  },
  {
    // Frontend: browser scripts
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Riptide: 'writable',
        Terminal: 'readonly',
        FitAddon: 'readonly',
        WebLinksAddon: 'readonly',
        marked: 'readonly',
        Prism: 'readonly',
        WebSocket: 'readonly',
        CM: 'readonly',
        DOMPurify: 'readonly'
      }
    },
    rules: { ...sharedRules }
  },
  {
    // Tests: Vitest
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
        Riptide: 'writable'
      }
    },
    rules: { ...sharedRules }
  },
  {
    ignores: ['node_modules/', 'public/vendor/']
  }
];
