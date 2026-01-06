# Mock Exam Parser - 모의고사 문항 관리 시스템

> 최종 업데이트: 2026-01-05
> 교육청 모의고사 PDF를 파싱하여 구조화된 문항 데이터로 변환하고 관리하는 시스템

---

## 1. 프로젝트 개요

### 1.1 목적
- 교육청 모의고사 PDF 파일을 업로드하여 AI(Claude)로 자동 파싱
- 파싱된 문항을 DB에 저장하고 필터링/검색/관리
- 문항별 도표 이미지 수동 업로드 기능
- CSV 다운로드 (이미지 URL 포함)

### 1.2 기술 스택
| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 18 + TypeScript + Vite + Tailwind CSS |
| 백엔드 | Vercel Edge Functions |
| DB | Supabase (PostgreSQL) |
| Storage | Supabase Storage |
| AI | Claude API (Sonnet 4, 프롬프트 캐싱) |
| PDF 파싱 | PDF.js |

---

## 2. 주요 기능

### 2.1 시험 관리 탭 (`exams`)
- **PDF 드래그 앤 드롭 업로드**
  - 파일명에서 메타데이터 자동 추출 (유형3, 학년, 년도, 출처)
  - Supabase Storage에 PDF 저장
  - 처리 큐에 등록

- **처리 큐 테이블**
  - 상태: 대기중 / 처리중 / 완료 / 실패
  - 진행률 표시
  - 재시도 / 삭제 액션

- **일괄 처리 시작**
  - 대기중인 항목을 순차적으로 AI 파싱
  - PDF.js로 텍스트 추출 → Claude API로 구조화

### 2.2 문항 관리 탭 (`questions`)
- **필터링**
  - 유형1 / 유형2 / 유형3
  - 학년 / 년도 / 출처
  - 검색어

- **문항 테이블**
  - 유형, 출처, 문제, 정답, 도표, 액션 컬럼
  - 문항 상세 모달

- **도표 이미지 업로드**
  - 각 문항 행에 "+" 버튼
  - 이미지 업로드 시 Storage 저장 및 DB 경로 업데이트
  - 업로드된 문항은 이미지 아이콘 표시

- **CSV 다운로드**
  - 필터된 문항 또는 전체 문항
  - 이미지 URL 포함

---

## 3. 파일 구조

```
mock-exam-parser/
├── api/
│   └── parse-mock-exam.ts    # Vercel Edge Function (AI 파싱)
├── src/
│   ├── App.tsx               # 메인 앱
│   ├── main.tsx              # 엔트리 포인트
│   ├── index.css             # 글로벌 스타일
│   ├── components/
│   │   └── MockExamParser.tsx  # 메인 컴포넌트 (2탭 구조)
│   └── lib/
│       └── supabase.ts       # Supabase 클라이언트
├── index.html
├── package.json
├── vite.config.ts
├── vercel.json
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── tsconfig.node.json
├── .env.example
├── .gitignore
└── CLAUDE.md                 # 이 문서
```

---

## 4. Supabase 프로젝트 정보

| 항목 | 값 |
|------|------|
| 프로젝트명 | 초등_베토 성장 레포트 |
| Project ID | `xhvponkrbihlndqkscwz` |
| Region | ap-northeast-2 (서울) |
| Organization | betoenglishkorea-lab's Org |

**MCP 사용 시**: 위 Project ID로 `mcp__supabase__execute_sql` 등 호출

---

## 5. DB 테이블

### 5.1 pdf_processing_queue
PDF 처리 큐 관리

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| filename | TEXT | 파일명 |
| storage_path | TEXT | Storage 경로 |
| status | TEXT | pending/processing/completed/failed |
| progress | INT | 진행률 (0-100) |
| total_questions | INT | 총 문항 수 |
| processed_questions | INT | 처리된 문항 수 |
| extracted_type3 | TEXT | 추출된 유형3 |
| extracted_grade | TEXT | 추출된 학년 |
| extracted_years | TEXT | 추출된 년도 |
| extracted_source | TEXT | 추출된 출처 |
| error_message | TEXT | 에러 메시지 |
| created_at | TIMESTAMP | 생성일 |
| started_at | TIMESTAMP | 처리 시작일 |
| completed_at | TIMESTAMP | 처리 완료일 |

