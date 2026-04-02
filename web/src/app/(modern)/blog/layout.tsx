import type { Metadata } from 'next';
import ClassicLayout from '@/layouts/classic/layout';
import BlogTopBar from '@/components/blog/BlogTopBar';

export const metadata: Metadata = {
  title: 'BNBot Blog',
  description: 'Product updates, SEO guidance, and AI growth playbooks from the BNBot team.',
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    title: 'BNBot Blog',
    description: 'Product updates, SEO guidance, and AI growth playbooks from the BNBot team.',
    url: 'https://bnbot.ai/blog',
    type: 'website',
  },
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClassicLayout hideTopNav contentClassName="!px-0 !pt-0 !pb-0">
      <BlogTopBar />
      {children}
    </ClassicLayout>
  );
}
