'use client';

import React, { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

const NewNavbar: React.FC = () => {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('bnbot-theme');
    if (saved === 'light') {
      setIsDark(false);
      document.documentElement.classList.add('light-home');
    }
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.remove('light-home');
      localStorage.setItem('bnbot-theme', 'dark');
    } else {
      document.documentElement.classList.add('light-home');
      localStorage.setItem('bnbot-theme', 'light');
    }
  };

  return (
    <nav className="fixed top-0 left-0 z-50 w-full">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-end px-4 sm:px-6 lg:px-8">
        <button
          onClick={toggleTheme}
          className="rounded-full p-2 text-space-muted transition-colors hover:text-space-text hover:bg-white/10"
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </nav>
  );
};

export default NewNavbar;
