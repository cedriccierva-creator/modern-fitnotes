/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // The app is dark-only for now; the class strategy is kept so a light theme
  // can be added later without touching every utility.
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};
