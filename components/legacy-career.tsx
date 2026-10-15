'use client'

import { useEffect, useRef, useState } from "react";
import { CareerCheckpoint } from "@/components/career/checkpoint";
import { RetirementConfirm } from '@/components/career/retirement-confirm';
import { RaceAction, RaceEntryWorkspace } from "@/components/career/race-entry-workspace";
import { RacePlayback } from "@/components/career/race-playback";
import { RaceReflection } from "@/components/career/race-reflection";
import { careerStore, useCareer } from "@/lib/career/store";
import { applyCareer } from '@/lib/career/lifecycle';
import { serverLifecycle } from '@/lib/server-save/lifecycle';
import { INJURY_NOTICE, isHealthy, isStrained } from "@/lib/career/status";
import { readLifecycleSave } from "@/lib/career/lifecycle-repository";
import { ChevronRight } from "lucide-react";
import type { View, CareerHorse, LifecycleState } from './career/legacy-types'
import { Section, FocusShell } from './career/presentation'
import { Header, Sidebar } from './career/navigation'
import { jockeys } from './career/legacy-catalog'
import { Stable } from './career/stable'
import { Horse, ArchivedHorseRecord } from './career/horse-record'
import { Races, Race } from './career/race-catalog'
import { Jockeys, Jockey } from './career/jockey-record'

