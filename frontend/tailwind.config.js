/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        nas: {
          bg: "#090d16",
          panel: "#111827",
          card: "#161f31",
          border: "#233048",
          accent: "#38bdf8",
          accentHover: "#0ea5e9"
        }
      }
    }
  },
  plugins: []
};
