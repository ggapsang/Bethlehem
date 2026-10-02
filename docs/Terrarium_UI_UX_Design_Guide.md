# Terrarium UI/UX Design Guide

> **제품:** Terrarium\
> **문서 형식:** `.terr.html`\
> **작성 프로그램:** Terrarium Desktop / Electron\
> **기반 디자인 시스템:** 다임리서치 UI/UX 가이드라인 v1.0\
> **문서 버전:** v0.1\
> **상태:** Product-specific extension

이 문서는 다임리서치 디자인 가이드라인을 대체하지 않는다. 다임리서치의
디자인 파운데이션을 상위 규칙으로 유지하면서, Terrarium의 제품 컨셉과
사용자 경험에 필요한 시각·레이아웃 규칙을 추가한다.

------------------------------------------------------------------------

## 0. Design System Hierarchy

Terrarium의 디자인 시스템은 세 개의 층으로 구성한다.

``` text
Daim Research Design System
        │
        ├── Color
        ├── Typography
        ├── Icon
        ├── Spacing
        └── Accessibility
                │
                ▼
Terrarium Product Layer
        │
        ├── Container
        ├── Live Screen
        ├── Comment
        ├── Screen List
        ├── Version
        └── Document
                │
                ▼
Terrarium Visual Language
        │
        ├── Contained
        ├── Living
        ├── Layered
        └── Quiet / Technical
```

**원칙**

> 다임리서치의 디자인 언어를 버리고 Terrarium만의 새로운 디자인 시스템을
> 만드는 것이 아니다.\
> 다임리서치의 기술적·전문적 기반 위에 Terrarium의 **"담는 경험"**을
> 추가한다.

다임리서치 가이드의 색상, 타이포그래피, 아이콘, 4px 그리드 등의
파운데이션을 그대로 계승한다.

------------------------------------------------------------------------

# 1. Product Design Concept

## 1.1 핵심 컨셉

Terrarium은 **살아 있는 화면을 담는 문서**다.

유리 용기가 내부의 생태계를 보존하면서 외부에서 바라볼 수 있게 하듯이,
Terrarium은 실행되는 화면을 문서 안에 담고 그 화면에 대한 의견과 정보를
함께 보존한다.

> **A living interface, contained in a document.**

Terrarium의 시각적 표현에서 식물이나 녹색 자체가 핵심이 아니다.

핵심은 다음 네 가지다.

  개념            UI에서의 의미
  --------------- ------------------------------------------------------
  **Contained**   화면이 하나의 문서 안에 담긴다
  **Living**      담긴 화면은 정적인 이미지가 아니라 실제로 실행된다
  **Layered**     화면, Comment, 문서 정보가 서로 다른 레이어를 가진다
  **Preserved**   화면과 그에 대한 의견이 하나의 문서에 함께 남는다

Terrarium의 핵심 컨셉인 **"문서의 문서"**를 UI 구조로 번역한다. 원본
화면을 품고, 그 바깥을 문서 구조가 감싸는 방식이다.

------------------------------------------------------------------------

# 2. Design Tone

Terrarium의 시각적 어조는 다음 네 가지를 동시에 만족해야 한다.

## 2.1 Technical

실제 HTML 화면과 프로토타입을 다루는 전문 도구다.

-   정확한 정렬
-   명확한 상태
-   높은 정보 밀도
-   기술적인 용어 사용
-   불필요한 장식 배제

## 2.2 Quiet

Terrarium 자체가 화면보다 더 눈에 띄어서는 안 된다.

특히 품어진 실제 화면이 주인공이어야 하므로 애플리케이션 UI는 한 단계
조용해야 한다.

``` text
Application UI
    ↓
quiet / neutral

Contained Screen
    ↓
visual focus
```

## 2.3 Living

일반적인 문서 편집기처럼 완전히 정적이어서는 안 된다.

화면의 실행 상태, 선택된 요소, Comment marker 등이 **살아 있는
객체**라는 느낌을 줘야 한다.

## 2.4 Contained

핵심 객체는 "무언가를 담고 있다"는 구조를 가진다.

``` text
Terrarium
└── Document
    └── Screen
        ├── Live UI
        └── Comments
```

------------------------------------------------------------------------

# 3. Visual Principle

