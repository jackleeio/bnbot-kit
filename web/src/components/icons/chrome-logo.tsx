import React from 'react';

export const ChromeLogo = ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        className={className}
        {...props}
    >
        <path fill="#4caf50" d="M45,24c0,0.9-0.1,1.8-0.2,2.6L29.6,39.5L24,39.5l-3.3,0l0,0l0,0c1.1,0.4,2.2,0.5,3.3,0.5 C35.6,40,45,30.6,45,24z" />
        <path fill="#ffeb3b" d="M44.8,26.6C44.9,25.8,45,24.9,45,24C45,14.6,38.9,6.7,30.6,3.6L17.7,26H44.8z" />
        <path fill="#f44336" d="M24,2c0.3,0,0.6,0,0.9,0l-6.2,10.8L12.5,23l6.2,10.7l0,0l0,0l-6.3-10.9L6.1,12.3l0,0l0,0 c2.4-5.2,7-9.3,12.6-10.1C20.5,2.1,22.2,2,24,2z" />
        <path fill="#2196f3" d="M24,14c5.5,0,10,4.5,10,10s-4.5,10-10,10s-10-4.5-10-10S18.5,14,24,14z" />
        <path fill="#eceff1" d="M24 16 A 8 8 0 0 1 24 32 A 8 8 0 0 1 24 16" />
    </svg>
);
