type BrandMarkProps = {
  className?: string;
};

export default function BrandMark({ className = 'h-10 w-10' }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" aria-hidden="true">
      <path
        d="M24 7.5c-8.2 0-14.8 6.55-14.8 14.65 0 8.15 6.6 14.75 14.8 14.75s14.8-6.6 14.8-14.75C38.8 14.05 32.2 7.5 24 7.5Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M17.5 34.7c1.42-4.05 3.68-6.08 6.5-6.08s5.08 2.03 6.5 6.08"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M18.85 20.35c0-2.95 2.25-5.25 5.15-5.25s5.15 2.3 5.15 5.25c0 2.85-2.25 5.12-5.15 5.12s-5.15-2.27-5.15-5.12Z"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="m35.25 8.25 1.2 3.1 3.3 1.15-3.3 1.15-1.2 3.1-1.2-3.1-3.3-1.15 3.3-1.15 1.2-3.1Z"
        fill="currentColor"
      />
      <path
        d="m34 30.7.72 1.88 2.03.67-2.03.7L34 35.8l-.72-1.85-2.03-.7 2.03-.67L34 30.7Z"
        fill="currentColor"
        opacity="0.82"
      />
      <path
        d="M24 40.4c-10.1 0-16.8-7.78-16.8-17.25C7.2 13.85 14.7 6.4 24 6.4c2.45 0 4.78.52 6.88 1.45"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
