import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Vercel Edge Function 설정
export const config = {
  runtime: 'edge',
  maxDuration: 300,
};

// Supabase 클라이언트
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Claude API 클라이언트
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// 유형 분류표 (20개 type3 → type1, type2 매핑)
const TYPE_MAPPING: Record<string, { type1: string; type2: string }> = {
  // 내용추론 계열
  '글의 목적': { type1: '내용추론', type2: '글의 목적' },
  '글의목적': { type1: '내용추론', type2: '글의 목적' },
  '감정/심경/분위기': { type1: '내용추론', type2: '감정/심경/분위기' },
  '감정_심경_분위기': { type1: '내용추론', type2: '감정/심경/분위기' },
  '지칭추론': { type1: '내용추론', type2: '지칭추론' },
  '실용문, 내용일치': { type1: '내용추론', type2: '실용문, 내용일치' },
  '실용문': { type1: '내용추론', type2: '실용문, 내용일치' },
  '내용일치': { type1: '내용추론', type2: '실용문, 내용일치' },
  '내용불일치': { type1: '내용추론', type2: '실용문, 내용일치' },
  '내용일치/불일치': { type1: '내용추론', type2: '실용문, 내용일치' },
  '도표': { type1: '내용추론', type2: '도표' },

  // 대의추론 계열
  '주제': { type1: '대의추론', type2: '주제' },
  '제목': { type1: '대의추론', type2: '제목' },
  '요지, 주장': { type1: '대의추론', type2: '요지, 주장' },
  '요지': { type1: '대의추론', type2: '요지, 주장' },
  '주장': { type1: '대의추론', type2: '요지, 주장' },
  '요지/주장': { type1: '대의추론', type2: '요지, 주장' },
  '요약문 완성': { type1: '대의추론', type2: '요약문 완성' },
  '요약문': { type1: '대의추론', type2: '요약문 완성' },
  '요약문완성': { type1: '대의추론', type2: '요약문 완성' },

  // 빈칸추론 계열
  '함의추론': { type1: '빈칸추론', type2: '함의추론' },
  '함축의미추론': { type1: '빈칸추론', type2: '함의추론' },
  '짧은 빈칸추론': { type1: '빈칸추론', type2: '짧은 빈칸추론' },
  '짧은빈칸추론': { type1: '빈칸추론', type2: '짧은 빈칸추론' },
  '긴 빈칸추론': { type1: '빈칸추론', type2: '긴 빈칸추론' },
  '긴빈칸추론': { type1: '빈칸추론', type2: '긴 빈칸추론' },
  '빈칸추론': { type1: '빈칸추론', type2: '짧은 빈칸추론' }, // 기본값
  '빈칸 넣기': { type1: '빈칸추론', type2: '짧은 빈칸추론' },
  '접속사/연결사': { type1: '빈칸추론', type2: '접속사/연결사' },
  '접속사': { type1: '빈칸추론', type2: '접속사/연결사' },
  '연결사': { type1: '빈칸추론', type2: '접속사/연결사' },
  '접속사+연결사': { type1: '빈칸추론', type2: '접속사/연결사' },

  // 논리추론 계열
  '무관한 문장': { type1: '논리추론', type2: '무관한 문장' },
  '무관한문장': { type1: '논리추론', type2: '무관한 문장' },
  '글의 순서': { type1: '논리추론', type2: '글의 순서' },
  '글의순서': { type1: '논리추론', type2: '글의 순서' },
  '순서': { type1: '논리추론', type2: '글의 순서' },
  '문장 삽입': { type1: '논리추론', type2: '문장 삽입' },
  '문장삽입': { type1: '논리추론', type2: '문장 삽입' },
  '삽입문장': { type1: '논리추론', type2: '문장 삽입' },
  '장문독해': { type1: '논리추론', type2: '장문독해' },
  '장문': { type1: '논리추론', type2: '장문독해' },

  // 어법/어휘 계열
  '어법': { type1: '어법', type2: '어법' },
  '문법': { type1: '어법', type2: '어법' },
  '어휘': { type1: '어휘', type2: '어휘' },
  '어휘 영영풀이': { type1: '어휘', type2: '어휘 영영풀이' },
  '어휘영영풀이': { type1: '어휘', type2: '어휘 영영풀이' },
};

// type3에서 type1, type2 찾기
function findTypeMapping(type3: string): { type1: string; type2: string } {
  if (TYPE_MAPPING[type3]) {
    return TYPE_MAPPING[type3];
  }

  const parts = type3.split('/');
  for (const part of parts) {
    const trimmed = part.trim();
    if (TYPE_MAPPING[trimmed]) {
      return TYPE_MAPPING[trimmed];
    }
  }

  for (const [key, value] of Object.entries(TYPE_MAPPING)) {
    if (type3.includes(key) || key.includes(type3)) {
      return value;
    }
  }

  return { type1: '', type2: '' };
}

