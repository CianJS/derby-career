"use client";

import { FilterMenu } from "@/components/career/filter-menu";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import { CareerCheckpoint } from "@/components/career/checkpoint";
import { RetirementConfirm } from '@/components/career/retirement-confirm'
import {
  RaceAction,
  RaceEntryWorkspace,
} from "@/components/career/race-entry-workspace";
import { RacePlayback } from "@/components/career/race-playback";
import { RaceReflection } from "@/components/career/race-reflection";
import { careerStore, useCareer } from "@/lib/career/store";
import { applyCareer } from '@/lib/career/lifecycle'
import { serverLifecycle } from '@/lib/server-save/lifecycle'
import { INJURY_NOTICE, isHealthy, isStrained } from "@/lib/career/status";
import { contractedJockeys, freeAgentJockeys, jockeyProfiles } from "@/lib/career/race-entry";
import { summarizeRecords, type HorseRaceRecord } from "@/lib/career/records";
import {
  readLifecycleSave,
} from "@/lib/career/lifecycle-repository";
import {
  Activity,
  Archive,
  ArrowUp,
  ArrowUpRight,
  BatteryLow,
  Bell,
  Brain,
  CalendarDays,
  Check,
  ChevronRight,
  Coins,
  CornerUpRight,
  Dumbbell,
  Flag,
  Flame,
  Gauge,
  HeartPulse,
  House,
  LockKeyhole,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Target,
  Trophy,
  TriangleAlert,
  UserRound,
  X,
  Zap,
} from "lucide-react";

type View =
  | "home"
  | "setup"
  | "candidates"
  | "careerComplete"
  | "retirementConfirm"
  | "training"
  | "entry"
  | "raceplay"
  | "raceexperimental"
  | "result"
  | "stable"
  | "horse"
  | "horseArchive"
  | "races"
  | "race"
  | "jockeys"
  | "jockey";
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
type CareerHorse = {
  id: string;
  name: string;
  age: string;
  sex: string;
  growth: string;
  growthNote: string;
  stats: readonly [string, number][];
  aptitude: readonly [string, string, string][];
  record: string;
  best: string;
  prize: string;
  fatigue?: number;
  bodyLoad?: number;
  condition?: string;
  retiredAt?: string;
  raceRecords?: readonly HorseRaceRecord[];
};
type PostRaceSnapshot = {
  raceId: string;
  horseId: string;
  prize: number;
  before: {
    record: string;
    prize: number;
    fatigue: number;
    bodyLoad: number;
    condition: string;
    month: number;
    year: number;
  };
  after: {
    record: string;
    prize: number;
    fatigue: number;
    bodyLoad: number;
    condition: string;
    month: number;
    year: number;
  };
  committed: boolean;
  operationId: string;
  recentActivityEntry: string;
};
type LifecycleState = {
  stableName: string;
  country: string;
  funds: string;
  activeHorse: CareerHorse | null;
  archive: CareerHorse[];
  candidateSeed: string;
  candidates: CareerHorse[];
  month: number;
  year: number;
  recentActivity: string[];
  postRace: PostRaceSnapshot | null;
  lifecycleView: "home" | "careerComplete" | "candidates";
  lastRetiredId?: string;
};
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
function parseRecord(record: string) {
  const values = record.match(/\d+/g)?.map(Number) || [0, 0];
  return { starts: values[0] || 0, wins: values[1] || 0 };
}
function formatRecord(starts: number, wins: number) {
  return `${starts}전 ${wins}승`;
}
function monthAfter(year: number, month: number) {
  return month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 };
}

