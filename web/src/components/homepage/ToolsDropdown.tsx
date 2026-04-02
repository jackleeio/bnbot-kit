'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useHomeTranslations } from '@/context/locale-context';
import { useAuth } from '@/lib/hooks/useAuth';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';

interface ToolsDropdownProps {
    onLogin: () => void;
}

const ToolsDropdown: React.FC<ToolsDropdownProps> = ({ onLogin }) => {
    const { t } = useHomeTranslations('home.navbar');
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const menuItems = [
        {
            key: 'drafts',
            href: '#' // Placeholder link
        },
        {
            key: 'scheduledPosts',
            href: '#' // Placeholder link
        }
    ];

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 text-slate-600 hover:text-gold-600 transition-colors text-sm font-medium"
            >
                <span>{t('tools')}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-max bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden z-50">
                    <div className="py-1">
                        {menuItems.map((item) => (
                            <Link
                                key={item.key}
                                href={item.href}
                                className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-gold-600 transition-colors whitespace-nowrap"
                                onClick={() => setIsOpen(false)}
                            >
                                <span>{t(item.key)}</span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ToolsDropdown;
