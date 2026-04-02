import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  extractFaqFromMarkdown,
  formatBlogDate,
  getBlogPostBySlug,
  getBlogPostSlugs,
  getBlogPostUrl,
} from '@/lib/blog';

type BlogPostPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return getBlogPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) {
    return {
      title: 'Blog Post Not Found | BNBot',
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const canonicalUrl = getBlogPostUrl(post.slug);

  return {
    title: `${post.title} | BNBot Blog`,
    description: post.description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      url: canonicalUrl,
      siteName: 'BNBOT',
      publishedTime: post.date,
      images: post.coverImage
        ? [
            {
              url: post.coverImage,
              alt: post.title,
            },
          ]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: post.coverImage ? [post.coverImage] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const canonicalUrl = getBlogPostUrl(post.slug);
  const faqItems = extractFaqFromMarkdown(post.content);
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    mainEntityOfPage: canonicalUrl,
    image: post.coverImage ? [post.coverImage] : undefined,
    author: {
      '@type': 'Organization',
      name: 'BNBot',
    },
    publisher: {
      '@type': 'Organization',
      name: 'BNBot',
    },
  };

  const faqJsonLd = faqItems.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqItems.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer,
          },
        })),
      }
    : null;

  return (
    <article className="relative overflow-hidden bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      {faqJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(240,185,11,0.12),transparent_32%),linear-gradient(to_bottom,rgba(248,250,252,0.9),rgba(255,255,255,1))]" />

      <div className="relative mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
        <header className="mt-0 border-b border-slate-200 pb-8">
          <p className="text-sm font-medium text-gold-700">{formatBlogDate(post.date)}</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            {post.title}
          </h1>

        </header>

        <a
          href="https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-10 block rounded-[24px] border border-gold-500/20 bg-gold-50/60 p-6 transition hover:border-gold-400/40 hover:bg-gold-50"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-700">About BNBot</p>
          <p className="mt-3 text-sm leading-7 text-slate-700 sm:text-base">
            BNBot is your AI Growth Agent for X — create viral content, spot the next wave, boost productivity,
            and automate everything.
          </p>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <Image
              src="/images/bnbot-home-hero-reference.jpg"
              alt="BNBot homepage hero preview"
              width={1200}
              height={500}
              className="h-auto w-full"
            />
          </div>
        </a>

        <div className="prose prose-slate mt-10 max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-gold-700 prose-a:no-underline hover:prose-a:text-gold-800 prose-strong:text-slate-950 prose-li:marker:text-gold-600">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
        </div>

        <section className="mt-12 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:p-6">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <Image
              src="/images/bnbot-x-agent-footer.jpg"
              alt="BNBot X Agent"
              width={1200}
              height={735}
              className="h-auto w-full"
            />
          </div>
          <a
            href="https://x.com/bnbot_ai"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex text-sm font-semibold text-gold-700 hover:text-gold-800"
          >
            Follow BNBot AI on X: https://x.com/bnbot_ai
          </a>
        </section>

      </div>
    </article>
  );
}
