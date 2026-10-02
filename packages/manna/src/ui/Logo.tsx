/* Terrarium 로고 — 앱 아이콘(docs/icon.png 를 64px 로 줄인 것)을 그대로 쓴다 */
import icon from '../assets/favicon.png';

export function Logo({ size = 28 }: { size?: number }) {
  return <img class="logo" src={icon} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
