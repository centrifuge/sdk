// import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  {
    // Build output. Without this, `pnpm lint` at the repo root reports the same
    // errors twice -- once in src and once in the emitted dist copy -- so the
    // repo-wide error count depended on whether anyone had run a build. The
    // root eslint.config.mjs already ignores `**/dist/**`, but ESLint 10
    // resolves config per file, so this directory's own config is the one in
    // force here and had to say it too.
    ignores: ['dist/**', 'dist-publish/**', 'temp/**'],
  },
  { files: ['**/*.{js,mjs,cjs,ts}'] },
  // { languageOptions: { globals: globals.browser } },
  ...tseslint.configs.recommended,
  {
    rules: {
      'prefer-arrow-callback': 'error',
      'no-new-func': 'error',
      'no-else-return': 'error',
      'no-constant-condition': 'error',
      'no-eval': 'error',
      'no-new-wrappers': 'error',
      'no-param-reassign': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          // The same `_` opt-out for variables and types, not just arguments.
          // Without it the convention is half a convention: a parked constant
          // renamed `_FOO` still errors, so the only ways to satisfy the rule
          // are to delete it or to disable the rule at the line. Several ABI
          // constants in `workflowExecute.ts` are deliberately parked for
          // work in progress; deleting them to satisfy a linter would be the
          // linter deciding the roadmap.
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
]
