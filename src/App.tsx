import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  format, 
  getDaysInMonth, 
  getDay, 
  getDayOfYear, 
  getDaysInYear, 
  addMonths, 
  subMonths 
} from 'date-fns';
import { 
  Check, 
  ChevronLeft, 
  ChevronRight, 
  Settings, 
  RefreshCw, 
  X, 
  ExternalLink, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle,
  CalendarDays,
  CalendarRange,
  LayoutGrid
} from 'lucide-react';
import Holidays from 'date-holidays';
import type { HabitRecord, GitHubConfig } from './types';
import { 
  getGitHubConfig, 
  saveGitHubConfig, 
  getMonthHabitsFromGitHub, 
  getYearHabitsFromGitHub,
  toggleOrCreateHabitOnGitHub 
} from './github';

const hdMY = new Holidays('MY');
const hdAU = new Holidays('AU', 'VIC');

function getMYPublicHoliday(d: Date) {
  const list = hdMY.isHoliday(d);
  if (!list) return false;
  const filtered = list.filter((h: any) => h.type === 'public');
  return filtered.length > 0 ? filtered : false;
}

function getAUPublicHoliday(d: Date) {
  const list = hdAU.isHoliday(d);
  if (!list) return false;
  const filtered = list.filter((h: any) => h.type === 'public');
  return filtered.length > 0 ? filtered : false;
}

const PREFERRED_ORDER = ["Meditation", "Exercise", "Reading", "Flying", "Others"];

const BIRTHDAYS: Record<string, string[]> = {
  '01-04': ['ping'],
  '01-20': ['ismail'],
  '01-30': ['dad'],
  '02-19': ['mum'],
  '05-02': ['jun'],
  '05-18': ['soh'],
  '05-19': ['na', 'bernard'],
  '06-10': ['bebo'],
  '06-23': ['shang yuan'],
  '08-10': ['qin'],
  '09-12': ['me'],
};

function getBirthdays(d: Date): string[] {
  const md = format(d, 'MM-dd');
  return BIRTHDAYS[md] || [];
}

