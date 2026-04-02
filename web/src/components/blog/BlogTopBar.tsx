import Link from 'next/link';

export default function BlogTopBar() {
  return (
    <header className="z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="https://bnbot.ai"
          className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-gold-600 via-gold-500 to-yellow-400"
        >
          BNBot
        </Link>

        <Link
          href="https://bnbot.ai"
          className="inline-flex items-center rounded-full bg-gradient-to-r from-gold-500 to-yellow-400 px-5 py-2 text-sm font-semibold text-black transition hover:from-gold-400 hover:to-yellow-300"
        >
          Get Started
        </Link>
      </div>
    </header>
  );
}
