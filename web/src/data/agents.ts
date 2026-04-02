export interface Agent {
    id: string;
    name: string;
    description: string;
    avatar: string;
    category: string;
    tags: string[];
    isActive: boolean;
    rating: number;
    totalVisits: number;
}

export const mockAgents: Agent[] = [
    {
        id: 'crypto-analyst',
        name: 'X Trend',
        description: 'Scan X in under 30s to find trending crypto topics, sentiment shifts, and key narratives.',
        avatar: '₿',
        category: 'Trends',
        tags: ['xTrends', 'sentiment', 'narratives'],
        isActive: true,
        rating: 4.8,
        totalVisits: 1250
    },
    {
        id: 'x-agent',
        name: 'X Agent',
        description: 'Become a KOL effortlessly. AI-crafted content, auto-scheduled posts, trends to Telegram.',
        avatar: '𝕏',
        category: 'X Agent',
        tags: ['content', 'kol', 'telegram'],
        isActive: true,
        rating: 4.8,
        totalVisits: 1520
    },
    {
        id: 'boost-agent',
        name: 'X Boost',
        description: 'Amplify your content\'s reach on X — 10x cheaper than X Ads.',
        avatar: '🚀',
        category: 'Marketing',
        tags: ['tweetBoost', 'tenthCost', 'goViral'],
        isActive: true,
        rating: 4.6,
        totalVisits: 850
    },
    {
        id: 'x-insight',
        name: 'X Insight',
        description: 'Deep research on AI, stocks, and crypto. Smart reports, x402 payment enabled.',
        avatar: '🧠',
        category: 'Research',
        tags: ['deepResearch', 'intelMining'],
        isActive: true,
        rating: 4.9,
        totalVisits: 1100
    },
];
