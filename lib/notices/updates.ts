export type UpdateNotice = {
  id: string
  category: '이용 안내'
  title: string
  summary: string
  details: readonly string[]
}

/** Feature guides only. No verified publication dates or operational release feed are available. */
export const updateNotices: readonly UpdateNotice[] = [
  {
    id: 'race-entry',
    category: '이용 안내',
    title: '경주 출전 추천 옵션 안내',
    summary: '경주·기수·전술의 기본 추천 조합을 확인하세요.',
    details: [
      '출전 가능한 경주와 계약 기수가 있으면 출전 화면에 추천 조합이 기본 선택됩니다. 경주마다 출전 조건을 확인하세요.',
      '경주를 변경하면 해당 경주에 맞는 추천 조합으로 갱신됩니다. 직접 변경한 기수·전술은 같은 경주에서 유지됩니다.',
      '출전 확정 후에는 선택이 잠기며 저장된 출전 정보로 경주가 진행됩니다.',
    ],
  },
  {
    id: 'browser-save',
    category: '이용 안내',
    title: '브라우저 저장과 기록 복구 안내',
    summary: '같은 브라우저에서 육성 기록을 이어갈 수 있습니다.',
    details: [
      '브라우저 저장 모드는 육성 상태와 마방 기록을 한 문서로 저장합니다. 새로고침 후 저장된 기록을 다시 불러옵니다.',
      '저장에 실패하면 오류를 표시하고 기존 기록을 임의로 초기화하지 않습니다. 오류 내용을 확인한 뒤 다시 불러와 주세요.',
      '브라우저 저장 기록은 이 브라우저에 보관됩니다. 브라우저 데이터를 삭제하면 기록이 사라질 수 있으며 이 기록은 다른 기기로 자동 동기화되지 않습니다.',
    ],
  },
  {
    id: 'race-watch',
    category: '이용 안내',
    title: '경주 관전 기능 알아보기',
    summary: '자동 관전과 배속·일시정지를 사용할 수 있습니다.',
    details: [
      '경주 관전에서는 자동 진행, 수동 배속 및 일시정지를 사용할 수 있습니다.',
      '현재 순위와 순위 변화, 경주 중 주요 상황을 함께 확인할 수 있습니다. 아직 진행되지 않은 장면은 관전 중 미리 표시하지 않습니다.',
      '경주가 끝나면 결과 화면에서 착순과 기록, 상금 및 주요 장면을 확인할 수 있습니다.',
    ],
  },
  {
    id: 'save-modes',
    category: '이용 안내',
    title: '저장 모드 이용 안내',
    summary: '현재 선택한 저장 모드와 연결 상태를 확인하세요.',
    details: [
      '브라우저 저장 모드는 현재 브라우저의 저장소를 사용합니다.',
      '개발용 서버 저장은 개발 설정과 API 연결이 갖춰진 환경에서 사용합니다. 현재 화면의 저장 모드와 연결 상태를 확인하세요.',
      '서버 저장의 연결 오류나 처리 중인 요청은 화면에 표시되는 상태와 재시도 안내를 확인하세요.',
    ],
  },
]

export const noticeCenterDescription =
  '등록된 운영 공지·업데이트 내역이 없습니다. 아래 항목은 배포·출시 이력이 아닌 기능 이용 안내입니다.'