type Action = "speed" | "rest" | "treat" | "race" | null;
const stats = [
  ["속도", 621],
  ["지구력", 574],
  ["파워", 598],
  ["근성", 542],
  ["지능", 611],
] as const;
const apt = [
  ["마장", "잔디", "A"],
  ["마장", "더트", "C"],
  ["거리", "단거리", "B"],
  ["거리", "마일", "A"],
  ["거리", "중거리", "A"],
  ["거리", "장거리", "C"],
  ["각질", "도주", "C"],
  ["각질", "선행", "A"],
  ["각질", "선입", "A"],
  ["각질", "추입", "B"],
] as const;
const races = [
  {
    name: "한신 컵",
    date: "4월 14일",
    country: "일본",
    grade: "G3",
    track: "잔디",
    distance: "1400m",
    venue: "한신",
    age: "3세 이상",
    gender: "수말·암말",
    prize: "₩42,000,000",
  },
  {
    name: "사츠키상",
    date: "4월 28일",
    country: "일본",
    grade: "G1",
    track: "잔디",
    distance: "2000m",
    venue: "나카야마",
    age: "3세",
    gender: "수말·암말",
    prize: "₩120,000,000",
  },
  {
    name: "NHK 마일컵",
    date: "5월 5일",
    country: "일본",
    grade: "G1",
    track: "잔디",
    distance: "1600m",
    venue: "도쿄",
    age: "3세",
    gender: "수말·암말",
    prize: "₩98,000,000",
  },
  {
    name: "오사카배",
    date: "5월 12일",
    country: "일본",
    grade: "G1",
    track: "잔디",
    distance: "2000m",
    venue: "한신",
    age: "4세 이상",
    gender: "수말·암말",
    prize: "₩110,000,000",
  },
];
const jockeys = [...contractedJockeys, ...freeAgentJockeys].map(j => ({ ...j, meta: j.style, contract: '—', chem: j.chemistry, abilities: [j.start, j.pace, j.path, j.timing, j.stability] }));
function Meter({ value }: { value: number }) {
  return (
    <div className="h-1 rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${value / 10}%` }}
      />
    </div>
  );
}
function IconLabel({
  icon: Icon,
  children,
  className = "",
}: {
  icon: ComponentType<{
    size?: number;
    className?: string;
    strokeWidth?: number;
    "aria-hidden"?: boolean;
  }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon size={15} strokeWidth={1.7} aria-hidden={true} />
      {children}
    </span>
  );
}
function IconTile({
  icon: Icon,
  tone = "gold",
  size = 22,
}: {
  icon: ComponentType<{
    size?: number;
    className?: string;
    strokeWidth?: number;
    "aria-hidden"?: boolean;
  }>;
  tone?: "gold" | "blue" | "green" | "orange" | "violet" | "teal";
  size?: number;
}) {
  return (
    <span className={`ui-icon-tile ui-icon-${tone}`}>
      <Icon size={size} strokeWidth={1.7} aria-hidden={true} />
    </span>
  );
}
function Section({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="ui-section border border-border bg-card">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="ui-label">
            {eyebrow}
          </p>
          <h2 className="mt-0.5 text-lg font-bold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Header({ setView }: { setView: (v: View) => void }) {
  const { theme = "dark", setTheme } = useTheme();
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const activeTheme = mounted ? theme : "dark";
  return (
    <header className="lab-topbar sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1540px] items-center justify-between px-4 md:px-8">
        <button
          className="lab-brand flex items-center"
          onClick={() => setView("home")}
        >
          DERBY CAREER
        </button>
        <div className="ml-auto flex items-center gap-2 text-muted-foreground">
          <span className="hidden text-xs sm:block">₩42,800,000</span>
          <button
            aria-label="운영 공지"
            onClick={() => setNote(!note)}
            className="relative rounded-lg p-2 hover:bg-accent"
          >
            <Bell size={17} />
            <i className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
          </button>
          <div className="relative">
            <button
              aria-label="테마 선택"
              onClick={() => setMenu(!menu)}
              className="rounded-lg p-2 hover:bg-accent"
            >
              {activeTheme === "light" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {menu && (
              <div className="absolute right-0 top-11 z-40 w-36 rounded-xl border border-border bg-popover p-1.5 shadow-xl">
                {(["system", "light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTheme(t);
                      setMenu(false);
                    }}
                    className="flex w-full justify-between rounded-lg px-2 py-2 text-xs hover:bg-accent"
                  >
                    {t === "system"
                      ? "시스템 설정"
                      : t === "light"
                        ? "라이트"
                        : "다크"}
                    {theme === t && ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            aria-label="설정"
            onClick={() => setView("setup")}
            className="rounded-lg p-2 hover:bg-accent"
          >
            <Settings size={17} />
          </button>
        </div>
      </div>
      {note && (
        <div className="absolute right-4 top-16 z-40 w-80 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <div className="flex justify-between">
            <div>
              <p className="font-mono text-[10px] text-primary">
                STABLE NOTICE
              </p>
              <h3 className="mt-1 font-serif text-lg">공지 & 업데이트</h3>
            </div>
            <button onClick={() => setNote(false)}>
              <X size={16} />
            </button>
          </div>
          <p className="mt-5 text-sm leading-6">
            다음 세대 등록 준비가 완료되었습니다.
          </p>
        </div>
      )}
    </header>
  );
}
function Sidebar({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  const items: [View, string, typeof House][] = [
    ["home", "홈", House],
    ["stable", "마구간", Archive],
    ["races", "경주 정보", Trophy],
    ["jockeys", "기수", UserRound],
  ];
  const active =
    view === "horseArchive" || view === "horse"
      ? "stable"
      : view === "race"
        ? "races"
        : view === "jockey"
          ? "jockeys"
          : view;
  return (
    <aside className="lab-sidebar hidden w-[var(--layout-sidebar)] shrink-0 border-r border-border/70 bg-sidebar px-4 py-6 lg:block">
      <button
        onClick={() => setView("home")}
        className="mb-10 flex items-center px-3"
      >
        <p className="text-left">DERBY CAREER</p>
      </button>
      <nav className="flex flex-col gap-1">
        {items.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${active === key ? "border-l-2 border-primary bg-accent/70 text-foreground" : "border-l-2 border-transparent text-muted-foreground hover:bg-accent/60"}`}
          >
            <Icon size={17} className={active === key ? "text-primary" : ""} />
            {label}
            {active === key && (
              <ChevronRight size={15} className="ml-auto text-primary" />
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
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
          앞으로 ��성한 경주마들의 기록은 이 마방의 역사로 남습니다.
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
function HorseCandidates({
  setView,
  state,
  onSelect,
}: {
  setView: (v: View) => void;
  state: LifecycleState;
  onSelect: (horse: CareerHorse) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const dominant = (horse: CareerHorse) =>
    horse.stats.reduce(
      (best, current) => (current[1] > best[1] ? current : best),
      horse.stats[0],
    );
  return (
    <div className="ui-page mx-auto max-w-[1440px] px-4 py-10 md:px-8">
      <p className="ui-label text-primary">
        {state.activeHorse ? "HORSE SELECTION" : "HORSE SELECTION"}
      </p>
      <h1 className="mt-2 font-serif text-4xl">
        {state.activeHorse
          ? "새 육성마를 선택하세요"
          : "첫 육성마를 선택하세요"}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        현재 능력과 적성을 비교해 직접 선택합니다. 후보는 고정되어 새로고침해도
        바뀌지 않습니다.
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-4 text-xs md:grid-cols-4">
        {[
          ["마방", state.stableName || "—"],
          ["보유 자금", state.funds],
          [
            "계약 기수",
            `${STABLE_CONTRACTED_JOCKEY_IDS.length}명 · ${contractedJockeys.map((j) => j.name).join(", ")}`,
          ],
          ["Career Archive", `${state.archive.length}마리 보존`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-serif text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {state.candidates.map((horse) => (
          <button
            key={horse.id}
            onClick={() => setSelected(horse.id)}
            className={`ui-compare-card border p-5 text-left ${selected === horse.id ? "ui-selected border-primary bg-primary/5" : "border-border bg-card/40"}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="ui-label text-muted-foreground">
                  HORSE CANDIDATE
                </p>
                <h2 className="mt-2 font-serif text-2xl">{horse.name}</h2>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="candidate-icon-tile">
                    <Zap size={14} />
                  </span>
                  <span>
                    <b className="block text-primary">
                      {dominant(horse)[0].toUpperCase()} TYPE
                    </b>
                    <span className="text-muted-foreground">
                      {dominant(horse)[0]} {dominant(horse)[1]}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {horse.age} · {horse.sex} · 성장형 {horse.growth}
                </p>
              </div>
              {selected === horse.id && (
                <Check className="text-primary" size={18} />
              )}
            </div>
            <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">
              {horse.growthNote}
            </p>
            <div className="mt-5 space-y-2 border-y border-border py-4">
              {horse.stats.map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[1fr_45px] items-center text-xs"
                >
                  <span>{label}</span>
                  <b className="text-right tabular-nums">{value}</b>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {horse.aptitude.map(([group, label, grade]) => (
                <div
                  key={group + label}
                  className="flex justify-between border-b border-border/60 pb-1"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <b className={grade === "A" ? "text-primary" : ""}>{grade}</b>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
      <button
        disabled={!selected}
        onClick={() => {
          const horse = state.candidates.find((item) => item.id === selected);
          if (horse) onSelect(horse);
        }}
        className="mt-8 rounded-lg bg-primary px-5 py-3 text-xs text-primary-foreground disabled:opacity-40"
      >
        이 말로 육성 시작
      </button>
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
function Management({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="lab-management ui-management ui-page flex flex-col gap-5">
      <div>
        <p className="font-mono text-[10px] tracking-[.22em] text-primary">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
function Stable({
  setView,
  archive = [],
  onArchiveSelect = () => {},
}: {
  setView: (v: View) => void;
  archive?: CareerHorse[];
  onArchiveSelect?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const horses = archive.map(
    (horse, index) =>
      [
        horse.name,
        `${horse.age} ${horse.sex}`,
        horse.record,
        horse.best,
        horse.prize,
        horse.retiredAt || "기록 없음",
        index,
      ] as const,
  );
  const filtered = horses
    .filter(([, name]) => name.includes(query))
    .sort((a, b) =>
      sort === "name"
        ? a[0].localeCompare(b[0], "ko")
        : sort === "wins"
          ? Number(b[2].match(/\d+승/)?.[0]) - Number(a[2].match(/\d+승/)?.[0])
          : sort === "prize"
            ? Number(b[4].replace(/[^\d]/g, "")) -
              Number(a[4].replace(/[^\d]/g, ""))
            : b[6] - a[6],
    );
  return (
    <Management
      title="마구간"
      eyebrow="STABLE"
      description="육성을 마친 경주마와 그들의 커리어 기록을 조회합니다."
    >
      {archive.length === 0 && (
        <div className="ui-empty-state border-y border-border/70 py-8">
          <p>아직 기록된 경주마가 없습니다.</p>
          <p className="mt-1 text-sm">
            육성을 완료한 경주마의 커리어가 이곳에 보존됩니다.
          </p>
        </div>
      )}
      {archive.length > 1 && (
        <Section eyebrow="CAREER ARCHIVE · RECENT" title="최근 은퇴마">
          <div className="space-y-2">
            {archive.slice(0, 2).map((horse) => (
              <button
                key={horse.id}
                onClick={() => setView("horseArchive")}
                className="flex w-full items-center justify-between border-b border-border py-3 text-left"
              >
                <span>
                  <b className="font-serif">{horse.name}</b>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {horse.retiredAt} · {horse.record}
                  </span>
                </span>
                <span className="text-xs text-primary">
                  기록 보기 <ChevronRight className="inline" size={14} />
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="flex min-w-64 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span>검색</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="말 이름 검색"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">정렬</span>
          <FilterMenu label="" value={{ recent: "최근 육성순", name: "이름순", wins: "통산 승수순", prize: "누적 상금순" }[sort] ?? "최근 육성순"} options={["최근 육성순", "이름순", "통산 승수순", "누적 상금순"]} onChange={v => setSort(({ "최근 육성순": "recent", "이름순": "name", "통산 승수순": "wins", "누적 상금순": "prize" } as Record<string, string>)[v] ?? "recent")} align="right" />
        </div>
      </div>
      <Section eyebrow="CAREER ARCHIVE" title="은퇴 경주마">
        <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_1fr_100px_24px] gap-4 border-b border-border px-4 pb-3 text-[10px] tracking-wide text-muted-foreground md:grid">
          <span>이름</span>
          <span>나이·성별</span>
          <span>통산 전적</span>
          <span>최고 성적</span>
          <span>누적 상금</span>
          <span>은퇴 시점</span>
          <span />
        </div>
        {filtered.map(([name, age, record, best, prize, retired]) => (
          <button
            key={name}
            onClick={() => setView("horseArchive")}
            className="group grid w-full gap-2 border-b border-border px-4 py-4 text-left last:border-0 hover:bg-accent/40 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_100px_24px] md:items-center md:gap-4"
          >
            <span className="font-serif text-base">{name}</span>
            <span className="text-xs text-muted-foreground">{age}</span>
            <span className="text-xs">{record}</span>
            <span className="text-xs">{best}</span>
            <span className="text-xs text-primary">{prize}</span>
            <span className="text-xs text-muted-foreground">{retired}</span>
            <ChevronRight
              size={15}
              className="text-primary opacity-0 transition group-hover:opacity-100"
            />
          </button>
        ))}
      </Section>
    </Management>
  );
}
function Horse({
  setView,
  onRetire,
  horse,
}: {
  setView: (v: View) => void;
  onRetire: () => void;
  horse: CareerHorse;
}) {
  const { career } = useCareer();
  const summary = summarizeRecords(horse.raceRecords);
  const stats = horse.stats;
  const apt = horse.aptitude;
  return (
    <FocusShell setView={setView}>
      <p className="ui-label text-primary">HORSE RECORD · FOCUS PLAY</p>
      <h1 className="ui-page-title mt-2 font-serif text-3xl">{horse.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        현재 육성마 · {horse.age} {horse.sex}
      </p>
      <div className="mt-6">
        <Section eyebrow="BASIC / CAREER" title="기본 정보 · 커리어">
          <div className="grid grid-cols-2 md:grid-cols-4">
            {[
              ["나이", horse.age],
              ["성별", horse.sex],
              ["출생지", "대한민국"],
              ["클래스", "OPEN"],
              ["활동 상태", "현역"],
              ["성장형", horse.growth],
              ["통산 전적", horse.record],
              ["누적 상금", horse.prize],
              ["최고 성적", horse.best],
            ].map(([a, b]) => (
              <div
                key={a}
                className="border-b border-r border-border px-4 py-3"
              >
                <span className="text-xs text-muted-foreground">{a}</span>
                <p className="mt-1 text-sm">{b}</p>
              </div>
            ))}
          </div>
        </Section>
        <Section eyebrow="ABILITY" title="능력">
          <div className="grid gap-4 md:grid-cols-5">
            {stats.map(([n, v]) => (
              <div key={n} className="border-b border-border pb-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{n}</span>
                  <b className="tabular-nums">{v}</b>
                </div>
                <div className="mt-3">
                  <Meter value={v} />
                </div>
              </div>
            ))}
          </div>
        </Section>
        <Section eyebrow="APTITUDE" title="적성">
          <div className="grid gap-x-8 md:grid-cols-3">
            {["마장", "거리", "각질"].map((group) => (
              <div key={group}>
                <p className="mb-2 text-xs text-muted-foreground">{group}</p>
                {apt
                  .filter(([g]) => g === group)
                  .map(([, n, v]) => (
                    <div
                      key={n}
                      className="flex justify-between border-b border-border py-2 text-xs"
                    >
                      <span>{n}</span>
                      <b className={v === "A" ? "text-primary" : ""}>{v}</b>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Section>
        <Section eyebrow="RACE RECORD" title="주요 경주 기록">
          <div className="overflow-x-auto">
            <div className="grid min-w-[680px] grid-cols-[100px_1.5fr_70px_80px_110px_70px_120px] border-b border-border px-3 pb-2 text-[10px] text-muted-foreground">
              <span>날짜</span>
              <span>경주</span>
              <span>등급</span>
              <span>거리</span>
              <span>기수</span>
              <span>결과</span>
              <span>상금</span>
            </div>
            {!horse.raceRecords?.length && <p className="py-4 text-sm text-muted-foreground">경주 기록이 없습니다.</p>}
            {(horse.raceRecords ?? []).map(record => [record.date, record.race, record.grade ?? '—', record.distance ? `${record.distance}m` : '—', record.jockeyName ?? '—', record.result, `₩${(record.prizeMoney ?? 0).toLocaleString('ko-KR')}`]).map((r) => (
              <button
                key={r[1]}
                onClick={() => setView("race")}
                className="grid min-w-[680px] w-full grid-cols-[100px_1.5fr_70px_80px_110px_70px_120px] border-b border-border px-3 py-3 text-left text-xs hover:bg-accent/40"
              >
                {r.map((v, i) => (
                  <span key={i} className={i === 1 ? "font-serif text-sm" : ""}>
                    {v}
                  </span>
                ))}
              </button>
            ))}
          </div>
        </Section>
        <div className="grid gap-5 md:grid-cols-2">
          <Section eyebrow="KEY JOCKEYS" title="주요 기수">
            {summary.jockeyRelations.length === 0 ? <p className="py-3 text-sm text-muted-foreground">함께한 기수가 없습니다.</p> : summary.jockeyRelations.map(relation => <p key={relation.jockeyId} className="border-b border-border py-3 text-sm">{jockeys.find(j => j.id === relation.jockeyId)?.name ?? horse.raceRecords?.find(r => r.jockeyId === relation.jockeyId)?.jockeyName} · {relation.starts}전 {relation.wins}승 · {career?.contractedJockeyIds.includes(relation.jockeyId) ? '계약 중' : '미계약'}</p>)}
          </Section>
          <Section eyebrow="CAREER TIMELINE" title="주요 사건">
            <div className="flex flex-col gap-3 text-xs">
              {summary.careerTimeline.length === 0 ? <p className="text-muted-foreground">아직 기록이 없습니다.</p> : summary.careerTimeline.map((event, index) => <p key={`${event.date}-${index}`}><span className="mr-4 text-muted-foreground">{event.date}</span>{event.text}</p>)}
            </div>
          </Section>
        </div>
      </div>
      <div className="mt-6">
        <button
          onClick={onRetire}
          className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
        >
          은퇴
        </button>
      </div>
    </FocusShell>
  );
}
function HorseArchiveLegacy({ setView }: { setView: (v: View) => void }) {
  return (
    <Management
      title="블루 문"
      eyebrow="HORSE RECORD · CAREER ARCHIVE"
      description="은퇴 경주마의 등록 정보와 커리어 기록을 조회합니다."
    >
      <Section eyebrow="BASIC / CAREER" title="기본 정보 · 커리어">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["나이", "6세"],
            ["성별", "암말"],
            ["상태", "은퇴"],
            ["통산 전적", "31전 9승"],
            ["최고 성적", "G1 2승"],
            ["누적 상금", "₩486,000,000"],
            ["은퇴 시점", "2027.11"],
            ["성장형", "보통"],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-border px-3 py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="CAREER ARCHIVE" title="주요 기록">
        <div className="grid gap-2 md:grid-cols-3">
          {[
            ["2027.11", "은퇴", "G1 2승"],
            ["2027.05", "오사카 컵", "1착"],
            ["2026.08", "재팬 더트 더비", "3착"],
          ].map(([date, name, result]) => (
            <div key={date + name} className="border-b border-border px-3 py-3">
              <span className="text-xs text-muted-foreground">{date}</span>
              <p className="mt-1 font-serif">{name}</p>
              <p className="mt-1 text-xs text-primary">{result}</p>
            </div>
          ))}
        </div>
      </Section>
    </Management>
  );
}
function HorseArchive({ setView }: { setView: (v: View) => void }) {
  return (
    <Management
      title="블루 문"
      eyebrow="HORSE RECORD · CAREER ARCHIVE"
      description="은퇴 경주마의 등록 정보와 커리어 기록을 조회합니다."
    >
      <Section eyebrow="BASIC / CAREER" title="기본 정보 · 커리어">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["나이", "6세"],
            ["성별", "암말"],
            ["출생지", "대한민국"],
            ["��래스", "OPEN"],
            ["활동 상태", "은퇴"],
            ["성장형", "보통"],
            ["통산 전적", "31전 9승"],
            ["누적 상금", "₩486,000,000"],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-border px-3 py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="ABILITY" title="능력">
        <div className="grid gap-3 md:grid-cols-5">
          {[
            ["속도", 780],
            ["지구력", 720],
            ["파워", 760],
            ["근성", 690],
            ["지능", 730],
          ].map(([a, b]) => (
            <div key={a as string} className="border-b border-border pb-2">
              <div className="flex justify-between text-xs">
                <span>{a}</span>
                <b>{b}</b>
              </div>
              <Meter value={b as number} />
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="APTITUDE" title="적성">
        <div className="grid gap-x-8 md:grid-cols-3">
          {["마장", "거리", "각질"].map((group) => (
            <div key={group}>
              <p className="mb-2 text-xs text-muted-foreground">{group}</p>
              {apt
                .filter(([g]) => g === group)
                .map(([, n, v]) => (
                  <div
                    key={n}
                    className="flex justify-between border-b border-border py-2 text-xs"
                  >
                    <span>{n}</span>
                    <b className={v === "A" ? "text-primary" : ""}>{v}</b>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="RACE RECORD" title="주요 경주 기록">
        <div className="grid gap-2 md:grid-cols-3">
          {[
            ["2027.11", "G1 재팬 컵", "2착"],
            ["2027.05", "G1 오사카배", "1착"],
            ["2026.08", "G1 재팬 더트 더비", "3착"],
          ].map(([date, name, result]) => (
            <div key={date + name} className="border-b border-border px-3 py-3">
              <span className="text-xs text-muted-foreground">{date}</span>
              <p className="mt-1 font-serif">{name}</p>
              <p className="mt-1 text-xs text-primary">{result}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="KEY JOCKEYS" title="주요 기수">
        <div className="grid gap-2 md:grid-cols-3">
          {["김도윤", "박성현", "이현우"].map((name) => (
            <div key={name} className="border-b border-border py-2 text-sm">
              <span>{name}</span>
              <span className="float-right text-xs text-muted-foreground">
                호흡도 기록
              </span>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="CAREER TIMELINE" title="커리어 타임라인">
        <div className="grid gap-2 md:grid-cols-4">
          {[
            ["2025", "데뷔"],
            ["2026", "G1 첫 출전"],
            ["2027", "G1 2승"],
            ["2027.11", "은퇴"],
          ].map(([date, event]) => (
            <div key={date} className="border-l-2 border-primary px-3 py-2">
              <span className="text-xs text-muted-foreground">{date}</span>
              <p className="mt-1 text-sm">{event}</p>
            </div>
          ))}
        </div>
      </Section>
    </Management>
  );
}
function Races({ setView }: { setView: (v: View) => void }) {
  const [grade, setGrade] = useState("전체");
  const [track, setTrack] = useState("전체");
  const [distance, setDistance] = useState("전체");
  const [period, setPeriod] = useState("전체");
  const [country, setCountry] = useState("전체");
  const [venue, setVenue] = useState("전체");
  const [age, setAge] = useState("전체");
  const [gender, setGender] = useState("전체");
  const [major, setMajor] = useState(false);
  const [weight, setWeight] = useState("전체");
  const filtered = races.filter(
    (r) =>
      (grade === "전체" || r.grade === grade) &&
      (track === "전체" || r.track === track) &&
      (distance === "전체" || r.distance === distance) &&
      (country === "전체" || r.country === country) &&
      (venue === "전체" || r.venue === venue) &&
      (age === "전체" || r.age.includes(age)) &&
      (gender === "전체" || r.gender === gender) &&
      (weight === "전체" || weight === "정량") &&
      (!major || r.grade === "G1"),
  );
  return (
    <Management
      title="경주 정보"
      eyebrow="RACE DATABASE"
      description="게임에 존재하는 전체 경주와 참가 조건을 조회합니다."
    >
      <div className="flex flex-wrap gap-2">
        {(
          [
            {
              label: "기간",
              value: period,
              setter: setPeriod,
              options: ["전체", "4월", "5월"],
            },
            {
              label: "마장",
              value: track,
              setter: setTrack,
              options: ["전체", "잔디", "더트"],
            },
            {
              label: "거리",
              value: distance,
              setter: setDistance,
              options: ["전체", "1400m", "1600m", "2000m"],
            },
            {
              label: "등급",
              value: grade,
              setter: setGrade,
              options: ["전체", "G1", "G2", "G3"],
            },
          ] as const
        ).map(({ label, value, setter, options }) => (
          <FilterMenu key={label} label={label} value={value as string} options={options} onChange={setter} />
        ))}
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-lg border border-border bg-card px-3 py-2 text-xs text-primary">
            상세 필터
          </summary>
          <div className="absolute right-0 z-10 mt-1 grid min-w-[320px] grid-cols-2 gap-2 rounded-xl border border-border bg-popover p-3 shadow-xl">
            <FilterMenu label="개최국" value={country} options={["전체", "일본"]} onChange={setCountry} />
            <FilterMenu label="경마장" value={venue} options={["전체", "한신", "나카야마", "도쿄"]} onChange={setVenue} />
            <FilterMenu label="연령" value={age} options={["전체", "3세"]} onChange={setAge} />
            <FilterMenu label="성별" value={gender} options={["전체", "수말·암말"]} onChange={setGender} />
            <FilterMenu label="부담중량" value={weight} options={["전체", "정량", "별정"]} onChange={setWeight} />
            <label className="col-span-2 flex items-center text-xs">
              <input
                type="checkbox"
                checked={major}
                onChange={(e) => setMajor(e.target.checked)}
                className="mr-2 accent-primary"
              />
              주요 경주만
            </label>
          </div>
        </details>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="hidden grid-cols-[100px_80px_70px_1fr_100px_70px_110px_110px_120px] gap-3 border-b border-border bg-accent/40 px-4 py-3 text-[10px] text-muted-foreground md:grid">
          <span>날짜</span>
          <span>국가</span>
          <span>등급</span>
          <span>경주명</span>
          <span>마장</span>
          <span>거리</span>
          <span>경마장</span>
          <span>연령·성별</span>
          <span>상금</span>
        </div>
        {filtered
          .filter((r) => period === "전체" || r.date.includes(period))
          .map((r) => (
            <button
              key={r.name}
              onClick={() => setView("race")}
              className="grid w-full gap-2 border-b border-border px-4 py-4 text-left text-xs hover:bg-accent/40 md:grid-cols-[100px_80px_70px_1fr_100px_70px_110px_110px_120px] md:items-center md:gap-3"
            >
              <span>{r.date}</span>
              <span>{r.country}</span>
              <b className="text-primary">{r.grade}</b>
              <span className="font-serif text-sm">{r.name}</span>
              <span>{r.track}</span>
              <span>{r.distance}</span>
              <span>{r.venue}</span>
              <span>
                {r.age} · {r.gender}
              </span>
              <span className="text-primary">{r.prize}</span>
            </button>
          ))}
      </div>
    </Management>
  );
}
function Race({ setView }: { setView: (v: View) => void }) {
  return (
    <Management
      title="사츠키상"
      eyebrow="RACE DETAIL"
      description="경주의 객관적인 조건과 코스 정보를 조회합니다."
    >
      <Section eyebrow="RACE SUMMARY" title="G1 · 4월 28일">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            ["개최국", "일본"],
            ["경마장", "나카야마"],
            ["마장", "잔디"],
            ["거리", "2000m"],
            ["방향", "우회전"],
            ["날씨 / 마장 상태", "맑음 · 양호"],
            ["상금", "₩120,000,000"],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-r border-border px-4 py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="ENTRY CONDITIONS" title="참가 조건">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            ["연령", "3세"],
            ["성별", "수말·암말"],
            ["클래스", "OPEN"],
            ["부담중량", "정량 57kg"],
            ["등록료", "₩1,200,000"],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-border py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="COURSE PROFILE" title="나카야마 잔디 2000m">
        <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-sm">우회전 · 첫 코너 진입까지 거리 짧음</p>
            <ul className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
              <li>직선 길이 · 310m</li>
              <li>코너 특성 · 첫 코너 진입까지 거리 짧음</li>
              <li>경사 · 고저차 약 2.2m · 마지막 구간에서 가속 요구</li>
            </ul>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">주요 요구 능력</p>
            <div className="mt-2 flex gap-2">
              <span className="border border-border px-3 py-1 text-xs">
                파워
              </span>
              <span className="border border-border px-3 py-1 text-xs">
                지구력
              </span>
            </div>
          </div>
        </div>
      </Section>
      <button onClick={() => setView("races")} className="text-xs text-primary">
        ← 경주 정보로 돌아가기
      </button>
    </Management>
  );
}
const STABLE_CONTRACTED_JOCKEY_IDS = ["HAN_DOYUN", "SEO_JIAN", "YOON_TAESUNG"];
function Jockeys({ setView, onSelect }: { setView: (v: View) => void; onSelect: (id: string) => void }) {
  const { career } = useCareer();
  const [tab, setTab] = useState("contract");
  const contractedIds = career?.contractedJockeyIds ?? STABLE_CONTRACTED_JOCKEY_IDS;
  const list = jockeys.filter(j => contractedIds.includes(j.id) === (tab === 'contract'));
  return (
    <Management
      title="기수"
      eyebrow="JOCKEYS"
      description="계약 기수와 계약 가능한 기수를 관리합니다. 최대 3명."
    >
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
        <button
          onClick={() => setTab("contract")}
          className={`rounded-lg px-4 py-2 text-xs ${tab === "contract" ? "bg-primary text-primary-foreground" : ""}`}
        >
          계약 기수 {contractedIds.length} / 3
        </button>
        <button
          onClick={() => setTab("available")}
          className={`rounded-lg px-4 py-2 text-xs ${tab === "available" ? "bg-primary text-primary-foreground" : ""}`}
        >
          계약 가능 기수
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((j) => (
          <button
            key={j.name}
            onClick={() => { onSelect(j.id); setView("jockey"); }}
            className="rounded-xl border border-border bg-card p-4 text-left hover:bg-accent/40"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/20 text-primary">
                <Flag size={16} />
              </div>
              <div>
                <p className="font-serif">{j.name}</p>
                <p className="text-[11px] text-muted-foreground">{j.meta}</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{j.style}</p>
            <p className="mt-1 text-xs text-primary">
              {contractedIds.includes(j.id) ? '계약 중' : '계약 가능'}
            </p>
            {career?.horse ? (
              <p className="mt-1 text-xs">
                현재 육성마 호흡도 ·{" "}
                <b className="text-primary">{j.chem} / 100</b>
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">현재 육성마 없음</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-xs">
              {[
                "스타트",
                "페이스 판단",
                "진로 판단",
                "승부 타이밍",
                "기승 안���",
              ].map((a, i) => (
                <span
                  key={a}
                  className="flex justify-between border-b border-border py-1"
                >
                  <span className="text-muted-foreground">{a}</span>
                  <b>{j.abilities[i]}</b>
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </Management>
  );
}
function Jockey({ setView, jockeyId, horses }: { setView: (v: View) => void; jockeyId: string; horses: CareerHorse[] }) {
  const { career } = useCareer();
  const j = jockeys.find(j => j.id === jockeyId) ?? jockeys[0];
  const riddenHorses = horses.filter(h => h.raceRecords?.some(r => r.jockeyId === j.id));
  const records = riddenHorses.flatMap(h => (h.raceRecords ?? []).filter(r => r.jockeyId === j.id).map(r => [r.date, h.name, r.race, r.grade ?? '—', r.result]));
  return (
    <Management
      title={j.name}
      eyebrow="JOCKEY RECORD"
      description="기수의 능력과 기승 기록을 조회합니다."
    >
      <button
        onClick={() => setView("jockeys")}
        className="w-fit text-xs text-muted-foreground hover:text-foreground"
      >
        ← 기수 목록
      </button>
      <Section eyebrow="PROFILE / CONTRACT" title="프로필 · 계약">
        <div className="grid grid-cols-2 md:grid-cols-3">
          {[
            ["나이", jockeyProfiles[j.id] ? `${jockeyProfiles[j.id].age}세` : "—"],
            ["국가", jockeyProfiles[j.id]?.nationality ?? "—"],
            ["주요 스타일", j.style],
            ["계약 상태", (career?.contractedJockeyIds ?? STABLE_CONTRACTED_JOCKEY_IDS).includes(j.id) ? "계약 중" : "미계약"],
            ["잔여 기간", (career?.contractedJockeyIds ?? STABLE_CONTRACTED_JOCKEY_IDS).includes(j.id) ? "2029년 12월까지" : "—"],
            career?.horse ? ["현재 육성마와 호흡도", `${j.chem} / 100`] : ["현재 육성마", "현재 육성마 없음"],
          ].map(([a, b]) => (
            <div key={a} className="border-b border-r border-border px-4 py-3">
              <span className="text-xs text-muted-foreground">{a}</span>
              <p className="mt-1 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="ABILITIES" title="기수 능력">
        <div className="grid gap-4 md:grid-cols-5">
          {[
            "스타트",
            "페이스 판단",
            "진로 판단",
            "승부 타이밍",
            "기승 안정",
          ].map((a, i) => (
            <div
              key={a}
              className="flex items-center justify-between border-b border-border py-2 text-xs"
            >
              <span className="text-muted-foreground">{a}</span>
              <b className="tabular-nums text-primary">{j.abilities[i]}</b>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="RIDING RECORD" title="최근 기승 기록">
        <div className="overflow-x-auto">
          <div className="grid min-w-[620px] grid-cols-[100px_1.2fr_1.3fr_70px_70px] border-b border-border px-3 pb-2 text-[10px] text-muted-foreground">
            <span>날짜</span>
            <span>말</span>
            <span>경주</span>
            <span>등급</span>
            <span>결과</span>
          </div>
          {records.length === 0 && <p className="py-4 text-sm text-muted-foreground">최근 기승 기록이 없습니다.</p>}
          {records.map((r) => (
            <div
              key={r.join("-")}
              className="grid min-w-[620px] grid-cols-[100px_1.2fr_1.3fr_70px_70px] border-b border-border px-3 py-3 text-xs"
            >
              <button onClick={() => setView("horse")} className="text-left">
                {r[0]}
              </button>
              <button
                onClick={() => setView("horse")}
                className="text-left font-serif hover:text-primary"
              >
                {r[1]}
              </button>
              <button
                onClick={() => setView("race")}
                className="text-left font-serif hover:text-primary"
              >
                {r[2]}
              </button>
              <span>{r[3]}</span>
              <span className="text-primary">{r[4]}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="HORSES" title="함께한 말">
        <div className="flex flex-col gap-2">
          {riddenHorses.length === 0 ? <p className="border-y border-border py-4 text-sm text-muted-foreground">함께한 말이 없습니다.</p> : riddenHorses.map(h => <p key={h.id} className="border-b border-border py-3 text-sm">{h.name} · {summarizeRecords(h.raceRecords?.filter(r => r.jockeyId === j.id)).record}</p>)}
        </div>
      </Section>
    </Management>
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
function RaceEntryArchive({ setView }: { setView: (v: View) => void }) {
  const [selected, setSelected] = useState({
    race: races[1],
    jockey: jockeys[1],
    tactic: "선행",
  });
  const [locked, setLocked] = useState(false);
  const selectedRace = selected.race;
  const selectedJockey = selected.jockey;
  const selectedTactic = selected.tactic;
  const tactics = [
    ["도주", "초반부터 선두권을 노립니다.", "C"],
    ["선행", "앞쪽 그룹에서 안정적으로 전개합니다.", "A"],
    ["선입", "중단에서 진행한 뒤 후반을 노립니다.", "A"],
    ["추입", "체력을 아끼고 막판 추격합니다.", "B"],
  ];
  const update = <K extends keyof typeof selected>(
    key: K,
    value: (typeof selected)[K],
  ) => {
    if (!locked) setSelected((s) => ({ ...s, [key]: value }));
  };
  const suitability = selectedTactic
    ? selectedJockey.name === "김도윤"
      ? "매우 좋음"
      : "좋음"
    : "전술 선택 후 확인";
  if (locked)
    return (
      <FocusShell setView={setView}>
        <p className="ui-label text-primary">
          <IconLabel icon={LockKeyhole}>RACE READY · TURN LOCK</IconLabel>
        </p>
        <h1 className="ui-page-title mt-2 font-serif">
          출전이 확정되었습니다.
        </h1>
        <Section eyebrow="LOCKED ENTRY" title="출전 정보">
          <div className="ui-result-summary">
            {[
              ["HORSE", "천둥의 전설"],
              ["RACE", selectedRace.name],
              ["JOCKEY", selectedJockey.name],
              ["TACTIC", selectedTactic],
            ].map(([a, b]) => (
              <div key={a}>
                <span className="ui-metadata">{a}</span>
                <p className="mt-2 font-serif text-lg">{b}</p>
              </div>
            ))}
          </div>
        </Section>
        <button
          onClick={() => setView("raceexperimental")}
          className="mt-4 rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
        >
          레이스 시작
        </button>
      </FocusShell>
    );
  return (
    <FocusShell setView={setView}>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="ui-label text-primary">RACE ENTRY · 2028년 4월</p>
          <h1 className="ui-page-title mt-2 font-serif">경주 출전</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          천둥의 전설 · 3세 · 수말 · OPEN
        </p>
      </div>
      <Section eyebrow="RACE SELECTION" title="이번 달 출전 가능한 경주">
        <div className="ui-compact-table space-y-1">
          {races.slice(0, 2).map((r) => (
            <button
              key={r.name}
              onClick={() => update("race", r)}
              className={`ui-table-row grid w-full grid-cols-[70px_48px_1.2fr_1.4fr_120px] items-center gap-3 rounded-lg border px-3 text-left ${selectedRace.name === r.name ? "ui-selected border-primary" : "border-border bg-card/40"}`}
            >
              <span className="text-xs text-muted-foreground">{r.date}</span>
              <b className="text-xs text-primary">{r.grade}</b>
              <span className="font-serif text-sm">{r.name}</span>
              <span className="text-xs text-muted-foreground">
                {r.track} · {r.distance} · {r.venue}
              </span>
              <span className="text-right text-xs text-primary">{r.prize}</span>
            </button>
          ))}
        </div>
      </Section>
      <div className="mt-3 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Section eyebrow="JOCKEY" title="기수 비교 · 선택">
          <div className="grid gap-2 md:grid-cols-3">
            {jockeys.slice(0, 3).map((j) => (
              <button
                key={j.name}
                onClick={() => update("jockey", j)}
                className={`ui-compare-card flex flex-col border text-left ${selectedJockey.name === j.name ? "ui-selected border-primary" : "border-border bg-card/40"}`}
              >
                <div className="flex items-start justify-between">
                  <span className="font-serif text-base">{j.name}</span>
                  {selectedJockey.name === j.name && (
                    <Check size={16} className="text-primary" />
                  )}
                </div>
                <span className="mt-1 ui-metadata">
                  {j.meta} · {j.style}
                </span>
                <div className="mt-4 space-y-1.5 text-xs">
                  {[
                    "스타트",
                    "페이스 판단",
                    "진로 판단",
                    "승부 타이밍",
                    "기승 안정",
                  ].map((label, i) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <b className="text-primary">{j.abilities[i]}</b>
                    </div>
                  ))}
                </div>
                <div className="mt-auto border-t border-border pt-3 text-xs">
                  <span className="text-muted-foreground">호흡도</span>
                  <b className="ml-2 text-primary">
                    {j.chem} / 100
                  </b>
                  <p className="mt-1 text-muted-foreground">
                    기승 적합도 · {suitability}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    현재 경주·전술 기준{" "}
                    {suitability === "전술 선택 후 확인"
                      ? "확인 필요"
                      : "상호 보완적인 조합입니다."}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </Section>
        <Section eyebrow="TACTIC" title="전술 선택">
          <div className="grid grid-cols-2 gap-2">
            {tactics.map(([name, description, apt]) => (
              <button
                key={name}
                onClick={() => update("tactic", name)}
                className={`ui-compare-card border text-left ${selectedTactic === name ? "ui-selected border-primary" : "border-border bg-card/40"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-serif">{name}</span>
                  {selectedTactic === name && (
                    <Check size={15} className="text-primary" />
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {description}
                </p>
                <span className="mt-3 block text-xs text-primary">
                  적성 {apt}
                </span>
              </button>
            ))}
          </div>
        </Section>
      </div>
      <Section eyebrow="ENTRY SUMMARY" title="출전 정보 확인">
        <div className="ui-result-summary">
          {[
            ["HORSE", "천둥의 전설"],
            [
              "RACE",
              `${selectedRace.name} · ${selectedRace.grade} · ${selectedRace.track} ${selectedRace.distance}`,
            ],
            ["JOCKEY", selectedJockey.name],
            ["TACTIC", selectedTactic],
          ].map(([a, b]) => (
            <div key={a}>
              <span className="ui-metadata">{a}</span>
              <p className="mt-2 ui-important-value">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 border-l-2 border-red-900/70 px-3 py-2 text-xs text-red-200">
          WARNING · 현재 신체 부하��� 높은 편입니다. 경주 후 피로와 부하가 증가할
          수 있습니다.
        </p>
        <button
          disabled={!selectedRace || !selectedJockey || !selectedTactic}
          onClick={() => setLocked(true)}
          className="mt-4 rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          출전 확정
        </button>
      </Section>
    </FocusShell>
  );
}
function RaceEntryLegacy({ setView }: { setView: (v: View) => void }) {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState({
    race: races[1],
    jockey: jockeys[1],
    tactic: "선행",
  });
  const [locked, setLocked] = useState(false);
  const selectedRace = selected.race;
  const selectedJockey = selected.jockey;
  const selectedTactic = selected.tactic;
  const updateSelection = <K extends keyof typeof selected>(
    key: K,
    value: (typeof selected)[K],
  ) => {
    if (!locked) setSelected((current) => ({ ...current, [key]: value }));
  };
  const steps = ["경주 선택", "기수 선택", "전술", "최종 확인"];
  const selectedTactics = [
    ["도주", "C", "초반부터 선두권을 노립니다."],
    ["선행", "A", "앞쪽 그룹에서 안정적으로 전개합니다."],
    ["선입", "A", "중단에서 경주를 진행한 뒤 후반을 노립니다."],
    ["추입", "B", "후방에서 체력을 아끼고 막판 추격을 노립니다."],
  ];
  const suitability = selectedJockey.name === "김도윤" ? "매우 좋음" : "좋음";
  if (locked)
    return (
      <FocusShell setView={setView}>
        <Section
          eyebrow="RACE READY · TURN LOCK"
          title="출전이 확정되었습니다."
        >
          <div className="grid gap-4 md:grid-cols-4">
            {[
              ["말", "천둥의 전설"],
              ["경주", selectedRace.name],
              ["기수", selectedJockey.name],
              ["전술", selectedTactic],
            ].map(([a, b]) => (
              <div key={a} className="border-b border-border py-3">
                <span className="ui-label">{a}</span>
                <p className="mt-2 font-serif text-lg">{b}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            이번 달 행동이 잠겼습니다. 레이스 시뮬레이션은 다음 단계에서
            시작합니다.
          </p>
          <button
            onClick={() => setView("raceplay")}
            className="mt-5 rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
          >
            레이스 시작
          </button>
        </Section>
      </FocusShell>
    );
  return (
    <FocusShell setView={setView}>
      <div className="flex items-end justify-between">
        <div>
          <p className="ui-label text-primary">RACE ENTRY · 2028년 4월</p>
          <h1 className="ui-page-title mt-2 font-serif text-3xl">경주 출전</h1>
        </div>
        <span className="text-xs text-muted-foreground">
          천��의 전설 · 3세 수말
        </span>
      </div>
      <div className="mt-6 flex items-center gap-2 text-xs">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={
                step === i + 1 ? "text-primary" : "text-muted-foreground"
              }
            >
              {String(i + 1).padStart(2, "0")} {label}
            </span>
            {i < 3 && <span className="text-border">—</span>}
          </div>
        ))}
      </div>
      {step === 1 && (
        <Section eyebrow="STEP 01 · RACE" title="어느 경주에 나갈 것인가?">
          <div className="flex flex-col gap-2">
            {races.slice(0, 2).map((r) => (
              <button
                key={r.name}
                onClick={() => updateSelection("race", r)}
                className={`grid gap-2 border px-4 py-4 text-left md:grid-cols-[100px_1fr_160px_120px] ${selectedRace.name === r.name ? "border-primary bg-accent" : "border-border hover:bg-accent/40"}`}
              >
                <span className="text-xs text-muted-foreground">{r.date}</span>
                <span>
                  <b className="font-serif text-lg">{r.name}</b>
                  <span className="ml-2 text-xs text-primary">{r.grade}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.track} · {r.distance} · {r.venue}
                </span>
                <span className="text-xs">
                  연령·성별
                  <br />
                  {r.age} · {r.gender}
                </span>
                <span className="text-xs text-primary">{r.prize}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">선택한 경주</p>
            <p className="mt-1 font-serif text-lg">
              {selectedRace.name} · {selectedRace.grade}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedRace.date} · {selectedRace.track} {selectedRace.distance}{" "}
              · {selectedRace.venue}
            </p>
            <button
              onClick={() => setView("race")}
              className="mt-3 text-xs text-primary"
            >
              경주 상세 보기 <ChevronRight className="inline" size={14} />
            </button>
            <br />
            <button
              onClick={() => setStep(2)}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground"
            >
              다음 · 기수 선택
            </button>
          </div>
        </Section>
      )}
      {step === 2 && (
        <Section eyebrow="STEP 02 · JOCKEY" title="누가 탈 것인가?">
          <p className="mb-4 text-xs text-muted-foreground">
            SELECTED RACE · {selectedRace.name} · {selectedRace.grade} ·{" "}
            {selectedRace.date}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {jockeys.slice(0, 2).map((j) => (
              <button
                key={j.name}
                onClick={() => updateSelection("jockey", j)}
                className={`border p-4 text-left ${selectedJockey.name === j.name ? "border-primary bg-accent" : "border-border hover:bg-accent/40"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-serif text-lg">{j.name}</span>
                  {j.name === selectedJockey.name && (
                    <span className="text-primary"></span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {j.meta} · {j.style}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-1 text-xs">
                  {[
                    "스타트",
                    "페이스 판단",
                    "진로 판단",
                    "승부 타이밍",
                    "기승 안정",
                  ].map((a, i) => (
                    <span
                      key={a}
                      className="flex justify-between border-b border-border py-1"
                    >
                      <span className="text-muted-foreground">{a}</span>
                      {j.abilities[i]}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-xs">
                  호흡도{" "}
                  <b className="text-primary">
                    {j.chem} / 100
                  </b>
                </p>
                <p className="mt-2 text-xs text-primary">
                  기승 적합도 ·{" "}
                  {j.name === selectedJockey.name ? suitability : "좋음"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {j.name === "김도윤"
                    ? "선행 전개 강점 · 진로 판단 우수"
                    : "스타트와 승부 타이밍 강점"}
                </p>
              </button>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
            >
              ← 경주 선택
            </button>
            <button
              onClick={() => setStep(3)}
              className="rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground"
            >
              다음 · 전술
            </button>
          </div>
        </Section>
      )}
      {step === 3 && (
        <Section eyebrow="STEP 03 · TACTIC" title="어떻게 달릴 것인가?">
          <div className="grid gap-2 md:grid-cols-2">
            {selectedTactics.map(([name, aptitude, description]) => (
              <button
                key={name}
                onClick={() => updateSelection("tactic", name)}
                className={`border p-4 text-left ${selectedTactic === name ? "border-primary bg-accent" : "border-border hover:bg-accent/40"}`}
              >
                <div className="flex justify-between">
                  <span className="font-serif text-lg">{name}</span>
                  <span className="text-primary">적성 {aptitude}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {description}
                </p>
              </button>
            ))}
          </div>
          <div className="mt-5 border-l-2 border-primary bg-accent/50 px-4 py-3 text-xs">
            <p>선택한 전술 · {selectedTactic}</p>
            <p className="mt-1 text-muted-foreground">
              말 적성{" "}
              {selectedTactics.find((t) => t[0] === selectedTactic)?.[1]} ·{" "}
              {selectedTactics.find((t) => t[0] === selectedTactic)?.[2]}
            </p>
            <p className="mt-1 text-muted-foreground">
              기수 강점 · 승부 이밍 {selectedJockey.abilities[3]}
            </p>
          </div>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
            >
              ← 기수 선택
            </button>
            <button
              onClick={() => setStep(4)}
              className="rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground"
            >
              다음 · 최종 확인
            </button>
          </div>
        </Section>
      )}
      {step === 4 && (
        <Section eyebrow="STEP 04 · CONFIRM" title="최종 출전 확인">
          <div className="grid gap-4 md:grid-cols-4">
            {[
              ["HORSE", "천둥의 전설", "3세 · 수말 · OPEN"],
              [
                "RACE",
                selectedRace.name,
                `${selectedRace.grade} · ${selectedRace.date} · ${selectedRace.track} ${selectedRace.distance}`,
              ],
              [
                "JOCKEY",
                selectedJockey.name,
                `호흡도 ${selectedJockey.name === "김도윤" ? "72" : "45"} · ${suitability}`,
              ],
              [
                "TACTIC",
                selectedTactic,
                `말 적성 ${selectedTactics.find((t) => t[0] === selectedTactic)?.[1]}`,
              ],
            ].map(([a, b, c]) => (
              <div key={a} className="border-b border-border py-3">
                <span className="ui-label">{a}</span>
                <p className="mt-2 font-serif text-lg">{b}</p>
                <p className="mt-1 text-xs text-muted-foreground">{c}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 border-l-2 border-primary bg-accent/50 px-4 py-3 text-xs">
            <b>주의</b>
            <p className="mt-1 text-muted-foreground">
              현재 신체 부하가 높은 편입니다. 경주 출전 후 피로와 신체 부하가
              증가할 수 있습니다.
            </p>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            출전 확정 시 이번 달 행동이 확정됩니다.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStep(3)}
              className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
            >
              ← 전술 수정
            </button>
            <button
              onClick={() => setLocked(true)}
              className="rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
            >
              출전 확정
            </button>
          </div>
        </Section>
      )}
    </FocusShell>
  );
}

function FocusShell({
  setView,
  children,
  backLabel = "← 이번 달 육성",
  backDisabled = false,
}: {
  setView: (v: View) => void;
  children: ReactNode;
  backLabel?: string;
  backDisabled?: boolean;
}) {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-7 md:px-8">
      <button
        disabled={backDisabled}
        onClick={() => setView("training")}
        className="text-xs text-muted-foreground"
      >
        {backLabel}
      </button>
      {children}
    </div>
  );
}
const raceSimulation = [
  { name: "골든 스톰", ranks: [2, 3, 4, 1, 1] },
  { name: "천둥의 전설", ranks: [3, 2, 2, 2, 2] },
  { name: "블랙 윈드", ranks: [1, 1, 1, 3, 3] },
  { name: "버 레인", ranks: [4, 4, 3, 4, 4] },
  { name: "레드 애로우", ranks: [5, 5, 5, 5, 5] },
] as const;
function PositionBoard({ stage }: { stage: number }) {
  const fields = raceSimulation.map(
    ({ name, ranks }) => [name, ranks] as const,
  );
  const order = fields.slice().sort((a, b) => a[1][stage] - b[1][stage]);
  return (
    <div className="space-y-3">
      {order.map(([name, ranks]) => (
        <div
          key={name}
          className="grid grid-cols-[28px_120px_1fr] items-center gap-3 text-xs"
        >
          <span
            className={
              name === "천둥의 전설" ? "text-primary" : "text-muted-foreground"
            }
          >
            {ranks[stage]}위
          </span>
          <span
            className={
              name === "천둥의 전설"
                ? "font-serif text-primary"
                : "text-muted-foreground"
            }
          >
            {name}
          </span>
          <div className="relative h-2 rounded-full bg-accent">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${name === "천둥의 전설" ? "bg-primary" : "bg-blue/70"}`}
              style={{ width: `${100 - (ranks[stage] - 1) * 17}%` }}
            />
            <span
              className={`absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-card ${name === "천둥의 전설" ? "bg-primary" : "bg-teal-500"}`}
              style={{ left: `calc(${100 - (ranks[stage] - 1) * 17}% - 6px)` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function PositionChart({
  stage,
  compact = false,
}: {
  stage: number;
  compact?: boolean;
}) {
  const labels = ["START", "MID", "FINAL CORNER", "STRETCH", "FINISH"];
  const fields = raceSimulation.map(
    ({ name, ranks }) => [name, ranks] as const,
  );
  const width = 640,
    height = compact ? 150 : 210,
    padX = 42,
    padY = 20,
    plotW = width - padX * 2,
    plotH = height - 48;
  const point = (i: number, r: number) =>
    `${padX + (i * plotW) / (labels.length - 1)},${padY + ((r - 1) * plotH) / 4}`;
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border bg-card/60 ${compact ? "p-3" : "p-4"}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="ui-label">POSITION HISTORY · RACE FLOW</span>
        <span className="text-[10px] text-muted-foreground">현재까지</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="레이스 구간별 순위 변화 그래프"
      >
        <g className="text-muted-foreground">
          {[1, 2, 3, 4, 5].map((r) => (
            <g key={r}>
              <line
                key={r}
                x1={padX}
                x2={width - padX}
                y1={padY + ((r - 1) * plotH) / 4}
                y2={padY + ((r - 1) * plotH) / 4}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
            </g>
          ))}
          {fields.map(([name, ranks]) => (
            <polyline
              key={name}
              points={ranks
                .slice(0, stage + 1)
                .map((r, i) => point(i, r))
                .join(" ")}
              fill="none"
              stroke={name === "천둥의 전설" ? "var(--primary)" : "#4f7776"}
              strokeOpacity={name === "천둥의 전설" ? 0.95 : 0.42}
              strokeWidth={name === "천둥의 전설" ? 3 : 1.3}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
function RacePlayVisual({ setView }: { setView: (v: View) => void }) {
  const [segment, setSegment] = useState(0);
  const [paused, setPaused] = useState(false);
  const stages = [
    ["START", "천둥의 전설이 안정적으로 출발했습니다. 현재 3위."],
    ["MID", "박성현이 페이스를 유지하며 2위까지 올라섭니다."],
    ["FINAL CORNER", "최종 코너에서 선두를 압박합니다. 현재 2위."],
    ["STRETCH", "직선에서 끝까지 추격합니다."],
    ["FINISH", "천둥의 전설이 2착으로 결승선을 통과합니다."],
  ];
  useEffect(() => {
    if (paused || segment >= 4) return;
    const id = window.setTimeout(
      () => setSegment((v) => v + 1),
      segment === 0 ? 1800 : 2000,
    );
    return () => window.clearTimeout(id);
  }, [segment, paused]);
  useEffect(() => {
    if (segment === 4 && !paused) {
      const id = window.setTimeout(() => setView("result"), 1500);
      return () => window.clearTimeout(id);
    }
  }, [segment, paused, setView]);
  return (
    <FocusShell setView={setView}>
      <p className="ui-label text-primary">RACE · 2028년 4월</p>
      <h1 className="ui-page-title mt-2 font-serif text-3xl">사츠키상</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        G1 · 나카야마 · 잔디 2000m
      </p>
      <p className="mt-4 text-xs">천둥의 전설 · 박성현 · 선행</p>
      <div className="mt-6 flex items-center gap-2 text-[10px] tracking-[.12em]">
        {stages.map(([label], i) => (
          <span
            key={label}
            className={i === segment ? "text-primary" : "text-muted-foreground"}
          >
            {label}
            {i < 4 && <b className="mx-2 text-border">—</b>}
          </span>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
        <Section eyebrow={stages[segment][0]} title="현 위치">
          <PositionBoard stage={segment} />
        </Section>
        <PositionChart stage={segment} />
      </div>
      <div className="mt-4 border-l-2 border-primary bg-accent/50 px-4 py-3 text-sm">
        <p>{stages[segment][1]}</p>
      </div>
      <div className="mt-5 flex gap-2">
        <button
          onClick={() => setPaused((v) => !v)}
          className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
        >
          {paused ? "계속" : "일시정지"}
        </button>
      </div>
    </FocusShell>
  );
}
function LegacyRacePlay({ setView }: { setView: (v: View) => void }) {
  return <RacePlayVisual setView={setView} />;
}

function RacePlay({ setView }: { setView: (v: View) => void }) {
  const [segment, setSegment] = useState(0);
  const [paused, setPaused] = useState(false);
  const segments = [
    [
      "START",
      "스타트",
      "천둥의 전설이 안적으로 출발했습니다.",
      "선행권을 확보합니다.",
    ],
    ["MID", "중반", "박성현이 페이스를 안정적으로 유지합니다.", "현재 3위."],
    [
      "FINAL CORNER",
      "최종 코너",
      "바깥쪽 진로를 확보합니다.",
      "선두와의 거리가 좁혀집니다.",
    ],
    [
      "STRETCH",
      "직선",
      "직선에서 추격을 시작합니다.",
      "2위권 경쟁이 이어집니다.",
    ],
  ];
  const positions = [
    [72, 68, 81, 61, 55],
    [78, 73, 84, 69, 62],
    [86, 84, 88, 77, 71],
    [94, 91, 89, 83, 78],
  ];
  const names = [
    "골든 스톰",
    "천둥의 전설",
    "블랙 윈드",
    "레드 애로우",
    "실버 레인",
  ];
  return (
    <FocusShell setView={setView}>
      <p className="ui-label text-primary">RACE · 2028년 4월</p>
      <h1 className="ui-page-title mt-2 font-serif text-3xl">사츠키상</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        G1 · 나카야마 · 잔디 2000m
      </p>
      <p className="mt-4 text-xs">천둥의 전설 · 박성현 · 선행</p>
      <div className="mt-7 flex items-center gap-2 text-[10px] tracking-[.15em]">
        {segments.map(([name, ko], i) => (
          <span
            key={name}
            className={i === segment ? "text-primary" : "text-muted-foreground"}
          >
            {name} {i < 3 && <b className="mx-2 text-border">—</b>}
          </span>
        ))}
      </div>
      {segment === 4 ? (
        <RaceFinish setView={setView} />
      ) : (
        <>
          <Section eyebrow={segments[segment][0]} title={segments[segment][1]}>
            <div className="flex flex-col gap-4">
              {names.map((name, i) => (
                <div
                  key={name}
                  className="grid grid-cols-[150px_42px_1fr] items-center gap-3 text-sm"
                >
                  <span
                    className={
                      name === "천둥의 전설"
                        ? "font-serif text-primary"
                        : "text-muted-foreground"
                    }
                  >
                    {i + 1} · {name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i + 1}위
                  </span>
                  <div className="h-2 rounded-full bg-accent">
                    <div
                      className={`h-full rounded-full ${name === "천둥의 전설" ? "bg-primary" : "bg-blue"}`}
                      style={{ width: `${positions[segment][i]}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>
          <div className="mt-4 flex items-start gap-3 border-l-2 border-primary bg-accent/50 px-4 py-3 text-sm">
            <IconTile
              icon={
                segment === 2
                  ? CornerUpRight
                  : segment === 3
                    ? Zap
                    : segment === 1
                      ? TriangleAlert
                      : ArrowUp
              }
              tone="gold"
              size={20}
            />
            <div>
              <p>{segments[segment][2]}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {segments[segment][3]}
              </p>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            {segment > 0 && (
              <button
                onClick={() => setSegment(segment - 1)}
                className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
              >
                이전 구간
              </button>
            )}
            <button
              onClick={() => setPaused(!paused)}
              className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
            >
              {paused ? "계속" : "일시정지"}
            </button>
            <button
              disabled={paused}
              onClick={() => setSegment(segment + 1)}
              className="rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground"
            >
              {segment === 3 ? "피니시" : "다음 구간"}
            </button>
          </div>
        </>
      )}
    </FocusShell>
  );
}
type RacePhase = "START" | "MID" | "FINAL_CORNER" | "STRETCH" | "FINISH";
type SimulationRunner = {
  horseId: string;
  horseName: string;
  distanceTraveled: number;
  rank: number;
  progress: number;
  lateralPosition: number;
  gapToLeader: number;
  finishTimestamp?: number;
};
type SimulationEvent = {
  id: string;
  timeMs: number;
  type:
    | "START"
    | "BLOCKED"
    | "PATH_CLEAR"
    | "OVERTAKE"
    | "PACE_UP"
    | "SPRINT_START"
    | "DUEL"
    | "FINISH";
  horseId?: string;
  relatedHorseId?: string;
  data?: Record<string, unknown>;
};
type RaceFrame = {
  timeMs: number;
  phase: RacePhase;
  distanceRemaining: number;
  runners: SimulationRunner[];
  events: SimulationEvent[];
};
type FinalStanding = {
  horseId: string;
  horseName: string;
  rank: number;
  finishTime: number;
  marginToWinner: number;
  prize?: number;
};
type RaceSimulation = {
  raceId: string;
  seed: string;
  durationMs: number;
  playerHorseId: string;
  frames: RaceFrame[];
  finalStandings: FinalStanding[];
};
const simulationKeyframes = [
  {
    timeMs: 0,
    phase: "START" as RacePhase,
    distanceRemaining: 2000,
    ranks: [5, 4, 1, 3, 2],
    progress: [8, 20, 36, 25, 15],
  },
  {
    timeMs: 8000,
    phase: "MID" as RacePhase,
    distanceRemaining: 1500,
    ranks: [4, 3, 1, 2, 5],
    progress: [28, 38, 48, 42, 34],
  },
  {
    timeMs: 15000,
    phase: "MID" as RacePhase,
    distanceRemaining: 1063,
    ranks: [3, 4, 1, 2, 5],
    progress: [42, 48, 62, 54, 44],
  },
  {
    timeMs: 20000,
    phase: "FINAL_CORNER" as RacePhase,
    distanceRemaining: 750,
    ranks: [3, 2, 1, 4, 5],
    progress: [58, 70, 78, 64, 53],
  },
  {
    timeMs: 26000,
    phase: "STRETCH" as RacePhase,
    distanceRemaining: 375,
    ranks: [3, 2, 1, 4, 5],
    progress: [76, 86, 94, 82, 70],
  },
  {
    timeMs: 30000,
    phase: "STRETCH" as RacePhase,
    distanceRemaining: 125,
    ranks: [3, 2, 1, 4, 5],
    progress: [88, 96, 99, 92, 84],
  },
  {
    timeMs: 32000,
    phase: "FINISH" as RacePhase,
    distanceRemaining: 0,
    ranks: [1, 2, 3, 4, 5],
    progress: [99.2, 98.8, 100, 97, 95],
  },
];
const simulationHorses = [
  ["1", "천둥의 전설"],
  ["2", "블랙 윈드"],
  ["3", "골든 스톰"],
  ["4", "실버 레인"],
  ["5", "레드 애로우"],
] as const;
function buildRaceSimulation(seed: string): RaceSimulation {
  const finalStandings: FinalStanding[] = [
    {
      horseId: "3",
      horseName: "골든 스톰",
      rank: 1,
      finishTime: 120.4,
      marginToWinner: 0,
      prize: 72000000,
    },
    {
      horseId: "1",
      horseName: "천둥의 전설",
      rank: 2,
      finishTime: 120.8,
      marginToWinner: 0.4,
      prize: 48000000,
    },
    {
      horseId: "2",
      horseName: "블랙 윈드",
      rank: 3,
      finishTime: 121.1,
      marginToWinner: 0.7,
      prize: 28000000,
    },
    {
      horseId: "4",
      horseName: "실버 레인",
      rank: 4,
      finishTime: 121.8,
      marginToWinner: 1.4,
      prize: 16000000,
    },
    {
      horseId: "5",
      horseName: "레드 애로우",
      rank: 5,
      finishTime: 122.3,
      marginToWinner: 1.9,
      prize: 10000000,
    },
  ];
  const finalRanks = new Map(
    finalStandings.map((standing) => [standing.horseId, standing.rank]),
  );
  const frames = simulationKeyframes.map((keyframe, index) => ({
    timeMs: keyframe.timeMs,
    phase: keyframe.phase,
    distanceRemaining: keyframe.distanceRemaining,
    runners: simulationHorses.map(([horseId, horseName], i) => ({
      horseId,
      horseName,
      distanceTraveled: (keyframe.progress[i] / 100) * 2000,
      rank:
        index === simulationKeyframes.length - 1
          ? finalRanks.get(horseId) || keyframe.ranks[i]
          : keyframe.ranks[i],
      progress:
        index === simulationKeyframes.length - 1
          ? 100 - (finalRanks.get(horseId) || keyframe.ranks[i]) * 0.25
          : keyframe.progress[i],
      lateralPosition:
        index === simulationKeyframes.length - 1
          ? ([0, 1, 2, 3, 4].find(
              (rank) => finalRanks.get(horseId) === rank + 1,
            )! -
              2) *
            18
          : (i - 2) * 18,
      gapToLeader: Math.max(
        0,
        ((index === simulationKeyframes.length - 1
          ? finalRanks.get(horseId) || keyframe.ranks[i]
          : keyframe.ranks[i]) -
          1) *
          0.4,
      ),
    })),
    events:
      index === 0
        ? [{ id: "start", timeMs: 0, type: "START" as const }]
        : index === 1
          ? [
              {
                id: "blocked",
                timeMs: keyframe.timeMs,
                type: "BLOCKED" as const,
                horseId: "1",
              },
            ]
          : index === 2
            ? [
                {
                  id: "path-clear",
                  timeMs: keyframe.timeMs,
                  type: "PATH_CLEAR" as const,
                  horseId: "1",
                },
              ]
            : index === 3
              ? [
                  {
                    id: "overtake",
                    timeMs: keyframe.timeMs,
                    type: "OVERTAKE" as const,
                    horseId: "1",
                    relatedHorseId: "3",
                  },
                ]
              : index === 4
                ? [
                    {
                      id: "sprint",
                      timeMs: keyframe.timeMs,
                      type: "SPRINT_START" as const,
                      horseId: "1",
                    },
                  ]
                : index === 6
                  ? finalStandings.map((standing) => ({
                      id: `finish-${standing.horseId}`,
                      timeMs: standing.finishTime * 1000 - 88400,
                      type: "FINISH" as const,
                      horseId: standing.horseId,
                    }))
                  : [],
  }));
  const playerHorseId = "1";
  const finalFrame = frames[frames.length - 1];
  const playerFinalResult = finalStandings.find(
    (standing) => standing.horseId === playerHorseId,
  );
  const finishRank = finalFrame.runners.find(
    (runner) => runner.horseId === playerHorseId,
  )?.rank;
  if (
    process.env.NODE_ENV === "development" &&
    (finishRank !== playerFinalResult?.rank ||
      playerFinalResult?.rank !==
        finalStandings.find((standing) => standing.horseId === playerHorseId)
          ?.rank)
  ) {
    console.warn("[v0] RaceSimulation final consistency mismatch", {
      finishRank,
      finalStandingRank: playerFinalResult?.rank,
      playerFinalResultRank: playerFinalResult?.rank,
    });
  }
  return {
    raceId: "satsuki-2028",
    seed,
    durationMs: 32000,
    playerHorseId,
    frames,
    finalStandings,
  };
}
function frameAt(simulation: RaceSimulation, timeMs: number): RaceFrame {
  const frames = simulation.frames;
  let from = frames[0],
    to = frames[frames.length - 1];
  for (let i = 0; i < frames.length - 1; i++) {
    if (timeMs >= frames[i].timeMs && timeMs <= frames[i + 1].timeMs) {
      from = frames[i];
      to = frames[i + 1];
      break;
    }
  }
  const span = Math.max(1, to.timeMs - from.timeMs);
  const t = Math.max(0, Math.min(1, (timeMs - from.timeMs) / span));
  const ease = (a: number, b: number) => a + (b - a) * t;
  return {
    timeMs,
    distanceRemaining: Math.round(
      ease(from.distanceRemaining, to.distanceRemaining),
    ),
    phase: t < 0.5 ? from.phase : to.phase,
    events: timeMs >= to.timeMs ? to.events : from.events,
    runners: from.runners.map((runner, index) => {
      const next = to.runners[index];
      const finish = simulation.finalStandings.find(
        (standing) => standing.horseId === runner.horseId,
      );
      const finishTime = finish
        ? 30000 + (finish.finishTime - 120.4) * 1000
        : Infinity;
      const crossed = timeMs >= finishTime;
      return {
        ...runner,
        distanceTraveled: crossed
          ? 2000
          : ease(runner.distanceTraveled, next.distanceTraveled),
        rank: crossed ? finish?.rank || next.rank : 0,
        progress: crossed ? 100 : ease(runner.progress, next.progress),
        lateralPosition: crossed
          ? next.lateralPosition
          : ease(runner.lateralPosition, next.lateralPosition),
        gapToLeader: 0,
        finishTimestamp: finish?.finishTime,
      };
    }),
  };
}
function consistentFrameAt(
  simulation: RaceSimulation,
  timeMs: number,
): RaceFrame {
  const frame = frameAt(simulation, timeMs);
  const leaderDistance = Math.max(
    ...frame.runners.map((r) => r.distanceTraveled),
  );
  const finishOrder = simulation.finalStandings.map((s) => s.horseId);
  const runners = frame.runners
    .map((r) => ({
      ...r,
      gapToLeader: Math.max(0, leaderDistance - r.distanceTraveled),
    }))
    .sort((a, b) => {
      const aFinished = a.distanceTraveled >= 2000,
        bFinished = b.distanceTraveled >= 2000;
      if (aFinished || bFinished)
        return aFinished && bFinished
          ? finishOrder.indexOf(a.horseId) - finishOrder.indexOf(b.horseId)
          : aFinished
            ? -1
            : 1;
      return b.distanceTraveled - a.distanceTraveled;
    })
    .map((r, index) => ({
      ...r,
      rank: index + 1,
      progress: r.distanceTraveled / 20,
    }));
  return { ...frame, runners };
}
function RaceBroadcastV2({
  setView,
  onRaceLocked,
}: {
  setView: (v: View) => void;
  onRaceLocked: () => void;
}) {
  const [time, setTime] = useState(0);
  const playbackTimeRef = useRef(0);
  const speedRef = useRef<1 | 2 | 4>(1);
  const pausedRef = useRef(false);
  const autoRef = useRef(true);
  const lastHudUpdateRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [auto, setAuto] = useState(true);
  const [simulation] = useState(() => {
    try {
      const saved = sessionStorage.getItem("derby-race-entry-lock");
      const parsed = saved ? JSON.parse(saved) : null;
      return buildRaceSimulation(parsed?.rngSeed || "SATSUKI-LOCKED");
    } catch {
      return buildRaceSimulation("SATSUKI-LOCKED");
    }
  });
  const currentFrame = consistentFrameAt(simulation, time);
  const playerFinalResult =
    simulation.finalStandings.find(
      (standing) => standing.horseId === simulation.playerHorseId,
    ) || simulation.finalStandings[0];
  const playerRunner =
    currentFrame.runners.find((r) => r.horseId === simulation.playerHorseId) ||
    currentFrame.runners[0];
  const ranking = currentFrame.runners.slice().sort((a, b) => a.rank - b.rank);
  const latestEvent =
    currentFrame.events[currentFrame.events.length - 1] || null;
  const directorSpeed = auto
    ? currentFrame.distanceRemaining <= 600 ||
      ["BLOCKED", "PATH_CLEAR", "OVERTAKE", "DUEL", "FINISH"].includes(
        latestEvent?.type || "START",
      ) ||
      currentFrame.phase === "FINAL_CORNER"
      ? 1
      : 2
    : speed;
  speedRef.current = speed;
  pausedRef.current = paused;
  autoRef.current = auto;
  useEffect(() => {
    let rafId: number | null = null;
    let previous = performance.now();
    let mounted = true;
    const tick = (now: number) => {
      if (!mounted) return;
      const deltaMs = Math.min(Math.max(0, now - previous), 250);
      previous = now;
      if (
        !pausedRef.current &&
        playbackTimeRef.current < simulation.durationMs
      ) {
        const current = consistentFrameAt(simulation, playbackTimeRef.current);
        const effectiveSpeed = autoRef.current
          ? current.distanceRemaining <= 600 ||
            ["BLOCKED", "PATH_CLEAR", "OVERTAKE", "DUEL", "FINISH"].includes(
              current.events.at(-1)?.type || "START",
            ) ||
            current.phase === "FINAL_CORNER"
            ? 1
            : 2
          : speedRef.current;
        playbackTimeRef.current = Math.min(
          simulation.durationMs,
          playbackTimeRef.current + deltaMs * effectiveSpeed,
        );
        if (
          now - lastHudUpdateRef.current >= 100 ||
          playbackTimeRef.current >= simulation.durationMs
        ) {
          lastHudUpdateRef.current = now;
          setTime(playbackTimeRef.current);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [simulation]);
  useEffect(() => {
    if (time >= simulation.durationMs) {
      setPaused(true);
      const id = window.setTimeout(() => setView("result"), 700);
      return () => window.clearTimeout(id);
    }
  }, [time, simulation.durationMs, setView]);
  const phase = currentFrame.phase;
  const phaseIndex = [
    "START",
    "MID",
    "FINAL_CORNER",
    "STRETCH",
    "FINISH",
  ].indexOf(phase);
  const distance = currentFrame.distanceRemaining;
  const eventType = latestEvent?.type || "START";
  const directorMode =
    eventType === "BLOCKED"
      ? "EVENT_FOCUS"
      : eventType === "PATH_CLEAR"
        ? "PLAYER_FOCUS"
        : eventType === "OVERTAKE" || eventType === "DUEL"
          ? "RIVAL_DUEL"
          : eventType === "FINISH"
            ? "PHOTO_FINISH"
            : distance <= 400
              ? "FINAL_STRETCH"
              : "NORMAL";
  const commentary =
    eventType === "BLOCKED"
      ? "앞이 막혔습니다."
      : eventType === "PATH_CLEAR"
        ? "바깥쪽으로 진로를 확보합니다."
        : eventType === "OVERTAKE"
          ? `${playerRunner.horseName}이 ${playerRunner.rank}위로 올라섭니다.`
          : eventType === "SPRINT_START"
            ? "직선에서 스퍼트를 시작합니다."
            : eventType === "FINISH"
              ? `${playerRunner.horseName}이 ${playerFinalResult.rank}착으로 통과합니다.`
              : "레이스가 진행 중입니다.";
  const reset = () => {
    setTime(0);
    setAuto(true);
    setSpeed(1);
    setPaused(false);
  };
  return (
    <FocusShell setView={setView}>
      <header className="race-broadcast-header">
        <div>
          <p className="ui-label text-muted-foreground">
            RACE VIEW · LIVE BROADCAST
          </p>
          <h1 className="ui-page-title mt-2 font-serif">
            사츠키상 <span className="text-primary">· G1</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            나카야마 · 잔디 2000m · 5두 출전
          </p>
        </div>
      </header>
      <div className="race-phase-strip">
        {["START", "MID", "FINAL_CORNER", "STRETCH", "FINISH"].map((p, i) => (
          <span key={p} className={i === phaseIndex ? "active" : ""}>
            {p.replace("_", " ")}
          </span>
        ))}
      </div>
      <main
        className={`race-broadcast-stage race-director-${directorMode.toLowerCase().replace("_", "-")}`}
      >
        <div className="race-stage-top">
          <span className="ui-label text-primary">LIVE TRACK VIEW</span>
          <span className="race-distance-live">
            {distance}m <small>REMAINING</small>
          </span>
        </div>
        <div className={`race-scene race-phase-${phaseIndex}`}>
          <div className="race-motion-lines" />
          <div className="race-track-grid" />
          <div
            className={`race-finish-band ${distance <= 400 ? "is-near" : ""} ${distance <= 100 ? "is-finish" : ""}`}
          />
          <div className="race-gate" />
          {currentFrame.runners.map((r) => (
            <div
              key={r.horseId}
              className={`race-broadcast-runner ${r.horseId === simulation.playerHorseId ? "player" : "rival"} ${r.rank === playerFinalResult.rank ? "is-player" : ""}`}
              style={
                {
                  "--runner-progress": `${r.progress}%`,
                  "--runner-lane": `${50 + r.lateralPosition}%`,
                } as CSSProperties
              }
            >
              <span className="runner-tag">
                <b>#{r.horseId}</b>
                {r.horseName}
                {r.horseId === simulation.playerHorseId && <em>YOU</em>}
              </span>
              <i />
            </div>
          ))}
          <div className="race-event-pop">
            <TriangleAlert size={16} />
            <span>{commentary}</span>
          </div>
        </div>
        <div className="race-stage-footer">
          <span>{distance}m remaining</span>
          <div className="race-progress-bar">
            <i style={{ width: `${(time / simulation.durationMs) * 100}%` }} />
          </div>
          <span>
            {distance <= 100
              ? "PHOTO FINISH"
              : distance <= 400
                ? "FINAL 400M"
                : ""}
          </span>
        </div>
      </main>
      <section className="race-live-grid">
        <div className="race-ranking-panel">
          <div className="panel-title">
            <IconLabel icon={Trophy}>LIVE RANKING</IconLabel>
            <span>
              {playerRunner.rank}위 / {currentFrame.runners.length}두
            </span>
          </div>
          {ranking.map((r) => (
            <div
              key={r.horseId}
              className={`race-rank-row ${r.horseId === simulation.playerHorseId ? "player" : ""}`}
            >
              <b>{r.rank}</b>
              <span>
                {r.horseName}{" "}
                {r.horseId === simulation.playerHorseId && <em>YOU</em>}
              </span>
              <i>
                <span style={{ width: `${Math.max(16, r.progress)}%` }} />
              </i>
            </div>
          ))}
        </div>
      </section>
      <footer className="race-control-deck">
        <button
          onClick={() => setPaused((v) => !v)}
          className="race-play-button"
        >
          {paused ? "계속" : "일시정지"}
        </button>
        <div className="race-speed-group">
          <span className="ui-metadata">PLAYBACK</span>
          {([1, 2, 4] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setSpeed(value);
                setAuto(false);
                setPaused(false);
              }}
              className={speed === value && !auto ? "active" : ""}
            >
              {value}x
            </button>
          ))}
          <button
            onClick={() => {
              setAuto((v) => !v);
              setPaused(false);
            }}
            className={auto ? "active" : ""}
          >
            AUTO
          </button>
        </div>
        <button
          onClick={() => setView("result")}
          className="ui-secondary-control rounded-lg border border-border px-3 py-2 text-xs"
        >
          결과로 건너뛰기
        </button>
      </footer>
    </FocusShell>
  );
}
function RaceExperimental({ setView }: { setView: (v: View) => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(true);
  const started = elapsed > 0;
  useEffect(() => {
    if (paused || elapsed >= 32) return;
    const id = window.setInterval(
      () => setElapsed((v) => Math.min(32, v + 0.05)),
      50,
    );
    return () => window.clearInterval(id);
  }, [paused, elapsed]);
  const t = elapsed;
  const phase =
    t < 4
      ? "START"
      : t < 14
        ? "MID"
        : t < 20
          ? "FINAL CORNER"
          : t < 29
            ? "STRETCH"
            : "FINISH";
  const distance = Math.max(0, Math.round(2000 - (t / 32) * 2000));
  const phases = [
    { time: 0, values: [0.08, 0.12, 0.16, 0.2, 0.24] },
    { time: 4, values: [0.2, 0.24, 0.13, 0.18, 0.1] },
    { time: 14, values: [0.43, 0.36, 0.48, 0.31, 0.26] },
    { time: 20, values: [0.64, 0.56, 0.69, 0.52, 0.48] },
    { time: 29, values: [0.91, 0.82, 0.87, 0.78, 0.76] },
    { time: 32, values: [1, 1, 0.98, 0.94, 0.92] },
  ];
  const sample = (index: number) => {
    let a = phases[0],
      b = phases[phases.length - 1];
    for (let i = 0; i < phases.length - 1; i++) {
      if (t >= phases[i].time && t <= phases[i + 1].time) {
        a = phases[i];
        b = phases[i + 1];
        break;
      }
    }
    const p = Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time || 1)));
    return a.values[index] + (b.values[index] - a.values[index]) * p;
  };
  const runners = [
    ["1", "천둥의 전설", "gold"],
    ["2", "블랙 윈드", "teal"],
    ["3", "골든 스톰", "slate"],
    ["4", "실버 레인", "teal"],
    ["5", "레드 애로우", "slate"],
  ];
  const rank = [...runners].sort(
    (a, b) => sample(runners.indexOf(b)) - sample(runners.indexOf(a)),
  );
  const playerRank = rank.findIndex((r) => r[1] === "천둥의 전설") + 1;
  const event =
    t < 4
      ? "게이트가 열렸습니다."
      : t < 9
        ? "선행 페이스 유지"
        : t < 14
          ? "앞이 막혔습니다."
          : t < 19
            ? "외곽 진로 확보"
            : t < 24
              ? "스퍼트 시작"
              : t < 29
                ? "3위로 올라섭니다."
                : "결승선을 2착으로 통과합니다.";
  return (
    <FocusShell setView={setView}>
      <div className="flex items-end justify-between">
        <div>
          <p className="ui-label text-primary">
            RACE VIEW EXPERIMENTAL · BROADCAST PROTOTYPE
          </p>
          <h1 className="ui-page-title mt-2 font-serif">사츠키상 · G1</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            잔디 2000m · 5 runners · deterministic simulation log
          </p>
        </div>
        <button
          onClick={() => {
            setElapsed(0);
            setPaused(true);
          }}
          className="ui-secondary-control rounded-lg border border-border px-3 py-2 text-xs"
        >
          Restart Race
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between border-y border-border py-2 text-xs">
        <span>
          <b className="text-primary">{phase}</b> · {distance}m remaining
        </span>
        <span>{playerRank}위 / 5두 · 선행 · 박성호</span>
      </div>
      <div
        className="race-broadcast mt-4"
        style={
          {
            "--race-progress": `${(t / 32) * 100}%`,
            "--race-zoom":
              phase === "START"
                ? ".86"
                : phase === "MID"
                  ? ".94"
                  : phase === "FINAL CORNER"
                    ? "1.02"
                    : phase === "STRETCH"
                      ? "1.12"
                      : "1.18",
          } as CSSProperties
        }
      >
        <div className="race-sky" />
        <div className="race-track">
          <div className="race-rail" />
          <div className="race-lane-line lane-one" />
          <div className="race-lane-line lane-two" />
          <div className="race-lane-line lane-three" />
          {runners.map(([number, name, color], i) => (
            <div
              key={name}
              className={`race-runner ${color} ${name === "천둥의 전설" ? "player" : ""}`}
              style={
                {
                  "--runner-progress": `${sample(i) * 100}%`,
                  "--runner-lateral": `${(i - 2) * 16}px`,
                } as CSSProperties
              }
            >
              <span className="race-marker">
                <b>{number}</b>
                <span>{name}</span>
              </span>
              <span className="race-shadow" />
            </div>
          ))}
          <div
            className={`finish-line ${phase === "FINISH" ? "visible" : ""}`}
          />
          <div className="gate-line" />
        </div>
        <div className="race-distance">{distance}m</div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_280px]">
        <div className="border-l-2 border-primary bg-accent/40 px-4 py-3 text-sm">
          <span className="ui-label text-primary">LIVE COMMENTARY</span>
          <p className="mt-2">{event}</p>
        </div>
        <div className="border border-border bg-card/30 px-4 py-3 text-xs">
          <div className="mb-2 flex justify-between text-muted-foreground">
            <span>LIVE RANKING</span>
            <span>{Math.round(elapsed)}s</span>
          </div>
          {rank.map((r, i) => (
            <div
              key={r[1]}
              className={`flex justify-between py-1 ${r[1] === "천둥의 전설" ? "text-primary font-medium" : ""}`}
            >
              <span>
                {i + 1} · {r[1]}
              </span>
              <span>{Math.round(sample(runners.indexOf(r)) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setPaused((v) => !v)}
          className="rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
        >
          {started && !paused ? "일��정지" : "레이스 시작"}
        </button>
        <button
          onClick={() => setView("raceplay")}
          className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
        >
          기존 Race View
        </button>
      </div>
    </FocusShell>
  );
}
function RaceFinish({ setView }: { setView: (v: View) => void }) {
  return (
    <Section eyebrow="FINISH" title="레이스가 끝났습니다.">
      <div className="flex flex-col gap-3">
        {[
          ["1위", "골든 스톰"],
          ["2위", "천둥의 전설"],
          ["3위", "블랙 윈드"],
          ["4위", "레드 애로우"],
        ].map(([rank, name]) => (
          <div
            key={rank}
            className={`flex justify-between border-b border-border py-3 ${name === "천둥의 전설" ? "font-serif text-lg text-primary" : ""}`}
          >
            <span>{rank}</span>
            <span>{name}</span>
          </div>
        ))}
      </div>
      <button
        onClick={() => setView("result")}
        className="mt-5 rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
      >
        결과 확인
      </button>
    </Section>
  );
}
function RaceResultLegacy({ setView }: { setView: (v: View) => void }) {
  const [simulation] = useState(() => {
    try {
      const saved = sessionStorage.getItem("derby-race-entry-lock");
      const parsed = saved ? JSON.parse(saved) : null;
      return buildRaceSimulation(parsed?.rngSeed || "SATSUKI-LOCKED");
    } catch {
      return buildRaceSimulation("SATSUKI-LOCKED");
    }
  });
  const result =
    simulation.finalStandings.find(
      (standing) => standing.horseId === simulation.playerHorseId,
    ) || simulation.finalStandings[0];
  const finalFrame = simulation.frames[simulation.frames.length - 1];
  const history = simulation.frames
    .filter((_, i) => [0, 2, 3, 5, 6].includes(i))
    .map((frame) => consistentFrameAt(simulation, frame.timeMs));
  const playerName =
    finalFrame.runners.find((r) => r.horseId === result.horseId)?.horseName ||
    "천둥의 전설";
  return (
    <FocusShell setView={setView}>
      <p className="ui-label text-primary">RACE RESULT</p>
      <h1 className="ui-page-title mt-2 font-serif">사츠키상 · G1</h1>
      <p className="mt-2 text-sm text-muted-foreground">2028년 4월 28일</p>
      <Section eyebrow="FINAL RESULT" title="결과 요약">
        <div className="ui-result-summary mt-4">
          <div>
            <span className="ui-label text-primary">RESULT</span>
            <p className="mt-2 font-serif text-3xl text-primary">
              {result.rank}착
            </p>
            <p className="mt-1 text-sm font-medium">{playerName}</p>
          </div>
          <div>
            <span className="ui-metadata">기록</span>
            <p className="mt-2 text-sm font-medium">
              {result.finishTime.toFixed(1)}s
            </p>
          </div>
          <div>
            <span className="ui-metadata">착차</span>
            <p className="mt-2 text-sm font-medium">
              +{result.marginToWinner.toFixed(1)}초
            </p>
          </div>
          <div>
            <span className="ui-metadata">획득 상금</span>
            <p className="mt-2 text-sm font-medium text-primary">
              ₩{(result.prize || 0).toLocaleString()}
            </p>
          </div>
        </div>
      </Section>
      <Section eyebrow="POSITION HISTORY" title="순위 변화">
        <div className="space-y-2">
          {history.map((frame) => (
            <div
              key={frame.timeMs}
              className="flex items-center gap-3 border-b border-border py-2 text-xs"
            >
              <span className="w-24 text-muted-foreground">{frame.phase}</span>
              <b>
                {
                  frame.runners.find(
                    (r) => r.horseId === simulation.playerHorseId,
                  )?.rank
                }
                위
              </b>
              <span className="flex-1 h-1 bg-muted">
                <i
                  className="block h-full bg-primary"
                  style={{
                    width: `${frame.runners.find((r) => r.horseId === simulation.playerHorseId)?.progress || 0}%`,
                  }}
                />
              </span>
              <span>{frame.distanceRemaining}m</span>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="RACE SUMMARY" title="경기 복기">
        <div className="space-y-2 text-sm">
          {simulation.frames
            .filter((frame) => frame.events.length > 0)
            .map((frame) => (
              <div
                key={frame.timeMs}
                className="flex gap-4 border-b border-border py-2"
              >
                <span className="w-28 text-xs text-muted-foreground">
                  {frame.phase}
                </span>
                <span>
                  {frame.events[0].type === "BLOCKED"
                    ? "앞이 막혀 잠시 전진이 정체되었습니다."
                    : frame.events[0].type === "PATH_CLEAR"
                      ? "외곽 진로를 확보했습니다."
                      : frame.events[0].type === "OVERTAKE"
                        ? "3위권 진입을 시도했습니다."
                        : frame.events[0].type === "SPRINT_START"
                          ? "직선에서 스퍼트를 시작했습니다."
                          : frame.events[0].type === "FINISH"
                            ? `1착과 ${result.marginToWinner.toFixed(1)}초 차 · ${result.rank}착`
                            : "안정적인 출발을 했습니다."}
                </span>
              </div>
            ))}
        </div>
      </Section>
      <button
        onClick={() => setView("training")}
        className="mt-4 rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
      >
        다음 달 시작
      </button>
    </FocusShell>
  );
}
function RaceResult({
  setView,
  state,
  onLock,
  onNext,
}: {
  setView: (v: View) => void;
  state: LifecycleState;
  onLock: (snapshot: PostRaceSnapshot) => void;
  onNext: () => void;
}) {
  const [simulation] = useState(() => {
    try {
      const saved = sessionStorage.getItem("derby-race-entry-lock");
      const parsed = saved ? JSON.parse(saved) : null;
      return buildRaceSimulation(parsed?.rngSeed || "SATSUKI-LOCKED");
    } catch {
      return buildRaceSimulation("SATSUKI-LOCKED");
    }
  });
  const result =
    simulation.finalStandings.find(
      (s) => s.horseId === simulation.playerHorseId,
    ) || simulation.finalStandings[0];
  const finalFrame = simulation.frames.at(-1)!;
  const playerName =
    finalFrame.runners.find((r) => r.horseId === result.horseId)?.horseName ||
    "천둥의 전설";
  const history = simulation.frames
    .filter((_, i) => [0, 2, 3, 5, 6].includes(i))
    .map((frame) => consistentFrameAt(simulation, frame.timeMs));
  const playerState = {
    prizeBefore: state.postRace?.before.prize ?? 218000000,
    recordBefore: state.postRace?.before.record ?? "12전 5승",
    fatigueBefore: state.postRace?.before.fatigue ?? 36,
    fatigueAfter: state.postRace?.after.fatigue ?? 61,
    bodyBefore: state.postRace?.before.bodyLoad ?? 48,
    bodyAfter: state.postRace?.after.bodyLoad ?? 66,
    conditionBefore: state.postRace?.before.condition ?? "좋음",
    conditionAfter: state.postRace?.after.condition ?? "보통",
  };
  useEffect(() => {
    if (!state.postRace) {
      onLock({
        raceId: "satsuki-2028",
        horseId: simulation.playerHorseId,
        prize: result.prize || 0,
        before: {
          record: playerState.recordBefore,
          prize: playerState.prizeBefore,
          fatigue: playerState.fatigueBefore,
          bodyLoad: playerState.bodyBefore,
          condition: playerState.conditionBefore,
          month: 4,
          year: 2028,
        },
        after: {
          record: "13전 5승",
          prize: playerState.prizeBefore + (result.prize || 0),
          fatigue: playerState.fatigueAfter,
          bodyLoad: playerState.bodyAfter,
          condition: playerState.conditionAfter,
          month: 4,
          year: 2028,
        },
        committed: false,
        operationId: "satsuki-2028-result-v1",
        recentActivityEntry: "4월 · 사츠키상 · 2착",
      });
    }
  }, [
    state.postRace,
    onLock,
    playerState,
    simulation.playerHorseId,
    result.prize,
  ]);
  const changes = [
    [
      "누적 상금",
      `₩${playerState.prizeBefore.toLocaleString()} → ₩${(playerState.prizeBefore + (result.prize || 0)).toLocaleString()}`,
      `+₩${(result.prize || 0).toLocaleString()}`,
      "",
    ],
    [
      "통산 전적",
      `${playerState.recordBefore} → ${Number(playerState.recordBefore.match(/\\d+/)?.[0] || 0) + 1}전 ${Number(playerState.recordBefore.match(/\\d+/g)?.[1] || 0) + (result.rank === 1 ? 1 : 0)}승`,
      "",
      "",
    ],
    [
      "피로",
      `${playerState.fatigueBefore} → ${playerState.fatigueAfter}`,
      `+${playerState.fatigueAfter - playerState.fatigueBefore}`,
      "",
    ],
    [
      "신체 부하",
      `${playerState.bodyBefore} → ${playerState.bodyAfter}`,
      `+${playerState.bodyAfter - playerState.bodyBefore}`,
      "",
    ],
    [
      "컨디션",
      `${playerState.conditionBefore} → ${playerState.conditionAfter}`,
      "",
      "",
    ],
  ];
  return (
    <FocusShell setView={setView}>
      <p className="ui-label text-primary">RACE RESULT</p>
      <h1 className="ui-page-title mt-2 font-serif">사츠키상 · G1</h1>
      <p className="mt-2 text-sm text-muted-foreground">2028년 4월 28일</p>
      <Section eyebrow="FINAL RESULT" title="결과 요약">
        <div className="ui-result-summary mt-4">
          <div>
            <span className="ui-label text-primary">RESULT</span>
            <p className="mt-2 font-serif text-3xl text-primary">
              {result.rank}착
            </p>
            <p className="mt-1 text-sm font-medium">{playerName}</p>
          </div>
          <div>
            <span className="ui-metadata">기록</span>
            <p className="mt-2 text-sm font-medium">
              {result.finishTime.toFixed(1)}s
            </p>
          </div>
          <div>
            <span className="ui-metadata">착차</span>
            <p className="mt-2 text-sm font-medium">
              +{result.marginToWinner.toFixed(1)}초
            </p>
          </div>
          <div>
            <span className="ui-metadata">획득 상금</span>
            <p className="mt-2 text-sm font-medium text-primary">
              ₩{(result.prize || 0).toLocaleString()}
            </p>
          </div>
        </div>
      </Section>
      <Section eyebrow="POSITION HISTORY" title="순위 변화">
        <div className="space-y-2">
          {history.map((frame) => (
            <div
              key={frame.timeMs}
              className="flex items-center gap-3 border-b border-border py-2 text-xs"
            >
              <span className="w-24 text-muted-foreground">{frame.phase}</span>
              <b>
                {
                  frame.runners.find(
                    (r) => r.horseId === simulation.playerHorseId,
                  )?.rank
                }
                위
              </b>
              <span className="flex-1 h-1 bg-muted">
                <i
                  className="block h-full bg-primary"
                  style={{
                    width: `${frame.runners.find((r) => r.horseId === simulation.playerHorseId)?.progress || 0}%`,
                  }}
                />
              </span>
              <span>{frame.distanceRemaining}m</span>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="CAREER / CONDITION" title="경기 후 상태 변화">
        <div className="grid gap-x-6 md:grid-cols-2">
          {changes
            .filter(([, value]) => value)
            .map(([label, value, delta]) => (
              <div key={label} className="border-b border-border py-3">
                <span className="ui-metadata">{label}</span>
                <p className="mt-1 text-sm font-medium">{value}</p>
                {delta && <span className="text-xs text-primary">{delta}</span>}
              </div>
            ))}
        </div>
        {playerState.bodyAfter >= 60 && (
          <p className="mt-3 text-xs text-rose">
            신체 부하가 높아졌습니다.
          </p>
        )}
      </Section>
      <Section eyebrow="RACE SUMMARY" title="경기 복기">
        <div className="space-y-2">
          {simulation.frames
            .filter((frame) => frame.events.length > 0)
            .map((frame) => (
              <div
                key={frame.timeMs}
                className="flex gap-4 border-b border-border py-2 text-sm"
              >
                <span className="w-28 text-xs text-muted-foreground">
                  {frame.phase}
                </span>
                <span>
                  {frame.events[0].type === "BLOCKED"
                    ? "앞이 막혀 잠시 전진이 정체되었습니다."
                    : frame.events[0].type === "PATH_CLEAR"
                      ? "외곽 진로를 확보했습니다."
                      : frame.events[0].type === "OVERTAKE"
                        ? "3위권 진입을 시도했습니다."
                        : frame.events[0].type === "SPRINT_START"
                          ? "직선에서 스퍼트를 시작했습니다."
                          : frame.events[0].type === "FINISH"
                            ? `${result.rank}착으로 결승선을 통과했습니다.`
                            : "안정적인 출발을 했습니다."}
                </span>
              </div>
            ))}
        </div>
      </Section>
      <button
        onClick={onNext}
        className="mt-5 rounded-lg bg-primary px-5 py-2 text-xs text-primary-foreground"
      >
        다음 달 시작
      </button>
    </FocusShell>
  );
}
function ArchivedHorseRecord({
  setView,
  horse,
}: {
  setView: (v: View) => void;
  horse: CareerHorse;
}) {
  return (
    <Management
      title={horse.name}
      eyebrow="HORSE RECORD · CAREER ARCHIVE"
      description="마구간에 보존된 은퇴 경주마의 기록입니다."
    >
      <button
        onClick={() => setView("stable")}
        className="mb-5 text-xs text-primary"
      >
        ← 마구간으로
      </button>
      <Section eyebrow="BASIC / CAREER" title="기본 정보 · 커리어">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <span className="ui-metadata">나이</span>
            <p className="mt-2">{horse.age}</p>
          </div>
          <div>
            <span className="ui-metadata">성별</span>
            <p className="mt-2">{horse.sex}</p>
          </div>
          <div>
            <span className="ui-metadata">성장형</span>
            <p className="mt-2">{horse.growth}</p>
          </div>
          <div>
            <span className="ui-metadata">은퇴 시점</span>
            <p className="mt-2">{horse.retiredAt || "기록 없음"}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <span className="ui-metadata">통산 전적</span>
            <p className="mt-2">{horse.record}</p>
          </div>
          <div>
            <span className="ui-metadata">최고 성적</span>
            <p className="mt-2">{horse.best}</p>
          </div>
          <div>
            <span className="ui-metadata">누적 상금</span>
            <p className="mt-2">{horse.prize}</p>
          </div>
        </div>
      </Section>
      <Section eyebrow="FINAL ABILITIES" title="최종 능력치">
        <div className="grid gap-2 md:grid-cols-5">
          {horse.stats.map(([label, value]) => (
            <div key={label} className="border-b border-border py-3">
              <span className="ui-metadata">{label}</span>
              <b className="mt-2 block text-primary">{value}</b>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="APTITUDE" title="적성">
        <div className="grid gap-2 md:grid-cols-4">
          {horse.aptitude.map(([group, label, grade]) => (
            <div
              key={group + label}
              className="flex justify-between border-b border-border py-2 text-sm"
            >
              <span>
                {group} · {label}
              </span>
              <b className="text-primary">{grade}</b>
            </div>
          ))}
        </div>
      </Section>
      <ArchivedHorseHistory horse={horse} />
    </Management>
  );
}
function ArchivedHorseHistory({ horse }: { horse: CareerHorse }) {
  const records = horse.raceRecords ?? [];
  const relations = Array.from(
    records.reduce((map, r) => {
      if (!r.jockeyId) return map;
      const entry = map.get(r.jockeyId) ?? { name: r.jockeyName ?? r.jockeyId, starts: 0, best: 99 };
      entry.starts += 1;
      const place = r.placing ?? Number(r.result.match(/^(\d+)/)?.[1] ?? 99);
      entry.best = Math.min(entry.best, place || 99);
      return map.set(r.jockeyId, entry);
    }, new Map<string, { name: string; starts: number; best: number }>()),
  );
  const timeline = [
    ["육성 시작", "육성을 시작했습니다"],
    ...records.slice(0, 4).map((r) => [r.date, `${r.race} ${r.result}`]),
    [horse.retiredAt || "은퇴", "은퇴"],
  ];
  return (
    <>
      <Section eyebrow="RACE RECORD" title="출전 기록">
        {records.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">출전 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[680px] grid-cols-[80px_1.4fr_60px_70px_1fr_60px_1fr] gap-2 border-b border-border px-3 pb-2 text-[10px] text-muted-foreground">
              <span>날짜</span><span>경주</span><span>등급</span><span>거리</span><span>기수</span><span>결과</span><span>상금</span>
            </div>
            {records.map((r, i) => (
              <div key={r.raceRunId ?? `${r.date}-${i}`} className="grid min-w-[680px] grid-cols-[80px_1.4fr_60px_70px_1fr_60px_1fr] gap-2 border-b border-border px-3 py-2.5 text-xs">
                <span className="tabular-nums text-muted-foreground">{r.date}</span>
                <span className="font-serif">{r.race}</span>
                <span>{r.grade ?? "—"}</span>
                <span className="tabular-nums">{r.distance ? `${r.distance}m` : "—"}</span>
                <span>{r.jockeyName ?? "—"}</span>
                <span className="text-primary">{r.result}</span>
                <span className="tabular-nums">{r.prizeMoney !== undefined ? `₩${r.prizeMoney.toLocaleString("ko-KR")}` : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section eyebrow="JOCKEY RELATIONSHIPS" title="함께한 기수">
        {relations.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">함께한 기수 기록이 없습니다.</p>
        ) : (
          <div className="grid gap-x-6 md:grid-cols-2">
            {relations.map(([id, r]) => (
              <div key={id} className="flex items-center justify-between border-b border-border py-2.5 text-xs">
                <b className="font-serif text-sm">{r.name}</b>
                <span className="text-muted-foreground">
                  {r.starts}전 · Chemistry {jockeys.find((j) => j.id === id)?.chem ?? "—"} · 최고 {r.best === 99 ? "—" : `${r.best}착`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section eyebrow="CAREER TIMELINE" title="커리어 타임라인">
        <ol>
          {timeline.map(([when, what], i) => (
            <li key={`${when}-${i}`} className="flex gap-4 border-b border-border py-2 text-xs last:border-b-0">
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{when}</span>
              <span>{what}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
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
  const selectHorse = (horse: CareerHorse) => {
    setState((current) => ({
      ...current,
      activeHorse: {
        ...horse,
        record: "0전 0승",
        prize: "₩0",
        fatigue: 5,
        bodyLoad: 5,
        condition: "보통",
        raceRecords: [],
      },
      lifecycleView: "home",
    }));
    setView("home");
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
  const advanceMonth = () => {
    setState((current) => {
      if (!current.postRace || current.postRace.committed) return current;
      const snapshot = current.postRace;
      const horse = current.activeHorse;
      if (!horse) return current;
      const next = monthAfter(current.year, current.month);
      const prizeText = `₩${snapshot.after.prize.toLocaleString()}`;
      const afterHorse = {
        ...horse,
        ...summarizeRecords(horse.raceRecords),
        fatigue: snapshot.after.fatigue,
        bodyLoad: snapshot.after.bodyLoad,
        condition: snapshot.after.condition,
        raceRecords: horse.raceRecords || [],
      };
      const nextState = {
        ...current,
        activeHorse: afterHorse,
        funds: `₩${(Number(current.funds.replace(/[^0-9]/g, "")) + snapshot.prize).toLocaleString()}`,
        year: next.year,
        month: next.month,
        recentActivity: [
          snapshot.recentActivityEntry,
          ...current.recentActivity,
        ].slice(0, 3),
        postRace: { ...snapshot, committed: true },
        lifecycleView: "home" as const,
      };
      if (process.env.NODE_ENV === "development") {
        const record = parseRecord(afterHorse.record);
        if (
          afterHorse.record !== snapshot.after.record ||
          afterHorse.prize !== prizeText ||
          afterHorse.fatigue !== snapshot.after.fatigue ||
          afterHorse.bodyLoad !== snapshot.after.bodyLoad ||
          afterHorse.condition !== snapshot.after.condition
        )
          console.warn("[v0] post-race state mismatch");
        if (
          nextState.month === current.month &&
          nextState.year === current.year
        )
          console.warn("[v0] month did not advance");
      }
      return nextState;
    });
    setView("training");
  };
  const lockPostRace = (snapshot: PostRaceSnapshot) =>
    setState((current) =>
      current.postRace ? current : { ...current, postRace: snapshot },
    );
  const commitRaceAndAdvance = () => {
    setState((current) => {
      const snapshot = current.postRace;
      if (!snapshot || snapshot.committed) return current;
      const nextMonth = current.month === 12 ? 1 : current.month + 1;
      const nextYear = current.month === 12 ? current.year + 1 : current.year;
      const horse = current.activeHorse;
      if (!horse) return current;
      const updatedHorse = {
        ...horse,
        ...summarizeRecords(horse.raceRecords),
        fatigue: snapshot.after.fatigue,
        bodyLoad: snapshot.after.bodyLoad,
        condition: snapshot.after.condition,
        raceRecords: horse.raceRecords || [],
      };
      return {
        ...current,
        activeHorse: updatedHorse,
        funds: `₩${(Number(current.funds.replace(/[^0-9]/g, "")) + snapshot.prize).toLocaleString()}`,
        month: nextMonth,
        year: nextYear,
        recentActivity: [
          snapshot.recentActivityEntry,
          ...current.recentActivity,
        ].slice(0, 3),
        postRace: { ...snapshot, committed: true },
        lifecycleView: "home",
      };
    });
    setView("training");
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