// Claude API로 PDF 텍스트 파싱
const PARSE_PROMPT = `당신은 교육청 모의고사 PDF 텍스트를 구조화된 JSON으로 변환하는 전문가입니다.

## 작업
주어진 PDF 텍스트에서 각 문제를 파싱하여 JSON 배열로 반환하세요.

## ❌ 금지 사항 (토큰 절약)

**출력뿐 아니라 사고 과정에서도 절대 금지:**
- 문제 내용 해석/설명 금지
- 출제 의도 추론 금지
- 난이도 평가 금지
- 지문 내용 요약/해석 금지
- 한국어로 번역하여 설명 금지
- "~능력을 평가", "~분석이 요구됩니다" 등 교육적 해설 금지
- 정답 추론/풀이 금지
- 지문에 없는 기호 임의 추가 금지
- **빈칸 채우기 금지**: 빈칸은 반드시 ________로 유지, 정답이나 내용을 삽입하지 않음

**예외: type3 분류는 반드시 수행**
- 파일명 힌트와 문제 형식을 참고하여 아래 20개 유형 중 반드시 1개 선택
- 유형 목록 외의 값 사용 금지
- 유형 분류 외의 분석은 금지

**단순 추출 → 유형 분류(20개 중 1개) → 변환 → 출력만 수행**

## 출력 형식
각 문제는 다음 필드를 포함해야 합니다:
{
  "source_year": 출제년도 (숫자, 예: 2010),
  "source_month": "출제월 (예: 3월)",
  "source_grade": "출제학년 (예: 고1)",
  "source_org": "출제기관 (예: 서울교육청)",
  "source_number": 출제번호 (숫자, 원 시험지 문항번호),
  "question_number": 문제번호 (숫자, 현재 PDF 내 순번),
  "type3": "문제 유형 (아래 유형 분류표 참고)",
  "question_text": "문제 지시사항/질문 (번호, 각주, 배점 제외)",
  "passage": "문제 지문 (변환 규칙 적용)",
  "choice_1": "① 선지1",
  "choice_2": "② 선지2",
  "choice_3": "③ 선지3",
  "choice_4": "④ 선지4",
  "choice_5": "⑤ 선지5",
  "correct_answer": "정답 (①~⑤)",
  "model_translation": "모범해석 ([해석] + 어휘설명 포함)"
}

## 문제 유형 분류 (type3)
파일명에 포함된 유형 힌트를 참고하여 type3를 결정하세요.
파일명은 별도로 제공됩니다.

**type3 유형 목록 (20개 - 이 중 반드시 1개만 선택):**
- 글의 목적
- 감정/심경/분위기
- 지칭추론
- 실용문, 내용일치
- 도표
- 주제
- 제목
- 요지, 주장
- 요약문 완성
- 함의추론
- 짧은 빈칸추론
- 긴 빈칸추론
- 접속사/연결사
- 무관한 문장
- 글의 순서
- 문장 삽입
- 장문독해
- 어법
- 어휘
- 어휘 영영풀이

### 빈칸 유형 구분 기준 (선지 형태로 판단)

⚠️ 빈칸의 언더스코어 길이가 아닌, **선지 형태**로 유형을 구분

1. **짧은 빈칸추론**
   - 선지 형태: 단어 1~2개, 짧은 구
   - 예: ① outdated ② factual ③ incomplete
   - 예: ① their coloration ② their violence
   - 빈칸 1개

2. **긴 빈칸추론**
   - 선지 형태: 3단어 이상의 구/절, to부정사구, 문장
   - 예: ① to move place to place ② to control the temperature
   - 예: ① both sides when reporting an issue
   - 빈칸 1개

3. **접속사/연결사**
   - 빈칸이 (A), (B) 또는 (A), (B), (C)로 2~3개
   - 선지 형태: 표 형식으로 (A)-(B) 또는 (A)-(B)-(C) 조합
   - 예: ① In addition - Instead ② For example - Instead

## 출처 표시 파싱 규칙
- 형식: "2010_3월_고1_서울교육청_29" 또는 유사 형식
- '_'로 분리하여 각 필드 추출

## 텍스트 변환 규칙 (매우 중요!)

### 밑줄 처리 (최우선 규칙 - 반드시 준수)
PDF에서 밑줄 친 텍스트는 반드시 대괄호 []로 감싸야 합니다.
PDF 텍스트 추출 시 밑줄 정보가 손실되므로, 문제 지시문을 보고 밑줄 위치를 추론하세요.

#### 밑줄 감지 방법:
1. 문제에서 "밑줄 친 ~", "~의 의미", "~에 해당하는" 언급 확인
2. 따옴표(' ' 또는 " ")로 인용된 표현 → 해당 표현이 지문에서 밑줄 친 부분
3. 어휘 문제: 선지에 있는 단어가 지문에서 밑줄 친 부분
4. 어법 문제: (A), (B), (C) 또는 ⓐ, ⓑ, ⓒ 표시된 부분
5. 기호 + 밑줄 표현: 기호와 밑줄 친 단어를 함께 대괄호로 감쌈
   - 소문자 괄호: (a), (b), (c), (d), (e)
   - 원문자: ①, ②, ③, ④, ⑤
   - ⚠️ 기호는 반드시 대괄호 안에 포함
   - 변환 예시:
     - (a)He → [(a)He]
     - (b)him → [(b)him]
     - ①he → [①he]
   - 잘못된 처리: [He], [him] (기호 누락)
   - 올바른 처리: [(a) He], [(b) him] (기호 포함)
6. 반복 밑줄 단어: 동일한 단어가 지문 내 여러 곳에서 밑줄 처리된 경우
   - 문제에서 "밑줄 친 This[this]", "밑줄 친 it" 등으로 힌트 제공
   - 지문 내 해당 단어가 나올 때마다 모두 대괄호 처리
   - 예시:
     - This is an act of giving. → [This] is an act of giving.
     - people do this for those → people do [this] for those

#### 짧은 밑줄 처리 (단어 1~2개도 반드시 처리):
- 단일 단어: make → [make]
- 짧은 구: in fact → [in fact]
- 괄호 포함: (A) accept → [(A) accept] 또는 (A) [accept]
- 동그라미 기호: ⓐ, ⓑ → [ⓐ], [ⓑ]

#### 긴 밑줄 처리:
- 구/절: make a difference → [make a difference]
- 문장: The irony is that... → [The irony is that...]

#### 어휘/어법 문제 특수 처리:
- 어휘 문제에서 선지가 "① accept ② reject ③ deny..." 형태이고
  지문에 해당 단어들이 있으면 → 지문에서 [accept], [reject] 등으로 표시
- 어법 문제에서 "(A) are / is" 형태면 → 지문에서 [(A) are / is] 또는 [(A)] are로 표시

#### 예시:
| 문제 유형 | 문제 지시문 | 지문 변환 |
|----------|------------|----------|
| 함의추론 | "밑줄 친 'a grain of sand'의 의미" | [a grain of sand] |
| 어휘 | "밑줄 친 ⓐ~ⓔ 중 적절하지 않은 것" | [ⓐ] accept, [ⓑ] deny... |
| 어휘 | "밑줄 친 단어의 의미와 가장 가까운 것" | [upset] |
| 어법 | "(A), (B), (C)에 적절한 것" | [(A) is], [(B) have], [(C) that] |

### 빈칸 처리 (밑줄과 구분)
- 내용이 비어있는 빈칸 → ________ (언더스코어 8개)
- 빈칸이 여러 개면 각각 ________로 표시
- 주의: 빈칸은 채워야 할 공백, 밑줄은 이미 텍스트가 있음
- ⚠️ **빈칸에 정답/내용 삽입 금지**: 빈칸은 반드시 ________로 유지
  - 잘못된 처리: solutions [hides a steady accumulation...] (빈칸에 정답 삽입)
  - 올바른 처리: solutions ________. (빈칸 유지)

### 기타 변환
- 꺾쇠괄호 <내용> → (내용)
- PDF 열 폭 줄바꿈 → 제거하여 문장 연결
- 의도된 문단 구분 → 유지

### 단락 구분 유지 (필수)
- (A), (B), (C), (D) 등 단락 표시가 있는 경우 각 단락 사이에 줄바꿈(\\n\\n) 유지
- 잘못된 처리: (A)... (B)... (C)... (한 줄로 연결)
- 올바른 처리: (A)...\\n\\n(B)...\\n\\n(C)... (단락 구분 유지)

### 단어 해석 처리 (필수)
- * 또는 **로 시작하는 단어 해석은 지문 가장 마지막에 줄바꿈(\\n) 후 별도 줄로 배치
- 형식: [지문 본문]\\n*단어1: 뜻1 **단어2: 뜻2
- 예시:
  - 지문: "The consensus among scientists was clear, but coercion was not the answer."
  - 단어 해석: *consensus: 합의 **coercion: 강압
  - 결과: "The consensus among scientists was clear, but coercion was not the answer.\\n*consensus: 합의 **coercion: 강압"

## 연계문제 처리 규칙 (장문독해 포함)

### 연계문제 감지 방법
1. 대괄호 형식: [3~4], [11~13], [43~45]
2. 장문독해 형식: 지문 후 여러 문제가 "위 글", "위 글의"로 시작

### 처리 규칙 (필수)

1. **연계 문제번호 삭제**: [43~45] 등 범위 표시는 question_text에서 제외

2. **공통 지시사항 무시**: "다음 글을 읽고, 물음에 답하시오." 등은 생략

3. **연계 지문**: 모든 해당 문제의 passage 필드에 완전히 동일한 전체 지문 복사
   - 잘못된 처리: 43번에만 지문, 44·45번은 빈칸
   - 올바른 처리: 43, 44, 45번 모두 동일한 지문 전체 입력
   - 올바른 처리: 43, 44, 45번 모두 동일한 기호 입력

4. **밑줄 표시 유지**: 연계문제의 모든 문제에서 동일한 밑줄 표시 유지
   - 지문에 (a), (b), (c) 등 밑줄 표현이 있으면 모든 연계문제에 동일하게 포함
   - 잘못된 처리: 43번(순서)에서 기호 생략, 44번(지칭)에서만 기호 포함
   - 올바른 처리: 43, 44, 45번 모두 [(a) He], [(b) him] 등 동일하게 포함
   - 이유: 연계문제는 동일한 지문을 공유하므로 밑줄 표시도 동일해야 함

### 연계문제 처리 순서 (필수)

1. **연계문제 전체 스캔 먼저**: 연계된 모든 문제(43, 44, 45번)의 question_text를 먼저 확인
2. **밑줄 필요 여부 판단**: 어느 한 문제라도 밑줄 표현을 요구하면 지문에 밑줄 규칙 적용
3. **지문 한 번만 처리**: 밑줄이 적용된 지문을 모든 연계문제에 동일하게 복사

#### 예시
- 43번: "글의 순서" → 밑줄 불필요
- 44번: "(a)~(e) 중 가리키는 대상이 다른 것" → 밑줄 필요
- 결과: 43, 44, 45번 모두 [(a) He], [(b) him] 등 밑줄 적용된 동일한 지문 사용

### 예시 (43~45번 장문독해)

문제 43:
- question_text: "위 글 (A)에 이어질 내용을 순서에 맞게 배열한 것으로 가장 적절한 것은?"
- passage: "(A) A fourteen-year-old girl named Victoria... (전체 지문)"

문제 44:
- question_text: "위 글의 밑줄 친 (a)~(e) 중에서 가리키는 대상이 나머지 넷과 다른 것은?"
- passage: "(A) A fourteen-year-old girl named Victoria... (전체 지문 동일하게 복사)"

문제 45:
- question_text: "위 글의 Victoria에 관한 내용으로 적절하지 않은 것은?"
- passage: "(A) A fourteen-year-old girl named Victoria... (전체 지문 동일하게 복사)"

## 문장 삽입 문제 처리 규칙

### 감지 방법
- "주어진 문장이 들어가기에", "다음 문장이 들어갈 위치" 등의 표현

### 구조
1. 주어진 문장 (삽입할 문장) - 보통 박스/테두리 안에 별도 표시
2. 본문 지문 - ( ① )( ② )( ③ )( ④ )( ⑤ ) 위치 표시 포함

### 처리 규칙
- **주어진 문장**을 passage 앞에 배치
- 형식: [주어진 문장] + 줄바꿈(\\n\\n) + 본문 지문
- ( ① ), ( ② ) 등 삽입 위치 표시는 그대로 유지

### 예시
passage: "To find the answer to this question, they can build a simple experiment.\\n\\nYou don't always need to plan everything for your students to have them do science. ( ① ) Sometimes all you need to do is suggest interesting ideas. ( ② ) ..."

## 글의 순서 문제 처리 규칙

### 감지 방법
- "주어진 글 다음에 이어질 글의 순서", "글의 순서로 가장 적절한" 등의 표현

### 구조
1. 주어진 글 (도입부) - 보통 박스/테두리 안에 별도 표시
2. (A), (B), (C) 단락들

### 처리 규칙 (매우 중요)
- **주어진 글**을 passage 맨 앞에 배치
- 형식: [주어진 글] + 줄바꿈(\\n\\n) + (A) 단락 + 줄바꿈(\\n\\n) + (B) 단락 + 줄바꿈(\\n\\n) + (C) 단락
- **(A), (B), (C) 순서를 절대로 바꾸지 말 것** - PDF에 나온 순서 그대로 (A), (B), (C) 순으로 나열
- 정답이 "(B)-(A)-(C)"라고 해서 (B) 단락을 먼저 배치하면 안 됨
- 당신은 문제를 푸는 것이 아니라, PDF의 내용을 그대로 추출하는 것임
- (A), (B), (C) 표시는 그대로 유지

### 예시
passage: "Newborn babies cry rather less than older babies. But even a small amount of crying can be quite worrying particularly to new parents.\\n\\n(A) For them, it may be helpful to know that crying makes the baby's lungs stronger, or sends oxygen to his blood.\\n\\n(B) More importantly, crying is your baby's main form of communication. When he cries, you need to respond quickly and find out what is wrong.\\n\\n(C) However, this does not mean that it is good to leave a baby to 'cry it out.' Crying is hard on a baby, and it uses up his limited energy."

## 요약문 완성 문제 처리 규칙

### 감지 방법
- "다음 글의 내용을 한 문장으로 요약하고자 한다", "빈칸 (A), (B)에 들어갈 말" 등의 표현

### 구조
1. 본문 지문
2. ↓ (화살표)
3. 요약문 (빈칸 포함)

### 처리 규칙
- **본문 지문**과 **요약문**을 모두 passage에 포함
- 형식: [본문 지문] + 줄바꿈(\\n\\n↓\\n\\n) + [요약문]
- (A), (B) 빈칸은 ________로 표시

### 예시
passage: "Even those with average talent can produce notable work in the various sciences, so long as they do not try to embrace all of them at once. Instead, they should concentrate attention on one subject after another...\\n*condense: 응축하다 **cerebral: 대뇌의\\n\\n↓\\n\\nExploring one scientific subject after another (A)________ remarkable work across the sciences, as the previously gained knowledge is retained in simplified forms within the brain, which (B)________ room for new learning."

## 중요
- 정답은 PDF 하단의 정답표에서 각주번호로 매칭
- 해석은 PDF 하단의 해석 섹션에서 각주번호로 매칭
- 선지가 5개 미만인 경우 빈 문자열로 채움
- JSON만 출력, 다른 설명 없이
`;

