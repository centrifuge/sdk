// import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
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
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
        },
      ],
    },
  },
]