## 3.1 키 아트의 시각 언어를 UI로 번역하는 방법

키 아트의 식물·유리·자연을 UI에 그대로 복사하지 않는다.

대신 다음과 같이 번역한다.

  Key Art              UI Translation
  -------------------- -----------------------------------
  유리 용기            Screen Container
  내부 생태계          Live Screen
  유리 밖에서 바라봄   Document / Viewer
  식물과 생명          실행 중인 실제 화면
  자연스러운 레이어    Screen / Comment / Document Layer
  어두운 주변 환경     Neutral Dark Workspace
  빛                   Primary Action

따라서 **Glassmorphism을 사용하는 제품이 아니다.**

> **"유리처럼 보이게 만드는 것"이 아니라 "무언가를 담고 있는 구조"를
> 보여주는 것이 Terrarium의 목표다.**

------------------------------------------------------------------------

# 4. Color System

## 4.1 상위 규칙

색상 체계는 다임리서치 디자인 가이드를 그대로 사용한다.

새로운 Green 계열을 Terrarium 전용 브랜드 색으로 추가하지 않는다.

기존 체계:

-   Primary `#F86517`
-   Neutral / Stone
-   Success = Blue
-   Warning = Amber
-   Error = Red
-   6 : 3 : 1 비율
-   의미 기반 토큰 사용

## 4.2 Terrarium의 색상 역할

  색상               Terrarium에서의 역할
  ------------------ ------------------------------
  Neutral            Terrarium의 공간
  Primary Orange     사용자의 행동 / 현재 작업
  Blue               완료 / 정상 상태
  Amber              주의
  Red                오류 / 위험
  Screen 내부 색상   품어진 화면의 고유 시각 언어

### 핵심 규칙

> **Terrarium UI는 화면의 색을 빼앗지 않는다.**

품어진 화면이 원래 녹색이면 녹색을 사용하고, 파란색이면 파란색을
사용한다.

Terrarium UI가 별도의 Green을 추가해서 화면과 경쟁하지 않는다.

------------------------------------------------------------------------

# 5. Dark Theme

Terrarium의 Dark Theme는 다임리서치 Neutral / Stone 계열을 적극적으로
사용한다.

현재의 차가운 Blue-gray 기반 Dark UI를 피하고 Stone 계열을 기본으로
한다.

권장 구조:

``` text
Canvas
→ neutral-950

Primary Surface
→ neutral-900

Secondary Surface
→ neutral-800

Strong Border
→ neutral-700

Secondary Text
→ neutral-400
```

목표는 다음과 같다.

> **Industrial Control Console**이 아니라\
> **Quiet Technical Workspace**

Dark Theme는 Terrarium의 키 아트가 가진 **어두운 주변 환경**을 UI에
번역하는 역할을 한다.

------------------------------------------------------------------------

# 6. Light Theme

Light Theme는 다임리서치 Neutral 계열을 기반으로 한다.

``` text
Canvas
→ neutral-50

Surface
→ white

Secondary Surface
→ neutral-100

Border
→ neutral-200

Text
→ neutral-900
```

Light Theme는 **Document / Annotation / Review** 작업에 적합한 분위기를
만든다.

Light와 Dark는 색만 반전하는 것이 아니라 동일한 의미 구조를 유지해야
한다.

------------------------------------------------------------------------

# 7. 6 : 3 : 1

Terrarium에서도 다임리서치의 6:3:1 원칙을 유지한다.

``` text
60%
Neutral / Background / Workspace

30%
Content / Text / Screen Container

10%
Primary / Status / Interaction
```

단, 실제 품어진 화면의 콘텐츠는 이 비율에 포함하지 않는다.

``` text
Terrarium UI
└── 6 : 3 : 1

Contained Screen
└── Screen 자체의 디자인 시스템
```

------------------------------------------------------------------------

# 8. Typography

타이포그래피는 다임리서치 가이드를 그대로 사용한다.

**Font: Pretendard**

지원 Weight:

-   Light 300
-   Regular 400
-   Medium 500
-   SemiBold 600
-   Bold 700

Terrarium은 화면정의서이므로 텍스트가 많아질 수 있다.

따라서:

> **큰 제목보다 정보의 계층을 명확하게 하는 것을 우선한다.**

