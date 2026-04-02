import { Metadata } from 'next';
import ClassicLayout from '@/layouts/classic/layout';

export const metadata: Metadata = {
  title: 'Credits - BNBOT',
  description: 'Manage your BNBOT credits balance. Invite friends to earn more credits and unlock premium features.',
};

export default function CreditsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ClassicLayout>{children}</ClassicLayout>;
}
