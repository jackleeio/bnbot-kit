'use client';

import React from 'react';

const AIIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect
      x="2"
      y="3"
      width="28"
      height="22"
      rx="11"
      fill="currentColor"
      opacity="0.18"
    />
    <rect
      x="6"
      y="6"
      width="20"
      height="16"
      rx="8"
      fill="currentColor"
      opacity="0.32"
    />
    <rect
      x="10"
      y="9"
      width="12"
      height="10"
      rx="5"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M12.5 12.75C12.5 13.5784 11.8284 14.25 11 14.25C10.1716 14.25 9.5 13.5784 9.5 12.75C9.5 11.9216 10.1716 11.25 11 11.25C11.8284 11.25 12.5 11.9216 12.5 12.75Z"
      fill="currentColor"
    />
    <path
      d="M22.5 12.75C22.5 13.5784 21.8284 14.25 21 14.25C20.1716 14.25 19.5 13.5784 19.5 12.75C19.5 11.9216 20.1716 11.25 21 11.25C21.8284 11.25 22.5 11.9216 22.5 12.75Z"
      fill="currentColor"
    />
    <path
      d="M14 17.5C15.5 18.5 17.5 18.5 19 17.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.5 8.5V6.5C13.5 5.39543 14.3954 4.5 15.5 4.5H16.5C17.6046 4.5 18.5 5.39543 18.5 6.5V8.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M10 20.5C11.6569 22.1569 13.6569 23 16 23C18.3431 23 20.3431 22.1569 22 20.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.6"
    />
  </svg>
);

export default AIIcon;
