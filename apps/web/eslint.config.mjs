import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "public/**", "playwright-report/**", "test-results/**"] },
  {
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "off",
      // We deliberately set state in effects for post-hydration reads (localStorage, matchMedia,
      // URL flags) and for resetting dialog state when it opens. Keep it visible, not blocking.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];
export default config;
