const errorMessages = {
  max_output_tokens: '답변이 최대 길이에 도달해 완료되지 않았어요. 요청 범위를 좁혀 다시 시도해 주세요.',
  empty_response: 'AI가 답변 내용을 반환하지 않았어요. 다시 요청해 주세요.',
  APIConnectionTimeoutError: 'AI 응답 대기 시간을 초과했어요. 잠시 후 다시 요청해 주세요.',
  APIConnectionError: 'OpenAI 서버에 연결하지 못했어요. 서버의 네트워크 연결을 확인해 주세요.',
  insufficient_quota: 'OpenAI API 사용 한도에 도달했어요. API 계정의 잔액과 사용 한도를 확인해 주세요.',
  401: 'OpenAI API 키 인증에 실패했어요. 서버의 API 키 설정을 확인해 주세요.',
  403: '설정한 AI 모델을 사용할 권한이 없어요. API 계정의 모델 사용 권한을 확인해 주세요.',
  404: '설정한 AI 모델을 찾을 수 없어요. 서버의 모델 이름과 사용 권한을 확인해 주세요.',
  429: 'OpenAI 요청이 일시적으로 많아요. 잠시 후 다시 요청해 주세요.'
};

function responseText(answer) {
  const text = typeof answer?.output_text === 'string' ? answer.output_text.trim() : '';
  if (answer?.status !== 'completed' || !text) {
    throw Object.assign(new Error('Incomplete AI response'), {
      code: answer?.incomplete_details?.reason || answer?.error?.code || 'empty_response',
      request_id: answer?._request_id
    });
  }
  return text;
}

function responseErrorMessage(error) {
  return errorMessages[error.code] || errorMessages[error.constructor?.name] || errorMessages[error.status]
    || 'AI 답변 생성 중 오류가 발생했어요. 잠시 후 다시 요청해 주세요.';
}

module.exports = { responseText, responseErrorMessage };