특히 Comment에서는 작은 본문 크기를 중심으로 구성하고, 큰 텍스트는 문서
제목이나 중요한 Section Heading에서 제한적으로 사용한다.

------------------------------------------------------------------------

# 9. Spacing

4px Base Grid를 그대로 사용한다.

모든:

-   padding
-   margin
-   gap
-   width
-   height
-   panel spacing
-   toolbar spacing

은 다임리서치의 단위 체계에서 선택한다.

### Terrarium 추가 원칙

**화면 주변의 여백은 "장식"이 아니라 Container의 여백이다.**

Live Screen을 둘러싼 여백은 일반적인 카드 padding보다 넉넉하게 사용한다.

목적은 화면을 강조하기 위한 **visual breathing room**이다.

------------------------------------------------------------------------

# 10. Container System

Terrarium에서 가장 중요한 제품 특화 컴포넌트다.

## 10.1 Container의 의미

Container는 단순한 Card가 아니다.

> **무언가를 담고 있다는 것을 표현하는 공간적 단위다.**

기본 구조:

``` text
┌────────────────────────────────────┐
│ Container Header                   │
│                                    │
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │         Live Screen          │  │
│  │                              │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

------------------------------------------------------------------------

# 11. Live Screen

Terrarium UI의 **Primary Object**다.

다른 UI 패널보다 시각적 우선순위가 높아야 한다.

### 원칙

1.  실제 화면은 이미지가 아니다.
2.  실제 화면은 문서 안에서 실행되는 콘텐츠다.
3.  Terrarium의 UI는 실제 화면보다 강하게 보이면 안 된다.
4.  Screen 자체의 디자인을 임의로 수정하지 않는다.
5.  Screen 주변에 충분한 시각적 분리를 제공한다.

------------------------------------------------------------------------

# 12. Screen Frame

Live Screen을 둘러싸는 Frame은 Terrarium의 대표적인 시각 요소로
사용한다.

### Frame

-   Neutral 기반
-   미세한 Border
-   제한적인 Radius
-   강한 Shadow 금지
-   Glassmorphism 금지

### 목적

화면을 장식하는 것이 아니라:

> **"이 화면이 Terrarium 안에 담겨 있다."**

는 것을 보여준다.

------------------------------------------------------------------------

# 13. Comment System

Comment는 Terrarium의 핵심 UI다.

Terrarium의 Comment는 **화면의 특정 위치와 연결된 문서 객체**다.

화면의 DOM 요소를 선택하면 해당 요소가 Highlight되고 번호 Marker가
붙으며, 오른쪽 패널에 동일한 번호의 Comment가 생성되는 구조를 기본으로
한다.

## 13.1 Marker

Marker는 장식이 아니다.

**화면 ↔ Comment를 연결하는 Identifier**다.

원칙:

-   번호는 명확해야 한다.
-   화면 요소를 가리지 않아야 한다.
-   Primary를 사용해 선택 상태를 표시할 수 있다.
-   상태를 색상만으로 표현하지 않는다.

------------------------------------------------------------------------

# 14. Comment Panel

Comment Panel은 일반적인 Chat UI처럼 만들지 않는다.

우선순위:

``` text
01
Comment Content
Author / Metadata
Reply
Status
```

Comment가 화면과 어떤 관계를 가지는지가 가장 중요하다.

------------------------------------------------------------------------

# 15. Screen List

Screen List는 일반적인 File Explorer가 아니다.

이는 하나의 Terrarium 안에 들어 있는 **여러 화면의 목록**이다.

``` text
SCREENS

01  Overview
02  Dashboard
03  Equipment
04  Settings
```

원칙:

-   현재 선택된 화면은 Primary로 명확히 표시
-   나머지는 Neutral
-   화면 번호와 이름을 명확하게 구분
-   필요할 경우 thumbnail 제공
-   불필요한 tree 구조를 만들지 않는다

------------------------------------------------------------------------

# 16. Version

Version은 파일 관리 기능이 아니라 **화면의 시간적 상태**를 보여주는
정보다.

예:

``` text
Dashboard

