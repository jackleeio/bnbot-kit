import React from 'react';

interface TextSwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    labelOn: string;
    labelOff: string;
    className?: string;
    activeColorClass?: string;
}

export const TextSwitchSimple: React.FC<TextSwitchProps> = ({
    checked,
    onChange,
    labelOn,
    labelOff,
    className = '',
    activeColorClass = 'bg-green-500'
}) => {
    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                onChange(!checked);
            }}
            className={`relative h-6 rounded-full transition-colors duration-300 cursor-pointer select-none ${checked ? activeColorClass : 'bg-gray-200 dark:bg-gray-700'
                } ${className}`}
            style={{ minWidth: '52px' }}
        >
            {/* Labels on the Track */}
            <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] font-bold leading-none pointer-events-none">
                {/* Label On (Visible on Left when Checked) */}
                <span
                    className={`text-white transition-opacity duration-300 ${checked ? 'opacity-100' : 'opacity-0'
                        }`}
                >
                    {labelOn}
                </span>

                {/* Label Off (Visible on Right when Unchecked) */}
                <span
                    className={`text-gray-500 dark:text-gray-400 transition-opacity duration-300 ${!checked ? 'opacity-100' : 'opacity-0'
                        }`}
                >
                    {labelOff}
                </span>
            </div>

            {/* Thumb */}
            <div
                className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full shadow-sm transition-transform duration-300 ease-spring`}
                style={{
                    transform: checked ? 'translateX(28px)' : 'translateX(0)'
                }}
            />
            {/* 
        Issue: If label is long, 60px might not be enough. 
        Auto-width support?
        If we use flex and a spacer?
        Better: Use specific widths for these specific toggles in their parent or here.
        "Dark"/"Light" fits in 60-64px.
        "CN"/"EN" fits easily.
       */}
        </div>
    );
};
// Re-export as default
export default TextSwitchSimple;