function isMYSchoolHoliday(d: Date): boolean {
  if (d.getFullYear() !== 2026) return false;
  const yyyymmdd = parseInt(format(d, 'yyyyMMdd'));
  if (yyyymmdd >= 20260101 && yyyymmdd <= 20260110) return true;
  if (yyyymmdd >= 20260320 && yyyymmdd <= 20260328) return true;
  if (yyyymmdd >= 20260522 && yyyymmdd <= 20260606) return true;
  if (yyyymmdd >= 20260828 && yyyymmdd <= 20260905) return true;
  if (yyyymmdd >= 20261204 && yyyymmdd <= 20261231) return true;
  return false;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const YEAR_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS_LIST = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export default function App() {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [habits, setHabits] = useState<HabitRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // View state: 'calendar' (Month), 'year' (Yearly 12-month dashboard), or 'table' (Matrix)
  const [viewMode, setViewMode] = useState<'calendar' | 'year' | 'table'>(() => {
    return (localStorage.getItem('logseq_habit_view_mode') as any) || 'calendar';
  });

  // Selected habit in calendar / yearly view ('all' or specific habit name)
  const [selectedHabit, setSelectedHabit] = useState<string>('all');
  const [selectedYearlyHabit, setSelectedYearlyHabit] = useState<string>('Meditation');

  // Day detail / check sheet modal
  const [daySheetDate, setDaySheetDate] = useState<number | null>(null);
  const [detailModal, setDetailModal] = useState<{ title: string; content: string } | null>(null);

  // Table compact zoom state
  const [compactTable, setCompactTable] = useState<boolean>(false);

  // Settings Form State
  const [config, setConfig] = useState<GitHubConfig>(getGitHubConfig());
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Date and Progress calculations
  const now = new Date();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const daysInMonth = getDaysInMonth(currentDate);
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  // Calendar month grid starting day (0 = Sun, 1 = Mon...)
  const firstDayOfMonth = useMemo(() => getDay(new Date(year, month - 1, 1)), [year, month]);
  const emptyPaddingDays = useMemo(() => Array.from({ length: firstDayOfMonth }, (_, i) => i), [firstDayOfMonth]);

  const currentYear = now.getFullYear();
  const isCurrentYear = year === currentYear;
  const isPastYear = year < currentYear;
  const daysInYear = getDaysInYear(new Date(year, 0, 1));
  let yearProgressPercent = 0;
  if (isCurrentYear) {
    const dayOfYear = getDayOfYear(now);
    yearProgressPercent = (dayOfYear / daysInYear) * 100;
  } else if (isPastYear) {
    yearProgressPercent = 100;
  }

  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === currentDate.getMonth();
  const isPastMonth = currentDate < now && !isCurrentMonth;
  const progressPercent = isCurrentMonth ? (now.getDate() / daysInMonth) * 100 : (isPastMonth ? 100 : 0);

  // Save view mode preference
  const handleSetViewMode = (mode: 'calendar' | 'year' | 'table') => {
    setViewMode(mode);
    localStorage.setItem('logseq_habit_view_mode', mode);
  };

  // Load habits from GitHub
  const loadHabits = useCallback(async (forceRefresh = false) => {
    if (!config.token) {
      setShowSettings(true);
      return;
    }

    if (forceRefresh) {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('logseq_habit_cache_')) {
          localStorage.removeItem(key);
        }
      });
    }

    setLoading(true);
    setErrorMsg('');
    try {
      if (viewMode === 'year') {
        const records = await getYearHabitsFromGitHub(year, msg => setStatusMsg(msg));
        setHabits(records);
      } else {
        const records = await getMonthHabitsFromGitHub(year, month, msg => setStatusMsg(msg));
        setHabits(records);
      }
      setStatusMsg('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to load habit journals from GitHub.');
    } finally {
      setLoading(false);
    }
  }, [config.token, year, month, viewMode]);

  useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  // Habit Toggle Handler with Optimistic UI & Auto-Create on untracked days
  const handleToggleHabit = async (habitName: string, day: number, overrideMonth?: number) => {
    const m = overrideMonth || month;
    const targetDateInt = parseInt(`${year}${m.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`);
    const record = habits.find(h => h.name === habitName && h.date === targetDateInt);
    const newCompleted = record ? !record.completed : true;

    // Optimistic UI update
    if (record) {
      setHabits(prev =>
        prev.map(h => (h.id === record.id ? { ...h, completed: newCompleted } : h))
      );
    } else {
      const optimisticRecord: HabitRecord = {
        id: `${targetDateInt}_${habitName}`,
        name: habitName,
        date: targetDateInt,
        completed: true,
        marker: 'DONE',
        content: `- DONE ${habitName} #habit-tracker`,
      };
      setHabits(prev => [...prev, optimisticRecord]);
    }

    try {
      const updated = await toggleOrCreateHabitOnGitHub(targetDateInt, habitName, newCompleted, record);
      setHabits(prev => {
        const exists = prev.some(h => h.id === updated.id);
        if (exists) {
          return prev.map(h => (h.id === updated.id ? updated : h));
        } else {
          return [...prev, updated];
        }
      });
    } catch (err: any) {
      alert(`Sync failed: ${err.message}`);
      // Revert optimistic update
      if (record) {
        setHabits(prev =>
          prev.map(h => (h.id === record.id ? { ...h, completed: record.completed } : h))
        );
      } else {
        setHabits(prev => prev.filter(h => h.id !== `${targetDateInt}_${habitName}`));
      }
    }
  };

  // Unique habit names sorted by preference
  const uniqueHabitNames = useMemo(() => {
    return Array.from(new Set([...PREFERRED_ORDER, ...habits.map(h => h.name).filter(Boolean) as string[]])).sort((a, b) => {
      const idxA = PREFERRED_ORDER.indexOf(a);
      const idxB = PREFERRED_ORDER.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [habits]);

  // Default yearly selected habit
  useEffect(() => {
    if (uniqueHabitNames.length > 0 && !uniqueHabitNames.includes(selectedYearlyHabit)) {
      setSelectedYearlyHabit(uniqueHabitNames[0]);
    }
  }, [uniqueHabitNames, selectedYearlyHabit]);

  // Calculate habit stats for active month
  const habitStats = useMemo(() => {
    const stats: Record<string, number> = {};
    uniqueHabitNames.forEach(hName => {
      let count = 0;
      daysArray.forEach(d => {
        const dInt = parseInt(`${year}${month.toString().padStart(2, '0')}${d.toString().padStart(2, '0')}`);
        const rec = habits.find(h => h.name === hName && h.date === dInt);
        if (rec?.completed) count++;
      });
      stats[hName] = count;
    });
    return stats;
  }, [uniqueHabitNames, habits, daysArray, year, month]);

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    saveGitHubConfig(config);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      setShowSettings(false);
      loadHabits(true);
    }, 600);
  };

  // Day bottom sheet helpers
  const selectedDayObj = useMemo(() => {
    if (!daySheetDate) return null;
    const dayStr = daySheetDate.toString();
    const dYear = parseInt(dayStr.substring(0, 4));
    const dMonth = parseInt(dayStr.substring(4, 6)) - 1;
    const dDay = parseInt(dayStr.substring(6, 8));
    return new Date(dYear, dMonth, dDay);
  }, [daySheetDate]);

  return (
    <div 
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 flex flex-col font-sans select-none"
    >
      {/* Top Navbar */}
      <header 
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}
        className="sticky top-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 px-4 pb-3 shadow-sm"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xl">📅</span>
            <span className="font-bold text-base tracking-tight text-gray-900 dark:text-white">
              Habits
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {/* View Mode Switcher: Month | Year | Table */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-0.5 rounded-xl border border-gray-200 dark:border-gray-700">
              <button
                onClick={() => handleSetViewMode('calendar')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  viewMode === 'calendar'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                title="Month Calendar View"
              >
                <CalendarDays size={14} />
                <span className="hidden xs:inline">Month</span>
              </button>
              <button
                onClick={() => handleSetViewMode('year')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  viewMode === 'year'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                title="Yearly Dashboard (12-Month Calendar)"
              >
                <CalendarRange size={14} />
                <span className="hidden xs:inline">Year</span>
              </button>
              <button
                onClick={() => handleSetViewMode('table')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                title="Matrix Table View"
              >
                <LayoutGrid size={14} />
                <span className="hidden xs:inline">Table</span>
              </button>
            </div>

            <button
              onClick={() => loadHabits(true)}
              disabled={loading}
              title="Refresh from GitHub"
              className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <RefreshCw size={17} className={loading ? 'animate-spin text-blue-500' : ''} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              title="GitHub Settings"
              className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Settings size={17} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-2.5 sm:p-5 flex flex-col safe-bottom">
        {/* Error Banner */}
        {errorMsg && (
          <div className="mb-3 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm flex items-start space-x-3">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-xs sm:text-sm">Unable to fetch from GitHub</p>
              <p className="mt-0.5 text-[11px] sm:text-xs">{errorMsg}</p>
              <button
                onClick={() => setShowSettings(true)}
                className="mt-1.5 text-xs font-bold underline hover:text-red-800 dark:hover:text-red-200"
              >
                Open Settings to check Token & Repo
              </button>
            </div>
          </div>
        )}

        {/* Dashboard Card */}
        <div className="w-full bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col overflow-hidden">
          {/* Header Controls */}
          <div className="p-3.5 sm:p-5 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2 sm:space-x-3">
                <button
                  onClick={() => {
                    if (viewMode === 'year') {
                      setCurrentDate(prev => new Date(prev.getFullYear() - 1, 0, 1));
                    } else {
                      setCurrentDate(prev => subMonths(prev, 1));
                    }
                  }}
                  className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors active:scale-95"
                  aria-label="Previous"
                >
                  <ChevronLeft size={20} className="text-gray-600 dark:text-gray-400" />
                </button>

                {/* Clickable Date Picker Heading */}
                <div className="relative group flex flex-col items-center">
                  <input
                    type="date"
                    value={format(currentDate, 'yyyy-MM-dd')}
                    onChange={e => {
                      if (e.target.value) {
                        setCurrentDate(new Date(e.target.value));
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    title="Click to jump to any date"
                  />
                  <h2 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100 min-w-[150px] sm:min-w-[190px] text-center leading-tight group-hover:text-blue-500 transition-colors">
                    {viewMode === 'year' ? `${year} Dashboard` : format(currentDate, 'MMMM yyyy')}
                  </h2>
                  <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 mt-1 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${viewMode === 'year' ? yearProgressPercent : progressPercent}%` }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (viewMode === 'year') {
                      setCurrentDate(prev => new Date(prev.getFullYear() + 1, 0, 1));
                    } else {
                      setCurrentDate(prev => addMonths(prev, 1));
                    }
                  }}
                  className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors active:scale-95"
                  aria-label="Next"
                >
                  <ChevronRight size={20} className="text-gray-600 dark:text-gray-400" />
                </button>
              </div>

              {/* Jump to Today Button */}
              <button
                onClick={() => setCurrentDate(new Date())}
                className="text-xs font-semibold px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                Today
              </button>
            </div>

            {/* Year Progress Bar */}
            <div className="w-full group cursor-default">
              <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">
                  Year Progress ({year})
                </span>
                <span className="text-xs font-bold text-red-500 dark:text-red-400">
                  {Math.round(yearProgressPercent)}% passed
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all duration-1000"
                  style={{ width: `${yearProgressPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* Loading status bar */}
          {loading && (
            <div className="px-4 py-1.5 bg-blue-50/60 dark:bg-blue-950/30 text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-2 border-b border-gray-100 dark:border-gray-800">
              <RefreshCw size={12} className="animate-spin" />
              <span>{statusMsg || 'Loading journal records...'}</span>
            </div>
          )}

          {/* ========================================================================= */}
          {/* VIEW 1: MONTH CALENDAR VIEW (FULL MONTH VISIBLE WITHOUT HORIZONTAL SCROLL) */}
          {/* ========================================================================= */}
          {viewMode === 'calendar' && (
            <div className="p-3 sm:p-5 flex flex-col">
              {/* Habit Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-3 mb-2">
                <button
                  onClick={() => setSelectedHabit('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    selectedHabit === 'all'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                  }`}
                >
                  All Habits (Overview)
                </button>
                {uniqueHabitNames.map(name => (
                  <button
                    key={name}
                    onClick={() => setSelectedHabit(name)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      selectedHabit === name
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                    }`}
                  >
                    <span>{name}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-black/10 dark:bg-white/10 font-bold">
                      {habitStats[name] || 0}/{daysInMonth}
                    </span>
                  </button>
                ))}
              </div>

              {/* Subtitle helper */}
              <div className="text-[11px] text-gray-500 mb-2 px-1 flex items-center justify-between">
                <span>
                  {selectedHabit === 'all'
                    ? 'Tap any day to see or check off habits for that date'
                    : `Showing full month for ${selectedHabit}. Tap any day to toggle!`}
                </span>
                {selectedHabit !== 'all' && (
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {Math.round(((habitStats[selectedHabit] || 0) / daysInMonth) * 100)}% done
                  </span>
                )}
              </div>

              {/* Weekday Labels (Sun to Sat) */}
              <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center mb-1">
                {WEEKDAYS.map((wd, idx) => (
                  <div
                    key={wd}
                    className={`text-[11px] font-bold uppercase py-1 ${
                      idx === 0 || idx === 6
                        ? 'text-gray-400 dark:text-gray-500'
                        : 'text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {wd}
                  </div>
                ))}
              </div>

              {/* 7-Column Calendar Grid */}
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {emptyPaddingDays.map(i => (
                  <div key={`empty-${i}`} className="aspect-square rounded-xl bg-transparent" />
                ))}

                {daysArray.map(day => {
                  const dateObj = new Date(year, month - 1, day);
                  const targetDateInt = parseInt(`${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`);
                  const isWeekend = getDay(dateObj) === 0 || getDay(dateObj) === 6;
                  const isToday = now.getFullYear() === year && now.getMonth() === month - 1 && now.getDate() === day;

                  const myHolidays = getMYPublicHoliday(dateObj);
                  const auHolidays = getAUPublicHoliday(dateObj);
                  const mySchoolHolidays = isMYSchoolHoliday(dateObj);
                  const bdays = getBirthdays(dateObj);

                  const singleRecord = selectedHabit !== 'all' 
                    ? habits.find(h => h.name === selectedHabit && h.date === targetDateInt)
                    : null;
                  const isSingleCompleted = singleRecord?.completed;

                  let completedCountForDay = 0;
                  let totalHabitsForDay = 0;
                  uniqueHabitNames.forEach(hName => {
                    const r = habits.find(h => h.name === hName && h.date === targetDateInt);
                    if (r) {
                      totalHabitsForDay++;
                      if (r.completed) completedCountForDay++;
                    }
                  });

                  return (
                    <div
                      key={day}
                      onClick={() => {
                        if (selectedHabit === 'all') {
                          setDaySheetDate(targetDateInt);
                        } else {
                          handleToggleHabit(selectedHabit, day);
                        }
                      }}
                      className={`aspect-square rounded-xl p-1 sm:p-2 flex flex-col justify-between relative overflow-hidden transition-all cursor-pointer active:scale-95 ${
                        isToday ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-900' : ''
                      } ${
                        selectedHabit !== 'all'
                          ? isSingleCompleted
                            ? 'bg-green-500 text-white font-bold shadow-sm'
                            : singleRecord
                            ? 'bg-gray-100 dark:bg-gray-800/80 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                            : isWeekend
                            ? 'bg-gray-100/50 dark:bg-gray-800/30 text-gray-400'
                            : 'bg-gray-50 dark:bg-gray-900/40 text-gray-400'
                          : completedCountForDay > 0 && completedCountForDay === totalHabitsForDay
                          ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'
                          : isWeekend
                          ? 'bg-gray-100/70 dark:bg-gray-800/50'
                          : 'bg-gray-50/80 dark:bg-gray-800/20 border border-gray-100 dark:border-gray-800'
                      }`}
                    >
                      {mySchoolHolidays && (
                        <span className="absolute inset-0 flex items-center justify-center text-green-500/20 text-3xl sm:text-4xl leading-none select-none z-0 pointer-events-none mt-1">
                          ■
                        </span>
                      )}
                      {myHolidays && (
                        <span className="absolute inset-0 flex items-center justify-center text-yellow-500/75 text-2xl sm:text-3xl leading-none select-none z-0 pointer-events-none">
                          ★
                        </span>
                      )}
                      {auHolidays && (
                        <span className="absolute inset-0 flex items-center justify-center text-blue-500/75 text-2xl sm:text-3xl leading-none select-none z-0 pointer-events-none">
                          ●
                        </span>
                      )}

                      <div className="flex items-center justify-between w-full relative z-10">
                        <span
                          className={`text-xs sm:text-sm font-bold ${
                            isSingleCompleted ? 'text-white' : isToday ? 'text-blue-600 dark:text-blue-400' : ''
                          }`}
                        >
                          {day}
                        </span>
                        {bdays.length > 0 && (
                          <span className="text-[10px] leading-none" title={bdays.join(', ')}>
                            🎂
                          </span>
                        )}
                      </div>

                      <div className="w-full flex items-center justify-center relative z-10 mt-auto">
                        {selectedHabit !== 'all' ? (
                          isSingleCompleted ? (
                            <Check size={16} strokeWidth={3} className="text-white" />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                          )
                        ) : (
                          totalHabitsForDay > 0 ? (
                            <span
                              className={`text-[9px] sm:text-[10px] font-bold px-1.5 py-0.2 rounded-md ${
                                completedCountForDay === totalHabitsForDay
                                  ? 'bg-green-500 text-white'
                                  : completedCountForDay > 0
                                  ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                              }`}
                            >
                              {completedCountForDay}/{totalHabitsForDay}
                            </span>
                          ) : (
                            <span className="text-[9px] text-gray-300 dark:text-gray-600">-</span>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* VIEW 2: YEARLY DASHBOARD VIEW (12-MONTH OVERVIEW LIKE LOGSEQ PLUGIN) */}
          {/* ========================================================================= */}
          {viewMode === 'year' && (
            <div className="p-3 sm:p-5 flex flex-col">
              {/* Habit Selector for Yearly View */}
              <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-3 mb-4">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider shrink-0">
                  Select Habit:
                </span>
                {uniqueHabitNames.map(name => {
                  let yearCompleted = 0;
                  habits.forEach(h => {
                    if (h.name === name && h.completed) yearCompleted++;
                  });

                  return (
                    <button
                      key={name}
                      onClick={() => setSelectedYearlyHabit(name)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                        selectedYearlyHabit === name
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      <span>{name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-black/10 dark:bg-white/10 font-bold">
                        {yearCompleted}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 12 Months Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                {MONTHS_LIST.map(monthIndex => {
                  const monthDate = new Date(year, monthIndex, 1);
                  const monthName = format(monthDate, 'MMMM');
                  const daysInM = getDaysInMonth(monthDate);
                  const firstDayOfWeek = getDay(monthDate);
                  const monthDaysArray = Array.from({ length: daysInM }, (_, i) => i + 1);
                  const emptyPaddings = Array.from({ length: firstDayOfWeek }, (_, i) => i);

                  let completedInMonth = 0;
                  let trackedInMonth = 0;
                  monthDaysArray.forEach(d => {
                    const dInt = parseInt(`${year}${(monthIndex + 1).toString().padStart(2, '0')}${d.toString().padStart(2, '0')}`);
                    const rec = habits.find(h => h.name === selectedYearlyHabit && h.date === dInt);
                    if (rec) {
                      trackedInMonth++;
                      if (rec.completed) completedInMonth++;
                    }
                  });

                  return (
                    <div
                      key={monthIndex}
                      className="bg-gray-50 dark:bg-gray-800/40 rounded-2xl p-4 border border-gray-100 dark:border-gray-800 flex flex-col"
                    >
                      {/* Month Card Header */}
                      <div className="flex justify-between items-center mb-3">
                        <button
                          onClick={() => {
                            setCurrentDate(new Date(year, monthIndex, 1));
                            handleSetViewMode('calendar');
                          }}
                          className="text-base font-bold text-gray-800 dark:text-gray-200 hover:text-blue-500 flex items-center gap-1 transition-colors"
                        >
                          {monthName}
                        </button>
                        <span className="text-xs font-semibold px-2 py-0.5 bg-white dark:bg-gray-900 rounded-md text-gray-500 border border-gray-200 dark:border-gray-700">
                          {completedInMonth}/{daysInM}
                        </span>
                      </div>

                      {/* Weekday Initials */}
                      <div className="grid grid-cols-7 gap-1 mb-1 text-center">
                        {YEAR_WEEKDAYS.map((wd, i) => (
                          <div key={`ywd-${i}`} className="text-[10px] font-bold text-gray-400">
                            {wd}
                          </div>
                        ))}
                      </div>

                      {/* Month Days Grid */}
                      <div className="grid grid-cols-7 gap-1">
                        {emptyPaddings.map(i => (
                          <div key={`yempty-${i}`} className="aspect-square" />
                        ))}

                        {monthDaysArray.map(d => {
                          const targetDateInt = parseInt(`${year}${(monthIndex + 1).toString().padStart(2, '0')}${d.toString().padStart(2, '0')}`);
                          const record = habits.find(h => h.name === selectedYearlyHabit && h.date === targetDateInt);
                          const isCompleted = record?.completed;
                          const dateObj = new Date(year, monthIndex, d);
                          const isWeekend = getDay(dateObj) === 0 || getDay(dateObj) === 6;

                          const myHolidays = getMYPublicHoliday(dateObj);
                          const auHolidays = getAUPublicHoliday(dateObj);
                          const mySchoolHolidays = isMYSchoolHoliday(dateObj);
                          const bdays = getBirthdays(dateObj);

                          return (
                            <div
                              key={d}
                              onClick={() => handleToggleHabit(selectedYearlyHabit, d, monthIndex + 1)}
                              className={`aspect-square rounded flex items-center justify-center text-xs font-medium transition-all relative overflow-hidden cursor-pointer active:scale-90 ${
                                !record
                                  ? isWeekend
                                    ? 'bg-gray-300/40 dark:bg-gray-700/40 text-gray-400'
                                    : 'bg-transparent text-gray-300 dark:text-gray-600'
                                  : isCompleted
                                  ? 'bg-green-500 text-white font-bold shadow-sm'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                              }`}
                              title={`${monthName} ${d}: ${isCompleted ? 'Completed' : 'Missed'}`}
                            >
                              <span className="relative z-10 text-[11px]">{d}</span>
                              {mySchoolHolidays && (
                                <span className="absolute inset-0 flex items-center justify-center text-green-500/20 text-2xl leading-none select-none z-0 pointer-events-none mt-0.5">
                                  ■
                                </span>
                              )}
                              {myHolidays && (
                                <span className="absolute inset-0 flex items-center justify-center text-yellow-500/75 text-lg leading-none select-none z-0 pointer-events-none">
                                  ★
                                </span>
                              )}
                              {auHolidays && (
                                <span className="absolute inset-0 flex items-center justify-center text-blue-500/75 text-lg leading-none select-none z-0 pointer-events-none">
                                  ●
                                </span>
                              )}
                              {bdays.length > 0 && (
                                <span className="absolute top-[1px] right-[1px] flex items-center justify-center text-[6px] leading-none select-none z-10 pointer-events-none">
                                  🎂
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* VIEW 3: MATRIX TABLE VIEW (CLASSIC SCROLLABLE TABLE WITH COMPACT ZOOM) */}
          {/* ========================================================================= */}
          {viewMode === 'table' && (
            <div className="flex flex-col">
              <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50 text-xs text-gray-500">
                <span>Swipe horizontally to see days 1–{daysInMonth}</span>
                <button
                  onClick={() => setCompactTable(!compactTable)}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 transition-colors"
                >
                  {compactTable ? 'Normal Size' : 'Compact Fit'}
                </button>
              </div>

              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse table-fixed bg-transparent">
                  <thead>
                    <tr>
                      <th
                        className={`p-2 sm:p-3 border-b-2 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 font-bold sticky left-0 bg-white dark:bg-gray-900 z-20 text-xs sm:text-base shadow-[1px_0_0_0_rgba(0,0,0,0.06)] ${
                          compactTable ? 'w-[110px]' : 'w-[130px] sm:w-[170px]'
                        }`}
                      >
                        Habit
                      </th>
                      {daysArray.map(day => {
                        const dateObj = new Date(year, month - 1, day);
                        const myHolidays = getMYPublicHoliday(dateObj);
                        const auHolidays = getAUPublicHoliday(dateObj);
                        const isWeekend = getDay(dateObj) === 0 || getDay(dateObj) === 6;
                        const mySchoolHolidays = isMYSchoolHoliday(dateObj);
                        const bdays = getBirthdays(dateObj);

                        const titleParts: string[] = [];
                        if (bdays.length > 0) titleParts.push(`🎂 ${bdays.join(', ')}'s Birthday`);
                        if (myHolidays) titleParts.push(`MY: ${myHolidays.map((h: any) => h.name).join(', ')}`);
                        if (auHolidays) titleParts.push(`AU (VIC): ${auHolidays.map((h: any) => h.name).join(', ')}`);
                        if (mySchoolHolidays) titleParts.push(`MY: School Holiday`);
                        const titleStr = titleParts.length > 0 ? titleParts.join('\n') : undefined;

                        return (
                          <th
                            key={day}
                            title={titleStr}
                            onClick={() => {
                              if (titleParts.length > 0) {
                                setDetailModal({
                                  title: `${format(dateObj, 'EEEE, d MMMM yyyy')}`,
                                  content: titleParts.join('\n'),
                                });
                              }
                            }}
                            className={`p-1 border-b-2 border-gray-200 dark:border-gray-700 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 relative select-none cursor-pointer ${
                              compactTable ? 'w-6' : 'w-7 sm:w-8'
                            } ${isWeekend ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`}
                          >
                            <span className="relative z-10">{day}</span>
                            {mySchoolHolidays && (
                              <span className="absolute inset-0 flex items-center justify-center text-green-500/20 text-2xl leading-none select-none z-0 pointer-events-none mt-0.5">
                                ■
                              </span>
                            )}
                            {myHolidays && (
                              <span className="absolute inset-0 flex items-center justify-center text-yellow-500/80 text-lg leading-none select-none z-0 pointer-events-none">
                                ★
                              </span>
                            )}
                            {auHolidays && (
                              <span className="absolute inset-0 flex items-center justify-center text-blue-500/80 text-lg leading-none select-none z-0 pointer-events-none">
                                ●
                              </span>
                            )}
                            {bdays.length > 0 && (
                              <span className="absolute top-[1px] right-[1px] flex items-center justify-center text-[7px] leading-none select-none z-10 pointer-events-none">
                                🎂
                              </span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody>
                    {uniqueHabitNames.length === 0 ? (
                      <tr>
                        <td colSpan={daysArray.length + 1} className="py-12 text-center text-gray-400 dark:text-gray-500">
                          No habits tracked this month.
                        </td>
                      </tr>
                    ) : (
                      uniqueHabitNames.map(habitName => {
                        const completedCount = habitStats[habitName] || 0;

                        return (
                          <tr
                            key={habitName}
                            className="bg-transparent hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition-colors"
                          >
                            <td
                              className={`p-1.5 sm:p-2 border-b border-gray-100 dark:border-gray-800 font-medium text-gray-800 dark:text-gray-200 sticky left-0 bg-white dark:bg-gray-900 z-10 shadow-[1px_0_0_0_rgba(0,0,0,0.06)] ${
                                compactTable ? 'w-[110px]' : 'w-[130px] sm:w-[170px]'
                              }`}
                              title={habitName}
                            >
                              <div className="flex justify-between items-center w-full">
                                <span className="truncate mr-1 text-xs font-semibold">{habitName}</span>
                                <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded shrink-0">
                                  {completedCount}/{daysInMonth}
                                </span>
                              </div>
                            </td>

                            {daysArray.map(day => {
                              const targetDateInt = parseInt(`${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`);
                              const record = habits.find(h => h.name === habitName && h.date === targetDateInt);
                              const isCompleted = record?.completed;
                              const isWeekend = getDay(new Date(year, month - 1, day)) === 0 || getDay(new Date(year, month - 1, day)) === 6;

                              return (
                                <td
                                  key={day}
                                  className={`p-0.5 border-b border-gray-100 dark:border-gray-800 text-center ${
                                    isWeekend ? 'bg-gray-50 dark:bg-gray-800/30' : ''
                                  }`}
                                >
                                  <button
                                    onClick={() => handleToggleHabit(habitName, day)}
                                    onContextMenu={e => {
                                      if (record?.details) {
                                        e.preventDefault();
                                        setDetailModal({
                                          title: `${habitName} (${month}/${day})`,
                                          content: record.details,
                                        });
                                      }
                                    }}
                                    title={
                                      record?.details
                                        ? `Details:\n${record.details}`
                                        : isCompleted
                                        ? 'Completed (Click to undo)'
                                        : 'Click to mark DONE'
                                    }
                                    className={`mx-auto rounded flex items-center justify-center transition-all cursor-pointer ${
                                      compactTable ? 'w-5 h-5' : 'w-6 h-6'
                                    } ${
                                      isCompleted
                                        ? 'bg-green-500 hover:bg-green-600 text-white shadow-sm scale-105 active:scale-95'
                                        : record
                                        ? isWeekend
                                          ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95'
                                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-95'
                                        : isWeekend
                                        ? 'border border-dashed border-gray-300 dark:border-gray-600 hover:bg-green-500/20 active:scale-95'
                                        : 'border border-dashed border-gray-200 dark:border-gray-700 hover:bg-green-500/20 active:scale-95'
                                    }`}
                                  >
                                    {isCompleted && <Check size={compactTable ? 12 : 14} strokeWidth={3} className="pointer-events-none" />}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Footer Legend */}
          <div className="p-3 bg-gray-50/70 dark:bg-gray-900/70 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-2.5 text-xs text-gray-500">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="text-yellow-500 font-bold">★</span> Malaysia
              </span>
              <span className="flex items-center gap-1">
                <span className="text-blue-500 font-bold">●</span> Victoria
              </span>
              <span className="flex items-center gap-1">
                <span className="text-green-500/70 font-bold">■</span> School Holiday
              </span>
              <span className="flex items-center gap-1">
                <span>🎂</span> Birthday
              </span>
            </div>
            <div className="text-[11px] text-gray-400">
              {viewMode === 'year'
                ? 'Yearly 12-Month View • Tap any month title to open month'
                : viewMode === 'calendar'
                ? 'Month view • Tap to check'
                : 'Tip: Turn phone landscape for full table'}
            </div>
          </div>
        </div>
      </main>

      {/* DAY HABITS CHECKLIST BOTTOM SHEET (FOR MOBILE QUICK CHECKING) */}
      {daySheetDate && selectedDayObj && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl max-w-md w-full border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-850">
              <div>
                <h3 className="font-bold text-base sm:text-lg text-gray-900 dark:text-gray-100">
                  {format(selectedDayObj, 'EEEE, d MMMM yyyy')}
                </h3>
                <div className="flex flex-wrap gap-1.5 mt-1 text-xs">
                  {getBirthdays(selectedDayObj).map(b => (
                    <span key={b} className="px-2 py-0.5 rounded-full bg-pink-100 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 font-semibold flex items-center gap-1">
                      🎂 {b}'s Birthday
                    </span>
                  ))}
                  {(() => {
                    const h = getMYPublicHoliday(selectedDayObj);
                    return h ? (
                      <span className="px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-300 font-semibold flex items-center gap-1">
                        ★ MY: {h.map((item: any) => item.name).join(', ')}
                      </span>
                    ) : null;
                  })()}
                  {isMYSchoolHoliday(selectedDayObj) && (
                    <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-300 font-semibold">
                      ■ School Holiday
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setDaySheetDate(null)}
                className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-400"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                Habits for this day
              </p>
              {uniqueHabitNames.map(hName => {
                const dayInt = daySheetDate;
                const record = habits.find(h => h.name === hName && h.date === dayInt);
                const isCompleted = record?.completed;

                return (
                  <div
                    key={hName}
                    onClick={() => {
                      const dayNum = parseInt(dayInt.toString().substring(6, 8));
                      handleToggleHabit(hName, dayNum);
                    }}
                    className={`p-3 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                      isCompleted
                        ? 'bg-green-50/80 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                        : 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 hover:border-blue-400'
                    }`}
                  >
                    <div>
                      <span className={`font-semibold text-sm ${isCompleted ? 'text-green-900 dark:text-green-200' : 'text-gray-800 dark:text-gray-200'}`}>
                        {hName}
                      </span>
                      {record?.details && (
                        <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">
                          {record.details}
                        </p>
                      )}
                      {!record && (
                        <p className="text-[11px] text-gray-400">Click to track on this day</p>
                      )}
                    </div>

                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                        isCompleted
                          ? 'bg-green-500 text-white shadow-sm'
                          : 'border-2 border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {isCompleted && <Check size={18} strokeWidth={3} />}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900 safe-sheet-bottom">
              <button
                onClick={() => setDaySheetDate(null)}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 max-w-sm w-full border border-gray-200 dark:border-gray-800 shadow-xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-gray-100">{detailModal.title}</h3>
              <button
                onClick={() => setDetailModal(null)}
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
              >
                <X size={18} />
              </button>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {detailModal.content}
            </div>
            <button
              onClick={() => setDetailModal(null)}
              className="mt-4 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* GitHub Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <Settings size={20} className="text-blue-500" />
                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">GitHub Sync Setup</h3>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                  GitHub Personal Access Token
                </label>
                <input
                  type="password"
                  value={config.token}
                  onChange={e => setConfig({ ...config, token: e.target.value })}
                  placeholder="ghp_..."
                  className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
                  <ShieldCheck size={14} className="text-green-500 shrink-0" />
                  Stored strictly in your device browser's localStorage.
                </p>
                <a
                  href="https://github.com/settings/tokens/new"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-500 hover:underline mt-1 inline-flex items-center gap-1"
                >
                  Create token on GitHub <ExternalLink size={12} />
                </a>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                    Owner
                  </label>
                  <input
                    type="text"
                    value={config.owner}
                    onChange={e => setConfig({ ...config, owner: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                    Repo Name
                  </label>
                  <input
                    type="text"
                    value={config.repo}
                    onChange={e => setConfig({ ...config, repo: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                    Branch
                  </label>
                  <input
                    type="text"
                    value={config.branch}
                    onChange={e => setConfig({ ...config, branch: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                    Journals Folder
                  </label>
                  <input
                    type="text"
                    value={config.folder}
                    onChange={e => setConfig({ ...config, folder: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow transition-all flex items-center gap-1.5"
                >
                  {saveSuccess ? (
                    <>
                      <CheckCircle2 size={16} /> Saved!
                    </>
                  ) : (
                    'Save Settings'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
