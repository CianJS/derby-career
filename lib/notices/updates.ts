export type UpdateNotice = {
  id: string
  category: '업데이트' | '안내'
  date: string
  title: string
  summary: string
  details: readonly string[]
}

/** Temporary, hand-written content for the notice UI. Not a live release feed. */
export const updateNotices: readonly UpdateNotice[] = [
  {
    id: 'race-entry',
    category: '업데이트',
    date: '2026-10-14',
    title: '경주 출전 추천 옵션 안내',
    summary: '경주·기수·전술의 기본 추천 조합을 확인하세요.',
    details: [
      '출전 화면을 열면 출전 가능한 경주와 계약 기수·전술의 추천 조합이 기본 선택됩니다.',
      '경주를 변경하면 해당 경주에 맞는 추천 조합으로 갱신됩니다. 직접 변경한 기수·전술은 같은 경주에서 유지됩니다.',
      '출전 확정 후에는 선택이 잠기며 저장된 출전 정보로 경주가 진행됩니다.',
    ],
  },
  {
    id: 'browser-save',
    category: '업데이트',
    date: '2026-10-14',
    title: '브라우저 저장과 기록 복구 안내',
    summary: '같은 브라우저에서 육성 기록을 이어갈 수 있습니다.',
    details: [
      '브라우저 저장 모드는 육성 상태와 마방 기록을 한 문서로 저장합니다. 새로고침 후 저장된 기록을 다시 불러옵니다.',
      '저장에 실패하면 오류를 표시하고 기존 기록을 임의로 초기화하지 않습니다. 오류 내용을 확인한 뒤 다시 불러와 주세요.',
      '브라우저 데이터를 삭제하면 기록이 사라질 수 있으며 다른 기기와의 동기화는 제공하지 않습니다.',
    ],
  },
  {
    id: 'race-watch',
    category: '안내',
    date: '2026-10-13',
    title: '경주 관전 기능 알아보기',
    summary: '자동 관전과 배속·일시정지를 사용할 수 있습니다.',
    details: [
      '경주 관전에서는 자동 진행, 수동 배속 및 일시정지를 사용할 수 있습니다.',
      '현재 순위와 순위 변화, 경주 중 주요 상황을 함께 확인할 수 있습니다. 아직 진행되지 않은 장면은 관전 중 미리 표시하지 않습니다.',
      '경주가 끝나면 결과 화면에서 착순과 기록, 상금 및 주요 장면을 확인할 수 있습니다.',
    ],
  },
  {
    id: 'preview',
    category: '안내',
    date: '2026-10-13',
    title: '현재 미리보기 이용 안내',
    summary: '미리보기는 브라우저 저장 모드로 제공됩니다.',
    details: [
      '현재 ChatGPT Sites 미리보기는 브라우저 저장 모드로 실행됩니다.',
      'API 서버가 이 미리보기에 배포되어 있지 않으므로 서버 저장 기능은 여기서 제공되지 않습니다.',
      '이 공지 목록은 화면 확인을 위한 임시 예시입니다. 정식 업데이트 내역과 공지 일정은 추후 교체될 수 있습니다.',
    ],
  },
]