v1
v2
v3  ← Current
```

현재 버전은 Primary로 표시한다.

이전 버전은 Neutral로 표시한다.

버전 간 비교가 중요한 경우에는 변경점을 시각적으로 강조하되, 화면 전체를
새로운 색으로 칠하지 않는다.

------------------------------------------------------------------------

# 17. Toolbar

Toolbar는 Terrarium의 작업 공간을 정의한다.

권장 구조:

``` text
[Terrarium]   [Screen] [Version]     [Mode] [Save]
```

우선순위:

1.  현재 문서
2.  현재 화면
3.  버전
4.  작업 모드
5.  저장

Toolbar에 기능을 계속 추가하지 않는다.

------------------------------------------------------------------------

# 18. Action Hierarchy

Primary Orange는 **행동을 의미해야 한다.**

### Primary

-   Save
-   Add Comment
-   Export
-   주요 확인

### Secondary

-   화면 전환
-   버전 선택
-   보기 옵션

### Tertiary

-   보조 설정
-   정보 표시

모든 버튼을 Orange로 만들지 않는다.

------------------------------------------------------------------------

# 19. Border & Radius

Terrarium은 다임리서치의 기술적 정밀함을 유지하면서 약간 더 부드러운
형태를 사용한다.

### 원칙

-   직선적인 정보 구조 유지
-   지나치게 날카로운 모서리는 피함
-   과도한 둥근 카드 금지
-   큰 Container에 더 명확한 Radius
-   작은 정보 요소는 낮은 Radius

목표:

> **Softened Technical**

귀여운 제품처럼 보이게 만드는 것이 목적이 아니다.

------------------------------------------------------------------------

# 20. Shadow

Shadow는 최소화한다.

Terrarium의 깊이는 Shadow가 아니라 **Layer와 Contrast**로 표현한다.

``` text
Canvas
 ↓
Surface
 ↓
Container
 ↓
Live Screen
 ↓
Comment Marker
```

각 레이어의 차이는:

-   명도
-   Border
-   여백
-   위치

로 표현한다.

------------------------------------------------------------------------

# 21. Glass Effect

Terrarium이라는 이름 때문에 실제 Glassmorphism을 사용하는 것은 권장하지
않는다.

### 금지

-   과도한 blur
-   반투명 패널
-   유리 광택
-   강한 reflection
-   유리 질감 이미지
-   Green glass gradient

### 허용

-   Container 구조
-   얇은 Border
-   Layered Surface
-   Screen을 감싸는 Frame

> **Glass as Metaphor, not Material**

------------------------------------------------------------------------

# 22. Key Art와 UI의 관계

키 아트는 UI의 컬러 팔레트가 아니다.

키 아트는 **Terrarium의 감성적 브랜드 표현**이다.

UI는 그것을 다음과 같이 번역한다.

``` text
KEY ART

Dark environment
       ↓
Glass container
       ↓
Living ecosystem


UI

Neutral workspace
       ↓
Screen container
       ↓
Live interface
```

따라서 키 아트의 녹색을 UI에 그대로 적용하지 않는다.

대신 **어두운 주변 + 하나의 살아 있는 중심 객체**라는 구성을 공유한다.

------------------------------------------------------------------------

# 23. Light / Dark Default

Terrarium은 **Light를 기본 테마**로 한다.

이유:

1.  Terrarium의 본질은 **문서**다.
2.  Comment와 Annotation을 읽고 작성하는 작업이 핵심이다.
3.  실제 품어진 화면은 각각 자체적인 색상 체계를 가질 수 있다.
4.  Light 환경에서 문서, 주석, 구조 정보의 계층을 안정적으로 표현하기
    쉽다.
5.  Dark Theme는 키 아트와 Live Screen의 몰입감을 강화하는 **Focus
    Workspace**로 활용할 수 있다.

### Light

키워드:

> Document / Review / Annotation / Structure

### Dark

키워드:

> Focus / Live Screen / Workspace / Immersion

따라서 **현재의 "Light 기본 + Dark 토글" 방향을 유지한다.**

단, Dark Theme의 색상은 현재의 차가운 Blue-gray에서 다임리서치의 Stone
Neutral 기반으로 수정한다.

------------------------------------------------------------------------

# 24. Information Density

Terrarium은 화면 자체가 이미 높은 정보 밀도를 가질 수 있으므로
**Terrarium UI까지 고밀도로 만들지 않는다.**

``` text
Application UI
Low → Medium Density