### 5.2 mock_exam_questions
파싱된 문항 데이터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| type1 | TEXT | 대분류 (내용추론/대의추론/빈칸추론/논리추론/어법/어휘) |
| type2 | TEXT | 중분류 |
| type3 | TEXT | 소분류 (파일명에서 추출) |
| source_year | INT | 출제년도 |
| source_month | TEXT | 출제월 |
| source_grade | TEXT | 출제학년 |
| source_org | TEXT | 출제기관 |
| source_number | INT | 원 시험지 문항번호 |
| question_number | INT | PDF 내 순번 |
| question_text | TEXT | 문제 지시사항 |
| passage | TEXT | 지문 |
| choice_1~5 | TEXT | 선지 |
| correct_answer | TEXT | 정답 |
| model_translation | TEXT | 모범해석 |
| image_path | TEXT | 도표 이미지 경로 |
| pdf_filename | TEXT | 원본 PDF 파일명 |
| created_at | TIMESTAMP | 생성일 |

---

## 6. Storage 버킷

### 6.1 mock-exam-pdfs
- 용도: PDF 파일 저장
- 공개 여부: 비공개

### 6.2 mock-exam-images
- 용도: 도표/차트 이미지 저장
- 공개 여부: 공개
- 제한: 5MB, 이미지 타입만 (png/jpeg/gif/webp)

---

## 7. API 엔드포인트

### POST /api/parse-mock-exam

PDF 텍스트를 Claude API로 파싱하여 구조화된 문항 데이터로 변환

**Request Body:**
```json
{
  "queueId": "UUID",
  "pdfText": "PDF에서 추출한 텍스트",
  "filename": "파일명.pdf",
  "extractedType3": "추출된 유형3"
}
```

**Response:**
```json
{
  "success": true,
  "questionsCount": 10,
  "message": "10개 문제 저장 완료"
}
```

---

## 8. 환경변수

### 프론트엔드 (.env)
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Vercel 환경변수
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

---

## 9. 유형 분류표

| 유형3 (소분류) | 유형1 (대분류) | 유형2 (중분류) |
|---------------|---------------|---------------|
| 글의 목적 | 내용추론 | 글의 목적 |
| 감정/심경/분위기 | 내용추론 | 감정/심경/분위기 |
| 지칭추론 | 내용추론 | 지칭추론 |
| 내용일치/불일치 | 내용추론 | 내용일치/불일치 |
| 도표 | 내용추론 | 도표 |
| 주제/제목/요지 | 대의추론 | 주제/제목/요지 |
| 요약문 완성 | 대의추론 | 요약문완성 |
| 함의추론 | 빈칸추론 | 함의추론 |
| 빈칸추론 | 빈칸추론 | 빈칸추론 |
| 접속사/연결사 | 빈칸추론 | 접속사/연결사 |
| 무관한 문장 | 논리추론 | 글의흐름(순서/삽입/무관) |
| 글의 순서 | 논리추론 | 글의흐름(순서/삽입/무관) |
| 문장 삽입 | 논리추론 | 글의흐름(순서/삽입/무관) |
| 장문독해 | 논리추론 | 장문독해 |
| 어법 | 어법 | 어법 |
| 어휘 | 어휘 | 어휘 |
| 어휘 영영풀이 | 어휘 | 어휘영영풀이 |

---

## 10. 개발 명령어

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 빌드
npm run build

# 프리뷰
npm run preview
```

---

## 11. 배포

### Vercel 배포
1. GitHub에 푸시
2. Vercel에서 Import
3. 환경변수 설정
4. 자동 배포

---

## 12. 주의사항

1. **로컬 개발 시**: PDF 처리(AI 파싱)는 Vercel 배포 후에만 작동
2. **프롬프트 캐싱**: Claude API 호출 시 시스템 프롬프트 캐싱 적용 (비용 90% 절감)
3. **PDF.js 워커**: Vite 환경에서는 `import.meta.url` 방식으로 워커 로드

---

## 13. 향후 계획

- [ ] 도표 이미지 자동 추출 (PDF 페이지 렌더링)
- [ ] 문항 편집 기능
- [ ] 문항 복제/이동 기능
- [ ] 일괄 유형 변경 기능
