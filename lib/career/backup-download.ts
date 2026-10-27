/** Browser-only download trigger; receives a verified copy and never touches game storage or HTTP. */
export function requestBackupDownload(backup: { json: string; filename: string }) {
  if (
    typeof Blob === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    throw new Error(
      '이 브라우저에서 파일 다운로드를 시작할 수 없습니다. 다운로드를 지원하는 일반 브라우저 창에서 다시 시도해 주세요.',
    )
  }
  let url: string | undefined
  const anchor = document.createElement('a')
  let requested = false
  try {
    url = URL.createObjectURL(new Blob([backup.json], { type: 'application/json;charset=utf-8' }))
    anchor.href = url
    anchor.download = backup.filename
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
    requested = true
  } catch (error) {
    throw new Error(
      '다운로드 요청 중 오류가 발생했습니다. 브라우저의 다운로드 권한과 다운로드 폴더를 확인해 주세요.',
      { cause: error },
    )
  } finally {
    anchor.remove()
    if (url) {
      const objectUrl = url
      if (requested) {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      } else {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }
}
