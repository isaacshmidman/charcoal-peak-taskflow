const defaultTheme = require("tailwindcss/defaultTheme");

/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
    safelist: ["xs:hidden"],
  theme: {
  	extend: {
      screens: {
        'xs': '420px',
      },
      fontFamily: {
        // Brand typeface (self-hosted; @font-face in src/styles/zephyrly.css).
        // Preflight applies fontFamily.sans to <html>, so this restyles the app.
        sans: ['"Hanken Grotesk"', ...defaultTheme.fontFamily.sans],
      },
      fontSize: {
        // Zephyrly micro sizes — named forms of the text-[10px]/text-[11px]
        // already used for date chips and counts.
        '2xs': ['10px', { lineHeight: '1.25' }],
        'xs2': ['11px', { lineHeight: '1.3' }],
      },
      boxShadow: {
        pop: 'var(--shadow-pop)',   // popovers, menus, dialogs
        hero: 'var(--shadow-hero)', // auth card
      },
      backgroundImage: {
        'sun-gradient': 'var(--sun-gradient)',
      },
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			// The Zephyrly palette (src/styles/zephyrly.css). `ink` is the warm
  			// neutral, `sun` the brand yellow, `night` the dark-mode surfaces.
  			// Written as rgb(… / <alpha-value>) so opacity modifiers work
  			// (bg-ink-900/5).
  			ink: {
  				50: '#fafaf7', 100: '#f3f2ed', 200: '#e7e5de', 300: '#d4d1c8', 400: '#98948a',
  				500: '#77736a', 600: '#5a564e', 700: '#423f39', 800: '#2a2824', 900: '#1a1915', 950: '#100f0d',
  			},
  			sun: {
  				50: '#fffdeb', 100: '#fff9c7', 200: '#fff29a', 300: '#fbe96a', 400: '#f3e23f',
  				500: '#e3cb1b', 600: '#bda010', 700: '#8c750c', 800: '#69580f', 900: '#493e10', 950: '#2a2409',
  			},
  			night: {
  				base: '#131311', sunken: '#151513', card: '#1b1a17', raised: '#232220', high: '#2b2a26',
  				line: '#2f2d28', 'line-strong': '#3b3933', 'line-bold': '#504d45',
  				danger: '#2c1512', info: '#131e30', warn: '#2a240c', 'warn-line': '#4a3f12', good: '#12241a',
  			},
  			// Surfaces and borders that swap with the theme by themselves.
  			'surface-page': 'var(--surface-page)',
  			'surface-card': 'var(--surface-card)',
  			'surface-glass': 'var(--surface-card-glass)',
  			'surface-muted': 'var(--surface-muted)',
  			'border-strong': 'var(--border-strong)',
  			'border-hairline': 'var(--border-hairline)',
  			selected: 'var(--selected)',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}