import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import next from '@next/eslint-plugin-next';
export default tseslint.config(
  { ignores: ['.next/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { '@next/next': next },
    rules: { ...next.configs.recommended.rules, ...next.configs['core-web-vitals'].rules },
  },
);
