import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function updateStatus() {
  // 현재 상태 확인
  const { data: before } = await supabase
    .from('pdf_processing_queue')
    .select('status')
    .in('status', ['failed', 'processing']);

  console.log('변경 대상:', before?.length || 0, '개');
  
  // failed → pending
  const { data: failedData, error: failedError } = await supabase
    .from('pdf_processing_queue')
    .update({ status: 'pending', error_message: null })
    .eq('status', 'failed')
    .select('id');

  if (failedError) {
    console.error('failed 변경 오류:', failedError);
  } else {
    console.log('failed → pending:', failedData?.length || 0, '개');
  }

  // processing → pending
  const { data: processingData, error: processingError } = await supabase
    .from('pdf_processing_queue')
    .update({ status: 'pending', error_message: null })
    .eq('status', 'processing')
    .select('id');

  if (processingError) {
    console.error('processing 변경 오류:', processingError);
  } else {
    console.log('processing → pending:', processingData?.length || 0, '개');
  }

  // 결과 확인
  const { data: after } = await supabase
    .from('pdf_processing_queue')
    .select('status');
    
  const statusCount = {};
  after?.forEach(item => {
    statusCount[item.status] = (statusCount[item.status] || 0) + 1;
  });
  console.log('변경 후 상태:', statusCount);
}

updateStatus();
