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
  AlertCircle
} from 'lucide-react';
import Holidays from 'date-holidays';
import type { HabitRecord, GitHubConfig } from './types';
import { 
  getGitHubConfig, 
  saveGitHubConfig, 
  getMonthHabitsFromGitHub, 
  toggleHabitOnGitHub 
} from './github';

const hdMY = new Holidays('MY');
const hdAU = new Holidays('AU', 'VIC');

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

export default function App() {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [habits, setHabits] = useState<HabitRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [detailModal, setDetailModal] = useState<{ title: string; content: string } | null>(null);

  // Settings Form State
  const [config, setConfig] = useState<GitHubConfig>(getGitHubConfig());
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Year Progress calculation
  const now = new Date();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const daysInMonth = getDaysInMonth(currentDate);
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

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

  // Month progress
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === currentDate.getMonth();
  const isPastMonth = currentDate < now && !isCurrentMonth;
  const progressPercent = isCurrentMonth ? (now.getDate() / daysInMonth) * 100 : (isPastMonth ? 100 : 0);

  // Load habits from GitHub
  const loadHabits = useCallback(async (forceRefresh = false) => {
    if (!config.token) {
      setShowSettings(true);
      return;
    }

    if (forceRefresh) {
      // Clear sha file cache from localStorage
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('logseq_habit_cache_')) {
          localStorage.removeItem(key);
        }
      });
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const records = await getMonthHabitsFromGitHub(year, month, msg => setStatusMsg(msg));
      setHabits(records);
      setStatusMsg('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to load habit journals from GitHub.');
    } finally {
      setLoading(false);
    }
  }, [config.token, year, month]);

  useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  // Handle habit toggle
  const handleToggleHabit = async (habitName: string, day: number) => {
    const targetDateInt = parseInt(`${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`);
    const record = habits.find(h => h.name === habitName && h.date === targetDateInt);
    if (!record) return;

    const newCompleted = !record.completed;

    // Optimistic UI update
    setHabits(prev =>
      prev.map(h => (h.id === record.id ? { ...h, completed: newCompleted } : h))
    );

    try {
      const updated = await toggleHabitOnGitHub(record, newCompleted);
      setHabits(prev =>
        prev.map(h => (h.id === updated.id ? updated : h))
      );
    } catch (err: any) {
      alert(`Sync failed: ${err.message}`);
      // Revert optimistic update
      setHabits(prev =>
        prev.map(h => (h.id === record.id ? { ...h, completed: record.completed } : h))
      );
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xl">📅</span>
            <span className="font-bold text-base tracking-tight text-gray-900 dark:text-white">
              Logseq Habits
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => loadHabits(true)}
              disabled={loading}
              title="Refresh from GitHub"
              className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin text-blue-500' : ''} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              title="GitHub Settings"
              className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 flex flex-col">
        {/* Error Banner */}
        {errorMsg && (
          <div className="mb-4 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm flex items-start space-x-3">
            <AlertCircle size={20} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Unable to fetch from GitHub</p>
              <p className="mt-0.5 text-xs">{errorMsg}</p>
              <button
                onClick={() => setShowSettings(true)}
                className="mt-2 text-xs font-bold underline hover:text-red-800 dark:hover:text-red-200"
              >
                Open Settings to check Token & Repository
              </button>
            </div>
          </div>
        )}

        {/* Dashboard Card */}
        <div className="w-full bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col overflow-hidden">
          {/* Calendar Header */}
          <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setCurrentDate(prev => subMonths(prev, 1))}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                  aria-label="Previous Month"
                >
                  <ChevronLeft size={22} className="text-gray-600 dark:text-gray-400" />
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
                    title="Click to jump to any month or date"
                  />
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 min-w-[180px] text-center leading-tight group-hover:text-blue-500 transition-colors flex items-center justify-center gap-1.5">
                    {format(currentDate, 'MMMM yyyy')}
                  </h2>
                  <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 mt-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => setCurrentDate(prev => addMonths(prev, 1))}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                  aria-label="Next Month"
                >
                  <ChevronRight size={22} className="text-gray-600 dark:text-gray-400" />
                </button>
              </div>

              {/* Jump to Today Button */}
              <button
                onClick={() => setCurrentDate(new Date())}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
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

          {/* Loading status text */}
          {loading && (
            <div className="px-4 py-2 bg-blue-50/50 dark:bg-blue-950/20 text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-2 border-b border-gray-100 dark:border-gray-800">
              <RefreshCw size={12} className="animate-spin" />
              <span>{statusMsg || 'Loading habit records...'}</span>
            </div>
          )}

          {/* Habit Tracker Table */}
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse table-fixed bg-transparent min-w-[700px]">
              <thead>
                <tr>
                  <th className="p-3 border-b-2 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 font-bold w-[160px] sm:w-[180px] sticky left-0 bg-white dark:bg-gray-900 z-20 text-sm sm:text-base shadow-[1px_0_0_0_rgba(0,0,0,0.06)]">
                    Habit
                  </th>
                  {daysArray.map(day => {
                    const dateObj = new Date(year, month - 1, day);
                    const myHolidays = hdMY.isHoliday(dateObj);
                    const auHolidays = hdAU.isHoliday(dateObj);
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
                        className={`p-1 border-b-2 border-gray-200 dark:border-gray-700 text-center text-xs sm:text-sm font-semibold text-gray-500 dark:text-gray-400 w-8 sm:w-9 relative select-none cursor-pointer ${
                          isWeekend ? 'bg-gray-50 dark:bg-gray-800/50' : ''
                        }`}
                      >
                        <span className="relative z-10">{day}</span>
                        {/* School Holiday background marker */}
                        {mySchoolHolidays && (
                          <span className="absolute inset-0 flex items-center justify-center text-green-500/20 text-2xl sm:text-3xl leading-none select-none z-0 pointer-events-none mt-0.5">
                            ■
                          </span>
                        )}
                        {/* MY Public Holiday Star */}
                        {myHolidays && (
                          <span className="absolute inset-0 flex items-center justify-center text-yellow-500/80 text-xl sm:text-2xl leading-none select-none z-0 pointer-events-none">
                            ★
                          </span>
                        )}
                        {/* AU VIC Holiday Dot */}
                        {auHolidays && (
                          <span className="absolute inset-0 flex items-center justify-center text-blue-500/80 text-xl sm:text-2xl leading-none select-none z-0 pointer-events-none">
                            ●
                          </span>
                        )}
                        {/* Birthday Cake */}
                        {bdays.length > 0 && (
                          <span className="absolute top-[2px] right-[2px] flex items-center justify-center text-[8px] leading-none select-none z-10 pointer-events-none">
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
                    let completedCount = 0;
                    daysArray.forEach(day => {
                      const targetDateInt = parseInt(`${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`);
                      const record = habits.find(h => h.name === habitName && h.date === targetDateInt);
                      if (record?.completed) completedCount++;
                    });

                    return (
                      <tr
                        key={habitName}
                        className="bg-transparent hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition-colors"
                      >
                        {/* Sticky habit column with counter */}
                        <td
                          className="p-2 sm:p-2.5 border-b border-gray-100 dark:border-gray-800 font-medium text-gray-800 dark:text-gray-200 sticky left-0 bg-white dark:bg-gray-900 z-10 w-[160px] sm:w-[180px] shadow-[1px_0_0_0_rgba(0,0,0,0.06)]"
                          title={habitName}
                        >
                          <div className="flex justify-between items-center w-full">
                            <span className="truncate mr-2 text-xs sm:text-sm font-semibold">{habitName}</span>
                            <span
                              className="text-[10px] font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded shrink-0"
                              title={`${completedCount} completed out of ${daysInMonth} days`}
                            >
                              {completedCount}/{daysInMonth}
                            </span>
                          </div>
                        </td>

                        {/* Habit Checkboxes */}
                        {daysArray.map(day => {
                          const targetDateInt = parseInt(`${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`);
                          const record = habits.find(h => h.name === habitName && h.date === targetDateInt);
                          const isCompleted = record?.completed;
                          const isWeekend = getDay(new Date(year, month - 1, day)) === 0 || getDay(new Date(year, month - 1, day)) === 6;

                          return (
                            <td
                              key={day}
                              className={`p-1 border-b border-gray-100 dark:border-gray-800 text-center ${
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
                                disabled={!record}
                                title={
                                  !record
                                    ? 'No habit block in journal'
                                    : record.details
                                    ? `Details:\n${record.details}`
                                    : isCompleted
                                    ? 'Completed (Click to undo)'
                                    : 'Click to mark DONE'
                                }
                                className={`w-6 h-6 sm:w-7 sm:h-7 mx-auto rounded-md flex items-center justify-center transition-all ${
                                  !record
                                    ? isWeekend
                                      ? 'opacity-30 cursor-not-allowed bg-gray-300 dark:bg-gray-600'
                                      : 'opacity-10 cursor-not-allowed bg-gray-200 dark:bg-gray-700'
                                    : isCompleted
                                    ? 'bg-green-500 hover:bg-green-600 text-white shadow-sm scale-105 active:scale-95'
                                    : isWeekend
                                    ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95'
                                    : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-95'
                                }`}
                              >
                                {isCompleted && <Check size={16} strokeWidth={3} className="pointer-events-none" />}
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

          {/* Footer Legend */}
          <div className="p-3 bg-gray-50/60 dark:bg-gray-900/60 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="text-yellow-500 font-bold">★</span> Malaysia Holiday
              </span>
              <span className="flex items-center gap-1">
                <span className="text-blue-500 font-bold">●</span> Victoria Holiday
              </span>
              <span className="flex items-center gap-1">
                <span className="text-green-500/70 font-bold">■</span> School Holiday
              </span>
              <span className="flex items-center gap-1">
                <span>🎂</span> Birthday
              </span>
            </div>
            <div className="text-[11px] text-gray-400">
              Tap any date for holiday details
            </div>
          </div>
        </div>
      </main>

      {/* Details Modal */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 max-w-sm w-full border border-gray-200 dark:border-gray-800 shadow-xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-gray-100">{detailModal.title}</h3>
              <button
                onClick={() => setDetailModal(null)}
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600"
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
              {/* GitHub Token Field */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                  GitHub Personal Access Token
                </label>
                <input
                  type="password"
                  value={config.token}
                  onChange={e => setConfig({ ...config, token: e.target.value })}
                  placeholder="github_pat_... or ghp_..."
                  className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
                  <ShieldCheck size={14} className="text-green-500 shrink-0" />
                  Stored strictly in your device browser's localStorage.
                </p>
                <a
                  href="https://github.com/settings/tokens?type=beta"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-500 hover:underline mt-1 inline-flex items-center gap-1"
                >
                  Create token on GitHub <ExternalLink size={12} />
                </a>
              </div>

              {/* Repository info */}
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

              {/* Submit Buttons */}
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
