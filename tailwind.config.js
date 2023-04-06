/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'master' : 'rgb(140, 0, 140)',
        'candidate-master' : 'rgb(140, 0, 140)',
      }
    },

  },
  plugins: [
    require('tailwind-scrollbar-hide'),
  ],
}
