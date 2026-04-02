'use client';

import React, { useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
    ArrowLeft, Chrome, Bot, Zap, Search, Globe2,
    ImageIcon, TrendingUp, HelpCircle, Crown
} from 'lucide-react';
import {
    motion, useScroll, useTransform, useSpring,
    useMotionValue
} from 'framer-motion';
import { ChromeLogo } from '@/components/icons/chrome-logo';


import xAgentAutoReply from '@/assets/images/generated/x-agent-auto-reply.png';

// Import Shared Layout & Components
// Import Shared Layout & Components
import ClassicLayout from '@/layouts/classic/layout';
// import { Footer } from '@/components/homepage';

// --- Content Dictionary ---
const content = {
    en: {
        nav: { agents: "Agents", pricing: "Pricing" },
        hero: {
            badge: "The Gold Standard for X Growth",
            title1: "Dominate X with",
            title2: "Liquid Intelligence",
            subtitle: "Draft, engage, and analyze with superhuman precision.",
            subtitle2: "The AI copilot engineered for the 1%.",
            cta: "Install Extension"
        },
        features: {
            title: "Power",
            titleHighlight: "Unleashed",
            subtitle: "Every tool you need to scale, unified in one interface.",
            autoReply: {
                badge: "Auto-Pilot Mode",
                title: "Smart Auto-Reply",
                desc: "Our AI mimics your tone perfectly. It identifies high-value conversations and engages for you, 24/7, turning your account into a growth machine while you sleep.",
                new: "NEW"
            },
            deepVision: {
                title: "Deep Vision Analysis",
                desc: "Stop guessing. Get one-click sentiment, context, and intent analysis on any post to craft the perfect viral response instantly."
            },
            kol: {
                title: "KOL Analytics Dashboard",
                desc: "Track trending KOL tweets and performance metrics. Visualize engagement data and discover viral content patterns."
            },
            utility: {
                chat: {
                    title: "AI Chat Assistant",
                    desc: "Chat with an intelligent AI agent powered by advanced language models. Get instant help with writing tweets, brainstorming content ideas, and strategic advice for growing your presence."
                },
                toolkit: {
                    title: "AI Toolkit",
                    desc: "Sentiment Check, Viral Drafter, Fact Checker, Thread Visuals."
                },
                bounty: {
                    title: "Bounty Tasks",
                    desc: "Discover and complete bounty tasks directly from your X feed. Earn rewards while growing your presence."
                },
                image: {
                    title: "Image Generation",
                    desc: "AI-powered image suggestions for your replies - charts, memes, infographics, and photos."
                }
            }
        },
        steps: {
            s1: { title: "Install Extension", desc: "Add to Chrome in seconds. No complex setup." },
            s2: { title: "Login", desc: "Sign in to your dashboard to get started." },
            s3: { title: "Scale Growth", desc: "Activate auto-replies and watch metrics soar." }
        },
        faq: {
            title: "Frequent Questions",
            q1: "Is my account safe?", a1: "Absolutely. We use advanced human behavior simulation including random delays and session limits to strictly adhere to X's safety guidelines.",
            q2: "Does it support other browsers?", a2: "Currently we are optimized for all Chromium-based browsers (Chrome, Brave, Edge, Arc).",
            q3: "Can I use the free version?", a3: "Yes! The core AI assistant features are free to use forever."
        },
        cta: {
            title: "Ready for",
            highlight: "liftoff?",
            button: "Launch"
        }
    },
    zh: {
        nav: { agents: "代理", pricing: "价格" },
        hero: {
            badge: "X (Twitter) 增长的金本位",
            title1: "用流体智能",
            title2: "统治 X",
            subtitle: "以超人类的精度起草、互动和分析。",
            subtitle2: "专为 1% 精英打造的 AI 副驾驶。",
            cta: "安装扩展"
        },
        features: {
            title: "释放",
            titleHighlight: "无限潜能",
            subtitle: "在一个界面中统一扩展所需的所有工具。",
            autoReply: {
                badge: "自动驾驶模式",
                title: "智能自动回复",
                desc: "我们的 AI 完美模仿您的语气。它能识别高价值对话并全天候为您互动，在您睡觉时也将您的账户变成增长机器。",
                new: "全新"
            },
            deepVision: {
                title: "深度视觉分析",
                desc: "不再猜测。一键分析任意推文的情感、背景和意图，即时生成完美的病毒式回复。"
            },
            kol: {
                title: "KOL 数据面板",
                desc: "追踪热门 KOL 推文和表现指标。可视化互动数据，发现病毒式内容模式。"
            },
            utility: {
                chat: {
                    title: "AI 聊天助手",
                    desc: "与先进的 AI Agent 对话。在撰写推文、头脑风暴内容创意和制定增长策略方面获得即时帮助。"
                },
                toolkit: {
                    title: "AI 工具箱",
                    desc: "情感检查、病毒式起草、事实核查、推文配图。"
                },
                bounty: {
                    title: "赏金任务",
                    desc: "直接从您的 X 信息流中发现并完成赏金任务。在增加曝光的同时赢取奖励。"
                },
                image: {
                    title: "AI 配图生成",
                    desc: "为您的回复提供 AI 驱动的图片建议 - 图表、表情包、信息图和照片。"
                }
            }
        },
        steps: {
            s1: { title: "安装扩展", desc: "几秒钟添加到 Chrome。无需复杂设置。" },
            s2: { title: "登录", desc: "登录仪表板即可开始使用。" },
            s3: { title: "规模增长", desc: "激活自动回复，看着数据飙升。" },
        },
        faq: {
            title: "常见问题",
            q1: "我的账号安全吗？", a1: "绝对安全。我们使用先进的人类行为模拟（包括随机延迟和会话限制）来严格遵守 X 的安全准则。",
            q2: "支持其他浏览器吗？", a2: "目前我们针对所有基于 Chromium 的浏览器（Chrome, Brave, Edge, Arc）进行了优化。",
            q3: "我可以免费使用吗？", a3: "是的！核心 AI 助手功能永久免费。"
        },
        cta: {
            title: "准备好",
            highlight: "起飞了吗？",
            button: "发射吧"
        }
    }
};

