'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useHomeTranslations } from '@/context/locale-context';

import {
    Globe,
    BrainCircuit,
    Feather,
    Gem,
    Palette,
    ScanSearch,
    PlaySquare,
    Repeat2,
    LibraryBig,
    ScrollText,
    MessageSquareReply,
    Timer,
    Settings2,
    LucideIcon,
    ArrowUpRight,
} from 'lucide-react';

interface Feature {
    id: string;
    translationKey: string;
    icon: LucideIcon;
    color: string;
    bg: string;
}

const featureConfig: Feature[] = [
    {
        id: 'SYS_01',
        translationKey: 'web3Trends',
        icon: Globe,
        color: 'text-orange-500',
        bg: 'bg-orange-500/10',
    },
    {
        id: 'SYS_02',
        translationKey: 'aiTrends',
        icon: BrainCircuit,
        color: 'text-purple-500',
        bg: 'bg-purple-500/10',
    },
    {
        id: 'SYS_03',
        translationKey: 'createTweets',
        icon: Feather,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
    },
    {
        id: 'SYS_04',
        translationKey: 'goldDogs',
        icon: Gem,
        color: 'text-purple-500',
        bg: 'bg-purple-500/10',
    },
    {
        id: 'SYS_05',
        translationKey: 'imageCreation',
        icon: Palette,
        color: 'text-pink-500',
        bg: 'bg-pink-500/10',
    },
    {
        id: 'SYS_06',
        translationKey: 'smartSearch',
        icon: ScanSearch,
        color: 'text-orange-500',
        bg: 'bg-orange-500/10',
    },
    {
        id: 'SYS_07',
        translationKey: 'youtubeToX',
        icon: PlaySquare,
        color: 'text-red-500',
        bg: 'bg-red-500/10',
    },
    {
        id: 'SYS_08',
        translationKey: 'tweetRepurpose',
        icon: Repeat2,
        color: 'text-blue-400',
        bg: 'bg-blue-400/10',
    },
    {
        id: 'SYS_09',
        translationKey: 'bookmarkSummary',
        icon: LibraryBig,
        color: 'text-orange-400',
        bg: 'bg-orange-400/10',
    },
    {
        id: 'SYS_10',
        translationKey: 'threadSummary',
        icon: ScrollText,
        color: 'text-purple-500',
        bg: 'bg-purple-500/10',
    },
    {
        id: 'SYS_11',
        translationKey: 'autoReply',
        icon: MessageSquareReply,
        color: 'text-yellow-500',
        bg: 'bg-yellow-500/10',
    },
    {
        id: 'SYS_12',
        translationKey: 'scheduledPosts',
        icon: Timer,
        color: 'text-orange-500',
        bg: 'bg-orange-500/10',
    },
];

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            type: 'spring',
            stiffness: 100,
            damping: 10,
        },
    },
};

const Features: React.FC = () => {
    const { t } = useHomeTranslations('home.features');

    return (
        <section className="relative overflow-hidden bg-white py-24">
            {/* Animated Blobs - same as Hero */}
            <div className="animate-blob pointer-events-none absolute left-1/4 top-20 h-72 w-72 rounded-full bg-gold-200/50 opacity-60 mix-blend-multiply blur-[80px] filter"></div>
            <div className="animate-blob animation-delay-2000 pointer-events-none absolute right-1/4 top-40 h-96 w-96 rounded-full bg-slate-200/60 opacity-60 mix-blend-multiply blur-[80px] filter"></div>
            <div className="animate-blob animation-delay-4000 pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-yellow-100 opacity-60 mix-blend-multiply blur-[80px] filter"></div>

            {/* Background Decor */}
            <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] opacity-30 [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

            <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="mb-20 text-center">
                    <h2 className="mb-6 select-none text-4xl font-bold tracking-tight md:text-5xl">
                        <span className="bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-400 bg-clip-text text-transparent">
                            BNBOT
                        </span>
                        <span className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                            {t('sectionTitle').replace('BNBOT', '')}
                        </span>
                    </h2>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                    {featureConfig.map((feature, idx) => (
                        <motion.div
                            key={feature.id}
                            variants={itemVariants}
                            className="group relative h-full"
                        >
                            <div className="absolute -inset-0.5 rounded-[2rem] bg-gradient-to-br from-slate-200 to-white opacity-50 blur transition duration-500 dark:from-slate-700 dark:to-slate-800" />

                            <div className="relative flex h-full select-none flex-col items-center rounded-[1.75rem] border border-slate-100 bg-white p-8 text-center transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/80">
                                <div
                                    className={`relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${feature.bg} ${feature.color}`}
                                >
                                    <div
                                        className={`absolute inset-0 rounded-2xl ${feature.bg} opacity-50 blur-lg`}
                                    />
                                    <feature.icon
                                        className="relative z-10 h-6 w-6"
                                        strokeWidth={1.5}
                                    />
                                </div>

                                <div className="relative z-10 space-y-0.5">
                                    <h3 className="text-lg font-bold text-slate-900 transition-colors duration-300 dark:text-slate-100">
                                        {t(`items.${feature.translationKey}.title`)}
                                    </h3>
                                    <p className="text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                                        {t(`items.${feature.translationKey}.description`)}
                                    </p>
                                </div>

                                <div className="pointer-events-none absolute inset-0 rounded-[1.75rem] bg-gradient-to-b from-transparent via-transparent to-slate-50/50 opacity-0 dark:to-slate-800/30" />
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default Features;
