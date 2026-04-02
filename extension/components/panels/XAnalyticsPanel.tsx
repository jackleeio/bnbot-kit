import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, Users, Eye, RotateCw, BadgeCheck, MessageCircle, Share2, X, Download, Sparkles, FileBarChart2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLanguage } from '../LanguageContext';
import { TwitterClient } from '../../utils/TwitterClient';
import { useXUser } from '../../hooks/useXUsername';
import { chatService } from '../../services/chatService';

// Pre-generated QR code for Chrome Web Store URL (128x128)
// URL: https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln
const CHROME_STORE_QR_CODE = 'data:image/png;base64,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';

// Animated Counter Component
interface AnimatedCounterProps {
  value: number;
  duration?: number;
}

const AnimatedCounter: React.FC<AnimatedCounterProps> = ({ value, duration = 1500 }) => {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValueRef = useRef(0);

  useEffect(() => {
    if (value === 0) {
      setDisplayValue(0);
      return;
    }

    const startValue = prevValueRef.current;
    const endValue = value;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(startValue + (endValue - startValue) * easeOut);

      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        prevValueRef.current = endValue;
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return <span>{displayValue.toLocaleString()}</span>;
};

// Interactive SVG Area Chart with Tooltip
interface SVGAreaChartProps {
  data: { date: string; value: number }[];
  color: string;
  formatDate: (date: string) => string;
  formatValue: (value: number) => string;
  showDailyChange?: boolean; // Show daily change in tooltip instead of cumulative value
}

const SVGAreaChart: React.FC<SVGAreaChartProps> = ({ data, color, formatDate, formatValue, showDailyChange = false }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  if (!data || data.length < 2) {
    return null;
  }

  const width = 280;
  const height = 140;
  const padding = { top: 12, right: 12, bottom: 12, left: 12 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const values = data.map(d => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Calculate daily changes for tooltip display
  const dailyChanges = data.map((d, i) => {
    if (i === 0) return d.value;
    return d.value - data[i - 1].value;
  });

  const getX = (index: number) => {
    return padding.left + (index / (data.length - 1)) * chartWidth;
  };

  const getY = (value: number) => {
    return padding.top + chartHeight - ((value - minVal) / range) * chartHeight;
  };

  // Build smooth curve path
  let linePath = '';
  const points: { x: number; y: number }[] = [];

  data.forEach((d, i) => {
    const x = getX(i);
    const y = getY(d.value);
    points.push({ x, y });

    if (i === 0) {
      linePath += `M ${x} ${y}`;
    } else {
      // Simple smooth curve using control points
      const prev = points[i - 1];
      const cpX = (prev.x + x) / 2;
      linePath += ` C ${cpX} ${prev.y}, ${cpX} ${y}, ${x} ${y}`;
    }
  });

  // Build area path
  const areaPath = linePath +
    ` L ${getX(data.length - 1)} ${padding.top + chartHeight}` +
    ` L ${padding.left} ${padding.top + chartHeight} Z`;

  const gradientId = `gradient-${color.replace('#', '')}-${Math.random().toString(36).substr(2, 9)}`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;

    // Find closest data point
    const chartX = x - padding.left;
    const index = Math.round((chartX / chartWidth) * (data.length - 1));
    const clampedIndex = Math.max(0, Math.min(data.length - 1, index));

    setHoverIndex(clampedIndex);
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    setMousePos(null);
  };

  const hoverPoint = hoverIndex !== null ? {
    x: getX(hoverIndex),
    y: getY(data[hoverIndex].value),
    data: data[hoverIndex],
    dailyChange: dailyChanges[hoverIndex]
  } : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover vertical line */}
        {hoverPoint && (
          <line
            x1={hoverPoint.x}
            y1={padding.top}
            x2={hoverPoint.x}
            y2={padding.top + chartHeight}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 2"
            opacity={0.5}
          />
        )}

        {/* Hover dot */}
        {hoverPoint && (
          <>
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r={6} fill={color} opacity={0.2} />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r={4} fill={color} />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r={2} fill="white" />
          </>
        )}
      </svg>

      {/* Tooltip */}
      {hoverPoint && mousePos && (
        <div
          style={{
            position: 'absolute',
            left: mousePos.x > 150 ? mousePos.x - 90 : mousePos.x + 10,
            top: Math.max(0, mousePos.y - 50),
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ color: '#999', marginBottom: '4px' }}>{formatDate(hoverPoint.data.date)}</div>
          <div style={{ fontWeight: 600, color: color }}>{formatValue(hoverPoint.data.value)}</div>
          {showDailyChange && (
            <div style={{ fontSize: '12px', fontWeight: 600, color: hoverPoint.dailyChange >= 0 ? '#22c55e' : '#ef4444', marginTop: '2px' }}>
              {hoverPoint.dailyChange >= 0 ? '+' : ''}{formatValue(hoverPoint.dailyChange)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

type TimeRange = '7D' | '2W' | '4W' | '3M' | '1Y';

interface MetricData {
  date: string;
  value: number;
}

interface AnalyticsData {
  followers: MetricData[];
  impressions: MetricData[];
  totalFollowersGain: number;
  totalImpressions: number;
}

interface ReplyImpressionsData {
  replies: Array<{
    id: string;
    text: string;
    createdAt: string;
    impressions: number;
    engagements: number;
  }>;
  chartData: MetricData[];
  totalImpressions: number;
  totalEngagements: number;
}

type ReplyTimeRange = '7D' | '2W' | '4W' | '3M' | '1Y';

const timeRangeOptions: TimeRange[] = ['7D', '2W', '4W', '3M', '1Y'];
const replyTimeRangeOptions: ReplyTimeRange[] = ['7D', '2W', '4W', '3M', '1Y'];

// 缓存配置：5分钟过期
const CACHE_TTL = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// 模块级缓存，panel 切换时不会丢失
const analyticsCache: Map<TimeRange, CacheEntry<AnalyticsData>> = new Map();
const replyImpressionsCache: Map<ReplyTimeRange, CacheEntry<ReplyImpressionsData>> = new Map();
let yearlyImpressionsCache: CacheEntry<number> | null = null;

const isCacheValid = <T,>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> => {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL;
};

const getDateRange = (range: TimeRange): { from: Date; to: Date } => {
  const to = new Date();
  to.setHours(23, 59, 59, 999);

  const from = new Date();
  from.setHours(0, 0, 0, 0);

  switch (range) {
    case '7D':
      from.setDate(from.getDate() - 7);
      break;
    case '2W':
      from.setDate(from.getDate() - 14);
      break;
    case '4W':
      from.setDate(from.getDate() - 28);
      break;
    case '3M':
      from.setMonth(from.getMonth() - 3);
      break;
    case '1Y':
      from.setFullYear(from.getFullYear() - 1);
      break;
  }

  return { from, to };
};

const formatDateLabel = (dateStr: string): string => {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

// 简化格式（用于标题）
const formatNumberShort = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

// 详细格式（用于 Tooltip，显示完整数字如 1,234,567）
const formatNumberFull = (num: number): string => {
  return num.toLocaleString();
};

interface XAnalyticsPanelProps {
  onBack?: () => void;
}

export const XAnalyticsPanel: React.FC<XAnalyticsPanelProps> = ({ onBack }) => {
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const userInfo = useXUser();

  const [timeRange, setTimeRange] = useState<TimeRange>('3M');
  const [isLoading, setIsLoading] = useState(true);
  const [isReplyLoading, setIsReplyLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [replyData, setReplyData] = useState<ReplyImpressionsData | null>(null);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [yearlyImpressions, setYearlyImpressions] = useState<number>(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isGeneratingScreenshot, setIsGeneratingScreenshot] = useState(false);
  const chartsContainerRef = useRef<HTMLDivElement>(null);

  // AI Analysis state
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [postData, setPostData] = useState<{
    posts: Array<{
      id: string;
      text: string;
      createdAt: string;
      impressions: number;
      engagements: number;
      likes: number;
    }>;
    totalImpressions: number;
  } | null>(null);

  // Lower sidebar z-index when share modal is open so modal covers it (fixes white line issue)
  useEffect(() => {
    if (showShareModal) {
      const style = document.createElement('style');
      style.id = 'share-modal-sidebar-fix';
      style.textContent = `
        [data-testid="bnbot-sidebar"] {
          z-index: 0 !important;
        }
        [data-testid="bnbot-sidebar"] * {
          z-index: 0 !important;
        }
      `;
      const shadowContainer = document.getElementById('x-sidekick-container');
      const target = shadowContainer?.shadowRoot || document.head;
      target.appendChild(style);

      return () => {
        const existingStyle = (shadowContainer?.shadowRoot || document).getElementById('share-modal-sidebar-fix');
        existingStyle?.remove();
      };
    }
  }, [showShareModal]);

  // Generate screenshot using native Canvas API
  const handleShare = async () => {
    if (!analyticsData || isGeneratingScreenshot) return;

    setIsGeneratingScreenshot(true);
    // Don't show modal yet - wait for screenshot to complete

    try {
      const canvas = document.createElement('canvas');
      const scale = 2; // Retina
      const width = 360;
      const height = 645;  // Space for watermark
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);

      // Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Helper: Draw rounded rect
      const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      };

      // Get time range label
      const timeRangeLabels: Record<TimeRange, string> = {
        '7D': 'Past Week',
        '2W': 'Past 2 Weeks',
        '4W': 'Past Month',
        '3M': 'Past 3 Months',
        '1Y': 'Past Year'
      };

      // Draw title at top (no background)
      const bannerY = 24;

      // Banner icon
      ctx.font = '18px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('🚀', 20, bannerY + 6);

      // Banner text with exclamation
      ctx.fillStyle = '#0f1419';
      ctx.font = '700 18px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(`My X Growth - ${timeRangeLabels[timeRange]}!`, 48, bannerY + 6);

      // Helper: Draw circular image
      const drawCircularImage = (img: HTMLImageElement, x: number, y: number, size: number) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, x, y, size, size);
        ctx.restore();
      };

      // Helper: Draw chart
      const drawChart = (
        data: { date: string; value: number }[],
        x: number, y: number, w: number, h: number,
        color: string, title: string, value: string
      ) => {
        // Card background
        roundRect(x, y, w, 150, 16);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#e1e8ed';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Title
        ctx.fillStyle = '#536471';
        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(title, x + 16, y + 28);

        // Value
        ctx.fillStyle = color === '#22c55e' || analyticsData.totalFollowersGain >= 0 ? '#22c55e' : '#ef4444';
        if (title !== 'Followers Growth') ctx.fillStyle = '#0f1419';
        ctx.font = '700 13px -apple-system, BlinkMacSystemFont, sans-serif';
        const valueWidth = ctx.measureText(value).width;
        ctx.fillText(value, x + w - 16 - valueWidth, y + 28);

        // Chart area
        const chartX = x + 16;
        const chartY = y + 40;
        const chartW = w - 32;
        const chartH = h - 10;

        if (data.length < 2) return;

        const values = data.map(d => d.value);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = maxVal - minVal || 1;

        const getPointX = (i: number) => chartX + (i / (data.length - 1)) * chartW;
        const getPointY = (v: number) => chartY + chartH - ((v - minVal) / range) * chartH;

        // Draw gradient fill
        const gradient = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
        gradient.addColorStop(0, color + '40');
        gradient.addColorStop(1, color + '08');

        ctx.beginPath();
        ctx.moveTo(getPointX(0), getPointY(data[0].value));
        for (let i = 1; i < data.length; i++) {
          const prevX = getPointX(i - 1);
          const prevY = getPointY(data[i - 1].value);
          const currX = getPointX(i);
          const currY = getPointY(data[i].value);
          const cpX = (prevX + currX) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, currY, currX, currY);
        }
        ctx.lineTo(getPointX(data.length - 1), chartY + chartH);
        ctx.lineTo(chartX, chartY + chartH);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw line
        ctx.beginPath();
        ctx.moveTo(getPointX(0), getPointY(data[0].value));
        for (let i = 1; i < data.length; i++) {
          const prevX = getPointX(i - 1);
          const prevY = getPointY(data[i - 1].value);
          const currX = getPointX(i);
          const currY = getPointY(data[i].value);
          const cpX = (prevX + currX) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, currY, currX, currY);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();
      };

      // Load avatar image
      let avatarImg: HTMLImageElement | null = null;
      if (userInfo.avatarUrl) {
        try {
          avatarImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = userInfo.avatarUrl!;
          });
        } catch (e) {
          console.log('[XAnalytics] Failed to load avatar for screenshot');
        }
      }

      // Draw user info section
      const avatarSize = 48;
      const avatarX = 20;
      const avatarY = 52;  // Closer to title

      if (avatarImg) {
        drawCircularImage(avatarImg, avatarX, avatarY, avatarSize);
      } else {
        // Fallback: draw placeholder circle
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#e1e8ed';
        ctx.fill();
      }

      // Display name
      ctx.fillStyle = '#0f1419';
      ctx.font = '700 16px -apple-system, BlinkMacSystemFont, sans-serif';
      const displayName = userInfo.displayName || userInfo.username || 'User';
      ctx.fillText(displayName, avatarX + avatarSize + 12, avatarY + 22);

      // Blue verified badge if user is verified (official Twitter/X style)
      if (userInfo.isBlueVerified) {
        const nameWidth = ctx.measureText(displayName).width;
        const badgeX = avatarX + avatarSize + 12 + nameWidth + 6;
        const badgeY = avatarY + 6;
        const size = 18;

        // Use official Twitter verified badge SVG path
        ctx.save();
        ctx.translate(badgeX, badgeY);
        ctx.scale(size / 22, size / 22);

        ctx.fillStyle = '#1D9BF0';
        const badgePath = new Path2D('M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z');
        ctx.fill(badgePath);
        ctx.restore();
      }

      // Username
      ctx.fillStyle = '#536471';
      ctx.font = '400 14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(`@${userInfo.username || 'user'}`, avatarX + avatarSize + 12, avatarY + 42);

      // Yearly Impressions on right side
      ctx.fillStyle = '#536471';
      ctx.font = '400 11px -apple-system, BlinkMacSystemFont, sans-serif';
      const yearlyLabel = 'Yearly Impressions';
      const yearlyLabelWidth = ctx.measureText(yearlyLabel).width;
      ctx.fillText(yearlyLabel, width - 20 - yearlyLabelWidth, avatarY + 18);

      ctx.fillStyle = '#0f1419';
      ctx.font = '700 16px -apple-system, BlinkMacSystemFont, sans-serif';
      const yearlyValue = formatNumberShort(yearlyImpressions);
      const yearlyValueWidth = ctx.measureText(yearlyValue).width;
      ctx.fillText(yearlyValue, width - 20 - yearlyValueWidth, avatarY + 38);

      // Draw charts
      const cardWidth = 320;
      const cardX = 20;
      const chartAreaHeight = 100;
      const startY = 115;  // Closer to user info

      // Followers Growth
      const followersValue = analyticsData.totalFollowersGain >= 0
        ? `+${formatNumberShort(analyticsData.totalFollowersGain)}`
        : formatNumberShort(analyticsData.totalFollowersGain);
      drawChart(analyticsData.followers, cardX, startY, cardWidth, chartAreaHeight, '#8B5CF6', 'Followers Growth', followersValue);

      // Impressions
      drawChart(analyticsData.impressions, cardX, startY + 160, cardWidth, chartAreaHeight, '#06B6D4', 'Impressions', formatNumberShort(analyticsData.totalImpressions));

      // Reply Impressions
      if (replyData && replyData.chartData.length > 1) {
        const replyTitle = 'Reply Impressions';
        drawChart(replyData.chartData, cardX, startY + 320, cardWidth, chartAreaHeight, '#F59E0B', replyTitle, formatNumberShort(replyData.totalImpressions));
      }

      // Watermark - right aligned with CTA
      ctx.fillStyle = '#536471';
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
      const ctaText = 'Want this for your account?';
      const ctaWidth = ctx.measureText(ctaText).width;
      ctx.fillText(ctaText, width - 20 - ctaWidth, height - 32);

      // Domain link with diagonal arrow (Binance gold)
      ctx.fillStyle = '#F0B90B';
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
      const domainText = 'Try BNBot.ai ↗';
      const domainWidth = ctx.measureText(domainText).width;
      ctx.fillText(domainText, width - 20 - domainWidth, height - 14);

      // Generate real QR code on bottom left
      const qrSize = 36;
      const qrX = 20;
      const qrY = height - 14 - qrSize + 4;

      // Draw pre-generated QR code
      const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = CHROME_STORE_QR_CODE;
      });
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      const url = canvas.toDataURL('image/png');
      setScreenshotUrl(url);
      setShowShareModal(true); // Show modal only after screenshot is ready
    } catch (err) {
      console.error('[XAnalytics] Error generating screenshot:', err);
    } finally {
      setIsGeneratingScreenshot(false);
    }
  };

  // Download screenshot
  const handleDownload = () => {
    if (!screenshotUrl) return;

    const link = document.createElement('a');
    link.download = `x-analytics-${new Date().toISOString().split('T')[0]}.png`;
    link.href = screenshotUrl;
    link.click();
  };

  // Post tweet with screenshot
  const handlePostTweet = async () => {
    if (!screenshotUrl) return;

    try {
      // Close modal first
      closeShareModal();

      // Helper functions
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      const waitForElement = async (selector: string, timeout = 5000): Promise<HTMLElement | null> => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const el = document.querySelector(selector) as HTMLElement;
          if (el) return el;
          await delay(100);
        }
        return null;
      };

      // 1. Click "New Tweet" button
      const newTweetBtn = await waitForElement('[data-testid="SideNav_NewTweet_Button"]', 10000);
      if (!newTweetBtn) {
        console.error('[XAnalytics] New Tweet button not found');
        return;
      }
      newTweetBtn.click();

      // 2. Wait for composer modal
      await waitForElement('[role="dialog"] [data-testid="tweetTextarea_0RichTextInputContainer"]', 5000);
      await delay(300);

      // 3. Focus and fill text
      const textarea = document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]') as HTMLElement;
      if (textarea) {
        textarea.focus();
        textarea.click();
        await delay(100);

        // Random marketing phrases
        const marketingPhrasesEn = [
          "Numbers don't lie. Here's my X growth journey 🚀",
          "Tracking progress, building presence. My X analytics 📊",
          "Growth is a game of consistency. Here's proof 💪",
          "Every impression counts. Here's my story 📈",
          "Data-driven growth hits different 🎯",
          "The grind is paying off. Check the stats 🔥",
          "Building in public. Here are my numbers 👀",
          "Proof > Promise. My X growth this month 📊",
          "Small wins compound. Here's the data 🌱",
          "Obsessed with growth? Same. Here's mine 💯"
        ];

        const marketingPhrasesZh = [
          "数据不会说谎，这是我的 X 增长之旅 🚀",
          "追踪进度，打造影响力。我的 X 数据 📊",
          "增长是坚持的游戏，这是证明 💪",
          "每一次曝光都很重要，这是我的故事 📈",
          "数据驱动的增长就是不一样 🎯",
          "努力正在得到回报，看看这些数据 🔥",
          "公开建设，这是我的数据 👀",
          "用数据说话，我这个月的 X 增长 📊",
          "小胜利会复利，这是数据 🌱",
          "痴迷于增长？我也是，这是我的 💯"
        ];

        const phrases = isZh ? marketingPhrasesZh : marketingPhrasesEn;
        const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

        const tweetText = `${randomPhrase}\n\n@BNBot_AI #BNBot`;

        // Use simulatePaste + "shake" technique (same as tweetPoster.ts)
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(tweetText, 'text/plain');
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer
        });
        textarea.dispatchEvent(pasteEvent);
        await delay(50);

        // "Shake" the editor: Type space then delete it to force React to register
        document.execCommand('insertText', false, ' ');
        textarea.dispatchEvent(new InputEvent('input', { data: ' ', inputType: 'insertText', bubbles: true }));
        await delay(20);
        document.execCommand('delete', false, undefined);
        textarea.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        await delay(200);
      }

      // 4. Upload the screenshot image
      const fileInput = document.querySelector('[role="dialog"] input[data-testid="fileInput"]') as HTMLInputElement;
      if (fileInput && screenshotUrl) {
        // Convert data URL to blob
        const response = await fetch(screenshotUrl);
        const blob = await response.blob();
        const file = new File([blob], `x-analytics-${Date.now()}.png`, { type: 'image/png' });

        // Create FileList
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

        // Trigger change event
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        console.log('[XAnalytics] Screenshot uploaded to tweet composer');
      }

    } catch (err) {
      console.error('[XAnalytics] Error posting tweet:', err);
    }
  };

  // Close modal
  const closeShareModal = () => {
    setShowShareModal(false);
    setScreenshotUrl(null);
  };

  // Build AI Analysis prompt
  const buildAnalysisPrompt = (data: {
    timeRange: string;
    totalFollowersGain: number;
    totalImpressions: number;
    top10Posts: Array<{ text: string; impressions: number; likes: number; engagements: number }>;
  }) => {
    const timeRangeLabels: Record<string, string> = {
      '7D': 'Past 7 Days',
      '2W': 'Past 2 Weeks',
      '4W': 'Past 4 Weeks',
      '3M': 'Past 3 Months',
      '1Y': 'Past Year'
    };

    const postsText = data.top10Posts.map((p, i) =>
      `${i + 1}. "${p.text.slice(0, 200)}${p.text.length > 200 ? '...' : ''}"\n` +
      `   Impressions: ${p.impressions.toLocaleString()} | Likes: ${p.likes} | Engagements: ${p.engagements}`
    ).join('\n\n');

    return `Analyze my X (Twitter) analytics and provide actionable insights.

**Time Period**: ${timeRangeLabels[data.timeRange] || data.timeRange}
**Follower Change**: ${data.totalFollowersGain >= 0 ? '+' : ''}${data.totalFollowersGain.toLocaleString()}
**Total Impressions**: ${data.totalImpressions.toLocaleString()}

**Top 10 Posts by Impressions**:
${postsText}

Please provide a comprehensive analysis in the following format:

## 📊 Key Insights
- Analyze follower growth trend (positive/negative, rate)
- Identify engagement patterns
- Note best performing content characteristics

## 📝 Content Analysis
- What content types/topics perform best
- Common patterns in high-impression posts
- Your unique voice/style based on top posts

## 🎯 Content-Market Fit
One sentence describing your positioning and target audience based on what resonates

## 💡 Recommendations
- **Double Down**: 2-3 topics/formats to do more of
- **Expand Into**: 1-2 adjacent topics that could work
- **Experiment With**: 1 new idea to test

## ✅ Action Items
3-5 specific, actionable next steps to accelerate growth

Keep the response concise but insightful. Use bullet points for readability.

IMPORTANT: You MUST respond entirely in ${isZh ? 'Chinese (简体中文)' : 'English'}.`;
  };

  // Handle AI Analysis
  const handleAIAnalysis = async () => {
    if (isAnalyzing) return;

    setShowAIPanel(true);
    setIsAnalyzing(true);
    setAiAnalysis('');

    try {
      // 1. Get post data (if not already cached)
      let posts = postData?.posts;
      if (!posts) {
        const { from, to } = getDateRange(timeRange);
        const result = await TwitterClient.getPostImpressions({ from, to });
        posts = result.posts;
        setPostData({ posts: result.posts, totalImpressions: result.totalImpressions });
      }

      // 2. Get Top 10 by impressions
      const top10 = [...posts]
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10);

      // 3. Build prompt
      const prompt = buildAnalysisPrompt({
        timeRange,
        totalFollowersGain: analyticsData?.totalFollowersGain || 0,
        totalImpressions: analyticsData?.totalImpressions || 0,
        top10Posts: top10
      });

      // 4. Call AI (streaming)
      await chatService.sendChatV2Stream(
        prompt,
        (chunk) => {
          setAiAnalysis(prev => prev + chunk);
        }
      );
    } catch (error) {
      console.error('[XAnalytics] AI Analysis error:', error);
      setAiAnalysis(isZh ? '分析失败，请重试。' : 'Failed to analyze. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Clear post data when time range changes
  useEffect(() => {
    setPostData(null);
  }, [timeRange]);

  // Fetch yearly impressions on mount (with cache)
  useEffect(() => {
    const fetchYearlyImpressions = async () => {
      // 检查缓存
      if (isCacheValid(yearlyImpressionsCache)) {
        setYearlyImpressions(yearlyImpressionsCache.data);
        return;
      }

      try {
        const to = new Date();
        const from = new Date();
        from.setFullYear(from.getFullYear() - 1);

        const data = await TwitterClient.getAccountAnalytics({
          fromTime: from.toISOString(),
          toTime: to.toISOString(),
          granularity: 'Weekly',
        });

        const timeSeries = data?.data?.viewer_v2?.user_results?.result?.organic_metrics_time_series || [];
        let total = 0;
        timeSeries.forEach((point: any) => {
          const metricValues = point.metric_values || [];
          const impressionsMetric = metricValues.find((m: any) => m.metric_type === 'Impressions');
          total += impressionsMetric?.metric_value || 0;
        });

        // 存入缓存
        yearlyImpressionsCache = { data: total, timestamp: Date.now() };
        setYearlyImpressions(total);
      } catch (err) {
        console.error('[XAnalytics] Error fetching yearly impressions:', err);
      }
    };
    fetchYearlyImpressions();
  }, []);

  // Fetch reply impressions (uses main timeRange)
  const fetchReplyImpressions = async (forceRefresh = false) => {
    // 检查缓存（非强制刷新时）
    if (!forceRefresh) {
      const cached = replyImpressionsCache.get(timeRange as ReplyTimeRange);
      if (isCacheValid(cached)) {
        setReplyData(cached.data);
        setIsReplyLoading(false);
        return;
      }
    }

    setIsReplyLoading(true);

    try {
      // Build date range based on timeRange
      const { from, to } = getDateRange(timeRange);
      const data = await TwitterClient.getReplyImpressions({ from, to });

      // Aggregate impressions by date for chart
      const dailyImpressions: Record<string, number> = {};

      data.replies.forEach(reply => {
        if (reply.createdAt) {
          const date = new Date(reply.createdAt);
          const dateKey = date.toISOString().split('T')[0];
          dailyImpressions[dateKey] = (dailyImpressions[dateKey] || 0) + reply.impressions;
        }
      });

      // Convert to sorted array and calculate cumulative values
      const sortedDates = Object.keys(dailyImpressions).sort();
      let cumulative = 0;
      const chartData: MetricData[] = sortedDates.map(date => {
        cumulative += dailyImpressions[date];
        return { date, value: cumulative };
      });

      const result: ReplyImpressionsData = {
        replies: data.replies,
        chartData,
        totalImpressions: data.totalImpressions,
        totalEngagements: data.totalEngagements
      };

      // 存入缓存
      replyImpressionsCache.set(timeRange as ReplyTimeRange, { data: result, timestamp: Date.now() });
      setReplyData(result);
    } catch (err) {
      console.error('[XAnalytics] Error fetching reply impressions:', err);
    } finally {
      setIsReplyLoading(false);
    }
  };

  // Fetch reply impressions when timeRange changes
  useEffect(() => {
    fetchReplyImpressions();
  }, [timeRange]);

  const fetchAnalytics = async (forceRefresh = false) => {
    // 检查缓存（非强制刷新时）
    if (!forceRefresh) {
      const cached = analyticsCache.get(timeRange);
      if (isCacheValid(cached)) {
        setAnalyticsData(cached.data);
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      const { from, to } = getDateRange(timeRange);
      const granularity = timeRange === '1Y' ? 'Weekly' : 'Daily';

      const data = await TwitterClient.getAccountAnalytics({
        fromTime: from.toISOString(),
        toTime: to.toISOString(),
        granularity,
      });

      const userResult = data?.data?.viewer_v2?.user_results?.result;
      const timeSeries = userResult?.organic_metrics_time_series || [];

      // Get current total followers from API response
      const currentFollowers = userResult?.relationship_counts?.followers || 0;

      // First pass: calculate total net change over the period
      let totalNetChange = 0;
      timeSeries.forEach((point: any) => {
        const metricValues = point.metric_values || [];
        const followsMetric = metricValues.find((m: any) => m.metric_type === 'Follows');
        const unfollowsMetric = metricValues.find((m: any) => m.metric_type === 'Unfollows');
        const follows = followsMetric?.metric_value || 0;
        const unfollows = unfollowsMetric?.metric_value || 0;
        totalNetChange += (follows - unfollows);
      });

      // Calculate starting followers (current - total change)
      const startingFollowers = currentFollowers - totalNetChange;

      const followersData: MetricData[] = [];
      const impressionsData: MetricData[] = [];

      let runningFollowers = startingFollowers;
      let cumulativeImpressions = 0;

      // Second pass: build the data arrays with total values
      timeSeries.forEach((point: any) => {
        const timestamp = point.timestamp?.iso8601_time;
        if (!timestamp) return;

        const metricValues = point.metric_values || [];

        const followsMetric = metricValues.find((m: any) => m.metric_type === 'Follows');
        const unfollowsMetric = metricValues.find((m: any) => m.metric_type === 'Unfollows');
        const impressionsMetric = metricValues.find((m: any) => m.metric_type === 'Impressions');

        // Calculate total followers at this point
        const follows = followsMetric?.metric_value || 0;
        const unfollows = unfollowsMetric?.metric_value || 0;
        runningFollowers += (follows - unfollows);

        followersData.push({
          date: timestamp,
          value: runningFollowers
        });

        // Calculate cumulative impressions
        const impressions = impressionsMetric?.metric_value || 0;
        cumulativeImpressions += impressions;

        impressionsData.push({
          date: timestamp,
          value: cumulativeImpressions
        });
      });

      const result: AnalyticsData = {
        followers: followersData,
        impressions: impressionsData,
        totalFollowersGain: totalNetChange,
        totalImpressions: cumulativeImpressions
      };

      // 存入缓存
      analyticsCache.set(timeRange, { data: result, timestamp: Date.now() });
      setAnalyticsData(result);

    } catch (err) {
      console.error('[XAnalytics] Error fetching data:', err);
      setError(isZh ? '获取数据失败' : 'Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  useEffect(() => {
    setAvatarLoaded(false);
  }, [userInfo.avatarUrl]);

  return (
    <div className="flex flex-col h-full bg-transparent overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      <div className="px-4 pt-4 pb-20 space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">
            {isZh ? 'X 数据分析' : 'X Analytics'}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleAIAnalysis}
              disabled={isLoading || !analyticsData || isAnalyzing}
              className="px-3 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <TrendingUp size={14} />
              {isAnalyzing ? (isZh ? '分析中...' : 'Analyzing...') : (isZh ? 'AI 分析' : 'AI Analysis')}
            </button>
            <button
              onClick={handleShare}
              disabled={isLoading || !analyticsData || isGeneratingScreenshot}
              className="p-1.5 rounded-full hover:bg-[var(--hover-bg)] transition-colors disabled:opacity-50"
            >
              {isGeneratingScreenshot ? (
                <svg className="w-4 h-4 text-[var(--text-secondary)] animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V2C4.318 2 0 6.318 0 12h4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--text-secondary)]" fill="currentColor">
                  <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => fetchAnalytics(true)}
              disabled={isLoading}
              className="p-1.5 rounded-full hover:bg-[var(--hover-bg)] transition-colors disabled:opacity-50"
            >
              <RotateCw size={16} className={`text-[var(--text-secondary)] ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* User Info Card */}
        <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] pl-3 pr-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 flex-shrink-0">
              {/* Placeholder/fallback - only show when no avatar URL */}
              {!userInfo.avatarUrl && (
                <div className="absolute inset-0 rounded-full bg-[var(--hover-bg)] flex items-center justify-center">
                  <Users size={20} className="text-[var(--text-secondary)]" />
                </div>
              )}
              {userInfo.avatarUrl && (
                <img
                  src={userInfo.avatarUrl}
                  alt="Avatar"
                  className="absolute inset-0 w-12 h-12 rounded-full object-cover"
                  onError={(e) => {
                    console.error('[XAnalytics] Avatar failed to load:', userInfo.avatarUrl);
                    // Hide broken image
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {userInfo.username ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <p className="text-base font-semibold text-[var(--text-primary)] truncate">
                      {userInfo.displayName || userInfo.username}
                    </p>
                    {userInfo.isBlueVerified && (
                      <BadgeCheck size={18} className="text-[#1D9BF0] flex-shrink-0" fill="#1D9BF0" stroke="white" />
                    )}
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">
                    @{userInfo.username}
                  </p>
                </>
              ) : (
                <>
                  <div className="h-4 w-24 bg-[var(--hover-bg)] rounded animate-pulse mb-1" />
                  <div className="h-3 w-20 bg-[var(--hover-bg)] rounded animate-pulse" />
                </>
              )}
            </div>
            {/* Yearly Impressions */}
            <div className="flex-shrink-0 text-right">
              <p className="text-xs text-[var(--text-secondary)]">{isZh ? '年度 Impressions' : 'Yearly Impressions'}</p>
              <p className="text-lg font-bold text-[var(--text-primary)] tabular-nums">
                <AnimatedCounter value={yearlyImpressions} duration={1500} />
              </p>
            </div>
          </div>
        </div>

        {/* Time Range Selector */}
        <div className="flex items-center gap-2">
          {timeRangeOptions.map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                timeRange === range
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
                  : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={fetchAnalytics}
              className="mt-2 text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
            >
              {isZh ? '重试' : 'Retry'}
            </button>
          </div>
        )}

        {/* Loading State */}
        {isLoading && !analyticsData && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] p-4 shadow-sm">
                <div className="h-4 w-32 bg-[var(--hover-bg)] rounded animate-pulse mb-4" />
                <div className="h-36 bg-[var(--hover-bg)] rounded-xl animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        {analyticsData && (
          <div ref={chartsContainerRef} className="space-y-4">
            {/* Followers Growth Card */}
            <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] p-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-[var(--text-secondary)]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {isZh ? '粉丝增长' : 'Followers Growth'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {analyticsData.totalFollowersGain >= 0 ? (
                    <TrendingUp size={16} className="text-green-500" />
                  ) : (
                    <TrendingDown size={16} className="text-red-500" />
                  )}
                  <span className={`text-sm font-bold ${analyticsData.totalFollowersGain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {analyticsData.totalFollowersGain >= 0 ? '+' : ''}{formatNumberShort(analyticsData.totalFollowersGain)}
                  </span>
                </div>
              </div>

              <div className="h-36">
                {analyticsData.followers.length > 1 ? (
                  <SVGAreaChart
                    data={analyticsData.followers}
                    color="#8B5CF6"
                    formatDate={formatDateLabel}
                    formatValue={formatNumberFull}
                    showDailyChange={true}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--text-secondary)] text-sm">
                    {isZh ? '暂无数据' : 'No data available'}
                  </div>
                )}
              </div>
            </div>

            {/* Impressions Card */}
            <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] p-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Eye size={18} className="text-[var(--text-secondary)]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {isZh ? '曝光量' : 'Impressions'}
                  </span>
                </div>
                <span className="text-sm font-bold text-[var(--text-primary)]">
                  {formatNumberShort(analyticsData.totalImpressions)}
                </span>
              </div>

              <div className="h-36">
                {analyticsData.impressions.length > 1 ? (
                  <SVGAreaChart
                    data={analyticsData.impressions}
                    color="#06B6D4"
                    formatDate={formatDateLabel}
                    formatValue={formatNumberFull}
                    showDailyChange={true}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--text-secondary)] text-sm">
                    {isZh ? '暂无数据' : 'No data available'}
                  </div>
                )}
              </div>
            </div>

            {/* Reply Impressions Card */}
            <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] p-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MessageCircle size={18} className="text-[var(--text-secondary)]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {isZh ? '回复曝光' : 'Reply Impressions'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {replyData && (
                    <span className="text-sm text-[var(--text-secondary)]">
                      {replyData.replies.length} {isZh ? '条' : 'replies'}
                    </span>
                  )}
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    {replyData ? formatNumberShort(replyData.totalImpressions) : '-'}
                  </span>
                </div>
              </div>

              <div className="h-36">
                {isReplyLoading && !replyData ? (
                  <div className="h-full bg-[var(--hover-bg)] rounded-xl animate-pulse" />
                ) : replyData && replyData.chartData && replyData.chartData.length > 1 ? (
                  <SVGAreaChart
                    data={replyData.chartData}
                    color="#F59E0B"
                    formatDate={formatDateLabel}
                    formatValue={formatNumberFull}
                    showDailyChange={true}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--text-secondary)] text-sm">
                    {isZh ? '暂无数据' : 'No data available'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* AI Analysis Panel - Bottom slide-in */}
      {showAIPanel && (
        <div
          className="absolute bottom-0 left-0 right-0 bg-[var(--bg-primary)] rounded-t-2xl border-t border-[var(--border-color)] z-50"
          style={{
            height: '93%',
            animation: 'slideUp 0.3s ease-out',
            boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.15)'
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5" style={{ minHeight: '56px' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-black flex items-center justify-center">
                <TrendingUp size={14} className="text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-tight">
                  {isZh ? 'AI 分析报告' : 'AI Analysis Report'}
                </h3>
                {isAnalyzing && (
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{isZh ? '正在生成...' : 'Generating...'}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowAIPanel(false)}
              className="p-1.5 rounded-lg hover:bg-[var(--hover-bg)] transition-colors"
            >
              <X size={16} className="text-[var(--text-secondary)]" />
            </button>
          </div>

          <div className="mx-5 border-b border-[var(--border-color)]" />

          {/* Content */}
          <div className="px-5 py-4 overflow-y-auto" style={{ height: 'calc(100% - 60px)', scrollbarWidth: 'none' }}>
            {isAnalyzing && !aiAnalysis ? (
              <div className="space-y-6 animate-pulse">
                {/* Section 1 */}
                <div className="rounded-xl bg-[var(--hover-bg)]/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[var(--hover-bg)] rounded" />
                    <div className="h-4 bg-[var(--hover-bg)] rounded-md w-1/3" />
                  </div>
                  <div className="space-y-2 pl-1">
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-full" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-11/12" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-4/5" />
                  </div>
                </div>
                {/* Section 2 */}
                <div className="rounded-xl bg-[var(--hover-bg)]/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[var(--hover-bg)] rounded" />
                    <div className="h-4 bg-[var(--hover-bg)] rounded-md w-2/5" />
                  </div>
                  <div className="space-y-2 pl-1">
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-10/12" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-9/12" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-full" />
                  </div>
                </div>
                {/* Section 3 */}
                <div className="rounded-xl bg-[var(--hover-bg)]/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[var(--hover-bg)] rounded" />
                    <div className="h-4 bg-[var(--hover-bg)] rounded-md w-1/4" />
                  </div>
                  <div className="space-y-2 pl-1">
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-full" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-3/4" />
                  </div>
                </div>
                {/* Section 4 */}
                <div className="rounded-xl bg-[var(--hover-bg)]/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[var(--hover-bg)] rounded" />
                    <div className="h-4 bg-[var(--hover-bg)] rounded-md w-1/3" />
                  </div>
                  <div className="space-y-2 pl-1">
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-9/12" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-10/12" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-7/12" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="ai-analysis-content prose prose-sm max-w-none
                prose-headings:text-[var(--text-primary)] prose-headings:font-semibold prose-headings:tracking-tight
                prose-h2:text-[13px] prose-h2:mt-5 prose-h2:mb-2 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-[var(--border-color)] first:prose-h2:mt-0
                prose-p:text-[var(--text-secondary)] prose-p:text-[13px] prose-p:leading-[1.7] prose-p:my-1.5
                prose-li:text-[var(--text-secondary)] prose-li:text-[13px] prose-li:leading-[1.7] prose-li:my-0.5 prose-li:pl-0
                prose-strong:text-[var(--text-primary)] prose-strong:font-semibold
                prose-ul:my-1.5 prose-ul:pl-1 prose-ul:list-disc
                prose-ol:my-1.5 prose-ol:pl-1">
                <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CSS Animation */}
      <style>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>

      {/* Share Modal */}
      {showShareModal && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 2147483647 }}
          onClick={closeShareModal}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" />

          {/* Modal */}
          <div
            className="relative bg-[var(--bg-primary)] rounded-2xl p-4 w-[360px] max-h-[85vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                {isZh ? '分享截图' : 'Share Screenshot'}
              </h3>
              <button
                onClick={closeShareModal}
                className="p-1 rounded-full hover:bg-[var(--hover-bg)] transition-colors"
              >
                <X size={18} className="text-[var(--text-secondary)]" />
              </button>
            </div>

            {isGeneratingScreenshot ? (
              <div className="h-48 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--text-secondary)] border-t-transparent" />
              </div>
            ) : screenshotUrl ? (
              <>
                <div className="flex-1 overflow-y-auto min-h-0 mb-4" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  <div className="rounded-xl overflow-hidden border border-[var(--border-color)]">
                    <img
                      src={screenshotUrl}
                      alt="Analytics Screenshot"
                      className="w-full"
                    />
                  </div>
                </div>
                <div className="flex gap-3 flex-shrink-0">
                  <button
                    onClick={handleDownload}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full border border-[var(--border-color)] text-[var(--text-primary)] font-medium text-sm hover:bg-[var(--hover-bg)] transition-colors"
                  >
                    <Download size={16} />
                    {isZh ? '保存' : 'Save'}
                  </button>
                  <button
                    onClick={handlePostTweet}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium text-sm hover:opacity-90 transition-opacity"
                  >
                    {isZh ? '发推' : 'Post'}
                  </button>
                </div>
              </>
            ) : (
              <div className="h-48 flex items-center justify-center text-[var(--text-secondary)] text-sm">
                {isZh ? '生成截图失败' : 'Failed to generate screenshot'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
