import type { Metadata } from 'next';
import DocsPageClient from './DocsPageClient';

export const metadata: Metadata = {
  title: 'Documentation — BNBot',
  description: 'Get started with BNBot — your AI agent for personal branding. Learn how to set up the CLI, install the Chrome Extension, and automate content across 30+ platforms.',
};

export default function DocsPage() {
  return <DocsPageClient />;
}
