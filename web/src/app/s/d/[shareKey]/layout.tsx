import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Draft Preview - BNBot',
  description: 'Preview a scheduled tweet draft',
};

export default function DraftPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