// --- Authentic Home Theme Components ---

function HomeThemeNavbar({ lang, setLang }: { lang: 'en' | 'zh', setLang: (l: 'en' | 'zh') => void }) {
    const t = content[lang].nav;
    return (
        <nav className="absolute top-0 left-0 w-full bg-transparent py-4 z-50">
            <div className="max-w-7xl mx-auto pl-4 md:pl-14 pr-6 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between">
                    <div />
                    <div className="flex items-center space-x-8">
                        {/* Language Toggle */}
                        <div className="flex items-center gap-1 bg-white/50 backdrop-blur-md rounded-full p-1 border border-white/20">
                            <button
                                onClick={() => setLang('en')}
                                className={`px-2 py-1 rounded-full text-xs font-bold transition-all ${lang === 'en' ? 'bg-slate-900 text-gold-400 shadow-md' : 'text-slate-500 hover:text-slate-900'}`}
                            >
                                EN
                            </button>
                            <button
                                onClick={() => setLang('zh')}
                                className={`px-2 py-1 rounded-full text-xs font-bold transition-all ${lang === 'zh' ? 'bg-slate-900 text-gold-400 shadow-md' : 'text-slate-500 hover:text-slate-900'}`}
                            >
                                CN
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
}

function TiltCard({ children, className }: { children: React.ReactNode, className?: string }) {
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const ref = useRef<HTMLDivElement>(null);

    const mouseX = useSpring(x, { stiffness: 500, damping: 100 });
    const mouseY = useSpring(y, { stiffness: 500, damping: 100 });

    function onMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent) {
        const { left, top, width, height } = currentTarget.getBoundingClientRect();
        const xPct = (clientX - left) / width - 0.5;
        const yPct = (clientY - top) / height - 0.5;
        x.set(xPct);
        y.set(yPct);
    }

    function onMouseLeave() {
        x.set(0);
        y.set(0);
    }

    const rotateX = useTransform(mouseY, [-0.5, 0.5], [5, -5]);
    const rotateY = useTransform(mouseX, [-0.5, 0.5], [-5, 5]);

    return (
        <motion.div
            ref={ref}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            style={{
                rotateX,
                rotateY,
                transformStyle: "preserve-3d",
            }}
            className={`relative group rounded-3xl border border-slate-100 bg-white/80 backdrop-blur-xl shadow-lg hover:shadow-xl hover:shadow-gold-500/10 transition-all duration-300 ${className}`}
        >
            {/* Gold Shimmer Effect */}
            <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none z-50 bg-gradient-to-tr from-transparent via-gold-200/30 to-transparent"
                style={{ mixBlendMode: 'overlay' }} />

            <div style={{ transform: "translateZ(20px)" }} className="h-full">
                {children}
            </div>
        </motion.div>
    );
}

