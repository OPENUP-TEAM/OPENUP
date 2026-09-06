/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Chrome stays neutral. Saturated hue is reserved for feeling.
        ink:   { DEFAULT: '#14201E', soft: '#40514D', faint: '#7B8B86' },
        paper: { DEFAULT: '#FBFCFB', raised: '#FFFFFF', sunk: '#F1F4F2' },
        line:  { DEFAULT: '#E2E8E4', strong: '#C7D2CC' },
        tide:  { 50:'#EEF6F4', 100:'#D3E8E3', 300:'#7FC0B5', 500:'#2E8B7C', 700:'#1C5B51', 900:'#0F332E' },
        // Mood / risk scale — the only saturated ramp in the product.
        mood:  { 1:'#B4413B', 2:'#D08340', 3:'#D6B441', 4:'#7FA85C', 5:'#3F8F5C' },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '14px', pill: '999px' },
      boxShadow: { lift: '0 1px 2px rgba(20,32,30,.06), 0 8px 24px -12px rgba(20,32,30,.14)' },
    },
  },
  plugins: [],
};
