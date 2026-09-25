import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    // This MVP uses explicit effect-driven browser subscriptions and state resets.
    // Keep the compiler optimization advisory visible without blocking basic lint.
    rules: { 'react-hooks/set-state-in-effect': 'warn' }
  },
  globalIgnores(['.next/**', 'out/**', 'node_modules/**'])
]);