// 청크 사이즈 설정 (10문항씩)
const CHUNK_SIZE = 10;

export default async function handler(req: Request) {
  // CORS 헤더
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let queueId: string | null = null;

  try {
    const body = await req.json();
    queueId = body.queueId;
    const {
      pdfText,
      filename,
      extractedType3,
      // 청크 모드 파라미터
      chunkIndex,      // 현재 청크 인덱스 (0부터 시작)
      totalChunks,     // 총 청크 수
      expectedQuestions, // 예상 총 문항 수
      startNum,        // 시작 문항 번호
      endNum,          // 끝 문항 번호
      // 청크 재분석 파라미터
      chunkStart,      // 재분석 시작 문항 번호
      chunkEnd,        // 재분석 끝 문항 번호
      isChunkReanalyze, // 청크 재분석 모드 여부
    } = body;

    if (!queueId || !pdfText) {
      return new Response(
        JSON.stringify({ error: 'queueId와 pdfText가 필요합니다' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isChunkMode = chunkIndex !== undefined && totalChunks !== undefined;
    const isReanalyzeMode = isChunkReanalyze === true && chunkStart !== undefined && chunkEnd !== undefined;

    // SSE 스트리밍 응답 설정
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: object) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // 청크 재분석 모드 - 특정 범위만 재파싱
          if (isReanalyzeMode) {
            sendEvent('progress', { step: 1, message: `${chunkStart}번~${chunkEnd}번 문항 재분석 시작...` });

            // PDF 텍스트를 청크 범위에 맞게 분할
            let chunkPdfText = pdfText;

            // 부분재분석에서는 항상 필요한 범위만 추출 시도 (토큰 절약)
            // 문항 번호 패턴으로 시작/끝 위치 찾기
            const startPattern = new RegExp(`(?:^|\\n)\\s*${chunkStart}\\s*[.)]`, 'm');
            const endPattern = new RegExp(`(?:^|\\n)\\s*${Math.min(chunkEnd + 3, expectedQuestions || chunkEnd + 3)}\\s*[.)]`, 'm');

            const startMatch = pdfText.match(startPattern);
            const endMatch = pdfText.match(endPattern);

            if (startMatch && startMatch.index !== undefined) {
              // 시작점 앞에 약간의 컨텍스트 포함
              const startIdx = Math.max(0, startMatch.index - 300);
              // 끝점 뒤에 충분한 텍스트 포함 (마지막 문항 전체 포함)
              const endIdx = endMatch && endMatch.index !== undefined
                ? Math.min(pdfText.length, endMatch.index + 8000)
                : Math.min(pdfText.length, startMatch.index + (chunkEnd - chunkStart + 1) * 3000);

              chunkPdfText = pdfText.substring(startIdx, endIdx);
              console.log(`부분재분석: 텍스트 분할 ${pdfText.length} → ${chunkPdfText.length}자`);
            } else {
              // 패턴 매칭 실패 시 전체 텍스트 사용 (단, 경고 로그)
              console.warn(`부분재분석: 문항 ${chunkStart}번 시작 패턴 찾기 실패, 전체 텍스트 사용`);
            }

            // 파일명에서 유형 힌트 생성
            const userContent = `## 파일명 (유형 힌트)
${filename}

## PDF 텍스트
${chunkPdfText}

## 중요: 부분 추출 모드
지금은 문항 번호 ${chunkStart}번부터 ${chunkEnd}번까지만 추출하세요.
다른 문항은 무시하고, 해당 범위의 문항만 정확하게 추출해주세요.

**question_number 필수**: 반드시 PDF 내 순번(${chunkStart}~${chunkEnd})을 question_number로 반환하세요.
- 첫 번째 문항: question_number = ${chunkStart}
- 두 번째 문항: question_number = ${chunkStart + 1}
- (source_number는 원 시험지 번호로 별도 저장)`;

            sendEvent('progress', { step: 2, message: `${chunkStart}번~${chunkEnd}번 AI 파싱 중...` });

            // Claude API 호출
            const apiStream = anthropic.messages.stream({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 64000,
              system: [
                {
                  type: 'text',
                  text: PARSE_PROMPT,
                  cache_control: { type: 'ephemeral' }
                }
              ],
              messages: [{ role: 'user', content: userContent }],
            });

            let fullResponse = '';
            let lastProgressTime = Date.now();
            let chunkCount = 0;

            for await (const event of apiStream) {
              if (event.type === 'content_block_delta') {
                const delta = event.delta as { type: string; text?: string };
                if (delta.type === 'text_delta' && delta.text) {
                  fullResponse += delta.text;
                  chunkCount++;

                  // 10초마다 또는 100청크마다 진행 상황 전송 (연결 유지)
                  const now = Date.now();
                  if (now - lastProgressTime > 10000 || chunkCount % 100 === 0) {
                    sendEvent('progress', {
                      step: 2,
                      message: `AI 응답 수신 중... (${Math.round(fullResponse.length / 1000)}KB)`,
                    });
                    lastProgressTime = now;
                  }
                }
              }
            }

            console.log(`부분재분석: Claude 응답 완료 (${fullResponse.length}자)`);

            // JSON 추출 및 파싱
            const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
              console.error('JSON 매칭 실패. 응답 시작 부분:', fullResponse.substring(0, 500));
              sendEvent('error', { message: 'JSON 형식 응답을 찾을 수 없습니다', success: false });
              controller.close();
              return;
            }

            let questions;
            try {
              questions = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
              console.error('JSON 파싱 실패:', parseError);
              sendEvent('error', { message: `JSON 파싱 실패: ${parseError}`, success: false });
              controller.close();
              return;
            }

            // 문항 저장
            let savedCount = 0;
            for (let i = 0; i < questions.length; i++) {
              const q = questions[i];
              const typeInfo = findTypeMapping(q.type3 || extractedType3 || '');

              const questionData = {
                type1: typeInfo.type1 || q.type1 || '',
                type2: typeInfo.type2 || q.type2 || '',
                type3: q.type3 || extractedType3 || '',
                source_year: q.source_year || null,
                source_month: q.source_month || '',
                source_grade: q.source_grade || '',
                source_org: q.source_org || '',
                source_number: q.source_number || null,
                question_number: q.question_number || q.source_number || (chunkStart + i),
                question_text: q.question_text || '',
                passage: q.passage || '',
                choice_1: q.choice_1 || '',
                choice_2: q.choice_2 || '',
                choice_3: q.choice_3 || '',
                choice_4: q.choice_4 || '',
                choice_5: q.choice_5 || '',
                correct_answer: q.correct_answer || '',
                model_translation: q.model_translation || '',
                pdf_filename: filename,
              };

              const { error: insertError } = await supabase.from('mock_exam_questions').insert(questionData);
              if (insertError) {
                console.error(`문항 ${i + 1} 저장 실패:`, insertError);
              } else {
                savedCount++;
              }
            }
            console.log(`부분재분석: ${questions.length}개 중 ${savedCount}개 저장 완료`);

            // 큐 상태 업데이트 (완료 시간 포함)
            if (queueId) {
              // 현재 저장된 총 문항 수 조회
              const { count } = await supabase
                .from('mock_exam_questions')
                .select('*', { count: 'exact', head: true })
                .eq('pdf_filename', filename);

              await supabase
                .from('pdf_processing_queue')
                .update({
                  status: 'completed',
                  total_questions: count || 0,
                  processed_questions: count || 0,
                  progress: 100,
                  completed_at: new Date().toISOString(),
                  error_message: null,
                })
                .eq('id', queueId);
            }

            sendEvent('complete', {
              success: true,
              questionsCount: questions.length,
              message: `${chunkStart}번~${chunkEnd}번 재분석 완료 (${questions.length}개 문항)`,
            });

            controller.close();
            return;
          }

          // 청크 모드가 아닌 경우 (첫 호출) - 문항수 계산 후 청크 정보 반환
          if (!isChunkMode) {
            // 먼저 현재 상태 확인 (동시 처리 방지)
            const { data: currentQueue } = await supabase
              .from('pdf_processing_queue')
              .select('status')
              .eq('id', queueId)
              .single();

            if (currentQueue?.status !== 'pending') {
              sendEvent('error', {
                message: '이미 처리 중이거나 완료된 항목입니다',
                currentStatus: currentQueue?.status
              });
              controller.close();
              return;
            }

            // status를 'processing'으로 즉시 변경 (동시 처리 방지)
            await supabase
              .from('pdf_processing_queue')
              .update({
                status: 'processing',
                started_at: new Date().toISOString(),
              })
              .eq('id', queueId);

            sendEvent('progress', { step: 1, message: '청크 정보 계산 중...' });

            // PDF 정답표에서 총 문항수 추출
            const answerPatterns = pdfText.match(/(\d{1,3})\s*\)?\s*[①②③④⑤]/g) || [];
            const questionNumbers = answerPatterns.map((p: string) => {
              const match = p.match(/(\d{1,3})/);
              return match ? parseInt(match[1], 10) : 0;
            });
            const maxQuestionNumber = questionNumbers.length > 0 ? Math.max(...questionNumbers) : 0;

            let totalQuestions = maxQuestionNumber;
            if (totalQuestions === 0) {
              const questionPatterns = pdfText.match(/(?:^|\n)\s*(\d{1,3})\s*[.)]/gm) || [];
              totalQuestions = questionPatterns.length;
            }

            const chunks = Math.ceil(totalQuestions / CHUNK_SIZE);

            // 청크 정보 반환 (프론트에서 청크별로 API 호출)
            sendEvent('chunk_info', {
              expectedQuestions: totalQuestions,
              totalChunks: chunks,
              chunkSize: CHUNK_SIZE,
            });

            sendEvent('complete', {
              success: true,
              needsChunking: chunks > 1,
              expectedQuestions: totalQuestions,
              totalChunks: chunks,
            });

            controller.close();
            return;
          }

          // 청크 모드 - 실제 파싱 수행
          const { type1, type2 } = findTypeMapping(extractedType3 || '');

          // 현재 상태 확인 (processing이 아니면 중단된 것으로 간주)
          const { data: currentQueue } = await supabase
            .from('pdf_processing_queue')
            .select('status')
            .eq('id', queueId)
            .single();

          if (currentQueue?.status !== 'processing') {
            sendEvent('error', {
              message: '처리가 중단되었거나 이미 완료되었습니다',
              currentStatus: currentQueue?.status
            });
            controller.close();
            return;
          }

          sendEvent('progress', {
            step: 2,
            message: `청크 ${chunkIndex + 1}/${totalChunks} 처리 중 (문항 ${startNum}~${endNum})...`
          });

          // PDF 텍스트를 청크 범위에 맞게 분할
          // 문항 번호 패턴으로 분할 시도
          let chunkPdfText = pdfText;

          // 전체 텍스트가 너무 크면 분할 시도 (약 100k 토큰 = 400k 문자 기준)
          if (pdfText.length > 300000) {
            // 시작 문항과 끝 문항+여유분 사이의 텍스트만 추출
            const startPattern = new RegExp(`(?:^|\\n)\\s*${startNum}\\s*[.)]`, 'm');
            const endPattern = new RegExp(`(?:^|\\n)\\s*${Math.min(endNum + 5, expectedQuestions)}\\s*[.)]`, 'm');

            const startMatch = pdfText.match(startPattern);
            const endMatch = pdfText.match(endPattern);

            if (startMatch && startMatch.index !== undefined) {
              const startIdx = Math.max(0, startMatch.index - 500); // 약간의 컨텍스트 포함
              const endIdx = endMatch && endMatch.index !== undefined
                ? Math.min(pdfText.length, endMatch.index + 5000)
                : Math.min(pdfText.length, startMatch.index + 50000);

              chunkPdfText = pdfText.substring(startIdx, endIdx);
              console.log(`[${filename}] 청크 ${chunkIndex + 1}: 텍스트 분할 ${pdfText.length} -> ${chunkPdfText.length} 문자`);
            }
          }

          // 파일명에서 유형 힌트 생성
          let userContent = `## 파일명 (유형 힌트)
${filename}

## PDF 텍스트
${chunkPdfText}

## 중요: 부분 추출 모드
이 PDF에는 총 ${expectedQuestions}개의 문항이 있습니다.
지금은 문항 번호 ${startNum}번부터 ${endNum}번까지만 추출하세요.
다른 문항은 무시하고, 해당 범위의 문항만 정확하게 추출해주세요.

**question_number 필수**: 반드시 PDF 내 순번(${startNum}~${endNum})을 question_number로 반환하세요.
- 첫 번째 문항: question_number = ${startNum}
- 두 번째 문항: question_number = ${startNum + 1}
- (source_number는 원 시험지 번호로 별도 저장)`;

          // 스트리밍 모드로 Claude API 호출
          const apiStream = anthropic.messages.stream({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 64000,
            system: [
              {
                type: 'text',
                text: PARSE_PROMPT,
                cache_control: { type: 'ephemeral' }
              }
            ],
            messages: [
              {
                role: 'user',
                content: userContent,
              },
            ],
          });

          // 스트리밍 응답 수집 (하트비트로 Vercel 타임아웃 방지)
          let responseText = '';
          let lastHeartbeat = Date.now();
          const HEARTBEAT_INTERVAL = 10000; // 10초마다 하트비트

          for await (const event of apiStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              responseText += event.delta.text;

              // 10초마다 하트비트 전송
              const now = Date.now();
              if (now - lastHeartbeat > HEARTBEAT_INTERVAL) {
                sendEvent('heartbeat', {
                  chunk: chunkIndex + 1,
                  totalChunks,
                  chars: responseText.length
                });
                lastHeartbeat = now;
              }
            }
          }

          // 토큰 사용량 로깅
          const finalMessage = await apiStream.finalMessage();
          const usage = finalMessage.usage as any;
          console.log(`[${filename}] 청크 ${chunkIndex + 1}/${totalChunks} 토큰:`, {
            input: usage.input_tokens,
            output: usage.output_tokens,
            cache_read: usage.cache_read_input_tokens || 0,
          });

          // 응답 파싱
          let jsonText = responseText;
          const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonText = jsonMatch[1].trim();
          }

          let chunkQuestions: any[];
          try {
            chunkQuestions = JSON.parse(jsonText);
          } catch (parseError) {
            console.error(`청크 ${chunkIndex + 1} JSON 파싱 실패:`, parseError);
            sendEvent('error', {
              message: `청크 ${chunkIndex + 1} 파싱 실패`,
              details: responseText.substring(0, 500)
            });
            controller.close();
            return;
          }

          // DB에 저장
          if (chunkQuestions.length > 0) {
            const insertData = chunkQuestions.map((q: any, index: number) => {
              const questionType3 = q.type3 || extractedType3 || '';
              const mapping = questionType3 ? findTypeMapping(questionType3) : { type1, type2 };
              return {
                type1: mapping.type1 || type1 || q.type1 || '',
                type2: mapping.type2 || type2 || q.type2 || '',
                type3: questionType3,
                source_year: q.source_year || null,
                source_month: q.source_month || '',
                source_grade: q.source_grade || '',
                source_org: q.source_org || '',
                source_number: q.source_number || null,
                question_number: q.question_number || index + 1,
                question_text: q.question_text || '',
                passage: q.passage || '',
                choice_1: q.choice_1 || '',
                choice_2: q.choice_2 || '',
                choice_3: q.choice_3 || '',
                choice_4: q.choice_4 || '',
                choice_5: q.choice_5 || '',
                correct_answer: q.correct_answer || '',
                model_translation: q.model_translation || '',
                pdf_filename: filename || '',
              };
            });

            const { error: insertError } = await supabase
              .from('mock_exam_questions')
              .insert(insertData);

            if (insertError) {
              sendEvent('warning', {
                message: `청크 ${chunkIndex + 1} DB 저장 실패`,
                details: insertError.message
              });
            } else {
              sendEvent('progress', {
                step: 3,
                message: `청크 ${chunkIndex + 1}/${totalChunks} 저장 완료 (${chunkQuestions.length}개)`
              });
            }
          }

          // 마지막 청크인 경우 큐 상태 업데이트
          const isLastChunk = chunkIndex === totalChunks - 1;
          if (isLastChunk) {
            // 저장된 총 문항 수 조회
            const { count } = await supabase
              .from('mock_exam_questions')
              .select('*', { count: 'exact', head: true })
              .eq('pdf_filename', filename);

            const totalSaved = count || 0;
            const extractionRatio = expectedQuestions > 0
              ? Math.round((totalSaved / expectedQuestions) * 100)
              : 100;
            const isLowExtraction = extractionRatio < 80 && expectedQuestions > 0;

            await supabase
              .from('pdf_processing_queue')
              .update({
                status: isLowExtraction ? 'warning' : 'completed',
                total_questions: totalSaved,
                processed_questions: totalSaved,
                expected_questions: expectedQuestions,
                extraction_ratio: extractionRatio,
                progress: 100,
                completed_at: new Date().toISOString(),
                error_message: isLowExtraction
                  ? `추출 비율 낮음: ${totalSaved}/${expectedQuestions} (${extractionRatio}%)`
                  : null,
              })
              .eq('id', queueId);
          }

          // 완료 이벤트 전송
          sendEvent('complete', {
            success: true,
            chunkIndex,
            questionsCount: chunkQuestions.length,
            isLastChunk,
            message: `청크 ${chunkIndex + 1}/${totalChunks} 완료`,
          });

          controller.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : '';
          console.error('API 오류:', errorMessage, errorStack);

          if (queueId) {
            await supabase
              .from('pdf_processing_queue')
              .update({
                status: 'failed',
                error_message: errorMessage.substring(0, 500),
              })
              .eq('id', queueId);
          }

          sendEvent('error', { message: '서버 오류', details: errorMessage });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('API 초기화 오류:', error);
    return new Response(
      JSON.stringify({ error: '서버 오류', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
