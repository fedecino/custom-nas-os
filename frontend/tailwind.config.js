/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        nas: {
          bg: "#090e1a",
          panel: "#0f172a",
          card: "#141e33",
          border: "#1e293b",
          accent: "#38bdf8",
          accentHover: "#0ea5e9",
          led: "#00ff88"
        }
      }
    }
  },
  plugins: []
};
