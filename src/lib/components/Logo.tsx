import React from 'react';

interface LogoProps {
  className?: string;
  rotate?: boolean;
  size?: string | number;
  color?: string;
}

const Logo: React.FC<LogoProps> = ({ className, rotate, size, color }) => {
  return (
    <svg
      width="361"
      height="361"
      viewBox="0 0 361 361"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        width: size || '100%',
        height: size || '100%',
        animation: rotate ? 'cwi-logo-rotate 3.301s linear infinite' : undefined,
      }}
    >
      <style>
        {`
          @keyframes cwi-logo-rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      <path
        d="M311.576 207.573C317.154 213.077 314.69 222.534 307.182 224.433L93.3038 278.54C85.9294 280.405 79.1961 273.555 81.126 266.15L136.095 55.2423C138.024 47.8375 147.187 45.366 152.666 50.7724L311.576 207.573Z"
        stroke={color || '#FC433F'}
        strokeWidth="16"
      />
      <line
        y1="-8"
        x2="140.093"
        y2="-8"
        transform="matrix(0.705197 -0.709012 0.689215 0.724557 84.991 283.045)"
        stroke={color || '#FC433F'}
        strokeWidth="16"
      />
      <line
        y1="-8"
        x2="140.821"
        y2="-8"
        transform="matrix(-0.969787 -0.243953 0.231529 -0.972828 315.265 210.604)"
        stroke={color || '#FC433F'}
        strokeWidth="16"
      />
      <line
        y1="-8"
        x2="137.617"
        y2="-8"
        transform="matrix(0.258648 0.965971 -0.962207 0.272317 136.567 50.7839)"
        stroke={color || '#FC433F'}
        strokeWidth="16"
      />
    </svg>
  );
};

export default Logo;
