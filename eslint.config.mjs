import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    ignores: ['.next/**', 'node_modules/**'],
    rules: {
      'jsx-a11y/label-has-associated-control': 'off',
      'no-param-reassign': 'off',
      'max-len': ['error', { code: 120 }],
    },
  },
];

export default config;
