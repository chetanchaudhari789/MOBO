/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './apps/*/app/**/*.{js,ts,jsx,tsx,mdx}',
    './apps/*/public/**/*.{html,js}',
    './shared/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
