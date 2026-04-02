import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatBlogDate, getBlogPostsByTag } from '@/lib/blog';

export const metadata = {
  title: 'Web3 Articles | BNBot Blog',
  description: 'Web3-focused articles on infrastructure, execution, and growth.',
};

export default function BlogWeb3Page() {
  const posts = getBlogPostsByTag('web3');

  return (
    <section className="relative overflow-hidden bg-white">
      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
        <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Web3 Articles</h1>
        <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">
          Web3 ecosystem signals, infra updates, and practical shipping guides.
        </p>

        <div className="mt-10 space-y-4">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="group rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_18px_60px_-38px_rgba(15,23,42,0.4)] transition-transform duration-200 hover:-translate-y-1"
            >
              {post.coverImage ? (
                <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200">
                  <Image src={post.coverImage} alt={post.title} width={1280} height={720} className="h-auto w-full" />
                </div>
              ) : null}
              <p className="text-sm font-medium text-slate-500">{formatBlogDate(post.date)}</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
                <Link href={`/blog/${post.slug}`} className="hover:text-gold-700 transition-colors">
                  {post.title}
                </Link>
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">{post.excerpt}</p>
              <Link
                href={`/blog/${post.slug}`}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 transition-colors hover:text-gold-700"
              >
                Read article
                <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
