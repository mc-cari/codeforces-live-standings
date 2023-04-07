/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors')

module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'master' : 'rgb(255, 140, 0)',
        'candidate-master' : 'rgb(180, 0, 180)',
        'specialist' : 'rgb(3,168,158)',
        'pupil' : 'rgb(136,204,34)',
      }
    },

  },
  plugins: [
    require('tailwind-scrollbar-hide'),
  ],
}
