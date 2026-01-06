const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Supabase 클라이언트 (CLAUDE.md에서 Project ID 참조)
const supabase = createClient(
  'https://xhvponkrbihlndqkscwz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhodnBvbmtyYmlobG5kcWtzY3d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY2NjMxMDcsImV4cCI6MjA1MjIzOTEwN30.8RDVjNT8e67hXkNh4Nm-t0P8jCsLjL3_Lz2JWF0rmw8'
);

const PDF_FILENAME = '고1_2017-2023_7개년_교육청 학력평가_유형별 모음집_09.내용일치&불일치(안내문).pdf';

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function restore() {
  const csv = fs.readFileSync('/Users/yongwoon.jeong/mock-exam-parser/mock_exam_questions_2026-01-06 (1).csv', 'utf-8');
  const lines = csv.split('\n').filter(l => l.trim());

  // BOM 제거
  const header = lines[0].replace(/^\uFEFF/, '');
  console.log('헤더:', header);

  const rows = lines.slice(1);
  console.log('복원할 문항 수:', rows.length);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.trim()) continue;

    const cols = parseCSVLine(row);

    // 컬럼 매핑:
    // 0: 유형1, 1: 유형2, 2: 유형3, 3: 출제년도, 4: 출제월, 5: 출제학년
    // 6: 출제교육청, 7: 출제번호, 8: 문제번호, 9: 문제, 10: 문제지문
    // 11-15: 선지1-5, 16: 정답, 17: 모범해석, 18: 이미지URL

    const questionData = {
      type1: cols[0] || '',
      type2: cols[1] || '',
      type3: cols[2] || '',
      source_year: cols[3] ? parseInt(cols[3]) : null,
      source_month: cols[4] || '',
      source_grade: cols[5] || '',
      source_org: cols[6] || '',
      source_number: cols[7] ? parseInt(cols[7]) : null,
      question_number: cols[8] ? parseInt(cols[8]) : null,
      question_text: cols[9] || '',
      passage: cols[10] || '',
      choice_1: cols[11] || '',
      choice_2: cols[12] || '',
      choice_3: cols[13] || '',
      choice_4: cols[14] || '',
      choice_5: cols[15] || '',
      correct_answer: cols[16] || '',
      model_translation: cols[17] || '',
      image_path: cols[18] ? extractPathFromUrl(cols[18]) : null,
      pdf_filename: PDF_FILENAME,
    };

    const { error } = await supabase.from('mock_exam_questions').insert(questionData);

    if (error) {
      console.error(`에러 (${i + 1}번째):`, error.message);
      errorCount++;
    } else {
      successCount++;
    }

    if ((i + 1) % 20 === 0) {
      console.log(`진행: ${i + 1}/${rows.length}`);
    }
  }

  console.log(`\n완료! 성공: ${successCount}, 실패: ${errorCount}`);
}

function extractPathFromUrl(url) {
  if (!url) return null;
  // https://xxx.supabase.co/storage/v1/object/public/mock-exam-images/xxx.png
  const match = url.match(/mock-exam-images\/(.+)$/);
  return match ? match[1] : null;
}

restore().catch(console.error);
