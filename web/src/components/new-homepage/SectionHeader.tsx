'use client';

import React from 'react';

interface SectionHeaderProps {
  title: string;
  description?: string;
  align?: 'center' | 'left';
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, description, align = 'left' }) => (
  <div className={`mb-12 md:mb-16 ${align === 'center' ? 'text-center' : ''}`}>
    <h2 className="text-[22px] font-semibold text-space-text">
      <span className="mr-2 text-coral-500">&gt;</span>
      {title}
    </h2>
    {description && (
      <p className="mt-3 max-w-2xl text-sm text-space-muted md:text-base">
        {description}
      </p>
    )}
  </div>
);

export default SectionHeader;
