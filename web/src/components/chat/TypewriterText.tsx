'use client';

import React, { useState, useEffect, useRef } from 'react';

interface TypewriterTextProps {
  text: string;
  speed?: number; // 每个字符的延迟时间（毫秒）
  className?: string;
  onComplete?: () => void; // 打字完成时的回调
}

const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  speed = 10,
  className = '',
  onComplete,
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const previousTextRef = useRef('');
  const hasCalledComplete = useRef(false);

  useEffect(() => {
    // 如果文本变短了（比如被替换），重置显示
    if (text.length < previousTextRef.current.length) {
      setDisplayedText('');
      setCurrentIndex(0);
      hasCalledComplete.current = false;
    }
    previousTextRef.current = text;
  }, [text]);

  useEffect(() => {
    // 如果已经显示完所有文本
    if (currentIndex >= text.length) {
      // 调用完成回调（只调用一次）
      if (onComplete && !hasCalledComplete.current) {
        hasCalledComplete.current = true;
        onComplete();
      }
      return;
    }

    // 计算需要添加的新文本
    const remainingText = text.slice(currentIndex);

    // 如果没有新文本需要添加
    if (remainingText.length === 0) {
      return;
    }

    // 使用 requestAnimationFrame 来优化性能
    const timer = setTimeout(() => {
      // 一次添加多个字符以提高流畅度（取决于 speed）
      const charsToAdd = speed < 20 ? Math.ceil(20 / speed) : 1;
      const nextIndex = Math.min(currentIndex + charsToAdd, text.length);

      setDisplayedText(text.slice(0, nextIndex));
      setCurrentIndex(nextIndex);
    }, speed);

    return () => clearTimeout(timer);
  }, [text, currentIndex, speed, onComplete]);

  return <span className={className}>{displayedText}</span>;
};

export default TypewriterText;