function GoldenWaveField() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = window.innerWidth;
        let height = window.innerHeight;

        // Resize handler
        const handleResize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
        };
        window.addEventListener('resize', handleResize);
        handleResize();

        // Configuration
        const SEPARATION = 50;

        // Wave State
        let count = 0;
        const mouse = { x: -1000, y: -1000 };

        const handleMouseMove = (e: MouseEvent) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        };
        window.addEventListener('mousemove', handleMouseMove);

        let animationFrameId: number;

        const render = () => {
            ctx.clearRect(0, 0, width, height);

            const AMOUNTX = Math.ceil(width / SEPARATION) + 2;
            const AMOUNTY = Math.ceil(height / SEPARATION) + 2;

            // Draw Grid
            for (let ix = 0; ix < AMOUNTX; ix++) {
                for (let iy = 0; iy < AMOUNTY; iy++) {
                    // Grid Position
                    const refX = ix * SEPARATION;
                    const refY = iy * SEPARATION;

                    // Base Wave
                    // sin(x + count) + sin(y + count) = rolling wave
                    const waveOffset = (Math.sin((ix * 0.5) + count) * 15) + (Math.sin((iy * 0.3) + count) * 15);

                    // Mouse Interaction (Local displacement)
                    const dx = refX - mouse.x;
                    const dy = refY - mouse.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    let interactionOffset = 0;
                    let scaleInteraction = 0;

                    if (dist < 300) {
                        const force = (300 - dist) / 300;
                        interactionOffset = Math.cos(dist * 0.05 - count * 2) * force * 20; // Ripple effect
                        scaleInteraction = force * 1.5;
                    }

                    // Final Position & Style
                    const x = refX;
                    const y = refY + waveOffset + interactionOffset;

                    // Depth effect via opacity and size
                    const baseRadius = 1.5;
                    const radius = Math.max(0.5, baseRadius + (waveOffset * 0.05) + scaleInteraction);
                    const opacity = Math.min(0.6, Math.max(0.1, 0.3 + (waveOffset * 0.01)));

                    // Draw Particle
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    // Gold Color: 240, 185, 11
                    ctx.fillStyle = `rgba(240, 185, 11, ${opacity})`;
                    ctx.fill();
                }
            }

            count += 0.05; // Speed of wave
            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouseMove);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none opacity-60" />;
}

