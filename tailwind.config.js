/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/client/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        ink: '#172033',
        accent: {
          50: '#eef8ff',
          100: '#d9efff',
          500: '#2087c9',
          600: '#166da8',
          700: '#155987',
        },
      },
      boxShadow: { soft: '0 12px 35px -20px rgba(15, 23, 42, 0.25)' },
    },
  },
  plugins: [],
}
