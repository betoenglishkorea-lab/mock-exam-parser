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
    const { pdfText, filename, extractedType3 } = body;

    if (!queueId || !pdfText) {
      return new Response(
        JSON.stringify({ error: 'queueId와 pdfText가 필요합니다' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

          // PDF 텍스트에서 문제 번호 패턴으로 예상 문항 수 추출
          // 패턴: "1.", "2.", ... 또는 "1)", "2)" 또는 출처 표시의 마지막 숫자
          const questionPatterns = pdfText.match(/(?:^|\n)\s*(\d{1,3})\s*[.)]/gm) || [];
          const sourcePatterns = pdfText.match(/_(\d{1,2})(?:\s|$|\n)/g) || [];
          const expectedQuestions = Math.max(questionPatterns.length, sourcePatterns.length);

          sendEvent('progress', { step: 2, message: `유형 매핑 완료 (예상 문항: ${expectedQuestions}개)` });

          // 3. Claude API 호출
          sendEvent('progress', { step: 3, message: 'AI 분석 중... (1~2분 소요)' });

          // 파일명에서 유형 힌트 생성
          const userContent = `## 파일명 (유형 힌트)
${filename}

## PDF 텍스트
${pdfText}`;

          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 128000,
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

          // 캐싱 정보 로깅
          const usage = response.usage as any;
          console.log(`[${filename}] 토큰 사용량:`, {
            input: usage.input_tokens,
            output: usage.output_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
            cache_read_input_tokens: usage.cache_read_input_tokens || 0,
          });

          sendEvent('progress', { step: 4, message: 'AI 응답 수신 완료' });

          // 4. 응답 파싱
          const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

          let jsonText = responseText;
          const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonText = jsonMatch[1].trim();
          }

          let questions: any[];
          try {
            questions = JSON.parse(jsonText);
          } catch (parseError) {
            await supabase
              .from('pdf_processing_queue')
              .update({
                status: 'failed',
                error_message: 'JSON 파싱 실패: ' + String(parseError),
              })
              .eq('id', queueId);

            sendEvent('error', { message: 'JSON 파싱 실패', details: responseText.substring(0, 500) });
            controller.close();
            return;
          }

          sendEvent('progress', { step: 5, message: `${questions.length}개 문제 파싱 완료` });

          // 5. DB에 문제 저장
          // AI가 반환한 type3 우선 사용, 없으면 파일명에서 추출한 값 사용
          const insertData = questions.map((q: any, index: number) => {
            const questionType3 = q.type3 || extractedType3 || '';
            // type3에서 type1, type2 재매핑 (AI가 반환한 type3 기준)
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
            await supabase
              .from('pdf_processing_queue')
              .update({
                status: 'failed',
                error_message: 'DB 저장 실패: ' + insertError.message,
              })
              .eq('id', queueId);

            sendEvent('error', { message: 'DB 저장 실패', details: insertError.message });
            controller.close();
            return;
          }

          sendEvent('progress', { step: 6, message: 'DB 저장 완료' });

          // 6. 추출 비율 계산 및 경고
          const extractionRatio = expectedQuestions > 0
            ? Math.round((questions.length / expectedQuestions) * 100)
            : 100;
          const isLowExtraction = extractionRatio < 80 && expectedQuestions > 0;

          // 7. 큐 상태 업데이트: completed
          await supabase
            .from('pdf_processing_queue')
            .update({
              status: isLowExtraction ? 'warning' : 'completed',
              total_questions: questions.length,
              processed_questions: questions.length,
              expected_questions: expectedQuestions,
              extraction_ratio: extractionRatio,
              progress: 100,
              completed_at: new Date().toISOString(),
              error_message: isLowExtraction
                ? `추출 비율 낮음: ${questions.length}/${expectedQuestions} (${extractionRatio}%)`
                : null,
            })
            .eq('id', queueId);

          // 8. 완료 이벤트 전송
          sendEvent('complete', {
            success: true,
            questionsCount: questions.length,
            expectedQuestions,
            extractionRatio,
            warning: isLowExtraction ? `추출 비율 낮음 (${extractionRatio}%)` : null,
            message: `${questions.length}개 문제 저장 완료`,
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
