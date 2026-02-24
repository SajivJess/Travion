/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dashboard: {
          bg: '#0C0A1D',
          surface: '#16132E',
        },
        brand: {
          primary: '#8B5CF6',
          secondary: '#16132E',
          accent: '#F59E0B',
        },
        status: {
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
        },
        ai: {
          glow: '#A78BFA',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
      },
      backdropBlur: {
        glass: '20px',
      },
      boxShadow: {
        glow: '0 0 20px rgba(139, 92, 246, 0.35)',
        'glow-accent': '0 0 20px rgba(245, 158, 11, 0.3)',
        'glow-lg': '0 0 40px rgba(139, 92, 246, 0.25)',
      }
    },
  },
  plugins: [],
}
