'use client'

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
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
import { ChevronRight, Dumbbell, Flag, HeartPulse, Moon } from "lucide-react";
import type { View, CareerHorse, LifecycleState } from './career/legacy-types'
import { IconTile, Section, FocusShell } from './career/presentation'
import { Header, Sidebar } from './career/navigation'
import { races, jockeys } from './career/legacy-catalog'
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

type Action = "speed" | "rest" | "treat" | "race" | null;
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
function Training({
  setView,
  state,
  monthlyWorkspace,
}: {
  setView: (v: View) => void;
  state: LifecycleState;
  monthlyWorkspace?: ReactNode;
}) {
  const monthLabel = `${state.year}년 ${state.month}월`;
  const [action, setAction] = useState<Action>(null);
  const [selection, setSelection] = useState("speed");
  const [result, setResult] = useState(false);
  const [treatmentAvailable, setTreatmentAvailable] = useState(false);
  const [raceSelected, setRaceSelected] = useState<string | null>(null);
  const choose = (a: Action) => {
    setAction(a);
    setResult(false);
    if (a !== "race") setRaceSelected(null);
  };
  if (monthlyWorkspace) return monthlyWorkspace;
  const title =
    action === "speed"
      ? "훈련"
      : action === "rest"
        ? "휴식"
        : action === "treat"
          ? "치료"
          : "경주 출전";
  const training = [
    ["speed", "스피드", "속도 ↑↑ · 파워 ↑", "보통", "높음"],
    ["stamina", "스태미나", "지구력 ↑↑ · 근성 ↑", "높음", "보통"],
    ["power", "파워", "파워 ↑↑ · 속도 ↑", "보통", "높음"],
    ["guts", "근성", "근성 ↑↑ · 지구력 ↑", "높음", "보통~높음"],
    ["intelligence", "지능", "지능 ↑↑", "낮음", "낮음"],
  ] as const;
  return (
    <div className="training-workspace pb-4">
      <div className="mx-auto max-w-[1380px] px-4 pt-7 md:px-8">
        <button
          onClick={() => setView("home")}
          className="text-xs text-muted-foreground"
        >
          ← 홈
        </button>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] tracking-[.22em] text-primary">
              FOCUS PLAY · MONTHLY DECISION
            </p>
            <h1 className="mt-2 font-serif text-3xl font-semibold">
              이번 달 육성
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              2028년 4월 · 행동 하나를 선택하세요
            </p>
          </div>
          <span className="hidden text-xs text-muted-foreground md:block">
            천둥의 전설 · 3세 수말
          </span>
        </div>
        <div className="mt-6">
          <Cockpit setView={setView} state={state} />
        </div>
        <Section eyebrow="MONTHLY DECISION" title="이번 달 행동">
          <div className="mb-3 border-b border-border px-1 py-2">
            <button
              onClick={() => setView("race")}
              className="flex w-full items-center justify-between text-left text-xs"
            >
              <span>
                <span className="text-muted-foreground">
                  NEXT RACE OPPORTUNITY ·{" "}
                </span>
                <b className="font-serif text-sm">사츠키상</b>{" "}
                <span className="text-primary">G1</span>
                <span className="ml-2 text-muted-foreground">
                  2개월 후 · 잔디 2000m · 출전 가능
                </span>
              </span>
              <ChevronRight size={14} className="text-primary" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              [
                Dumbbell,
                "gold",
                "speed",
                "훈련",
                "능력 성장 · 주의 · 신체 부하 높은 편",
              ],
              [Moon, "blue", "rest", "휴식", "컨디션 회복 · 피로 감소"],
              [
                HeartPulse,
                "green",
                "treat",
                "치료",
                treatmentAvailable ? "왼쪽 앞다리 부상" : "현재 치료 대상 없음",
              ],
              [Flag, "gold", "race", "경주 출전", "이번 달 레이스 선택"],
            ].map(([Icon, tone, key, label, context]) => (
              <button
                key={key as string}
                onClick={() =>
                  key === "race" ? setView("entry") : choose(key as Action)
                }
                className="ui-compare-card flex items-start gap-3 rounded-lg border border-border text-left transition hover:border-primary hover:bg-accent/40"
              >
                <IconTile
                  icon={
                    Icon as ComponentType<{
                      size?: number;
                      className?: string;
                      strokeWidth?: number;
                      "aria-hidden"?: boolean;
                    }>
                  }
                  tone={tone as "gold" | "blue" | "green"}
                />
                <span>
                  <span className="block font-serif text-base">
                    {String(label)}
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {String(context)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Section>
        {!action && (
          <Section eyebrow="RECENT ACTIVITY" title="최근 활동">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["3월", "휴식 · 컨디션 회복"],
                ["2월", "파워 훈련 · 능력 성장"],
                ["1월", "한신 컵 · 3착"],
              ].map(([month, text]) => (
                <div key={month} className="border-b border-border pb-2">
                  <p className="text-xs text-muted-foreground">{month}</p>
                  <p className="mt-1 text-sm">{text}</p>
                </div>
              ))}
            </div>
          </Section>
        )}
        {action && (
          <Section eyebrow="MONTHLY DECISION" title={`이번 달 행동 · ${title}`}>
            <div className="flex flex-col gap-4">
              {result ? (
                <Result
                  action={action}
                  onNext={() => {
                    setAction(null);
                    setResult(false);
                  }}
                />
              ) : action === "speed" ? (
                <>
                  <div className="grid gap-2 md:grid-cols-5">
                    {training.map(([key, label, effect, fatigue, load]) => (
                      <button
                        key={key}
                        onClick={() => setSelection(key)}
                        className={`rounded-xl border p-4 text-left ${selection === key ? "border-primary bg-accent" : "border-border"}`}
                      >
                        <p className="font-serif">{label}</p>
                        <p className="mt-2 text-xs text-primary">{effect}</p>
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          피로 부담: {fatigue}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          신체 부하: {load}
                        </p>
                      </button>
                    ))}
                  </div>
                  <div className="border-l-2 border-primary bg-accent/50 px-4 py-3 text-xs">
                    <p className="font-semibold">
                      예상 영향 ·{" "}
                      {training.find((t) => t[0] === selection)?.[1]}
                    </p>
                    <p className="mt-1">
                      {training.find((t) => t[0] === selection)?.[2]}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      현재 신체 부하가 높은 편입니다. 훈련 후 부하가 더 증가할
                      수 있습니다.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAction(null)}
                      className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
                    >
                      ← 행동 선택으로 돌아가기
                    </button>
                    <button
                      onClick={() => setResult(true)}
                      className="rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground"
                    >
                      행동 확정
                    </button>
                  </div>
                </>
              ) : action === "rest" ? (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    {[
                      ["컨디션", "좋음"],
                      ["피로", "36"],
                      ["신체 부하", "48"],
                    ].map(([a, b]) => (
                      <div key={a} className="rounded-lg bg-accent p-4">
                        <span className="text-xs text-muted-foreground">
                          현재 {a}
                        </span>
                        <p className="mt-1 text-lg">{b}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-l-2 border-primary bg-accent/50 px-4 py-3 text-xs">
                    예상 영향 · 컨디션 ↑ · 피로 ↓↓ · 신체 부하 ↓
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAction(null)}
                      className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
                    >
                      ← 돌아가기
                    </button>
                    <button
                      onClick={() => setResult(true)}
                      className="rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground"
                    >
                      휴식 확정
                    </button>
                  </div>
                </>
              ) : action === "treat" ? (
                <>
                  {!treatmentAvailable ? (
                    <>
                      <div className="border-l-2 border-border bg-accent/50 px-4 py-3">
                        <p className="text-sm">
                          현재 치료가 필요한 부상이 없습니다.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          료는 부상 또는 치료 대상 상가 있을 때 선택할 수
                          있습니다.
                        </p>
                      </div>
                      <div>
                        <button
                          onClick={() => setAction(null)}
                          className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
                        >
                          ← 행동 선택으로 돌아가기
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg bg-accent p-4">
                          <span className="text-xs text-muted-foreground">
                            치료 대상
                          </span>
                          <p className="mt-1">왼쪽 앞다리 부상</p>
                        </div>
                        <div className="rounded-lg bg-accent p-4">
                          <span className="text-xs text-muted-foreground">
                            현재 상태
                          </span>
                          <p className="mt-1 text-primary">경미</p>
                        </div>
                      </div>
                      <div className="border-l-2 border-primary bg-accent/50 px-4 py-3 text-xs">
                        예상 영향 · 부상 상태 개선 · 피로 소 가능 · 신체 부하
                        감소
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAction(null)}
                          className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
                        >
                          ← 돌아가기
                        </button>
                        <button
                          onClick={() => setResult(true)}
                          className="rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground"
                        >
                          치료 확정
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="grid gap-2 md:grid-cols-2">
                    {races.slice(0, 2).map((r) => (
                      <button
                        key={r.name}
                        onClick={() => setRaceSelected(r.name)}
                        className={`rounded-xl border p-4 text-left ${raceSelected === r.name ? "border-primary bg-accent" : "border-border"}`}
                      >
                        <p className="text-xs text-muted-foreground">
                          {r.date}
                        </p>
                        <p className="mt-1 font-serif text-lg">
                          {r.name}{" "}
                          <span className="text-xs text-primary">
                            {r.grade}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.track} · {r.distance} · {r.venue}
                        </p>
                      </button>
                    ))}
                  </div>
                  {raceSelected ? (
                    <div className="border-l-2 border-primary bg-accent/50 px-4 py-3 text-sm">
                      선택한 경주: {raceSelected}
                      <div className="mt-3">
                        <button
                          onClick={() => setResult(true)}
                          className="rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground"
                        >
                          경주 출전 준비
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setAction(null)}
                      className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
                    >
                      ← 돌아가기
                    </button>
                    <button
                      onClick={() => setView("races")}
                      className="text-xs text-primary"
                    >
                      전체 경주 정보 보기
                    </button>
                  </div>
                </>
              )}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
function Result({ action, onNext }: { action: Action; onNext: () => void }) {
  const treatment = action === "treat";
  const rest = action === "rest";
  return (
    <div>
      <p className="font-serif text-lg">
        4월 · {treatment ? "치료" : rest ? "휴식" : "훈련"} 결과
      </p>
      {treatment ? (
        <>
          <div className="mt-4 grid gap-3 border-y border-border py-4 md:grid-cols-2">
            <div>
              <span className="text-xs text-muted-foreground">부상 상태</span>
              <p className="mt-1">
                왼쪽 앞다리 부상 <b className="text-primary">경미 → 회복</b>
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">건강</span>
              <p className="mt-1">
                부상 <b className="text-sage">→ 정상</b>
              </p>
            </div>
            <Delta label="피로" from="36" to="28" value="-8" tone="good" />
            <Delta
              label="신체 부하"
              from="48"
              to="35"
              value="-13"
              tone="good"
            />
          </div>
        </>
      ) : rest ? (
        <div className="mt-4 grid gap-3 border-y border-border py-4 md:grid-cols-3">
          <Delta label="컨디션" from="좋음" to="최상" value="" tone="good" />
          <Delta label="피로" from="36" to="8" value="-28" tone="good" />
          <Delta label="신체 부하" from="48" to="30" value="-18" tone="good" />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 border-y border-border py-4 md:grid-cols-2">
          <Delta label="속도" from="621" to="638" value="+17" tone="good" />
          <Delta label="파워" from="598" to="603" value="+5" tone="good" />
          <Delta label="피로" from="36" to="49" value="+13" tone="warn" />
          <Delta label="신체 부하" from="48" to="61" value="+13" tone="warn" />
        </div>
      )}
      <button
        onClick={onNext}
        className="mt-5 rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
      >
        다음 달 시작
      </button>
    </div>
  );
}
function Delta({
  label,
  from,
  to,
  value,
  tone,
}: {
  label: string;
  from: string;
  to: string;
  value: string;
  tone: "good" | "warn";
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-end border-b border-border pb-2">
      <div>
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="mt-1 tabular-nums">
          {from} <span className="text-muted-foreground">→</span> {to}
        </p>
      </div>
      <b className={tone === "good" ? "text-primary" : "text-rose"}>
        {value}
      </b>
    </div>
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
            <Training
              setView={setView}
              state={state}
              monthlyWorkspace={
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
              }
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
