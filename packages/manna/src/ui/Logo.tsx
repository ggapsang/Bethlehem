/* Terrarium 로고 마크 — docs/key_art.png 의 잎 마크를 벡터로 옮긴 것.
 * 녹색은 제품 로고에만 쓰고 UI 색상 토큰에는 넣지 않는다 (디자인 가이드 §3.3). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg class="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="tr-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#9ED8A8" />
          <stop offset="1" stop-color="#3F9A62" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#tr-logo)" />
      <path d="M16 26.5V15" stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none" />
      <path d="M15.4 21C9.4 21 7 16.6 7.4 11.6c4.8.2 8 3.6 8 9.4z" fill="#fff" />
      <path d="M16.6 17.6c0-6 3.2-9.8 8.6-10.4.6 5.6-2.8 10.2-8.6 10.4z" fill="#fff" />
    </svg>
  );
}
