/* 문서 안에서는 텍스트를 모두 UTF-8 로 읽는다 — EUC-KR 같은 옛 인코딩의 페이지는 담을 때 바꿔 둔다 */

export function toUtf8(bytes: Uint8Array, type: string, charset?: string): Uint8Array {
  const cs = charset?.toLowerCase().trim();
  if (!cs || /^utf-?8$/.test(cs) || !/^text\/|javascript|json|xml/.test(type)) return bytes;
  try {
    let text = new TextDecoder(cs).decode(bytes);
    if (type === 'text/html') text = text.replace(/<meta[^>]+charset\s*=\s*["']?[\w-]+["']?[^>]*>/i, '<meta charset="utf-8">');
    else if (type === 'text/css') text = text.replace(/^@charset\s+["'][^"']+["'];?/i, '');
    return new TextEncoder().encode(text);
  } catch {
    return bytes; // 모르는 인코딩 — 그대로 둔다
  }
}
