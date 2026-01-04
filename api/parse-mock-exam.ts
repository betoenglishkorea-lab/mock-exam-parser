import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Vercel Serverless Function 설정 (Pro: 최대 300초, Fluid Compute: 800초)
export const config = {
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

## 텍스트 변환 규칙
1. 밑줄 친 텍스트 → [텍스트]
2. 빈칸 밑줄 → ________ (원본 길이 유지)
3. 꺾쇠괄호 <내용> → (내용)
4. PDF 열 폭 줄바꿈 → 제거하여 문장 연결
5. 의도된 문단 구분 → 유지
6. 단어 설명 *단어: 뜻 → 그대로 유지

## 중요
- 정답은 PDF 하단의 정답표에서 각주번호로 매칭
- 해석은 PDF 하단의 해석 섹션에서 각주번호로 매칭
- 선지가 5개 미만인 경우 빈 문자열로 채움
- JSON만 출력, 다른 설명 없이

## PDF 텍스트:
`;

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
    const { pdfText, filename, extractedType3, mode, existingQuestionNumbers } = body;
    // mode: 'full' (기본값) | 'additional' (추가 추출)
    // existingQuestionNumbers: 이미 추출된 문항 번호 배열 (추가 추출 모드에서 사용)

    if (!queueId || !pdfText) {
      return new Response(
        JSON.stringify({ error: 'queueId와 pdfText가 필요합니다' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isAdditionalMode = mode === 'additional';

    // SSE 스트리밍 응답 설정
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: object) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // 1. 큐 상태 업데이트: processing
          sendEvent('progress', { step: 1, message: '처리 시작...' });

          await supabase
            .from('pdf_processing_queue')
            .update({
              status: 'processing',
              started_at: new Date().toISOString(),
            })
            .eq('id', queueId);

          // 2. type1, type2 매핑 및 예상 문항 수 추출
          const { type1, type2 } = findTypeMapping(extractedType3 || '');

          // PDF 정답표에서 총 문항수 추출 (가장 정확한 방법)
          // 정답표 패턴들:
          // - "18①", "105③" (번호+정답 붙어있음)
          // - "18) ③", "105) ①" (번호+괄호+공백+정답)
          // 마지막 페이지에 있는 정답표에서 가장 큰 문항 번호 = 총 문항수
          const answerPatterns = pdfText.match(/(\d{1,3})\s*\)?\s*[①②③④⑤]/g) || [];
          const questionNumbers = answerPatterns.map(p => {
            const match = p.match(/(\d{1,3})/);
            return match ? parseInt(match[1], 10) : 0;
          });
          const maxQuestionNumber = questionNumbers.length > 0 ? Math.max(...questionNumbers) : 0;

          // fallback: 정답표가 없으면 기존 방식 사용
          let expectedQuestions = maxQuestionNumber;
          if (expectedQuestions === 0) {
            const questionPatterns = pdfText.match(/(?:^|\n)\s*(\d{1,3})\s*[.)]/gm) || [];
            expectedQuestions = questionPatterns.length;
          }

          // 청크 분할 설정: 30문항씩 분할 (Vercel Serverless 300초 타임아웃)
          const CHUNK_SIZE = 30;
          const needsChunking = expectedQuestions > CHUNK_SIZE;
          const totalChunks = needsChunking ? Math.ceil(expectedQuestions / CHUNK_SIZE) : 1;

          sendEvent('progress', {
            step: 2,
            message: needsChunking
              ? `유형 매핑 완료 (예상 ${expectedQuestions}개 → ${totalChunks}개 청크로 분할)`
              : `유형 매핑 완료 (예상 문항: ${expectedQuestions}개)`
          });

          // 3. Claude API 호출 (청크별 처리 + 즉시 DB 저장)
          let allQuestions: any[] = [];
          const savedQuestionNumbers = new Set<number>();  // 이미 저장된 문항 번호 추적
          let totalSavedQuestions = 0;

          for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const startNum = chunkIdx * CHUNK_SIZE + 1;
            const endNum = Math.min((chunkIdx + 1) * CHUNK_SIZE, expectedQuestions);

            const chunkMessage = needsChunking
              ? `청크 ${chunkIdx + 1}/${totalChunks} 처리 중 (문항 ${startNum}~${endNum})...`
              : isAdditionalMode
                ? `추가 추출 모드 (기존 ${existingQuestionNumbers?.length || 0}문항 제외)`
                : 'AI 분석 중... (1~2분 소요)';
            sendEvent('progress', { step: 3, message: chunkMessage });

            // 파일명에서 유형 힌트 생성
            let userContent = `## 파일명 (유형 힌트)
${filename}

## PDF 텍스트
${pdfText}`;

            // 청크 모드: 특정 범위만 추출 지시
            if (needsChunking) {
              userContent += `

## 중요: 부분 추출 모드
이 PDF에는 총 ${expectedQuestions}개의 문항이 있습니다.
지금은 문항 번호 ${startNum}번부터 ${endNum}번까지만 추출하세요.
다른 문항은 무시하고, 해당 범위의 문항만 정확하게 추출해주세요.`;
            }

            // 추가 추출 모드: 기존 문항 제외 지시
            if (isAdditionalMode && existingQuestionNumbers?.length > 0) {
              userContent += `

## 중요: 추가 추출 모드
다음 문항 번호들은 이미 추출되었습니다. 이 번호들을 제외한 나머지 문항만 추출하세요:
이미 추출된 문항: ${existingQuestionNumbers.join(', ')}

위 번호들을 제외한 모든 문항을 빠짐없이 추출해주세요.`;
            }

            // 스트리밍 모드로 Claude API 호출 (10분 이상 걸릴 수 있어서 필수)
            const apiStream = anthropic.messages.stream({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 64000,  // Sonnet 4 최대값
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

                // 10초마다 하트비트 전송 (Vercel 타임아웃 방지)
                const now = Date.now();
                if (now - lastHeartbeat > HEARTBEAT_INTERVAL) {
                  sendEvent('heartbeat', {
                    chunk: chunkIdx + 1,
                    totalChunks,
                    chars: responseText.length
                  });
                  lastHeartbeat = now;
                }
              }
            }

            // 최종 메시지에서 사용량 정보 가져오기
            const finalMessage = await apiStream.finalMessage();
            const usage = finalMessage.usage as any;
            console.log(`[${filename}] 청크 ${chunkIdx + 1}/${totalChunks} 토큰 사용량:`, {
              input: usage.input_tokens,
              output: usage.output_tokens,
              cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
              cache_read_input_tokens: usage.cache_read_input_tokens || 0,
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
              console.error(`청크 ${chunkIdx + 1} JSON 파싱 실패:`, parseError);
              // 청크 하나 실패해도 계속 진행
              sendEvent('warning', {
                message: `청크 ${chunkIdx + 1} 파싱 실패, 계속 진행`,
                details: responseText.substring(0, 200)
              });
              continue;
            }

            // 청크별 중복 제거 (이미 저장된 문항 번호 제외)
            const newQuestions = chunkQuestions.filter((q: any) => {
              const num = q.question_number;
              if (savedQuestionNumbers.has(num)) {
                return false;
              }
              return true;
            });

            if (newQuestions.length > 0) {
              // 청크별 즉시 DB 저장
              const chunkInsertData = newQuestions.map((q: any, index: number) => {
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

              const { error: chunkInsertError } = await supabase
                .from('mock_exam_questions')
                .insert(chunkInsertData);

              if (chunkInsertError) {
                sendEvent('warning', {
                  message: `청크 ${chunkIdx + 1} DB 저장 실패`,
                  details: chunkInsertError.message
                });
              } else {
                // 저장된 문항 번호 기록
                newQuestions.forEach((q: any) => savedQuestionNumbers.add(q.question_number));
                totalSavedQuestions += newQuestions.length;
                sendEvent('progress', {
                  step: 3,
                  message: `청크 ${chunkIdx + 1}/${totalChunks} 저장 완료 (${newQuestions.length}개, 누적 ${totalSavedQuestions}개)`
                });
              }
            }

            allQuestions = allQuestions.concat(chunkQuestions);

            // 청크 사이 딜레이 (API 레이트 리밋 방지)
            if (chunkIdx < totalChunks - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }

          sendEvent('progress', { step: 4, message: `AI 처리 완료 (총 ${totalSavedQuestions}개 저장됨)` });

          // 4. 저장 결과 확인
          if (totalSavedQuestions === 0) {
            await supabase
              .from('pdf_processing_queue')
              .update({
                status: 'failed',
                error_message: '추출된 문항이 없습니다',
              })
              .eq('id', queueId);

            sendEvent('error', { message: '추출된 문항이 없습니다' });
            controller.close();
            return;
          }

          sendEvent('progress', { step: 5, message: `${totalSavedQuestions}개 문제 DB 저장 완료` });

          // 6. 추출 비율 계산 및 경고
          const extractionRatio = expectedQuestions > 0
            ? Math.round((totalSavedQuestions / expectedQuestions) * 100)
            : 100;
          const isLowExtraction = extractionRatio < 80 && expectedQuestions > 0;

          // 7. 큐 상태 업데이트: completed
          await supabase
            .from('pdf_processing_queue')
            .update({
              status: isLowExtraction ? 'warning' : 'completed',
              total_questions: totalSavedQuestions,
              processed_questions: totalSavedQuestions,
              expected_questions: expectedQuestions,
              extraction_ratio: extractionRatio,
              progress: 100,
              completed_at: new Date().toISOString(),
              error_message: isLowExtraction
                ? `추출 비율 낮음: ${totalSavedQuestions}/${expectedQuestions} (${extractionRatio}%)`
                : null,
            })
            .eq('id', queueId);

          // 8. 완료 이벤트 전송
          sendEvent('complete', {
            success: true,
            questionsCount: totalSavedQuestions,
            expectedQuestions,
            extractionRatio,
            warning: isLowExtraction ? `추출 비율 낮음 (${extractionRatio}%)` : null,
            message: `${totalSavedQuestions}개 문제 저장 완료`,
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
