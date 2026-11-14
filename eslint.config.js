import js from '@eslint/js';
import globals from 'globals';

const sharedRules = {
  ...js.configs.recommended.rules,
  'no-console': ['error', { allow: ['warn', 'error'] }],
  'no-implicit-coercion': ['error', { allow: ['!!'] }],
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.name='eval']",
      message: 'Do not use eval.',
    },
    {
      selector: "NewExpression[callee.name='Function']",
      message: 'Do not use the Function constructor.',
    },
  ],
  'no-return-await': 'error',
  'no-throw-literal': 'error',
  'no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' },
  ],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
};

export default [
  {
    ignores: [
      '.trash/**',
      '_site/demo.js',
      'coverage/**',
      'e2e/artifacts/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: sharedRules,
  },
  {
    files: ['scripts/**/*.js', 'e2e/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
];
