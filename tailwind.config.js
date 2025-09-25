/** @type {import('tailwindcss').Config} */
module.exports = {
  // Esta linha é a mais importante.
  // Diz ao Tailwind para procurar por classes em todos estes arquivos.
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  // Esta linha ativa o modo escuro manual através da classe 'dark'
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
}