function FluidBackground() {
    return (
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-slate-50">
            <GoldenWaveField />
            {/* Moving Blobs - Subtle base layer */}
            <motion.div
                animate={{
                    x: [0, 100, -100, 0],
                    y: [0, -100, 100, 0],
                    scale: [1, 1.2, 0.9, 1]
                }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute top-[-20%] left-[-20%] w-[80vw] h-[80vw] bg-gold-100/30 rounded-full blur-[120px] mix-blend-multiply"
            />
            <motion.div
                animate={{
                    x: [0, -150, 150, 0],
                    y: [0, 100, -100, 0],
                    scale: [1, 1.1, 0.9, 1]
                }}
                transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                className="absolute top-[20%] right-[-20%] w-[70vw] h-[70vw] bg-slate-200/40 rounded-full blur-[120px] mix-blend-multiply"
            />
        </div>
    );
}

// --- Main Page ---

export default function XAgentLandingPage() {
    const [lang, setLang] = React.useState<'en' | 'zh'>('en');
    const t = content[lang];

    const { scrollY } = useScroll();
    const heroY = useTransform(scrollY, [0, 500], [0, 150]);
    const textY = useTransform(scrollY, [0, 300], [0, 50]);

    return (
        <ClassicLayout contentClassName="!p-0">
            <div className="min-h-screen text-slate-900 font-sans selection:bg-gold-200 selection:text-gold-900 overflow-x-hidden perspective-1000">
                <FluidBackground />
                <HomeThemeNavbar lang={lang} setLang={setLang} />

                <div className="relative z-10">

                    {/* Hero Section */}
                    <section className="relative pt-32 pb-32 lg:pt-48 lg:pb-48">
                        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                            <motion.div
                                style={{ y: textY }}
                                initial={{ opacity: 0, y: 30 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                                className="text-center max-w-5xl mx-auto space-y-8"
                            >
                                {/* Badge matching home theme style */}
                                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-blue-100 shadow-sm mb-6 animate-fade-in-up hover:scale-105 transition-transform cursor-default">
                                    <Crown className="w-4 h-4 text-gold-500 fill-gold-500" />
                                    <span className="text-sm font-medium text-slate-700 tracking-tight">
                                        {t.hero.badge}
                                    </span>
                                </div>

                                <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-[1.1] text-slate-900">
                                    {t.hero.title1} <br />
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold-600 via-gold-500 to-yellow-400">
                                        {t.hero.title2}
                                    </span>
                                </h1>

                                <p className="text-xl md:text-2xl text-slate-600 max-w-3xl mx-auto leading-relaxed font-light font-body">
                                    {t.hero.subtitle}
                                    <br className="hidden md:block" /> {t.hero.subtitle2}
                                </p>

                                <div className="flex flex-col sm:flex-row gap-6 justify-center items-center pt-10">
                                    <motion.a
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        href="https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group relative flex items-center justify-center gap-3 rounded-full bg-white px-10 py-4 text-lg font-bold text-slate-900 shadow-xl shadow-slate-900/10 hover:shadow-slate-900/20 hover:bg-slate-50 transition-all duration-300"
                                    >
                                        <ChromeLogo className="h-6 w-6" />
                                        <span>{t.hero.cta}</span>
                                    </motion.a>
                                </div>
                            </motion.div>
                        </div>
                    </section>

                    {/* Features Grid */}
                    <section className="py-32 relative z-20">
                        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                            <div className="mb-20 text-center max-w-3xl mx-auto">
                                <h2 className="text-4xl md:text-5xl font-bold mb-6 text-slate-900">
                                    {t.features.title} <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold-600 to-gold-500">{t.features.titleHighlight}</span>
                                </h2>
                                <p className="text-slate-500 text-lg font-light">{t.features.subtitle}</p>
                            </div>

                            <div className="space-y-32">

                                {/* Feature Row 1: Smart Auto-Reply */}
                                <div className="grid md:grid-cols-2 gap-12 items-center">
                                    <div className="order-2 md:order-1">
                                        <TiltCard className="h-full bg-gradient-to-br from-white to-gold-50/30 border-slate-100 p-2">
                                            <div className="relative h-[400px] w-full rounded-2xl overflow-hidden border border-slate-200 shadow-2xl shadow-slate-200 bg-white">
                                                <Image
                                                    src={xAgentAutoReply}
                                                    alt="Auto Reply Engine"
                                                    fill
                                                    className="object-cover"
                                                />
                                            </div>
                                        </TiltCard>
                                    </div>
                                    <div className="order-1 md:order-2 space-y-6">
                                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900 text-gold-400 text-xs font-bold uppercase tracking-wider shadow-md">
                                            <Zap size={14} className="fill-current" /> {t.features.autoReply.badge}
                                        </div>
                                        <h3 className="text-4xl md:text-5xl font-bold text-slate-900">{t.features.autoReply.title}</h3>
                                        <p className="text-slate-600 text-xl font-medium leading-relaxed">
                                            {t.features.autoReply.desc}
                                        </p>
                                    </div>
                                </div>

                                {/* Feature Row 2: Deep Vision */}
                                <div className="grid md:grid-cols-2 gap-12 items-center">
                                    <div className="space-y-6">
                                        <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-xl shadow-slate-200">
                                            <Search size={26} />
                                        </div>
                                        <h3 className="text-4xl md:text-5xl font-bold text-slate-900">{t.features.deepVision.title}</h3>
                                        <p className="text-slate-600 text-xl font-medium leading-relaxed">
                                            {t.features.deepVision.desc}
                                        </p>
                                    </div>

                                    <TiltCard className="h-full bg-white border-slate-100 p-8">
                                        {/* Graph UI */}
                                        <div className="h-[350px] bg-slate-50/50 rounded-xl border border-slate-200 p-5 relative overflow-hidden group-hover:border-gold-200 transition-colors duration-500">
                                            <div className="absolute inset-0 bg-[linear-gradient(rgba(240,185,11,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(240,185,11,0.02)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />

                                            <div className="flex gap-4 items-end h-full justify-between relative z-10 px-4 pb-2">
                                                {[40, 70, 50, 90, 60, 80].map((h, i) => (
                                                    <motion.div
                                                        key={i}
                                                        initial={{ height: 0 }}
                                                        whileInView={{ height: `${h}%` }}
                                                        transition={{ duration: 1, delay: i * 0.1, type: "spring" }}
                                                        className="w-full relative group/bar"
                                                    >
                                                        <div className="absolute bottom-0 w-full bg-gradient-to-t from-gold-600 to-gold-300 opacity-80 rounded-t-sm shadow-[0_0_15px_rgba(240,185,11,0.4)] transition-all duration-300 group-hover/bar:shadow-[0_0_25px_rgba(240,185,11,0.6)] group-hover/bar:opacity-100" style={{ height: '100%' }} />
                                                        <div className="absolute top-0 w-full h-[2px] bg-white/80 shadow-[0_0_10px_white]" />
                                                    </motion.div>
                                                ))}
                                            </div>
                                        </div>
                                    </TiltCard>
                                </div>

                                {/* Feature Row 3: KOL Analytics Dashboard (NEW) */}
                                <div className="grid md:grid-cols-2 gap-12 items-center">
                                    <div className="order-2 md:order-1">
                                        <TiltCard className="h-full bg-white border-slate-100 p-8">
                                            {/* KOL UI Placeholder - Sleek Data Table */}
                                            <div className="bg-slate-50 rounded-xl overflow-hidden border border-slate-100 h-[300px] flex flex-col">
                                                <div className="flex items-center gap-3 p-4 border-b border-slate-200 bg-white">
                                                    <div className="w-8 h-8 rounded-full bg-gold-500/20 flex items-center justify-center text-gold-600"><Crown size={14} /></div>
                                                    <div className="flex-1 h-3 bg-slate-100 rounded opacity-60"></div>
                                                </div>
                                                <div className="p-4 space-y-3">
                                                    {[1, 2, 3, 4].map(i => (
                                                        <div key={i} className="flex items-center gap-3 animate-pulse" style={{ animationDelay: `${i * 200}ms` }}>
                                                            <div className="w-8 h-8 rounded-full bg-slate-200"></div>
                                                            <div className="flex-1 space-y-2">
                                                                <div className="h-2 bg-slate-200 rounded w-3/4"></div>
                                                                <div className="h-2 bg-slate-100 rounded w-1/2"></div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </TiltCard>
                                    </div>
                                    <div className="order-1 md:order-2 space-y-6">
                                        <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-xl shadow-slate-200">
                                            <TrendingUp size={26} />
                                        </div>
                                        <h3 className="text-4xl md:text-5xl font-bold text-slate-900">{t.features.kol.title}</h3>
                                        <p className="text-slate-600 text-xl font-medium leading-relaxed">
                                            {t.features.kol.desc}
                                        </p>
                                    </div>
                                </div>

                                {/* Feature Row 4: 4-Col Essentials */}
                                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    {/* AI Chat */}
                                    <TiltCard className="h-full bg-white border-slate-100">
                                        <div className="p-8">
                                            <Bot className="w-12 h-12 text-slate-900 mb-6" />
                                            <h4 className="text-2xl font-bold mb-3 text-slate-900">{t.features.utility.chat.title}</h4>
                                            <p className="text-slate-500 font-medium">{t.features.utility.chat.desc}</p>
                                        </div>
                                    </TiltCard>

                                    {/* AI Toolkit */}
                                    <TiltCard className="h-full bg-white border-slate-100">
                                        <div className="p-8">
                                            <Zap className="w-12 h-12 text-slate-700 mb-6" />
                                            <h4 className="text-2xl font-bold mb-3 text-slate-900">{t.features.utility.toolkit.title}</h4>
                                            <p className="text-slate-500 font-medium">{t.features.utility.toolkit.desc}</p>
                                        </div>
                                    </TiltCard>

                                    {/* Bounty Tasks */}
                                    <TiltCard className="h-full bg-white border-slate-100">
                                        <div className="p-8">
                                            <div className="w-12 h-12 rounded-full bg-gold-100 flex items-center justify-center text-gold-600 mb-6 font-black text-xl">$</div>
                                            <h4 className="text-2xl font-bold mb-3 text-slate-900">{t.features.utility.bounty.title}</h4>
                                            <p className="text-slate-500 font-medium">{t.features.utility.bounty.desc}</p>
                                        </div>
                                    </TiltCard>

                                    {/* Image Gen */}
                                    <TiltCard className="h-full bg-white border-slate-100">
                                        <div className="p-8">
                                            <ImageIcon className="w-12 h-12 text-gold-500 mb-6" />
                                            <h4 className="text-2xl font-bold mb-3 text-slate-900">{t.features.utility.image.title}</h4>
                                            <p className="text-slate-500 font-medium">{t.features.utility.image.desc}</p>
                                        </div>
                                    </TiltCard>
                                </div>

                            </div>
                        </div>
                    </section>

                    {/* Steps */}
                    <section className="py-32 bg-slate-50/50">
                        <div className="container mx-auto px-4">
                            <div className="grid md:grid-cols-3 gap-12 text-center">
                                <Step
                                    num="01"
                                    title={t.steps.s1.title}
                                    desc={t.steps.s1.desc}
                                />
                                <Step
                                    num="02"
                                    title={t.steps.s2.title}
                                    desc={t.steps.s2.desc}
                                />
                                <Step
                                    num="03"
                                    title={t.steps.s3.title}
                                    desc={t.steps.s3.desc}
                                />
                            </div>
                        </div>
                    </section>

                    {/* FAQ */}
                    <section className="py-32">
                        <div className="container mx-auto px-4 max-w-3xl">
                            <h2 className="text-3xl font-bold mb-16 text-center text-slate-900">{t.faq.title}</h2>
                            <div className="space-y-4">
                                <FaqRow q={t.faq.q1} a={t.faq.a1} />
                                <FaqRow q={t.faq.q2} a={t.faq.a2} />
                                <FaqRow q={t.faq.q3} a={t.faq.a3} />
                            </div>
                        </div>
                    </section>



                    {/* Rocket Animation Overlay - Enhanced */}


                </div>
            </div>
        </ClassicLayout>
    );
}

// --- Helper Components ---

function Step({ num, title, desc }: { num: string, title: string, desc: string }) {
    return (
        <div className="relative group">
            <div className="w-16 h-16 mx-auto bg-white rounded-2xl flex items-center justify-center font-bold text-xl text-gold-600 mb-6 group-hover:bg-gold-500 group-hover:text-white transition-all shadow-lg shadow-slate-100 group-hover:shadow-gold-200 border border-slate-100">
                {num}
            </div>
            <h3 className="text-xl font-bold mb-3 text-slate-900">{title}</h3>
            <p className="text-slate-500 font-medium text-base">{desc}</p>
        </div>
    )
}

function FaqRow({ q, a }: { q: string, a: string }) {
    return (
        <div
            className="p-6 rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-default"
        >
            <h3 className="font-bold text-lg mb-2 flex items-center gap-3 text-slate-900">
                <HelpCircle className="w-5 h-5 text-gold-500" />
                {q}
            </h3>
            <p className="text-slate-500 pl-8 font-medium">{a}</p>
        </div>
    )
}
