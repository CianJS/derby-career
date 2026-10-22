'use client'

import { useCareer, stableFunds, stableTravel } from '@/lib/career/store'
import {
  contractedRoster,
  entryRestriction,
  localRacesForTurn,
  raceEligibility,
} from '@/lib/career/race-entry'
import type { GameplayView } from '@/lib/race-catalog/model'

export function catalogGameplayTarget(snapshot: ReturnType<typeof useCareer>): {
  view: GameplayView
  label: string
  reason: string
  disabled?: boolean
} {
  const { career, mode, ready, busy, pending, error, workspace, raceOptions } = snapshot
  if (error) {
    return { view: career ? 'training' : 'home', label: '게임 저장 상태 확인', reason: error }
  }
  if (!ready || !mode || busy || pending || (mode === 'server' && !workspace)) {
    return {
      view: 'home',
      label: '게임 상태 확인 중…',
      reason: pending
        ? '처리 중인 저장 요청을 확인하고 있습니다.'
        : '저장 상태를 확인하고 있습니다. 출전 가능 여부는 아직 확인되지 않았습니다.',
      disabled: true,
    }
  }
  if (!career) {
    return {
      view: 'home',
      label: '육성마 선택하러 가기',
      reason: '게임 출전에는 현재 육성마가 필요합니다. 홈에서 마방과 육성마 선택을 진행하세요.',
    }
  }
  if (career.action || career.raceRun) {
    return {
      view: 'training',
      label: '육성 일정·확정 정보 보기',
      reason: career.raceRun
        ? '이미 확정된 출전이 있습니다. 육성 화면에서 저장된 출전 정보를 확인하세요.'
        : '이번 달 행동을 이미 확정했습니다. 육성 화면에서 결과와 다음 일정을 확인하세요.',
    }
  }
  if (mode === 'server') {
    if (workspace?.career?.event?.state === 'pending') {
      return {
        view: 'training',
        label: '게임 출전 일정·상태 보기',
        reason: '서버 이벤트 선택을 먼저 확정해 주세요.',
      }
    }
    if (!raceOptions) {
      return {
        view: 'training',
        label: '게임 출전 일정·상태 보기',
        reason: '서버 출전 정보를 아직 확인하지 못했습니다. 출전 후보가 0개라는 뜻은 아닙니다.',
      }
    }
    const reason =
      raceOptions.restrictionReason ??
      (!raceOptions.races.some((row) => row.eligible)
        ? '서버가 현재 출전 가능한 게임 경주를 제공하지 않았습니다.'
        : !raceOptions.jockeys.length
          ? '서버에서 계약 기수를 확인하지 못했습니다.'
          : null)
    return reason
      ? { view: 'training', label: '게임 출전 일정·상태 보기', reason }
      : {
          view: 'entry',
          label: '게임 경주 출전 준비',
          reason:
            '서버에서 조회한 현재 게임 출전 후보를 확인합니다. 확정 전 조건을 다시 확인하세요.',
        }
  }
  const funds = stableFunds(snapshot)
  const travel = stableTravel(snapshot)
  const reason =
    funds === null || !travel
      ? '마방 자금·체류 상태를 아직 확인하지 못했습니다.'
      : (entryRestriction(career, funds, travel) ??
        (!contractedRoster(career).length
          ? '계약 기수가 없습니다.'
          : !localRacesForTurn(career.careerTurnIndex).some(
                (race) => !raceEligibility(career, race, funds, travel),
              )
            ? '현재 조건에 맞는 게임 출전 경주가 없습니다.'
            : null))
  return reason
    ? { view: 'training', label: '게임 출전 일정·상태 보기', reason }
    : {
        view: 'entry',
        label: '게임 경주 출전 준비',
        reason: '현재 육성마의 게임 경주·기수·전술을 확인합니다. 확정 전 조건을 다시 확인하세요.',
      }
}

export function CatalogGameplayBridge({
  onNavigate,
}: {
  onNavigate: (view: GameplayView) => void
}) {
  const target = catalogGameplayTarget(useCareer())
  return (
    <section
      aria-label="참고 도감과 게임 출전 안내"
      className="mb-4 rounded-lg border border-border p-4 text-sm"
    >
      <p className="font-semibold">실제 경마 참고 자료 · 현재 게임 출전 대상 아님</p>
      <p className="mt-2 text-xs text-muted-foreground">
        도감의 실제 개최 연도·일정은 육성 턴·시즌과 다릅니다. 도감에서 본 경주가 출전 선택에
        전달되지는 않습니다. 게임 출전 후보는 현재 육성 상태와 별도로 등록된 게임 경주에서
        확인합니다.
      </p>
      <p role="status" className="mt-2 text-xs">
        {target.reason}
      </p>
      <button
        id="catalog-gameplay-bridge"
        type="button"
        disabled={target.disabled}
        onClick={() => onNavigate(target.view)}
        className="mt-3 min-h-11 rounded-md border border-border px-3 font-semibold text-primary disabled:opacity-50"
      >
        {target.label}
      </button>
    </section>
  )
}
