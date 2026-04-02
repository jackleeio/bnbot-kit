export function LivePricing(props: React.SVGAttributes<{}>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M3 3V21H21V18H6V3H3Z"
        fill="currentColor"
      />
      <path
        d="M17.5 7.5L13 12L10 9L7 13.5L8.5 15L10 12.5L13 15.5L19 8.5L17.5 7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
