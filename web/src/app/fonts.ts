import { Fira_Code, Press_Start_2P } from 'next/font/google';
import localFont from 'next/font/local';

export const fira_code = Fira_Code({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
});

export const pressStart2P = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-press-start',
});

export const chirp = localFont({
  src: [
    {
      path: '../fonts/chirp-regular-web.woff',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../fonts/chirp-medium-web.woff',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../fonts/chirp-bold-web.woff',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../fonts/chirp-heavy-web.woff',
      weight: '800',
      style: 'normal',
    },
  ],
  variable: '--font-chirp',
  display: 'swap',
});
