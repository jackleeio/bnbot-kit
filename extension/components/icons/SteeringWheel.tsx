import React from 'react';

export const SteeringWheel: React.FC<{ size?: number; className?: string }> = ({
    size = 24,
    className = ''
}) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            {/* Outer Circle */}
            <circle cx="12" cy="12" r="10" />
            {/* Center Hub (Small circle) */}
            <circle cx="12" cy="12" r="3" />
            {/* Spokes - Two lines angled downwards like '八' */}
            {/* Left spoke: from approx 8 o'clock on hub to rim */}
            <path d="M9.8 14.2 L4.5 18" />
            {/* Right spoke: from approx 4 o'clock on hub to rim */}
            <path d="M14.2 14.2 L19.5 18" />
        </svg>
    );
};
