# 테라리움 작업 폴더 형식

이 문서는 테라리움 작업 폴더의 파일을 **직접 고치는 사람이나 도구**(예: 테라리움 터미널에서 실행한 Claude Code)를 위해 쓴 것이다. 테라리움은 작업 폴더를 지켜보고 있다가, 바깥에서 파일이 바뀌면 바로 다시 불러온다(되돌리기 `Ctrl+Z` 로 되돌릴 수 있다).

## 구조

```
<작업 폴더>/
├── terrarium.json              문서 정보(제목 · 버전 · 참여자 · 변경 이력) · 화면 순서
├── screens/<화면 ID>/          화면마다 하나 (SCR-001, SCR-002 …)
│   ├── screen.json             제목 · 버전들 · 자유 노트 탭 목록 · 원본 폴더 연결
│   ├── notes.md                자유 노트 첫 탭 (마크다운)
│   ├── notes-<탭 id>.md        자유 노트 나머지 탭 (마크다운)
│   └── comments.json           Comment 목록 (순서 = 번호)
├── blobs/ab/abcdef…            화면 파일 · 그림 · 클립 (내용 해시) — 고치지 않는다
├── returned/                   돌아온 회신본 (.terr.html)
└── dist/<제목>.terr.html        자동으로 구운 보낼 파일 — 고치지 않는다 (테라리움이 다시 굽는다)
```

## 고쳐도 되는 것

| 파일 | 고칠 수 있는 것 |
|---|---|
| `screens/<ID>/notes.md`, `notes-<id>.md` | 자유 노트 본문. 마크다운 그대로 |
| `screens/<ID>/screen.json` | `title`(화면 이름), `notesTitle`(첫 탭 이름), `moreNotes`(탭 목록 `[{ "id", "title" }]` — 탭을 더하면 `notes-<id>.md` 도 만든다) |
| `screens/<ID>/comments.json` | Comment 의 `title`, `body`, `replies`. 순서를 바꾸면 번호가 바뀐다 |
| `terrarium.json` | `doc.meta.title`(문서 제목), `doc.meta.version` |

`versions`, `anchor`, `shot`, `clips`, `id`, `blobs/` 는 화면 · 위치 · 그림과 묶여 있으니 고치지 않는다.

## Comment (comments.json 의 한 항목)

```json
{
  "id": "6f1c…",                 // 고치지 않는다
  "version": 2,                   // 어느 화면 버전에 단 것인가
  "title": "탭 이름",             // 없어도 된다
  "body": "## 마크다운\n- [ ] 할 일",
  "author": "이상현",
  "createdAt": "2026-10-02T03:00:00.000Z",
  "updatedAt": "2026-10-02T03:10:00.000Z",
  "kind": "capture",              // 있으면 캡처 Comment (그림만, 실시간 화면에 마커 없음)
  "anchor": { … },                // 화면 위 대상 — 고치지 않는다. 없으면 화면 전체 Comment
  "replies": [ { "id": "…", "author": "이상현", "at": "…", "body": "마크다운" } ],
  "history": [ … ]
}
```

- 새 답글은 `replies` 끝에 `{ "id": 새 무작위 문자열, "author": 이름, "at": ISO 시각, "body": 마크다운 }` 를 더한다.
- 새 Comment 는 화면 전체 Comment(=`anchor` 없이)로만 만들 수 있다. `id` 는 새 무작위 문자열, `version` 은 그 화면의 마지막 버전, `replies`·`history` 는 `[]`.
- 할 일은 본문에 `- [ ]` / `- [x]` 로 적는다.
- `updatedAt` 을 지금 시각으로 바꿔 둔다.

## 지켜 줄 것

- JSON 은 들여쓰기 2칸, UTF-8. 깨진 JSON 은 불러오지 못한다.
- 한 번에 여러 파일을 고쳐도 된다. 테라리움은 잠깐 기다렸다가 한 번에 다시 불러온다.
- `dist/` 는 테라리움이 다시 굽는다. 보낼 파일을 바꾸려면 위 원본을 고친다.
