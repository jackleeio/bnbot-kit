import React, { useState, useEffect } from 'react';
import { X, Search, ChevronRight, Loader2, Image as ImageIcon } from 'lucide-react';

interface PromptItem {
    title: string;
    preview: string;
    prompt: string;
    author: string;
    link: string;
    mode: string;
    category: string;
    sub_category?: string;
    created: string;
}

interface PromptPickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (prompt: string) => void;
}

export const PromptPickerModal: React.FC<PromptPickerModalProps> = ({ isOpen, onClose, onSelect }) => {
    const [data, setData] = useState<PromptItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>('全部');
    const [searchQuery, setSearchQuery] = useState('');

    // Infinite Scroll State
    const [visibleCount, setVisibleCount] = useState(20);
    const loadMoreRef = React.useRef<HTMLDivElement>(null);
    const observerRef = React.useRef<IntersectionObserver | null>(null);

    // Fetch data on mount
    useEffect(() => {
        if (!isOpen && data.length > 0) return; // Don't re-fetch if already loaded

        const fetchData = async () => {
            setLoading(true);
            try {
                const response = await fetch('https://raw.githubusercontent.com/glidea/banana-prompt-quicker/main/prompts.json');
                if (!response.ok) throw new Error('Failed to fetch prompts');
                const jsonData = await response.json();
                setData(jsonData);
            } catch (err) {
                console.error('Error fetching prompts:', err);
                setError('Failed to load prompts');
            } finally {
                setLoading(false);
            }
        };

        if (isOpen) {
            fetchData();
        }
    }, [isOpen]);

    // Derive categories
    const categories = ['全部', ...Array.from(new Set(data.map(item => item.category))).filter(Boolean)];

    // Filter items
    const filteredItems = data.filter(item => {
        const matchesCategory = selectedCategory === '全部' || item.category === selectedCategory;
        const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.prompt.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    // Reset visible count when filters change
    useEffect(() => {
        setVisibleCount(20);
    }, [selectedCategory, searchQuery]);

    // Intersection Observer for Infinite Scroll
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    setVisibleCount(prev => prev + 20);
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        observerRef.current = observer;

        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, [filteredItems, visibleCount]); // Re-attach when list changes

    if (!isOpen) return null;

    return (
        <div
            className="absolute bottom-full left-0 right-0 z-[50] flex flex-col shadow-[0_-8px_40px_rgba(0,0,0,0.2)] border-t animate-in slide-in-from-bottom-5 fade-in duration-300 mb-2"
            style={{
                height: '85vh',
                borderTopLeftRadius: '24px',
                borderTopRightRadius: '24px',
                backgroundColor: 'var(--bg-primary)',
                borderColor: 'var(--border-color)'
            }}
            onClick={e => e.stopPropagation()}
        >
            {/* Header Area */}
            <div className="flex-none backdrop-blur-md z-20 rounded-t-[24px]" style={{ backgroundColor: 'var(--bg-primary)', opacity: 0.98 }}>
                {/* Search Bar + Close */}
                <div className="px-4 pt-4 pb-2 flex items-center gap-3">
                    <div className="relative flex-1 group">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--accent-color)] transition-colors duration-200" />
                        <input
                            type="text"
                            placeholder="Search prompts..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-transparent focus:ring-4 text-sm outline-none transition-all duration-200"
                            style={{
                                backgroundColor: 'var(--bg-secondary)',
                                color: 'var(--text-primary)',
                                borderColor: 'transparent',
                            }}
                        />
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full transition-all duration-200 hover:rotate-90 active:scale-95"
                        style={{ color: 'var(--text-secondary)' }}
                        onMouseEnter={e => {
                            e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                            e.currentTarget.style.color = 'var(--text-primary)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'var(--text-secondary)';
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Horizontal Category Tabs */}
                <div className="px-4 py-2 flex overflow-x-auto scrollbar-hide gap-2 mask-linear-fade">
                    {categories.map(category => (
                        <button
                            key={category}
                            onClick={() => setSelectedCategory(category)}
                            className={`flex-none px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${selectedCategory === category ? 'shadow-md transform scale-105' : ''}`}
                            style={{
                                backgroundColor: selectedCategory === category ? 'var(--text-primary)' : 'var(--bg-secondary)',
                                color: selectedCategory === category ? 'var(--bg-primary)' : 'var(--text-secondary)',
                                borderColor: selectedCategory === category ? 'transparent' : 'var(--border-color)',
                            }}
                        >
                            {category}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin" style={{ backgroundColor: 'var(--bg-primary)' }}>
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: 'var(--text-secondary)' }}>
                        <div className="p-4 rounded-full shadow-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent-color)' }} />
                        </div>
                        <span className="text-sm font-medium animate-pulse">Loading presets...</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full text-red-500 gap-3">
                        <p className="text-sm font-medium bg-red-50 dark:bg-red-900/10 px-4 py-2 rounded-lg border border-red-100 dark:border-red-900/20">{error}</p>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: 'var(--text-secondary)' }}>
                        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                            <Search size={32} className="opacity-20" />
                        </div>
                        <p className="text-sm font-medium">No match found</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-4 pb-4">
                            {filteredItems.slice(0, visibleCount).map((item, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => {
                                        onSelect(item.prompt);
                                        onClose();
                                    }}
                                    className="group relative flex flex-col rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer border"
                                    style={{
                                        backgroundColor: 'var(--bg-secondary)',
                                        borderColor: 'var(--border-color)',
                                    }}
                                >
                                    {/* Image Area */}
                                    <div className="aspect-[4/3] w-full relative overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                                        {item.preview ? (
                                            <img
                                                src={item.preview}
                                                alt={item.title}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                <ImageIcon size={28} />
                                            </div>
                                        )}
                                        {/* Text Overlay with Gradient */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-3">
                                            <div className="flex flex-col gap-1">
                                                <h3 className="font-bold text-white text-xs sm:text-sm line-clamp-1 drop-shadow-md">
                                                    {item.title}
                                                </h3>
                                                {item.sub_category && (
                                                    <div className="flex">
                                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-white/20 text-white backdrop-blur-sm border border-white/10 line-clamp-1">
                                                            {item.sub_category}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Hover Effect Layer (optional extra highlight) */}
                                        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Sentinel for infinite scroll */}
                        {visibleCount < filteredItems.length && (
                            <div ref={loadMoreRef} className="h-8 flex justify-center py-2">
                                <Loader2 size={20} className="animate-spin text-gray-400" />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
