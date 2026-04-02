'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useLocaleContext } from '@/context/locale-context';

type Locale = 'en' | 'zh';

interface LanguageOption {
    code: Locale;
    label: string;
    flag: string;
}

const languages: LanguageOption[] = [
    { code: 'en', label: 'English', flag: 'EN' },
    { code: 'zh', label: '中文', flag: '中' },
];

const LanguageIcon = ({ className }: { className?: string }) => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a49 49 0 0 1 6-.371m0 0q1.681 0 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138q1.344.092 2.666.257m-4.589 8.495a18 18 0 0 1-3.827-5.802" />
    </svg>
);

const LocaleSwitcher: React.FC = () => {
    const { locale, setLocale } = useLocaleContext();
    const [isOpen, setIsOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const currentLanguage = languages.find(lang => lang.code === locale) || languages[0];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                handleClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(() => {
            setIsOpen(false);
            setIsClosing(false);
        }, 150);
    };

    const handleSelect = (code: Locale) => {
        setLocale(code);
        handleClose();
    };

    const handleToggle = () => {
        if (isOpen) {
            handleClose();
        } else {
            setIsOpen(true);
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={handleToggle}
                className="group relative flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 hover:bg-black/[0.04]"
                title={currentLanguage.label}
                aria-label="Switch language"
            >
                <LanguageIcon className="w-[18px] h-[18px] text-slate-400 group-hover:text-slate-600 transition-colors duration-200" />
            </button>

            {isOpen && (
                <div
                    className={`absolute right-0 mt-2 origin-top-right transition-all duration-150 ${
                        isClosing
                            ? 'opacity-0 scale-95'
                            : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'
                    }`}
                >
                    <div className="bg-white/95 backdrop-blur-xl rounded-lg shadow-[0_4px_24px_-4px_rgba(0,0,0,0.1)] border border-black/[0.06] overflow-hidden min-w-0">
                        {languages.map((lang) => {
                            const isActive = locale === lang.code;
                            return (
                                <button
                                    key={lang.code}
                                    onClick={() => handleSelect(lang.code)}
                                    className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] tracking-wide transition-colors duration-150 ${
                                        isActive
                                            ? 'text-amber-700 bg-amber-50/60'
                                            : 'text-slate-500 hover:text-slate-800 hover:bg-black/[0.02]'
                                    }`}
                                >
                                    <span className={isActive ? 'font-medium' : 'font-normal'}>
                                        {lang.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LocaleSwitcher;