Contained Screen
High Density Allowed

Comment
Medium Density
```

Terrarium UI와 실제 화면의 정보 밀도를 분리하는 것이 중요하다.

------------------------------------------------------------------------

# 25. Do / Don't

## DO

-   다임리서치 Neutral / Stone 사용
-   Primary Orange를 제한적으로 사용
-   실제 화면을 가장 중요한 객체로 취급
-   Container로 화면을 감싼다
-   Comment와 Marker의 연결성을 강조한다
-   4px Grid를 유지한다
-   Pretendard를 사용한다
-   Lucide를 사용한다
-   정보 위계를 명확하게 한다
-   화면의 고유 디자인을 존중한다
-   Light를 기본 테마로 한다
-   Dark를 집중 작업 환경으로 제공한다

## DON'T

-   Terrarium UI에 임의의 Green 추가
-   모든 요소를 Glassmorphism으로 만들기
-   모든 버튼을 Orange로 만들기
-   실제 화면까지 Terrarium 색상으로 덮기
-   과도한 Shadow 사용
-   Comment를 일반적인 채팅 앱처럼 만들기
-   Screen List를 복잡한 File Explorer처럼 만들기
-   Jira/Linear와 같은 프로젝트 관리 UI로 확장하기
-   장식적인 식물/자연 그래픽을 UI에 삽입하기
-   키 아트의 녹색을 그대로 UI 브랜드 컬러로 사용하기

------------------------------------------------------------------------

# 26. Component Priority

Terrarium에서 시각적 중요도는 다음 순서를 따른다.

``` text
1. Live Screen
       ↓
2. Comment / Marker
       ↓
3. Screen / Version Context
       ↓
4. Terrarium Application UI
       ↓
5. Secondary Controls
```

**Terrarium 자체가 주인공이면 안 된다.**

Terrarium은 **화면을 보여주기 위한 용기**다.

------------------------------------------------------------------------

# 27. Design Checklist

## Foundation

-   [ ] 다임리서치 색상 토큰을 사용하는가
-   [ ] 임의의 Green을 추가하지 않았는가
-   [ ] Primary Orange가 CTA/강조에만 사용되는가
-   [ ] 6:3:1 비율이 유지되는가
-   [ ] Pretendard를 사용하는가
-   [ ] 4px Grid를 사용하는가
-   [ ] Lucide를 사용하는가

## Terrarium

-   [ ] Live Screen이 가장 중요한 객체인가
-   [ ] 화면이 하나의 Container 안에 담겨 있는가
-   [ ] 실제 화면과 Terrarium UI가 시각적으로 구분되는가
-   [ ] Comment Marker와 Comment Panel이 연결되어 있는가
-   [ ] Screen List가 문서 내부 화면 목록처럼 보이는가
-   [ ] Version이 화면의 시간적 상태로 표현되는가
-   [ ] UI가 실제 화면보다 더 강하게 보이지 않는가

## Visual

-   [ ] Dark Theme가 지나치게 Blue-gray로 보이지 않는가
-   [ ] Stone 계열 Neutral이 공간의 기본색으로 작동하는가
-   [ ] Glassmorphism을 남용하지 않았는가
-   [ ] Shadow보다 Layer와 Contrast로 깊이를 표현하는가
-   [ ] Radius가 기술적 정밀함을 해치지 않는가
-   [ ] 장식적인 식물/자연 그래픽을 UI에 넣지 않았는가

## UX

-   [ ] 현재 Screen을 즉시 알 수 있는가
-   [ ] 현재 Version을 즉시 알 수 있는가
-   [ ] Comment가 어느 화면 요소에 붙어 있는지 알 수 있는가
-   [ ] Comment 내용과 답글을 쉽게 읽을 수 있는가
-   [ ] 주요 Action이 명확한가
-   [ ] 실제 화면의 조작을 방해하지 않는가

------------------------------------------------------------------------

# 28. One-line Principle

> **다임리서치의 정밀하고 신뢰할 수 있는 기술적 UI 안에, 살아 있는 화면
> 하나를 조용히 담는다.**

Terrarium의 제품 특화 레이어는 기존 디자인 시스템에 **Contained / Living
/ Layered**를 추가한다.