const VIEW_NAMES = [
  "home",
  "candidates",
  "careerComplete",
  "training",
  "raceplay",
  "result",
  "stable",
  "horse",
  "races",
  "jockeys",
] as const;
const candidates: CareerHorse[] = [
  {
    id: "thunder",
    name: "천둥의 전설",
    age: "2세",
    sex: "수말",
    growth: "표준",
    growthNote: "3~4세에 안정적으로 성장하는 타입",
    stats: [
      ["속도", 545],
      ["지구력", 482],
      ["파워", 526],
      ["근성", 463],
      ["지능", 511],
    ],
    aptitude: [
      ["마장", "잔디", "A"],
      ["거리", "마일", "A"],
      ["거리", "중거리", "B"],
      ["각질", "선행", "A"],
    ],
    record: "0전 0승",
    best: "미출전",
    prize: "₩0",
  },
  {
    id: "silver",
    name: "실버 크라운",
    age: "2세",
    sex: "암말",
    growth: "조숙",
    growthNote: "2~3세 초반에 빠르게 완성되는 타입",
    stats: [
      ["속도", 498],
      ["지구력", 558],
      ["파워", 471],
      ["근성", 520],
      ["지능", 487],
    ],
    aptitude: [
      ["마장", "잔디", "A"],
      ["거리", "중거리", "A"],
      ["거리", "장거리", "B"],
      ["각질", "선입", "A"],
    ],
    record: "0전 0승",
    best: "미출전",
    prize: "₩0",
  },
  {
    id: "black",
    name: "블랙 앙코르",
    age: "2세",
    sex: "수말",
    growth: "만성",
    growthNote: "4세 이후에 강점이 드러나는 타입",
    stats: [
      ["속도", 476],
      ["지구력", 531],
      ["파워", 574],
      ["근성", 589],
      ["지능", 452],
    ],
    aptitude: [
      ["마장", "더트", "A"],
      ["거리", "중거리", "A"],
      ["거리", "장거리", "A"],
      ["각질", "추입", "A"],
    ],
    record: "0전 0승",
    best: "미출전",
    prize: "₩0",
  },
];
const initialLifecycle: LifecycleState = {
  stableName: "",
  country: "대한민국",
  funds: "₩42,800,000",
  activeHorse: null,
  archive: [],
  candidateSeed: "stable-candidates-v1",
  candidates,
  month: 4,
  year: 2028,
  recentActivity: [
    "3월 · 휴식 · 컨디션 회복",
    "2월 · 파워 훈련 · 능력 성장",
    "1월 · 한신 컵 · 3착",
  ],
  postRace: null,
  lifecycleView: "home",
};
function readLifecycle(): LifecycleState {
  return (readLifecycleSave() as LifecycleState | null) ?? initialLifecycle;
}
function StableSetup({
  setView,
  onCreate,
}: {
  setView: (v: View) => void;
  onCreate: (name: string, country: string) => void;
}) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("대한민국");
  return (
    <div className="lab-stable-setup flex min-h-[calc(100vh-57px)] items-center justify-center px-6 py-12 md:py-16">
      <div className="w-full max-w-xl">
        <p className="font-mono text-[10px] tracking-[.32em] text-primary">
          DERBY CAREER
        </p>
        <h1 className="mt-4 font-serif text-4xl leading-tight md:text-5xl">
          마방을 시작합니다.
        </h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
          앞으로 육성한 경주마들의 기록은 이 마방의 역사로 남습니다.
        </p>
        <div className="mt-10 border-y border-border py-6">
          <label className="block text-xs text-muted-foreground">
            마방명
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="마방 이름을 입력하세요"
              className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-lg outline-none focus:border-primary"
            />
          </label>
          <label className="mt-7 block text-xs text-muted-foreground">
            본거지
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-2 w-full border-b border-border bg-transparent py-3 text-sm outline-none"
            >
              <option>대한민국</option>
              <option>일본</option>
              <option>미국</option>
              <option>영국</option>
            </select>
          </label>
        </div>
        <button
          disabled={!name.trim()}
          onClick={() => onCreate(name.trim(), country)}
          className="mt-8 rounded-lg bg-primary px-5 py-3 text-xs text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          마방 생성
        </button>
      </div>
    </div>
  );
}
function CareerComplete({
  setView,
  horse,
  onNext,
}: {
  setView: (v: View) => void;
  horse: CareerHorse;
  onNext: () => void;
}) {
  return (
    <div className="lab-complete flex min-h-[calc(100vh-57px)] items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <p className="ui-label text-primary">CAREER COMPLETE</p>
        <h1 className="mt-3 font-serif text-5xl">{horse.name}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          이 커리어의 기록은 마방에 보존됩니다.
        </p>
        <div className="mt-10 grid grid-cols-2 gap-4 border-y border-border py-6 md:grid-cols-4">
          <div>
            <span className="ui-metadata">통산 전적</span>
            <p className="mt-2 font-serif">{horse.record}</p>
          </div>
          <div>
            <span className="ui-metadata">최고 성적</span>
            <p className="mt-2 font-serif">{horse.best}</p>
          </div>
          <div>
            <span className="ui-metadata">누적 상금</span>
            <p className="mt-2 font-serif">{horse.prize}</p>
          </div>
          <div>
            <span className="ui-metadata">상태</span>
            <p className="mt-2 font-serif text-primary">은퇴</p>
          </div>
        </div>
      <button
        onClick={onNext}
        className="mt-5 rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
      >
        새 육성마 선택
      </button>
        <button
          onClick={() => setView("stable")}
          className="ui-secondary-control ml-3 rounded-lg border border-border px-5 py-3 text-xs"
        >
          Career Archive 보기
        </button>
      </div>
    </div>
  );
}
function Home({
  setView,
  hasActiveHorse,
  onNewCareer,
}: {
  setView: (v: View) => void;
  hasActiveHorse: boolean;
  onNewCareer: () => void;
}) {
  return (
    <div className="lab-home relative flex min-h-[calc(100vh-57px)] items-center justify-center overflow-hidden px-6 py-16">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute left-1/2 top-1/2 size-[680px] -translate-x-1/2 -translate-y-1/2 rotate-12 rounded-[48%] border border-primary/20" />
        <div className="absolute left-1/2 top-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-[48%] border border-accent-sage/20" />
      </div>
      <div className="lab-home-content relative z-10 w-full max-w-5xl text-center">
        <p className="font-mono text-[10px] tracking-[.42em] text-primary">
          RACING CAREER SIMULATION
        </p>
        <h1 className="mt-5 font-serif text-6xl font-semibold md:text-8xl">
          DERBY
          <br />
          <span className="text-primary">CAREER</span>
        </h1>
        <p className="mx-auto mt-6 max-w-md text-sm leading-7 text-muted-foreground">
          한 마리의 경주마를 직접 육성하고, 선택의 기록을 마구간의 역사로
          남깁니다.
        </p>
        <button
          onClick={() => setView(hasActiveHorse ? "training" : "candidates")}
          className="lab-home-primary group mx-auto mt-12 flex items-center gap-4 border-b border-primary pb-3 font-serif text-2xl hover:gap-6"
        >
          {hasActiveHorse ? "육성 계속" : "새 육성마 시작"}
          <ChevronRight className="text-primary" />
        </button>
        {hasActiveHorse && (
          <button
            onClick={onNewCareer}
            className="mx-auto mt-5 block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            새 커리어 시작
          </button>
        )}
        <div className="lab-home-links mx-auto mt-20 grid max-w-3xl border-y border-border/70 md:grid-cols-3">
          {[
            ["stable", "마구간", "STABLE"],
            ["races", "경주 정보", "RACE DATABASE"],
            ["jockeys", "기수", "JOCKEYS"],
          ].map(([key, label, ey]) => (
            <button
              key={key}
              onClick={() => setView(key as View)}
              className="border-border/70 px-6 py-7 text-left hover:bg-accent/40 md:border-r last:md:border-r-0"
            >
              <p className="font-mono text-[10px] tracking-[.22em] text-primary">
                {ey}
              </p>
              <p className="mt-3 font-serif text-xl">{label}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                관리 화면으로 이동
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
function Cockpit({
  setView,
  state,
}: {
  setView: (v: View) => void;
  state: LifecycleState;
}) {
  const horse = state.activeHorse;
  const stats = horse?.stats ?? [];
  const apt = horse?.aptitude ?? [];
  const { career } = useCareer();
  const health = career?.health ?? "정상";
  const injured = !isHealthy(health);
  return (
    <Section
      eyebrow="HORSE IN FOCUS"
      title={horse?.name ?? "현재 육성마"}
      action={
        <button
          onClick={() => setView("horse")}
          className="text-xs text-primary"
        >
          상세 기록 <ChevronRight className="inline" size={14} />
        </button>
      }
    >
      <div className="ui-focus-grid grid items-start gap-x-6 gap-y-3 lg:grid-cols-[minmax(11rem,.9fr)_minmax(0,1.7fr)_minmax(0,1.1fr)]">
        <div>
          <p className="text-xs text-muted-foreground">
            {horse?.age} · 성장형 {horse?.growth} · 통산 {horse?.record || "0전 0승"} · 누적 {horse?.prize || "₩0"}
          </p>
          <p className="mt-1 text-xs text-primary">
            최고 성적 {horse?.best ?? "미출전"}
          </p>
          {!injured && isStrained(horse?.fatigue ?? 0, horse?.bodyLoad ?? 0) && (
            <div
              role="status"
              className="lab-warn mt-2 px-3 py-2 text-xs"
            >
              <b className="font-semibold">피로가 높습니다.</b>{" "}
              <span className="text-muted-foreground">
                훈련 시 부상 위험이 증가할 수 있습니다.
              </span>
            </div>
          )}
          {injured && (
            <div
              role="status"
              className="lab-warn mt-2 px-3 py-2 text-xs"
            >
              <b className="font-semibold">부상 중 · {health}</b>{" "}
              <span className="text-muted-foreground">{INJURY_NOTICE}</span>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-5 gap-3 lg:border-x lg:border-border lg:px-6">
          {stats.map(([n, v]) => (
            <div key={n}>
              <dt className="text-xs text-muted-foreground">{n}</dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">{v}</dd>
              <div aria-hidden className="lab-meter mt-1.5">
                <i style={{ width: `${Math.min(100, v / 10)}%` }} />
              </div>
            </div>
          ))}
        </dl>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          {[
            ["컨디션", state.activeHorse?.condition || "좋음", "text-sage"],
            ["피로", String(state.activeHorse?.fatigue ?? 36), "text-rose"],
            ["부하", String(state.activeHorse?.bodyLoad ?? 48), "text-primary"],
            ["건강", health, injured ? "text-rose" : "text-sage"],
          ].map(([a, b, c]) => (
            <div key={a} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{a}</dt>
              <dd className={`font-semibold tabular-nums ${c}`}>{b}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
        <span className="text-muted-foreground">주요 적성</span>
        {apt
          .filter(([, , grade]) => grade === "A")
          .map(([, n, g]) => (
            <span key={n}>
              {n} <b className="ml-0.5 text-primary">{g}</b>
            </span>
          ))}
      </div>
    </Section>
  );
}
function RaceEntry({ setView }: { setView: (v: View) => void }) {
  const { busy } = useCareer();
  return (
    <FocusShell
      setView={setView}
      backLabel="육성으로 돌아가기"
      backDisabled={busy}
    >
      <RaceEntryWorkspace onStartRace={() => setView("raceexperimental")} />
    </FocusShell>
  );
}
export default function App({ saveMode = 'local' }: { saveMode?: 'local' | 'server' }) {
  const [localState, setState] = useState<LifecycleState>(initialLifecycle);
  const [selectedJockeyId, setSelectedJockeyId] = useState(jockeys[0].id);
  const [view, setView] = useState<View>("home");
  const { career, workspace, ready, busy, pending, error } = useCareer();
  const state: LifecycleState = saveMode === 'server' && workspace
    ? { ...localState, stableName: '서버 마방', ...serverLifecycle(workspace) }
    : localState
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(
    null,
  );
  const [hydrated, setHydrated] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    careerStore.configure(saveMode)
    if (saveMode === 'server') {
      setHydrated(true)
      const requested = new URLSearchParams(window.location.search).get('view')
      if (requested && ['training', 'candidates', 'stable', 'horse'].includes(requested)) {
        setView(requested as View)
      }
      return
    }
    try {
      const saved = { ...initialLifecycle, ...readLifecycle() };
      setState(saved);
      const requested = new URLSearchParams(window.location.search).get("view");
      setView(
        process.env.NODE_ENV !== "production" &&
          requested &&
          (VIEW_NAMES as readonly string[]).includes(requested)
          ? (requested as View)
          : "home",
      );
      setHydrated(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "마방 기록을 읽지 못했습니다. 기존 저장은 유지됩니다.");
    }
  }, [saveMode]);
  const observedServerRace = useRef<{ careerId: string; runId: string } | null>(null)
  useEffect(() => {
    if (saveMode !== 'server' || !workspace?.career) { observedServerRace.current = null; return }
    const current = workspace.career
    if (current.state.raceRun) {
      observedServerRace.current = { careerId: current.id, runId: current.state.raceRun.raceRunId }
      return
    }
    const previous = observedServerRace.current
    if (ready && !busy && !pending && previous?.careerId === current.id && current.state.raceRecords.some(record => record.raceRunId === previous.runId)) {
      observedServerRace.current = null
      if (['entry', 'raceplay', 'raceexperimental', 'result'].includes(view)) setView('training')
    }
  }, [saveMode, workspace, ready, busy, pending, view])
  const [restoredServerView, setRestoredServerView] = useState(false)
  useEffect(() => {
    if (saveMode !== 'server') { setRestoredServerView(false); return }
    if (!ready || busy || pending || error || !workspace || restoredServerView) return
    setRestoredServerView(true)
    if (career?.raceRun) setView('raceplay')
  }, [saveMode, ready, busy, pending, error, workspace, restoredServerView, career])
  useEffect(() => {
    if (saveMode === 'local' && hydrated && career) setState((current) => applyCareer(current, career));
  }, [career, hydrated, saveMode]);
  useEffect(() => {
    if (saveMode !== 'local' || !hydrated) return
    let current = true
    void careerStore.saveLifecycle(state).then(() => {
      if (current) setSaveError(null)
    }).catch(error => {
      if (current) setSaveError(error instanceof Error ? error.message : '마방 기록을 저장하지 못했습니다.')
    })
    return () => { current = false }
  }, [state, hydrated, saveMode]);
  const createStable = (name: string, country: string) => {
    setState((current) => ({
      ...current,
      stableName: name,
      country,
      lifecycleView: "candidates",
    }));
    setView("candidates");
  };
  const retire = () => {
    if (!state.activeHorse) return;
    setView("retirementConfirm");
  };
  const confirmRetire = async () => {
    if (!state.activeHorse) {
      return
    }
    const receipt = await careerStore.release()
    if (!receipt) {
      return
    }
    if (receipt.mode === 'local') {
      setState({ ...initialLifecycle, ...receipt.lifecycle } as LifecycleState)
    }
    setView('careerComplete')
  }
  const refreshRetirement = async () => {
    const retiringId = careerStore.getSnapshot().workspace?.career?.id
    await careerStore.refresh()
    const current = careerStore.getSnapshot()
    if (saveMode === 'local' && current.ready && !current.busy && !current.error) {
      try {
        const saved = { ...initialLifecycle, ...readLifecycle() }
        setState(saved)
        if (!current.career && !saved.activeHorse) {
          setView(saved.lastRetiredId ? 'careerComplete' : 'home')
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : '마방 기록을 읽지 못했습니다.')
      }
    }
    if (
      saveMode === 'server' &&
      retiringId &&
      !current.pending &&
      current.workspace?.retirements.some((record) => record.careerId === retiringId)
    ) {
      setView('careerComplete')
    }
  }
  const startCandidates = () => {
    setState((current) => ({ ...current, lifecycleView: "candidates" }));
    setView("candidates");
  };
  const management = [
    "stable",
    "horseArchive",
    "races",
    "race",
    "jockeys",
    "jockey",
  ].includes(view);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header setView={setView} />
      <div className="flex min-h-[calc(100vh-57px)]">
        {management && <Sidebar view={view} setView={setView} />}
        <main className="min-w-0 flex-1">
          {saveMode === 'server' && (
            <div className="m-4 rounded-lg border border-border p-3 text-sm" role={error ? 'alert' : 'status'}>
              <p>로컬 서버 저장 · {busy ? '서버 확인 중…' : pending ? '저장 결과 확인 필요' : ready ? '서버 기록 연결됨' : '연결 중…'}</p>
              <p className="mt-1 text-xs text-muted-foreground">훈련·휴식·치료·이벤트·은퇴를 서버에 저장합니다. 경주 연결은 준비 중입니다.</p>
              {error && <p className="mt-2">{error}</p>}
              <button disabled={busy} onClick={() => void careerStore.refresh()} className="mt-2 text-xs underline">{pending ? '같은 요청으로 다시 확인' : '서버 기록 새로고침'}</button>
            </div>
          )}
          {(saveMode === 'local' || workspace) && <>
          {saveError && (
            <p role="alert" className="ui-error-state m-4">
              {saveError}
              <a href="/" target="_blank" rel="noreferrer" className="ml-3 underline">새 탭에서 열기</a>
            </p>
          )}
          {view === "setup" && (
            <StableSetup setView={setView} onCreate={createStable} />
          )}{" "}
          {view === "careerComplete" && (
            <CareerComplete
              setView={setView}
              horse={
                state.archive.find((item) => item.id === state.lastRetiredId) ||
                state.archive[0] ||
                candidates[0]
              }
              onNext={startCandidates}
            />
          )}{" "}
          {view === "retirementConfirm" && state.activeHorse && (
            <RetirementConfirm
              horseName={state.activeHorse.name}
              ready={ready}
              busy={busy}
              pending={pending}
              error={error ?? saveError}
              blockedReason={
                career?.raceRun
                  ? '확정한 경주를 완료한 뒤 은퇴해 주세요.'
                  : career?.action && career.action.result === null
                    ? '확정한 행동을 완료한 뒤 은퇴해 주세요.'
                    : null
              }
              local={saveMode === 'local'}
              onCancel={() => setView('horse')}
              onConfirm={confirmRetire}
              onRefresh={() => void refreshRetirement()}
              onContinue={() => setView(career?.raceRun ? 'raceplay' : 'training')}
            />
          )}{" "}
          {view === "home" && (
            <Home
              setView={setView}
              hasActiveHorse={Boolean(state.activeHorse || career)}
              onNewCareer={() => setView("retirementConfirm")}
            />
          )}{" "}
          {(view === "training" || view === "candidates") && (
            <CareerCheckpoint
                  onHome={() => setView("home")}
                  onHorse={() => setView("horse")}
                  horseSummary={
                    career ? (
                      <Cockpit
                        setView={setView}
                        state={applyCareer(state, career)}
                      />
                    ) : undefined
                  }
                  raceEntry={<RaceAction onOpen={() => setView("entry")} />}
                />
          )}{" "}
          {view === "entry" && <RaceEntry setView={setView} />}{" "}
          {(view === "raceplay" || view === "raceexperimental") && (
            <FocusShell setView={setView} backLabel="육성으로 돌아가기">
              <RacePlayback
                onFinish={() => setView("result")}
                onBack={() => setView("training")}
              />
            </FocusShell>
          )}{" "}
          {view === "result" && (
            <FocusShell setView={setView} backLabel="육성으로 돌아가기">
              <RaceReflection
                onNext={() => setView("training")}
                onBack={() => setView("training")}
              />
            </FocusShell>
          )}{" "}
          {view === "stable" && (
            <Stable
              setView={setView}
              archive={state.archive}
              onArchiveSelect={setSelectedArchiveId}
            />
          )}{" "}
          {saveMode === 'server' && view === 'stable' && workspace && workspace.pagination.page < workspace.pagination.totalPages && (
            <button disabled={busy || pending} onClick={() => void careerStore.loadMoreRetirements()} className="m-4 text-sm underline">이전 은퇴 기록 더 불러오기</button>
          )}
          {view === "horse" && state.activeHorse && (
            <Horse
              setView={setView}
              onRetire={retire}
              horse={state.activeHorse}
            />
          )}{" "}
          {view === "horseArchive" && (
            <ArchivedHorseRecord
              setView={setView}
              horse={
                state.archive.find((item) => item.id === selectedArchiveId) ||
                state.archive[0] ||
                candidates[0]
              }
            />
          )}{" "}
          {view === "races" && <Races setView={setView} />}{" "}
          {view === "race" && <Race setView={setView} />}{" "}
          {view === "jockeys" && <Jockeys setView={setView} onSelect={setSelectedJockeyId} />}{" "}
          {view === "jockey" && <Jockey setView={setView} jockeyId={selectedJockeyId} horses={[...(state.activeHorse ? [state.activeHorse] : []), ...state.archive]} />}
          </>}
        </main>
      </div>
    </div>
  );
}
