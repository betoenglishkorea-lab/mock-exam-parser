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

// 유형 분류표
const TYPE_MAPPING: Record<string, { type1: string; type2: string }> = {
  '글의 목적': { type1: '내용추론', type2: '글의 목적' },
  '글의목적': { type1: '내용추론', type2: '글의 목적' },
  '감정/심경/분위기': { type1: '내용추론', type2: '감정/심경/분위기' },
  '감정_심경_분위기': { type1: '내용추론', type2: '감정/심경/분위기' },
  '지칭추론': { type1: '내용추론', type2: '지칭추론' },
  '내용일치': { type1: '내용추론', type2: '내용일치/불일치' },
  '내용불일치': { type1: '내용추론', type2: '내용일치/불일치' },
  '내용일치/불일치': { type1: '내용추론', type2: '내용일치/불일치' },
  '실용문': { type1: '내용추론', type2: '내용일치/불일치' },
  '도표': { type1: '내용추론', type2: '도표' },
  '주제': { type1: '대의추론', type2: '주제/제목/요지' },
  '제목': { type1: '대의추론', type2: '주제/제목/요지' },
  '요지': { type1: '대의추론', type2: '주제/제목/요지' },
  '주장': { type1: '대의추론', type2: '주제/제목/요지' },
  '요지/주장': { type1: '대의추론', type2: '주제/제목/요지' },
  '요약문': { type1: '대의추론', type2: '요약문완성' },
  '요약문완성': { type1: '대의추론', type2: '요약문완성' },
  '요약문 완성': { type1: '대의추론', type2: '요약문완성' },
  '함의추론': { type1: '빈칸추론', type2: '함의추론' },
  '함축의미추론': { type1: '빈칸추론', type2: '함의추론' },
  '빈칸추론': { type1: '빈칸추론', type2: '빈칸추론' },
  '짧은빈칸추론': { type1: '빈칸추론', type2: '빈칸추론' },
  '긴빈칸추론': { type1: '빈칸추론', type2: '빈칸추론' },
  '접속사': { type1: '빈칸추론', type2: '접속사/연결사' },
  '연결사': { type1: '빈칸추론', type2: '접속사/연결사' },
  '접속사/연결사': { type1: '빈칸추론', type2: '접속사/연결사' },
  '접속사+연결사': { type1: '빈칸추론', type2: '접속사/연결사' },
  '무관한 문장': { type1: '논리추론', type2: '글의흐름(순서/삽입/무관)' },
  '무관한문장': { type1: '논리추론', type2: '글의흐름(순서/삽입/무관)' },
  '글의 순서': { type1: '논리추론', type2: '글의흐름(순서/삽입/무관)' },
  '글의순서': { type1: '논리추론', type2: '글의흐름(순서/삽입/무관)' },
  '순서': { type1: '논리추론', type2: '글의흐름(순서/삽입/무관)' },
  '문장 삽입': { type1: '논리추론', type2: '글의흐름(순서/삽입/무관)' },
  '문장삽입': { type1: '논리추론', type2: '글의흐름(순서/삽입/무관)' },
  '삽입문장': { type1: '논리추론', type2: '글의흐름(순서/삽입/무관)' },
  '장문독해': { type1: '논리추론', type2: '장문독해' },
  '장문': { type1: '논리추론', type2: '장문독해' },
  '어법': { type1: '어법', type2: '어법' },
  '문법': { type1: '어법', type2: '어법' },
  '어휘': { type1: '어휘', type2: '어휘' },
  '어휘영영풀이': { type1: '어휘', type2: '어휘영영풀이' },
  '어휘 영영풀이': { type1: '어휘', type2: '어휘영영풀이' },
  '빈칸 넣기': { type1: '빈칸추론', type2: '빈칸추론' },
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

유형 목록:
- 글의 목적
- 감정/심경/분위기
- 지칭추론
- 내용일치/불일치
- 도표
- 주제
- 제목
- 요지/주장
- 요약문완성
- 함의추론
- 빈칸추론
- 접속사/연결사
- 무관한 문장
- 글의 순서
- 문장 삽입
- 장문독해
- 어법
- 어휘

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

### 기타 변환
- 꺾쇠괄호 <내용> → (내용)
- PDF 열 폭 줄바꿈 → 제거하여 문장 연결
- 의도된 문단 구분 → 유지
- 단어 설명 (*단어: 뜻 형식) → 지문 마지막에 줄바꿈(\n) 후 별도 줄로 유지
  예: "... the end of passage.\n*consensus: 합의 **coercion: 강압"

## 중요
- 정답은 PDF 하단의 정답표에서 각주번호로 매칭
- 해석은 PDF 하단의 해석 섹션에서 각주번호로 매칭
- 선지가 5개 미만인 경우 빈 문자열로 채움
- JSON만 출력, 다른 설명 없이

## PDF 텍스트:
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
    } = body;

    if (!queueId || !pdfText) {
      return new Response(
        JSON.stringify({ error: 'queueId와 pdfText가 필요합니다' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isChunkMode = chunkIndex !== undefined && totalChunks !== undefined;

    // SSE 스트리밍 응답 설정
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: object) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
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

          // 파일명에서 유형 힌트 생성
          let userContent = `## 파일명 (유형 힌트)
${filename}

## PDF 텍스트
${pdfText}

## 중요: 부분 추출 모드
이 PDF에는 총 ${expectedQuestions}개의 문항이 있습니다.
지금은 문항 번호 ${startNum}번부터 ${endNum}번까지만 추출하세요.
다른 문항은 무시하고, 해당 범위의 문항만 정확하게 추출해주세요.`;

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
          console.error('API 오류:', error);

          if (queueId) {
            await supabase
              .from('pdf_processing_queue')
              .update({
                status: 'failed',
                error_message: String(error),
              })
              .eq('id', queueId);
          }

          sendEvent('error', { message: '서버 오류', details: String(error) });
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
