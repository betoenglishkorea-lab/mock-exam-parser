import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js 워커 설정 (Vite 호환)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Supabase Storage 버킷 이름
const STORAGE_BUCKET = 'mock-exam-pdfs';
const IMAGE_BUCKET = 'mock-exam-images';

// Supabase Storage 헬퍼 함수들
const uploadPdfToStorage = async (filename: string, file: File): Promise<string> => {
  const timestamp = Date.now();
  const safeName = filename.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
  const storagePath = `uploads/${timestamp}_${safeName}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: 'application/pdf',
      upsert: false
    });

  if (error) {
    throw new Error(`Storage 업로드 실패: ${error.message}`);
  }

  return storagePath;
};

const getPdfFromStorage = async (storagePath: string): Promise<ArrayBuffer | null> => {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (error) {
    console.error('Storage 다운로드 실패:', error);
    return null;
  }

  return await data.arrayBuffer();
};

const deletePdfFromStorage = async (storagePath: string): Promise<void> => {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath]);

  if (error) {
    console.error('Storage 삭제 실패:', error);
  }
};

interface PdfQueueItem {
  id: string;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'warning';
  progress: number;
  total_questions: number;
  processed_questions: number;
  expected_questions?: number;
  extraction_ratio?: number;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  extracted_type3?: string;
  extracted_grade?: string;
  extracted_years?: string;
  extracted_source?: string;
  storage_path?: string;
}

interface MockExamQuestion {
  id: string;
  type1: string;
  type2: string;
  type3: string;
  source_year: number;
  source_month: string;
  source_grade: string;
  source_org: string;
  source_number: number;
  question_number: number;
  question_text: string;
  passage: string;
  choice_1: string;
  choice_2: string;
  choice_3: string;
  choice_4: string;
  choice_5: string;
  correct_answer: string;
  model_translation: string;
  pdf_filename: string;
  image_path?: string;
  created_at?: string;
}

export function MockExamParser() {
  // 메인 탭: 시험 / 문항
  const [mainTab, setMainTab] = useState<'exams' | 'questions'>('exams');

  // 시험 탭 상태
  const [queue, setQueue] = useState<PdfQueueItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);

  // 문항 탭 상태
  const [questions, setQuestions] = useState<MockExamQuestion[]>([]);
  const [filteredQuestions, setFilteredQuestions] = useState<MockExamQuestion[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<MockExamQuestion | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);

  // 필터 상태
  const [filters, setFilters] = useState({
    type1: '',
    type2: '',
    type3: '',
    sourceGrade: '',
    sourceYear: '',
    sourceOrg: '',
    searchText: ''
  });

  // 필터 옵션
  const [filterOptions, setFilterOptions] = useState({
    type1List: [] as string[],
    type2List: [] as string[],
    type3List: [] as string[],
    gradeList: [] as string[],
    yearList: [] as string[],
    orgList: [] as string[]
  });

  // 통계
  const [stats, setStats] = useState({
    totalPdfs: 0,
    pendingPdfs: 0,
    processingPdfs: 0,
    completedPdfs: 0,
    failedPdfs: 0,
    totalQuestions: 0
  });

  // 이미지 업로드 ref
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 큐 및 통계 조회
  const fetchQueue = useCallback(async () => {
    const { data: queueData } = await supabase
      .from('pdf_processing_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (queueData) {
      setQueue(queueData);

      const pending = queueData.filter(q => q.status === 'pending').length;
      const processingCount = queueData.filter(q => q.status === 'processing').length;
      const completed = queueData.filter(q => q.status === 'completed').length;
      const failed = queueData.filter(q => q.status === 'failed').length;

      setStats(prev => ({
        ...prev,
        totalPdfs: queueData.length,
        pendingPdfs: pending,
        processingPdfs: processingCount,
        completedPdfs: completed,
        failedPdfs: failed
      }));
    }

    const { count } = await supabase
      .from('mock_exam_questions')
      .select('*', { count: 'exact', head: true });

    setStats(prev => ({
      ...prev,
      totalQuestions: count || 0
    }));
  }, []);

  // 문제 목록 조회
  const fetchQuestions = useCallback(async () => {
    const { data } = await supabase
      .from('mock_exam_questions')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      setQuestions(data);
      setFilteredQuestions(data);

      // 필터 옵션 추출
      const type1Set = new Set<string>();
      const type2Set = new Set<string>();
      const type3Set = new Set<string>();
      const gradeSet = new Set<string>();
      const yearSet = new Set<string>();
      const orgSet = new Set<string>();

      data.forEach(q => {
        if (q.type1) type1Set.add(q.type1);
        if (q.type2) type2Set.add(q.type2);
        if (q.type3) type3Set.add(q.type3);
        if (q.source_grade) gradeSet.add(q.source_grade);
        if (q.source_year) yearSet.add(String(q.source_year));
        if (q.source_org) orgSet.add(q.source_org);
      });

      setFilterOptions({
        type1List: Array.from(type1Set).sort(),
        type2List: Array.from(type2Set).sort(),
        type3List: Array.from(type3Set).sort(),
        gradeList: Array.from(gradeSet).sort(),
        yearList: Array.from(yearSet).sort((a, b) => Number(b) - Number(a)),
        orgList: Array.from(orgSet).sort()
      });
    }
  }, []);

  // 필터 적용
  useEffect(() => {
    let result = [...questions];

    if (filters.type1) {
      result = result.filter(q => q.type1 === filters.type1);
    }
    if (filters.type2) {
      result = result.filter(q => q.type2 === filters.type2);
    }
    if (filters.type3) {
      result = result.filter(q => q.type3 === filters.type3);
    }
    if (filters.sourceGrade) {
      result = result.filter(q => q.source_grade === filters.sourceGrade);
    }
    if (filters.sourceYear) {
      result = result.filter(q => String(q.source_year) === filters.sourceYear);
    }
    if (filters.sourceOrg) {
      result = result.filter(q => q.source_org === filters.sourceOrg);
    }
    if (filters.searchText) {
      const searchLower = filters.searchText.toLowerCase();
      result = result.filter(q =>
        q.question_text?.toLowerCase().includes(searchLower) ||
        q.passage?.toLowerCase().includes(searchLower)
      );
    }

    setFilteredQuestions(result);
  }, [filters, questions]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  useEffect(() => {
    if (mainTab === 'questions') {
      fetchQuestions();
    }
  }, [mainTab, fetchQuestions]);

  // 드래그 앤 드롭 핸들러
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type === 'application/pdf');
    if (files.length > 0) {
      await uploadFiles(files);
    }
    e.target.value = '';
  };

  // 파일명에서 메타데이터 추출
  const extractMetadataFromFilename = (filename: string) => {
    let extractedType3 = '';

    // 패턴 1: 모음집_유형.pdf 또는 모음집 숫자_유형.pdf
    let typeMatch = filename.match(/모음집[_\s]*(\d+)?[_\s]+(.+)\.pdf$/i);
    if (typeMatch && typeMatch[2]) {
      extractedType3 = typeMatch[2];
    }

    // 패턴 2: 기출_숫자.유형.pdf (예: 기출_11.장문독해.pdf)
    if (!extractedType3) {
      typeMatch = filename.match(/기출[_\s]+\d+\.(.+)\.pdf$/i);
      if (typeMatch && typeMatch[1]) {
        extractedType3 = typeMatch[1];
      }
    }

    // 패턴 3: 기출_유형.pdf (숫자 없는 경우)
    if (!extractedType3) {
      typeMatch = filename.match(/기출[_\s]+([^_\d][^_]+)\.pdf$/i);
      if (typeMatch && typeMatch[1]) {
        extractedType3 = typeMatch[1];
      }
    }

    // 후처리: 언더스코어 → 슬래시, 쉼표 → 슬래시, 수정 표시 제거
    if (extractedType3) {
      extractedType3 = extractedType3.replace(/_/g, '/');
      extractedType3 = extractedType3.replace(/,\s*/g, '/');
      extractedType3 = extractedType3.replace(/\(\d+수정\)/g, '');
      extractedType3 = extractedType3.trim();
    }

    const gradeMatch = filename.match(/고(\d)/);
    const extractedGrade = gradeMatch ? `고${gradeMatch[1]}` : '';

    const yearsMatch = filename.match(/(\d{4})[-~]?(\d{4})?년?/);
    const extractedYears = yearsMatch
      ? yearsMatch[2]
        ? `${yearsMatch[1]}-${yearsMatch[2]}`
        : yearsMatch[1]
      : '';

    let extractedSource = '';
    if (filename.includes('평가원')) extractedSource = '평가원';
    else if (filename.includes('모평')) extractedSource = '평가원';
    else if (filename.includes('수능')) extractedSource = '수능';
    else if (filename.includes('교육청')) extractedSource = '교육청';

    return { extractedType3, extractedGrade, extractedYears, extractedSource };
  };

  // 파일 업로드
  const uploadFiles = async (files: File[]) => {
    setUploading(true);

    for (const file of files) {
      try {
        const filename = file.name;
        const { extractedType3, extractedGrade, extractedYears, extractedSource } = extractMetadataFromFilename(filename);

        const storagePath = await uploadPdfToStorage(filename, file);

        const { error } = await supabase
          .from('pdf_processing_queue')
          .insert({
            filename: filename,
            file_size: file.size,
            extracted_type3: extractedType3,
            extracted_grade: extractedGrade,
            extracted_years: extractedYears,
            extracted_source: extractedSource,
            storage_path: storagePath,
            status: 'pending'
          });

        if (error) {
          console.error('큐 추가 실패:', error);
          await deletePdfFromStorage(storagePath);
        }
      } catch (err) {
        console.error('파일 처리 오류:', err);
      }
    }

    setUploading(false);
    fetchQueue();
  };

  // CSV 다운로드
  const downloadCSV = async () => {
    const dataToExport = filteredQuestions.length > 0 ? filteredQuestions : questions;

    if (dataToExport.length === 0) {
      alert('다운로드할 데이터가 없습니다.');
      return;
    }

    const headers = [
      '유형 1', '유형 2', '유형 3', '출제년도', '출제월', '출제학년',
      '출제교육청', '출제번호', '문제번호', '문제', '문제지문',
      '선지1', '선지2', '선지3', '선지4', '선지5', '정답', '모범해석', '이미지URL'
    ];

    const rows = dataToExport.map(q => [
      q.type1,
      q.type2,
      q.type3,
      q.source_year,
      q.source_month,
      q.source_grade,
      q.source_org,
      q.source_number,
      q.question_number,
      q.question_text,
      q.passage,
      q.choice_1,
      q.choice_2,
      q.choice_3,
      q.choice_4,
      q.choice_5,
      q.correct_answer,
      q.model_translation,
      q.image_path ? `${supabase.storage.from(IMAGE_BUCKET).getPublicUrl(q.image_path).data.publicUrl}` : ''
    ]);

    const escapeCSV = (value: any) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mock_exam_questions_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 큐 아이템 삭제
  const deleteQueueItem = async (id: string, storagePath?: string) => {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;

    if (storagePath) {
      await deletePdfFromStorage(storagePath);
    }
    await supabase.from('pdf_processing_queue').delete().eq('id', id);
    fetchQueue();
  };

  // 큐 아이템 재시도
  const retryQueueItem = async (id: string) => {
    await supabase
      .from('pdf_processing_queue')
      .update({ status: 'pending', error_message: null, retry_count: 0 })
      .eq('id', id);
    fetchQueue();
  };

  // 추가 추출 (누락된 문항 추출)
  const additionalExtract = async (item: PdfQueueItem) => {
    if (processing) {
      alert('다른 처리가 진행 중입니다.');
      return;
    }

    if (!item.storage_path) {
      alert('Storage 경로가 없습니다.');
      return;
    }

    // 이미 추출된 문항 번호 조회
    const { data: existingQuestions } = await supabase
      .from('mock_exam_questions')
      .select('question_number')
      .eq('pdf_filename', item.filename);

    const existingNumbers = existingQuestions?.map(q => q.question_number) || [];

    if (existingNumbers.length === 0) {
      alert('기존 추출된 문항이 없습니다. 일반 처리를 사용하세요.');
      return;
    }

    if (!confirm(`기존 ${existingNumbers.length}개 문항을 제외하고 추가 추출을 시작합니다.\n계속하시겠습니까?`)) {
      return;
    }

    setProcessing(true);

    try {
      // Storage에서 PDF 다운로드
      const arrayBuffer = await getPdfFromStorage(item.storage_path);
      if (!arrayBuffer) {
        throw new Error('Storage에서 파일을 찾을 수 없습니다.');
      }

      // PDF 텍스트 추출
      const pdfText = await extractTextFromArrayBuffer(arrayBuffer);

      // 상태 업데이트
      await supabase
        .from('pdf_processing_queue')
        .update({
          status: 'processing',
          started_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', item.id);
      fetchQueue();

      // API 호출 (추가 추출 모드)
      const response = await fetch('/api/parse-mock-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueId: item.id,
          pdfText,
          filename: item.filename,
          extractedType3: item.extracted_type3,
          mode: 'additional',
          existingQuestionNumbers: existingNumbers,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP ${response.status}`);
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      // SSE 스트림 읽기
      if (!response.body) {
        throw new Error('응답 스트림이 없습니다.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            console.log('SSE Event:', line.substring(7));
          } else if (line.startsWith('data: ')) {
            const dataStr = line.substring(6);
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              console.log('SSE Data:', data);

              if (data.success === false || data.error) {
                throw new Error(data.message || data.error || 'API 처리 실패');
              }
            } catch (parseErr) {
              if (!(parseErr instanceof SyntaxError)) {
                throw parseErr;
              }
            }
          }
        }
      }

      fetchQueue();
      alert('추가 추출이 완료되었습니다.');
    } catch (error) {
      console.error('추가 추출 실패:', error);
      const errorMsg = error instanceof Error ? error.message : String(error).substring(0, 200);
      await supabase
        .from('pdf_processing_queue')
        .update({
          status: 'warning',
          error_message: `추가 추출 실패: ${errorMsg}`,
        })
        .eq('id', item.id);
      fetchQueue();
      alert(`추가 추출 실패: ${errorMsg}`);
    } finally {
      setProcessing(false);
    }
  };

  // ArrayBuffer에서 PDF 텍스트 추출
  const extractTextFromArrayBuffer = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const textParts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      textParts.push(pageText);
    }

    return textParts.join('\n\n');
  };

  // 대기중인 항목 처리 시작
  const startProcessing = async () => {
    if (processing) return;

    const pendingItems = queue.filter(q => q.status === 'pending');
    if (pendingItems.length === 0) {
      alert('처리할 대기중인 항목이 없습니다.');
      return;
    }

    setProcessing(true);

    for (const item of pendingItems) {
      try {
        if (!item.storage_path) {
          await supabase
            .from('pdf_processing_queue')
            .update({
              status: 'failed',
              error_message: 'Storage 경로가 없습니다. 다시 업로드해주세요.',
            })
            .eq('id', item.id);
          continue;
        }

        const arrayBuffer = await getPdfFromStorage(item.storage_path);
        if (!arrayBuffer) {
          await supabase
            .from('pdf_processing_queue')
            .update({
              status: 'failed',
              error_message: 'Storage에서 파일을 찾을 수 없습니다. 다시 업로드해주세요.',
            })
            .eq('id', item.id);
          continue;
        }

        await supabase
          .from('pdf_processing_queue')
          .update({
            status: 'processing',
            started_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        fetchQueue();

        const pdfText = await extractTextFromArrayBuffer(arrayBuffer);

        const response = await fetch('/api/parse-mock-exam', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queueId: item.id,
            pdfText,
            filename: item.filename,
            extractedType3: item.extracted_type3,
          }),
        });

        // 에러 응답 체크 (SSE가 아닌 JSON 에러 응답인 경우)
        if (!response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        }

        // SSE 스트림 읽기
        if (!response.body) {
          throw new Error('응답 스트림이 없습니다.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE 이벤트 파싱
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              const eventType = line.substring(7);
              console.log('SSE Event:', eventType);
            } else if (line.startsWith('data: ')) {
              const dataStr = line.substring(6);
              if (!dataStr) continue; // 빈 데이터 무시

              try {
                const data = JSON.parse(dataStr);
                console.log('SSE Data:', data);

                if (data.message) {
                  console.log(`[${item.filename}] ${data.message}`);
                }

                // 에러 이벤트 처리
                if (data.success === false || data.error) {
                  throw new Error(data.message || data.error || 'API 처리 실패');
                }
              } catch (parseErr) {
                // JSON 파싱 실패 시 - 실제 에러인지 확인
                if (parseErr instanceof SyntaxError) {
                  console.warn('SSE 데이터 파싱 스킵:', dataStr.substring(0, 100));
                } else {
                  // JSON 파싱 에러가 아니면 실제 에러이므로 다시 throw
                  throw parseErr;
                }
              }
            }
          }
        }

        fetchQueue();
      } catch (error) {
        console.error(`처리 실패: ${item.filename}`, error);
        // 에러 메시지 간결하게 처리
        const errorMsg = error instanceof Error
          ? error.message
          : String(error).substring(0, 200);
        await supabase
          .from('pdf_processing_queue')
          .update({
            status: 'failed',
            error_message: errorMsg,
          })
          .eq('id', item.id);
        fetchQueue();
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    setProcessing(false);
    fetchQueue();
    alert('처리가 완료되었습니다.');
  };

  // 문항 삭제
  const deleteQuestion = async (id: string) => {
    if (!confirm('이 문항을 삭제하시겠습니까?')) return;

    const { error } = await supabase.from('mock_exam_questions').delete().eq('id', id);
    if (!error) {
      fetchQuestions();
    }
  };

  // 도표 이미지 업로드
  const handleImageUpload = async (questionId: string, file: File) => {
    try {
      const timestamp = Date.now();
      const ext = file.name.split('.').pop();
      const storagePath = `charts/${questionId}_${timestamp}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: true
        });

      if (uploadError) {
        // 버킷이 없으면 생성 시도
        if (uploadError.message.includes('not found')) {
          alert('이미지 버킷이 없습니다. 관리자에게 문의하세요.');
          return;
        }
        throw uploadError;
      }

      // DB 업데이트
      const { error: updateError } = await supabase
        .from('mock_exam_questions')
        .update({ image_path: storagePath })
        .eq('id', questionId);

      if (updateError) throw updateError;

      alert('이미지가 업로드되었습니다.');
      fetchQuestions();
      setShowImageModal(false);
    } catch (error) {
      console.error('이미지 업로드 실패:', error);
      alert('이미지 업로드에 실패했습니다.');
    }
  };

  // 상태 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'warning': return 'bg-orange-100 text-orange-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '대기중';
      case 'processing': return '처리중';
      case 'completed': return '완료';
      case 'warning': return '확인필요';
      case 'failed': return '실패';
      default: return status;
    }
  };

  // 필터 초기화
  const resetFilters = () => {
    setFilters({
      type1: '',
      type2: '',
      type3: '',
      sourceGrade: '',
      sourceYear: '',
      sourceOrg: '',
      searchText: ''
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">모의고사 문제은행</h1>
              <p className="text-sm text-gray-500 mt-1">교육청 모의고사 PDF → DB 변환 및 관리</p>
            </div>
            <div className="flex gap-3">
              {mainTab === 'exams' && (
                <button
                  onClick={startProcessing}
                  disabled={stats.pendingPdfs === 0 || processing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {processing ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      처리 중...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      처리 시작 ({stats.pendingPdfs})
                    </>
                  )}
                </button>
              )}
              <button
                onClick={downloadCSV}
                disabled={stats.totalQuestions === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                CSV 다운로드 {filteredQuestions.length > 0 && filteredQuestions.length !== questions.length && `(${filteredQuestions.length})`}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 탭 */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex gap-4 border-b border-gray-200">
          <button
            onClick={() => setMainTab('exams')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              mainTab === 'exams'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            시험 관리
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
              {stats.totalPdfs}
            </span>
          </button>
          <button
            onClick={() => setMainTab('questions')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              mainTab === 'questions'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            문항 관리
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
              {stats.totalQuestions.toLocaleString()}
            </span>
          </button>
        </div>
      </div>

      {/* 시험 관리 탭 */}
      {mainTab === 'exams' && (
        <div className="max-w-7xl mx-auto px-4 pb-6">
          {/* 통계 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-500">전체 PDF</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalPdfs}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-500">대기중</p>
              <p className="text-2xl font-bold text-yellow-600">{stats.pendingPdfs}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-500">처리중</p>
              <p className="text-2xl font-bold text-blue-600">{stats.processingPdfs}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-500">완료</p>
              <p className="text-2xl font-bold text-green-600">{stats.completedPdfs}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-500">실패</p>
              <p className="text-2xl font-bold text-red-600">{stats.failedPdfs}</p>
            </div>
          </div>

          {/* 업로드 영역 */}
          <div className="bg-white rounded-lg shadow mb-6">
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">PDF 업로드</h3>
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <svg className="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="mt-3 text-base font-medium text-gray-900">
                  PDF 파일을 드래그하여 업로드
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  또는 클릭하여 파일 선택 (여러 파일 선택 가능)
                </p>
                <input
                  type="file"
                  accept=".pdf"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="mt-3 inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 cursor-pointer"
                >
                  {uploading ? '업로드 중...' : '파일 선택'}
                </label>
              </div>
            </div>
          </div>

          {/* 처리 큐 */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h3 className="text-lg font-medium text-gray-900">처리 큐</h3>
            </div>
            <div className="overflow-x-auto">
              {queue.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>처리 대기 중인 PDF가 없습니다.</p>
                  <p className="text-sm mt-2">PDF 파일을 업로드하세요.</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">파일명</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">유형</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">학년</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">출처</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">문제수</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">액션</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {queue.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900 truncate max-w-xs" title={item.filename}>
                            {item.filename}
                          </div>
                          <div className="text-xs text-gray-500">
                            {new Date(item.created_at).toLocaleString('ko-KR')}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {item.extracted_type3 || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {item.extracted_grade || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {item.extracted_source || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
                            {getStatusText(item.status)}
                          </span>
                          {item.error_message && (
                            <p className="text-xs text-red-500 mt-1 truncate max-w-xs" title={item.error_message}>
                              {item.error_message}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {(item.status === 'completed' || item.status === 'warning') && (
                            <div>
                              <span className={`font-medium ${item.status === 'warning' ? 'text-orange-600' : 'text-green-600'}`}>
                                {item.total_questions}문제
                              </span>
                              {item.expected_questions && item.expected_questions > 0 && (
                                <span className="text-gray-400 text-xs ml-1">
                                  /{item.expected_questions} ({item.extraction_ratio}%)
                                </span>
                              )}
                            </div>
                          )}
                          {item.status === 'processing' && (
                            <span className="text-blue-600">{item.processed_questions || 0}/{item.total_questions || '?'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            {(item.status === 'failed' || item.status === 'warning') && (
                              <button
                                onClick={() => retryQueueItem(item.id)}
                                className="text-blue-600 hover:text-blue-800 text-sm"
                                disabled={processing}
                              >
                                재시도
                              </button>
                            )}
                            {item.status === 'warning' && (
                              <button
                                onClick={() => additionalExtract(item)}
                                className="text-orange-600 hover:text-orange-800 text-sm"
                                disabled={processing}
                              >
                                추가추출
                              </button>
                            )}
                            <button
                              onClick={() => deleteQueueItem(item.id, item.storage_path)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 문항 관리 탭 */}
      {mainTab === 'questions' && (
        <div className="max-w-7xl mx-auto px-4 pb-6">
          {/* 필터 영역 */}
          <div className="bg-white rounded-lg shadow mb-6 p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">유형1</label>
                <select
                  value={filters.type1}
                  onChange={e => setFilters(prev => ({ ...prev, type1: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">전체</option>
                  {filterOptions.type1List.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">유형2</label>
                <select
                  value={filters.type2}
                  onChange={e => setFilters(prev => ({ ...prev, type2: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">전체</option>
                  {filterOptions.type2List.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">유형3</label>
                <select
                  value={filters.type3}
                  onChange={e => setFilters(prev => ({ ...prev, type3: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">전체</option>
                  {filterOptions.type3List.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">학년</label>
                <select
                  value={filters.sourceGrade}
                  onChange={e => setFilters(prev => ({ ...prev, sourceGrade: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">전체</option>
                  {filterOptions.gradeList.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">년도</label>
                <select
                  value={filters.sourceYear}
                  onChange={e => setFilters(prev => ({ ...prev, sourceYear: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">전체</option>
                  {filterOptions.yearList.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">출처</label>
                <select
                  value={filters.sourceOrg}
                  onChange={e => setFilters(prev => ({ ...prev, sourceOrg: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">전체</option>
                  {filterOptions.orgList.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">검색</label>
                <input
                  type="text"
                  value={filters.searchText}
                  onChange={e => setFilters(prev => ({ ...prev, searchText: e.target.value }))}
                  placeholder="문제 또는 지문 검색..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <button
                onClick={resetFilters}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
              >
                초기화
              </button>
            </div>
            <div className="mt-3 text-sm text-gray-500">
              {filteredQuestions.length === questions.length
                ? `전체 ${questions.length}개 문항`
                : `${filteredQuestions.length}개 / ${questions.length}개 문항`}
            </div>
          </div>

          {/* 문항 테이블 */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              {filteredQuestions.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>표시할 문항이 없습니다.</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">유형</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">출처</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">문제</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase w-16">정답</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase w-16">도표</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase w-24">액션</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredQuestions.map(q => (
                      <tr key={q.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="text-xs">
                            <span className="font-medium text-gray-900">{q.type1}</span>
                            {q.type3 && (
                              <>
                                <br />
                                <span className="text-gray-500">{q.type3}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          <div>{q.source_year}년 {q.source_month}</div>
                          <div>{q.source_grade} {q.source_org}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div
                            className="text-sm text-gray-900 truncate max-w-md cursor-pointer hover:text-blue-600"
                            title={q.question_text}
                            onClick={() => {
                              setSelectedQuestion(q);
                              setShowDetailModal(true);
                            }}
                          >
                            {q.question_text || '(문제 텍스트 없음)'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-7 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                            {q.correct_answer}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {q.image_path ? (
                            <button
                              onClick={() => {
                                const url = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(q.image_path!).data.publicUrl;
                                window.open(url, '_blank');
                              }}
                              className="text-green-600 hover:text-green-800"
                              title="도표 보기"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedQuestion(q);
                                setShowImageModal(true);
                              }}
                              className="text-gray-400 hover:text-blue-600"
                              title="도표 추가"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={() => {
                                setSelectedQuestion(q);
                                setShowDetailModal(true);
                              }}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                            >
                              상세
                            </button>
                            <button
                              onClick={() => deleteQuestion(q.id)}
                              className="text-red-600 hover:text-red-800 text-xs"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 문항 상세 모달 */}
      {showDetailModal && selectedQuestion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-medium text-gray-900">문항 상세</h3>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">유형:</span>
                    <span className="ml-2 font-medium">{selectedQuestion.type1} / {selectedQuestion.type2} / {selectedQuestion.type3}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">출처:</span>
                    <span className="ml-2 font-medium">
                      {selectedQuestion.source_year}년 {selectedQuestion.source_month} {selectedQuestion.source_grade} {selectedQuestion.source_org} {selectedQuestion.source_number}번
                    </span>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2">문제</h4>
                  <p className="text-gray-900 bg-gray-50 p-3 rounded-lg">{selectedQuestion.question_text}</p>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2">지문</h4>
                  <p className="text-gray-900 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap text-sm">
                    {selectedQuestion.passage || '(지문 없음)'}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2">선지</h4>
                  <div className="space-y-1 text-sm">
                    {[1, 2, 3, 4, 5].map(i => {
                      const choice = selectedQuestion[`choice_${i}` as keyof MockExamQuestion] as string;
                      const isCorrect = selectedQuestion.correct_answer === `${i}` || selectedQuestion.correct_answer === `①②③④⑤`[i-1];
                      return choice ? (
                        <div key={i} className={`p-2 rounded ${isCorrect ? 'bg-green-100 text-green-800' : 'bg-gray-50'}`}>
                          {choice}
                        </div>
                      ) : null;
                    })}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2">정답</h4>
                  <span className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                    {selectedQuestion.correct_answer}
                  </span>
                </div>

                {selectedQuestion.model_translation && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">모범해석</h4>
                    <p className="text-gray-900 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap text-sm">
                      {selectedQuestion.model_translation}
                    </p>
                  </div>
                )}

                {selectedQuestion.image_path && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">도표 이미지</h4>
                    <img
                      src={supabase.storage.from(IMAGE_BUCKET).getPublicUrl(selectedQuestion.image_path).data.publicUrl}
                      alt="도표"
                      className="max-w-full rounded-lg border"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 이미지 업로드 모달 */}
      {showImageModal && selectedQuestion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-medium text-gray-900">도표 이미지 추가</h3>
                <button
                  onClick={() => setShowImageModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className="text-sm text-gray-500 mb-4">
                {selectedQuestion.source_year}년 {selectedQuestion.source_month} {selectedQuestion.source_grade} {selectedQuestion.source_number}번 문항에 도표 이미지를 추가합니다.
              </p>

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleImageUpload(selectedQuestion.id, file);
                  }
                }}
                className="hidden"
              />

              <button
                onClick={() => imageInputRef.current?.click()}
                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-500 transition-colors"
              >
                클릭하여 이미지 선택
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
