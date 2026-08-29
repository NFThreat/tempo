export default function Whale({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 56) / 96} viewBox="0 0 96 56" fill="none" aria-hidden="true">
      <path d="M74 22 C 72 16 68 13 62 12 L 72 18 C 74 20 75 24 74 28 C 78 28 82 27 85 24 L 80 19 Z" fill="#4a8fcb" />
      <path d="M52 15 c0 -5 4 -9 6 -12" stroke="#8fc3ea" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M56 15 c0 -4 3 -7 5 -9" stroke="#8fc3ea" strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="42" cy="32" rx="28" ry="16" fill="#5fa8e0" />
      <ellipse cx="42" cy="38" rx="20" ry="10" fill="#d7f0f2" />
      <circle cx="30" cy="28" r="2.6" fill="#1e3a5f" />
      <circle cx="70" cy="40" r="1.8" fill="#8fc3ea" opacity="0.8" />
      <circle cx="75" cy="35" r="1.3" fill="#8fc3ea" opacity="0.8" />
    </svg>
  )
}
