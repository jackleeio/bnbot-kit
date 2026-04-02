import React, { useState } from 'react';

interface ImageWithLoadProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  alt: string;
  className?: string;
}

export default function ImageWithLoad({
  src,
  alt,
  className = '',
  ...props
}: ImageWithLoadProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div className={`relative overflow-hidden ${className} ${!isLoaded ? 'border-0' : ''}`}>
      {/* Skeleton / Placeholder */}
      {!isLoaded && (
        <div className="absolute inset-0 animate-pulse bg-gray-100" />
      )}
      
      {/* Actual Image */}
      <img
        src={src}
        alt={alt}
        className={`h-full w-full object-cover transition-opacity duration-500 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={() => setIsLoaded(true)}
        {...props}
      />
    </div>
  );
}
