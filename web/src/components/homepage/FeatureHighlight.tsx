'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface FeatureHighlightProps {
    title: string;
    description: string;
    features?: string[];
    ctaText?: string;
    videoPosition?: 'left' | 'right';
    videoSrc?: string; // Optional video source, if not provided, shows placeholder
    onCtaClick?: () => void;
    badge?: string;
}

const FeatureHighlight: React.FC<FeatureHighlightProps> = ({
    title,
    description,
    features,
    ctaText,
    videoPosition = 'right',
    videoSrc,
    onCtaClick,
    badge
}) => {
    return (
        <section className="py-24 bg-white relative overflow-hidden">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className={`flex flex-col lg:flex-row items-center gap-16 lg:gap-24 ${videoPosition === 'left' ? 'lg:flex-row-reverse' : ''}`}>

                    {/* Text Content */}
                    <motion.div
                        initial={{ opacity: 0, x: videoPosition === 'right' ? -50 : 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.6 }}
                        className="flex-1 text-left"
                    >
                        {badge && (
                            <div className="inline-flex items-center px-3 py-1 rounded-full bg-gold-100/50 border border-gold-200 text-gold-700 text-sm font-medium mb-6">
                                {badge}
                            </div>
                        )}

                        <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 leading-tight select-none">
                            {title}
                        </h2>

                        <p className="text-lg text-slate-600 mb-8 leading-relaxed font-light font-sans select-none">
                            {description}
                        </p>

                        {features && features.length > 0 && (
                            <ul className="space-y-4 mb-10 select-none">
                                {features.map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-3">
                                        <div className="mt-1 flex-shrink-0 w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                                            <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                        <span className="text-slate-700 font-medium">{feature}</span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {ctaText && (
                            <button
                                onClick={onCtaClick}
                                className="group inline-flex items-center gap-2 px-8 py-3 bg-slate-900 text-white rounded-full font-semibold hover:bg-slate-800 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                            >
                                {ctaText}
                                <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                            </button>
                        )}
                    </motion.div>

                    {/* Video/Image Placeholder */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.8 }}
                        className="flex-1 w-full max-w-xl lg:max-w-none"
                    >
                        <div className="relative aspect-video rounded-3xl overflow-hidden shadow-2xl bg-slate-900 border-4 border-slate-100/50 ring-1 ring-slate-900/5">
                            {/* Decorative Elements */}
                            <div className="absolute top-0 right-0 p-4 opacity-50">
                                <div className="flex gap-2">
                                    <div className="w-2 h-2 rounded-full bg-slate-600/50"></div>
                                    <div className="w-2 h-2 rounded-full bg-slate-600/50"></div>
                                    <div className="w-2 h-2 rounded-full bg-slate-600/50"></div>
                                </div>
                            </div>

                            {videoSrc ? (
                                <video
                                    src={videoSrc}
                                    className="w-full h-full object-cover"
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
                                    <div className="text-center">
                                        <div className="w-20 h-20 mx-auto bg-slate-200 rounded-full flex items-center justify-center mb-4 text-slate-400">
                                            <svg className="w-10 h-10 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                        </div>
                                        <p className="text-slate-500 font-medium">Video Placeholder</p>
                                        <p className="text-slate-400 text-sm">{videoPosition === 'left' ? '(Left Aligned)' : '(Right Aligned)'}</p>
                                    </div>
                                </div>
                            )}

                            {/* Glass reflection effect */}
                            <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none"></div>
                        </div>
                    </motion.div>

                </div>
            </div>
        </section>
    );
};

export default FeatureHighlight;
