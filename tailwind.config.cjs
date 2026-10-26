/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI Variable', 'Segoe UI', 'sans-serif']
      },
      boxShadow: {
        dock: '-12px 0 40px rgba(0, 0, 0, 0.38)'
      }
    }
  },
  plugins: []
}
