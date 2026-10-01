/* 명령줄 굽기 — Bethlehem 없이 화면 폴더를 Manna 한 장으로. 테스트와 자동화용.
 *
 *   npm run bake -- <화면 폴더> <출력.html> [--entry a.html,b.html] [--title 제목]
 *
 * --entry 에 여러 개를 주면 앞에서부터 v1, v2 … 로 등록한다 (같은 폴더의 옛 화면과 새 화면).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { formatBytes, newDoc, now, serializeManna } from '../packages/core/src';
import type { BlobStore, Screen } from '../packages/core/src';
import { packFolder, scanFolder } from '../packages/core/node/pack';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [dir, out] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  if (!dir || !out) {
    console.error('사용법: npm run bake -- <화면 폴더> <출력.html> [--entry a.html,b.html] [--title 제목]');
    process.exit(1);
  }
  const entries = arg('entry')?.split(',').map((s) => s.trim()).filter(Boolean);
  const base = await scanFolder(resolve(dir), entries?.[0]);
  const doc = newDoc(arg('title') ?? base.title ?? base.name);
  const blobs: BlobStore = new Map();
  const s: Screen = { id: 'SCR-001', title: base.title ?? base.name, versions: [], annotations: [] };
  doc.screens.push(s);

  for (const entry of entries ?? [base.entry]) {
    const scan = await scanFolder(resolve(dir), entry);
    const include = scan.files.filter((f) => f.referenced).map((f) => f.path);
    const skipped = scan.files.filter((f) => !f.referenced && f.path !== scan.description).map((f) => f.path);
    const r = await packFolder({
      dir: scan.dir,
      entry: scan.entry,
      include,
      description: scan.description,
      external: scan.external.map((url) => ({ url })),
      viewport: { w: 1920, h: 1080, fit: 'contain' },
    });
    for (const [sha, b] of r.blobs) blobs.set(sha, b);
    const v = s.versions.length + 1;
    s.versions.push({ v, label: entry, createdAt: now(), ...r.version });
    if (r.description) s.description = r.description;
    console.log(`v${v} ${scan.entry}: 파일 ${include.length}개 ${formatBytes(r.stats.raw)}${skipped.length ? ` · 제외(미참조) ${skipped.join(', ')}` : ''}`);
    for (const e of r.version.external) console.log(`   외부 ${e.excluded ? '✗' : '✓'} ${e.url}${e.size ? ` ${formatBytes(e.size)}` : ''}${e.note ? ` — ${e.note}` : ''}${e.error ? ` — ${e.error}` : ''}`);
  }

  const runtimeDir = resolve(import.meta.dirname, '../out/manna');
  const runtime = {
    js: await readFile(resolve(runtimeDir, 'manna-runtime.js'), 'utf8'),
    css: await readFile(resolve(runtimeDir, 'manna-runtime.css'), 'utf8'),
  };
  const html = serializeManna(doc, blobs, runtime);
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(resolve(out), html);
  console.log(`→ ${out} (${formatBytes(Buffer.byteLength(html))})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
