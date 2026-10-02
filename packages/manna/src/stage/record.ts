/* 움직임 클립 녹화 — 스테이지(품은 화면) 영역만 webm 으로
 *
 * 화면 공유(getDisplayMedia)로 이 탭/창을 받는다. Bethlehem 은 메인 프로세스가 자기 창을 바로 건네고,
 * 브라우저(Manna)는 "이 탭 공유" 대화상자가 뜬다(preferCurrentTab).
 * 자르기는 Region Capture(cropTo)를 먼저 쓰고, 안 되면 캔버스에 스테이지 영역만 옮겨 그린다.
 */

export interface ClipResult {
  bytes: Uint8Array;
  type: string;
  ms: number;
  w: number;
  h: number;
}

export interface Recorder {
  stop(): Promise<ClipResult>;
  /** 공유가 밖에서 끊겼을 때 (브라우저의 "공유 중지") */
  onEnded(cb: () => void): void;
}

const MAX_W = 1600;
const BITRATE = 2_000_000;

type CropTargetCtor = { fromElement(el: Element): Promise<unknown> };
type CroppableTrack = MediaStreamTrack & { cropTo?: (t: unknown) => Promise<void> };

function pickMime(): string {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}

export async function startRecording(target: HTMLElement): Promise<Recorder> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('이 브라우저는 화면 녹화를 지원하지 않습니다. Chrome 이나 Edge 에서 열어 주세요.');
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
  } as DisplayMediaStreamOptions);
  const track = stream.getVideoTracks()[0] as CroppableTrack;
  const surface = track.getSettings().displaySurface;
  if (surface && surface !== 'browser' && surface !== 'window') {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('화면 전체가 아니라 "이 탭"을 골라 주세요. 스테이지 영역만 잘라 녹화합니다.');
  }

  let recStream: MediaStream = stream;
  let cleanup = () => {};
  const rect = target.getBoundingClientRect();
  let w = Math.round(rect.width);
  let h = Math.round(rect.height);

  const CropTarget = (window as unknown as { CropTarget?: CropTargetCtor }).CropTarget;
  let cropped = false;
  if (CropTarget && track.cropTo) {
    try {
      await track.cropTo(await CropTarget.fromElement(target));
      cropped = true;
    } catch {
      /* 자기 탭이 아니거나 지원하지 않음 — 캔버스로 자른다 */
    }
  }

  if (!cropped) {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const scale = Math.min(1, MAX_W / rect.width);
    w = Math.round(rect.width * scale);
    h = Math.round(rect.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      const r = target.getBoundingClientRect();
      // 받은 영상은 창의 보이는 영역(뷰포트) 전체 — 같은 비율로 스테이지 자리를 잘라 온다
      const kx = video.videoWidth / window.innerWidth;
      const ky = video.videoHeight / window.innerHeight;
      if (video.videoWidth) ctx.drawImage(video, r.left * kx, r.top * ky, r.width * kx, r.height * ky, 0, 0, w, h);
      raf = requestAnimationFrame(draw);
    };
    draw();
    recStream = canvas.captureStream(30);
    cleanup = () => {
      cancelAnimationFrame(raf);
      video.srcObject = null;
    };
  }

  const type = pickMime();
  const rec = new MediaRecorder(recStream, { mimeType: type, videoBitsPerSecond: BITRATE });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const started = performance.now();
  rec.start(500);
  let ended: (() => void) | null = null;
  track.addEventListener('ended', () => ended?.());

  return {
    onEnded(cb) {
      ended = cb;
    },
    stop() {
      return new Promise<ClipResult>((done, fail) => {
        rec.onstop = async () => {
          cleanup();
          stream.getTracks().forEach((t) => t.stop());
          recStream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: type.split(';')[0] });
          if (!blob.size) return fail(new Error('녹화된 내용이 없습니다.'));
          done({ bytes: new Uint8Array(await blob.arrayBuffer()), type: 'video/webm', ms: Math.round(performance.now() - started), w, h });
        };
        if (rec.state === 'inactive') rec.onstop(new Event('stop'));
        else rec.stop();
      });
    },
  };
}
