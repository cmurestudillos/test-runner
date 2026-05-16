import js from '@eslint/js';
import prettierPlugin from 'eslint-plugin-prettier/recommended';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import globals from 'globals';

export default [
  // Ignored paths (replaces .eslintignore)
  {
    ignores: ['dist/**', 'build/**', 'coverage/**', 'release/**', '**/*.min.js', '**/*.min.css'],
  },

  // Base JS config for all source files
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // JS recommended rules
  js.configs.recommended,

  // Prettier integration (disables conflicting rules and adds prettier/prettier)
  prettierPlugin,

  // Project-specific rules
  {
    files: ['src/**/*.js'],
    plugins: {
      jsdoc: jsdocPlugin,
    },
    rules: {
      // Code quality
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',
      'eqeqeq': ['error', 'always'],
      'curly': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Complexity limits
      'complexity': ['warn', 12],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 4],
    },
  },
];
