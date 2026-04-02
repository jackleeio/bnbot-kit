import React, { useState, useEffect } from 'react';

export const ImageWithSkeleton = ({
    src,
    alt,
    className,
    fallbackSrc
}: {
    src: string,
    alt: string,
    className?: string,
    fallbackSrc?: string
}) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [imgSrc, setImgSrc] = useState(src);

    useEffect(() => {
        setImgSrc(src);
    }, [src]);

    return (
        <div className={`relative ${className?.includes('w-') ? '' : 'w-full'} ${className?.includes('h-') ? '' : 'h-full'}`}>
            {!isLoaded && (
                <div className={`absolute inset-0 bg-[var(--hover-bg)] animate-pulse ${className?.includes('rounded') ? className.match(/rounded-[^\s]+/)?.[0] : ''}`} />
            )}
            <img
                src={imgSrc}
                alt={alt}
                className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
                onLoad={() => setIsLoaded(true)}
                onError={(e) => {
                    if (fallbackSrc && imgSrc !== fallbackSrc) {
                        setImgSrc(fallbackSrc);
                        // Don't set loaded yet, let the fallback load
                    } else {
                        setIsLoaded(true); // Stop skeleton if no fallback or fallback failed
                    }
                }}
            />
        </div>
    );
};
