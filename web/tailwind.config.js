module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/layouts/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: ['class', 'class'],
  theme: {
  	screens: {
  		xs: '500px',
  		sm: '640px',
  		md: '768px',
  		lg: '1024px',
  		xl: '1280px',
  		'2xl': '1440px',
  		'3xl': '1780px',
  		'4xl': '2160px'
  	},
  	extend: {
  		colors: {
  			brand: 'rgb(var(--color-brand) / <alpha-value>)',
  			body: '#fcfcfc',
  			dark: '#0D1321',
  			'light-dark': '#171e2e',
  			'sidebar-body': '#F8FAFC',
  			'space-black': '#050810',
  			'space-surface': '#0a0f1a',
  			'space-elevated': '#111827',
  			'space-text': '#f0f4ff',
  			'space-muted': '#8892b0',
  			'space-dim': '#5a6480',
  			'coral': {
  				400: '#ff6b6b',
  				500: '#ff4d4d',
  				600: '#ef4b58',
  			},
  			'teal': {
  				400: '#00e5cc',
  				500: '#00d4bb',
  			},
  			// Gold color palette for homepage
  			gold: {
  				50: '#fffbeb',
  				100: '#fef3c7',
  				200: '#fde68a',
  				300: '#fcd34d',
  				400: '#fbbf24',
  				500: '#f0b90b',
  				600: '#d97706',
  				700: '#b45309',
  				800: '#92400e',
  				900: '#78350f',
  			},
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
  			}
  		},
  		spacing: {
  			'13': '3.375rem'
  		},
  		margin: {
  			'1/2': '50%'
  		},
  		padding: {
  			full: '100%'
  		},
  		width: {
  			'calc-320': 'calc(100% - 320px)',
  			'calc-358': 'calc(100% - 358px)'
  		},
  		fontFamily: {
  			body: [
  				'Mona Sans',
  				'Roboto',
  				'Fira Code',
  				'monospace'
  			],
  			inter: [
  				'Inter',
  				'system-ui',
  				'sans-serif'
  			],
  			'twitter-chirp': [
  				'Twitter Chirp',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI',
  				'Roboto',
  				'Helvetica',
  				'Arial',
  				'sans-serif'
  			],
  			orbitron: [
  				'Orbitron',
  				'monospace'
  			],
  			exo2: [
  				'Exo 2',
  				'sans-serif'
  			],
  			rajdhani: [
  				'Rajdhani',
  				'sans-serif'
  			],
  			'sci-fi': [
  				'Orbitron',
  				'Exo 2',
  				'monospace'
  			]
  		},
  		fontSize: {
  			'13px': [
  				'13px',
  				'18px'
  			]
  		},
  		borderWidth: {
  			'3': '3px'
  		},
  		transitionDuration: {
  			'350': '350ms',
  			'600': '600ms'
  		},
  		boxShadow: {
  			main: '0px 6px 18px rgba(0, 0, 0, 0.04)',
  			light: '0px 4px 4px rgba(0, 0, 0, 0.08)',
  			large: '0px 8px 16px rgba(17, 24, 39, 0.1)',
  			card: '0px 2px 6px rgba(0, 0, 0, 0.06)',
  			transaction: '0px 8px 16px rgba(17, 24, 39, 0.06)',
  			expand: '0px 0px 50px rgba(17, 24, 39, 0.2)',
  			button: '0px 2px 4px rgba(0, 0, 0, 0.06), 0px 4px 6px rgba(0, 0, 0, 0.1)'
  		},
  		dropShadow: {
  			main: '0px 4px 8px rgba(0, 0, 0, 0.08)'
  		},
  		backgroundImage: {
  			'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))'
  		},
  		animation: {
  			blink: 'blink 1.4s infinite both;',
  			'move-up': 'moveUp 500ms infinite alternate',
  			'scale-up': 'scaleUp 500ms infinite alternate',
  			'drip-expand': 'expand 500ms ease-in forwards',
  			'drip-expand-large': 'expand-large 600ms ease-in forwards',
  			'move-up-small': 'moveUpSmall 500ms infinite alternate',
  			'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  			'ping-slow': 'ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite',
  			'spin-slow': 'spin 3s linear infinite',
  			'fade-in': 'fadeIn 200ms ease-out forwards',
  			'slide-up': 'slideUp 250ms ease-out forwards',
  			'marquee-up': 'marqueeUp 30s linear infinite',
  			'marquee-down': 'marqueeDown 30s linear infinite',
  			'marquee-left': 'marqueeLeft 25s linear infinite',
  			'marquee-right': 'marqueeRight 25s linear infinite',
  			'float': 'float 4s ease-in-out infinite',
  			'twinkle': 'twinkle 8s ease-in-out infinite',
  			'gradient-shift': 'gradientShift 6s ease-in-out infinite',
  			'fade-in-up': 'fadeInUp 0.8s ease-out forwards',
  			'marquee-left-slow': 'marqueeLeft 8s linear infinite',
  			'marquee-right-slow': 'marqueeRight 8s linear infinite',
  		},
  		keyframes: {
  			blink: {
  				'0%': {
  					opacity: 0.2
  				},
  				'20%': {
  					opacity: 1
  				},
  				'100%': {
  					opacity: 0.2
  				}
  			},
  			expand: {
  				'0%': {
  					opacity: 0,
  					transform: 'scale(1)'
  				},
  				'30%': {
  					opacity: 1
  				},
  				'80%': {
  					opacity: 0.5
  				},
  				'100%': {
  					transform: 'scale(30)',
  					opacity: 0
  				}
  			},
  			'expand-large': {
  				'0%': {
  					opacity: 0,
  					transform: 'scale(1)'
  				},
  				'30%': {
  					opacity: 1
  				},
  				'80%': {
  					opacity: 0.5
  				},
  				'100%': {
  					transform: 'scale(96)',
  					opacity: 0
  				}
  			},
  			moveUp: {
  				'0%': {
  					transform: 'translateY(0)'
  				},
  				'100%': {
  					transform: 'translateY(-20px)'
  				}
  			},
  			moveUpSmall: {
  				'0%': {
  					transform: 'translateY(0)'
  				},
  				'100%': {
  					transform: 'translateY(-10px)'
  				}
  			},
  			scaleUp: {
  				'0%': {
  					transform: 'scale(0)'
  				},
  				'100%': {
  					transform: 'scale(1)'
  				}
  			},
  			fadeIn: {
  				'0%': {
  					opacity: 0
  				},
  				'100%': {
  					opacity: 1
  				}
  			},
  			slideUp: {
  				'0%': {
  					opacity: 0,
  					transform: 'translateY(100px) scale(0.95)'
  				},
  				'100%': {
  					opacity: 1,
  					transform: 'translateY(0) scale(1)'
  				}
  			},
  			marqueeUp: {
  				'0%': {
  					transform: 'translateY(0)'
  				},
  				'100%': {
  					transform: 'translateY(-50%)'
  				}
  			},
  			marqueeDown: {
  				'0%': {
  					transform: 'translateY(-50%)'
  				},
  				'100%': {
  					transform: 'translateY(0)'
  				}
  			},
  			marqueeLeft: {
  				'0%': {
  					transform: 'translateX(0)'
  				},
  				'100%': {
  					transform: 'translateX(-50%)'
  				}
  			},
  			marqueeRight: {
  				'0%': {
  					transform: 'translateX(-50%)'
  				},
  				'100%': {
  					transform: 'translateX(0)'
  				}
  			},
  			slideUpIn: {
  				'0%': {
  					transform: 'translateY(100%)',
  					opacity: 0
  				},
  				'100%': {
  					transform: 'translateY(0)',
  					opacity: 1
  				}
  			},
  			float: {
  				'0%, 100%': { transform: 'translateY(0)' },
  				'50%': { transform: 'translateY(-8px)' }
  			},
  			twinkle: {
  				'0%, 100%': { opacity: 0.4 },
  				'50%': { opacity: 0.7 }
  			},
  			gradientShift: {
  				'0%': { backgroundPosition: '0% 50%' },
  				'50%': { backgroundPosition: '100% 50%' },
  				'100%': { backgroundPosition: '0% 50%' }
  			},
  			fadeInUp: {
  				'0%': { opacity: 0, transform: 'translateY(20px)' },
  				'100%': { opacity: 1, transform: 'translateY(0)' }
  			},
  			wiggle: {
  				'0%, 100%': { transform: 'rotate(0deg) scale(1.1)' },
  				'25%': { transform: 'rotate(-5deg) scale(1.1)' },
  				'75%': { transform: 'rotate(5deg) scale(1.1)' },
  			},
  			nod: {
  				'0%': { transform: 'scale(1.1) translateY(0)' },
  				'30%': { transform: 'scale(1.1) translateY(12px)' },
  				'60%': { transform: 'scale(1.1) translateY(-4px)' },
  				'100%': { transform: 'scale(1.1) translateY(0)' },
  			},
  			shake: {
  				'0%, 100%': { transform: 'translateX(0)' },
  				'20%': { transform: 'translateX(-3px)' },
  				'40%': { transform: 'translateX(3px)' },
  				'60%': { transform: 'translateX(-2px)' },
  				'80%': { transform: 'translateX(2px)' },
  			},
  			flipIn: {
  				'0%': { transform: 'rotateY(90deg)' },
  				'100%': { transform: 'rotateY(0deg)' }
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
    require('daisyui'),
      require("tailwindcss-animate")
],
  daisyui: {
    themes: ['light'],
  },
};
