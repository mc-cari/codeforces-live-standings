/** @type {import('tailwindcss').Config} */

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        master: 'rgb(255, 140, 0)',
        'candidate-master': 'rgb(180, 0, 180)',
        specialist: 'rgb(3,168,158)',
        pupil: 'rgb(136,204,34)',
      },
    },

  },
  plugins: [
    // eslint-disable-next-line global-require
    require('tailwind-scrollbar-hide'),
  ],
};
