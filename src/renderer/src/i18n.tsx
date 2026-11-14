import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Language = 'en' | 'fa'

const messages: Record<Language, Record<string, string>> = {
  en: {
    flowdock: 'FlowDock', settings: 'Settings', preferences: 'FlowDock preferences',
    openWindows: '{count} open windows', search: 'Find a window…', noWindows: 'No open windows found',
    noMatches: 'No matching windows', tryDifferent: 'Try a different title or app name.',
    windowsAppear: 'New windows will appear automatically.', close: 'Close {name}', hide: 'Hide FlowDock',
    openSettings: 'Open settings', openPomodoro: 'Open Pomodoro', navigate: 'navigate', primary: 'click → primary',
    focus: 'Focus', pomodoroTasks: 'Pomodoro & tasks', stayFocused: 'Stay focused', windows: 'Windows', back: 'back',
    appearance: 'Appearance', theme: 'Theme', accentColor: 'Accent color', font: 'Font', fontSize: 'Font size',
    glassEffect: 'Glass effect', animations: 'Animations', language: 'Language', english: 'English', persian: 'فارسی',
    startup: 'Run at Windows startup', startupHelp: 'Start FlowDock automatically when you sign in.',
    startupStored: 'This setting is stored by Windows for the current user.',
    startupError: 'Could not change the startup setting.', resize: 'Resize sidebar', windowList: 'Open windows',
    minimized: 'Minimized', primaryMonitor: 'Primary monitor', movePrimaryHint: 'Shift+Click: move to primary monitor', pomodoroTimer: 'Pomodoro timer',
    focusSession: 'Focus', shortBreak: 'Short break', longBreak: 'Long break', sessionProgress: 'Session in progress', paused: 'Paused',
    short: 'Short', long: 'Long', resetTimer: 'Reset timer', skipSession: 'Skip session', pause: 'Pause', start: 'Start',
    todaysTasks: 'Today’s tasks', focusSessions: '{count} focus sessions', remaining: '{count} remaining',
    timerSettings: 'Timer settings', focusMin: 'Focus min', shortMin: 'Short min', longMin: 'Long min', longEvery: 'Long every',
    addTask: 'Add a task…', add: 'Add', sessions: '{count} sessions', active: 'active', deleteTask: 'Delete task',
    taskEmpty: 'Add a task and start focusing.', reopenTask: 'Reopen {name}', completeTask: 'Complete {name}',
    focusStats: 'Focus statistics', todayProgress: 'Today’s goal', daySessions: '{count} sessions',
    weekSessions: '{count} this week', focusMinutes: '{count} focus minutes', dailyGoal: 'Daily session goal',
    shortcuts: 'Keyboard shortcuts', shortcutHint: 'Click a field and press the new shortcut.',
    shortcutDock: 'Show / hide FlowDock', shortcutPomodoro: 'Start / pause Pomodoro',
    shortcutNextWindow: 'Next window', shortcutMoveWindow: 'Move window', shortcutDisabled: 'Disabled',
    monitors: 'Monitors', dockMonitor: 'FlowDock monitor', followCursor: 'Follow cursor', fixedMonitor: 'Fixed monitor',
    chooseMonitor: 'Choose monitor', moveTarget: 'Window move target', nextMonitor: 'Next monitor',
    monitorNumber: 'Monitor {count}', primaryLabel: 'Primary', quitFlowDock: 'Quit FlowDock',
    focusComplete: 'Focus session complete', breakComplete: 'Break complete',
    greatWork: 'Great work', timeForBreak: '{task}. Time for a {kind} break.', readyFocus: 'Ready for another focused session?',
    shortKind: 'short', longKind: 'long', activationBlocked: 'Windows prevented this app from taking foreground focus.',
    windowActivationFailed: 'Window activation failed.', windowCloseFailed: 'The window could not be closed.'
  },
  fa: {
    flowdock: 'فلو‌داک', settings: 'تنظیمات', preferences: 'تنظیمات فلو‌داک',
    openWindows: '{count} پنجره باز', search: 'جستجوی پنجره…', noWindows: 'پنجره‌ای پیدا نشد',
    noMatches: 'نتیجه‌ای پیدا نشد', tryDifferent: 'عنوان یا نام برنامه دیگری را امتحان کنید.',
    windowsAppear: 'پنجره‌های جدید خودکار نمایش داده می‌شوند.', close: 'بستن {name}', hide: 'مخفی‌کردن فلو‌داک',
    openSettings: 'بازکردن تنظیمات', openPomodoro: 'بازکردن پومودورو', navigate: 'جابجایی', primary: 'کلیک ← مانیتور اصلی',
    focus: 'تمرکز', pomodoroTasks: 'پومودورو و کارها', stayFocused: 'متمرکز بمان', windows: 'ویندوز', back: 'بازگشت',
    appearance: 'ظاهر برنامه', theme: 'تم کلی', accentColor: 'رنگ اصلی', font: 'فونت', fontSize: 'اندازه فونت',
    glassEffect: 'افکت شیشه‌ای', animations: 'انیمیشن‌ها', language: 'زبان', english: 'English', persian: 'فارسی',
    startup: 'اجرای خودکار با ویندوز', startupHelp: 'بعد از ورود به ویندوز، فلو‌داک خودکار اجرا شود.',
    startupStored: 'این تنظیم برای کاربر فعلی در ویندوز ذخیره می‌شود.',
    startupError: 'تغییر تنظیم اجرای خودکار ناموفق بود.', resize: 'تغییر عرض نوار کناری', windowList: 'پنجره‌های باز',
    minimized: 'کوچک‌شده', primaryMonitor: 'مانیتور اصلی', movePrimaryHint: 'Shift+Click: انتقال به مانیتور اصلی', pomodoroTimer: 'تایمر پومودورو',
    focusSession: 'تمرکز', shortBreak: 'استراحت کوتاه', longBreak: 'استراحت بلند', sessionProgress: 'جلسه در حال اجرا', paused: 'متوقف شده',
    short: 'کوتاه', long: 'بلند', resetTimer: 'شروع مجدد تایمر', skipSession: 'ردکردن جلسه', pause: 'توقف', start: 'شروع',
    todaysTasks: 'کارهای امروز', focusSessions: '{count} جلسه تمرکز', remaining: '{count} باقی‌مانده',
    timerSettings: 'تنظیمات تایمر', focusMin: 'دقیقه تمرکز', shortMin: 'استراحت کوتاه', longMin: 'استراحت بلند', longEvery: 'استراحت بلند بعد از',
    addTask: 'افزودن کار جدید…', add: 'افزودن', sessions: '{count} جلسه', active: 'فعال', deleteTask: 'حذف کار',
    taskEmpty: 'یک کار اضافه کنید و تمرکز را شروع کنید.', reopenTask: 'بازگرداندن {name}', completeTask: 'تکمیل {name}',
    focusStats: 'آمار تمرکز', todayProgress: 'هدف امروز', daySessions: '{count} جلسه',
    weekSessions: '{count} جلسه این هفته', focusMinutes: '{count} دقیقه تمرکز', dailyGoal: 'هدف روزانه جلسات',
    shortcuts: 'میان‌برهای صفحه‌کلید', shortcutHint: 'روی کادر کلیک کنید و میان‌بر جدید را بزنید.',
    shortcutDock: 'نمایش / مخفی‌کردن فلو‌داک', shortcutPomodoro: 'شروع / توقف پومودورو',
    shortcutNextWindow: 'پنجره بعدی', shortcutMoveWindow: 'انتقال پنجره', shortcutDisabled: 'غیرفعال',
    monitors: 'مانیتورها', dockMonitor: 'مانیتور فلو‌داک', followCursor: 'دنبال‌کردن ماوس', fixedMonitor: 'مانیتور ثابت',
    chooseMonitor: 'انتخاب مانیتور', moveTarget: 'مقصد انتقال پنجره', nextMonitor: 'مانیتور بعدی',
    monitorNumber: 'مانیتور {count}', primaryLabel: 'اصلی', quitFlowDock: 'خروج از فلو‌داک',
    focusComplete: 'جلسه تمرکز تمام شد', breakComplete: 'زمان استراحت تمام شد',
    greatWork: 'عالی بود', timeForBreak: '{task}؛ حالا زمان یک استراحت {kind} است.', readyFocus: 'برای یک جلسه تمرکز دیگر آماده‌ای؟',
    shortKind: 'کوتاه', longKind: 'بلند', activationBlocked: 'ویندوز اجازه انتقال فوکوس به این برنامه را نداد.',
    windowActivationFailed: 'فعال‌کردن پنجره ناموفق بود.', windowCloseFailed: 'پنجره بسته نشد.'
  }
}

interface I18nValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string, values?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('flowdock:language') === 'fa' ? 'fa' : 'en')

  useEffect(() => {
    localStorage.setItem('flowdock:language', language)
    document.documentElement.lang = language
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr'
    document.documentElement.dataset.language = language
    void window.flowDock.setLanguage(language)
  }, [language])

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (key, values = {}) => {
      let text = messages[language][key] ?? messages.en[key] ?? key
      for (const [name, replacement] of Object.entries(values)) {
        text = text.replaceAll(`{${name}}`, String(replacement))
      }
      return text
    }
  }), [language])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
