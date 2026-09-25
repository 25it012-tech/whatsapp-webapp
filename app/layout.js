import './globals.css';

export const metadata = {
  title: 'Common — Your people, one place',
  description: 'An independent app for one-to-one messages, voice calls, and video calls.'
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
