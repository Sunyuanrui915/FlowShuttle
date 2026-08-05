import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  Bell,
  BookOpenText,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Clock3,
  Clipboard,
  Circle,
  CirclePause,
  Ellipsis,
  ExternalLink,
  FileDown,
  FileText,
  Folder,
  FolderCog,
  FolderOpen,
  HardDrive,
  Info,
  Languages,
  RefreshCw,
  LayoutList,
  Monitor,
  Moon,
  Orbit,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Star,
  StickyNote,
  Sun,
  Trash2,
  Undo2,
  Wallpaper,
  Waypoints,
  X
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { countTextMetricCharacters } from "../../shared/textMetrics";
import editorPaperCloudMist from "./assets/editor-paper/cloud-mist.webp";
import editorPaperForestWhisper from "./assets/editor-paper/forest-whisper.webp";
import editorPaperNightVoyage from "./assets/editor-paper/night-voyage.webp";
import userGuideEn from "./content/user-guide.en.md?raw";
import userGuideZhCn from "./content/user-guide.zh-CN.md?raw";
import { createTranslator, languageOptions, type Translator } from "./i18n";
import { MarkdownWysiwygEditor, type MarkdownEditorLabels } from "./MarkdownWysiwygEditor";
import {
  isMarkdownFenceClosing,
  normalizeReferenceMarkdownSpacing,
  parseMarkdownFenceOpening,
  type MarkdownFence
} from "./referenceMarkdown";
import type {
  AiOperationResult,
  AiSaveSettingsInput,
  AiSettingsInfo,
  AppUpdateStatus,
  DailyAutoReportEvent,
  DailyAutoReportRequest,
  DailyWorkItemEntry,
  LanguagePreference,
  MarkdownPayload,
  Project,
  ProjectMemo,
  ProjectDeleteSummary,
  ProjectDetail,
  ProjectListItem,
  SearchResult,
  SettingsInfo,
  SortMoveDirection,
  ThemePreference,
  DailyJournalView,
  DailyProjectGroup,
  DailyReportListItem,
  DailyWorkItemBlock,
  DailyWorkItemStatus,
  EffectiveTheme,
  HeatmapDay,
  HeatmapMonth,
  PeriodReportType,
  PeriodReportListItem,
  WorkItemHistoryRecovery,
  WorkItemDeleteSummary,
  WorkItemNote,
  WorkItemStatus,
  WorkItemWithLatest
} from "../../shared/types";

type View =
  | "today"
  | "daily-entry-editor"
  | "projects"
  | "project-detail"
  | "project-memo"
  | "reports"
  | "heatmap"
  | "archive"
  | "settings"
  | "user-guide";
type UserGuideReturnView = Exclude<View, "user-guide">;
type ReportTab = "daily" | "weekly" | "monthly";
type ProjectWorkItemTab = "active" | "completed";
type ReportTimeFilter = "all" | "today" | "last7" | "last30" | "thisMonth" | "lastMonth";
type EditorWallpaper = "clean" | "cloud" | "forest" | "night";

const EDITOR_WALLPAPER_STORAGE_KEY = "flow-shuttle:editor-wallpaper";
const EDITOR_WALLPAPER_OPTIONS: readonly EditorWallpaper[] = ["clean", "cloud", "forest", "night"];

function readEditorWallpaperPreference(): EditorWallpaper {
  if (typeof window === "undefined") {
    return "cloud";
  }
  try {
    const stored = window.localStorage.getItem(EDITOR_WALLPAPER_STORAGE_KEY);
    if (stored === "flow") {
      return "cloud";
    }
    if (stored === "orbit") {
      return "night";
    }
    return EDITOR_WALLPAPER_OPTIONS.includes(stored as EditorWallpaper) ? (stored as EditorWallpaper) : "cloud";
  } catch {
    return "cloud";
  }
}

type ReportItem = MarkdownPayload & {
  id: string;
  reportKind: "daily" | "weekly" | "monthly";
  title: string;
  meta: string;
  fileName: string;
  typeLabel: string;
  generatedAt: string | null;
  periodStart: string;
  periodEnd: string;
  aiFileName?: string;
  aiRefinedMarkdown?: string | null;
  aiRefinedAt?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  aiIsStale?: boolean;
};

interface QuickProgressForm {
  projectId: string;
  workItemId: string;
  content: string;
  nextStep: string;
  blocker: string;
}

interface DailyEntryForm {
  workItemNoteContent: string;
  todayProgress: string;
  nextStep: string;
  blocker: string;
  statusForToday: DailyWorkItemStatus;
}

interface DailyEntryEditorTarget {
  journalDate: string;
  projectId: string;
  workItemId: string;
}

interface TodaySearchTarget {
  id: number;
  projectId: string;
  workItemId: string | null;
}

interface TodayVisualPulse {
  id: number;
  journalDate: string;
  projectId: string;
  workItemId: string;
}

type TodayConstellationTransitionKind = "exit" | "enter";

interface TodayConstellationTransition {
  id: number;
  journalDate: string;
  projectId: string;
  workItemId: string;
  kind: TodayConstellationTransitionKind;
  node: TodayConstellationNode | null;
}

interface TodayConstellationRefreshTarget {
  projectId: string;
  workItemId: string;
}

type DailyEditorSection = "todayProgress" | "nextStep" | "blocker";
type DailyPrimaryEditorSection = "currentContent" | "dailyChange";

type ToastKind = "success" | "error" | "warning" | "info";
type ConfirmTone = "danger" | "warning" | "info";

interface Toast {
  kind: ToastKind;
  message: string;
}

interface AppConfirmOptions {
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel?: string;
  tone?: ConfirmTone;
  objectName?: string;
  calloutTitle?: string;
  calloutBody?: string;
}

const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null && !element.getAttribute("aria-hidden")
  );
}

function trapModalFocus(event: globalThis.KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) {
    return;
  }

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleSegmentedKeyDown<T extends string>(
  event: KeyboardEvent<HTMLElement>,
  items: readonly T[],
  activeItem: T,
  onChange: (item: T) => void
) {
  const currentIndex = Math.max(0, items.indexOf(activeItem));
  let nextIndex: number | null = null;

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % items.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  }

  if (nextIndex === null) {
    return;
  }

  event.preventDefault();
  const nextItem = items[nextIndex];
  const tablist = event.currentTarget;
  onChange(nextItem);
  window.requestAnimationFrame(() => {
    Array.from(tablist.querySelectorAll<HTMLButtonElement>("[data-tab-id]"))
      .find((button) => button.dataset.tabId === nextItem)
      ?.focus();
  });
}

function SlidingTabIndicator({ activeItem }: { activeItem: string }) {
  const indicatorRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const tablist = indicator?.parentElement;
    if (!indicator || !tablist) {
      return;
    }

    let readyFrame = 0;
    const buttons = Array.from(tablist.querySelectorAll<HTMLButtonElement>("button[data-tab-id]"));
    const updateIndicator = () => {
      const activeButton = buttons.find((button) => button.dataset.tabId === activeItem);
      if (!activeButton) {
        indicator.style.opacity = "0";
        return;
      }

      const tablistRect = tablist.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      indicator.style.setProperty("--sliding-tab-x", `${buttonRect.left - tablistRect.left + tablist.scrollLeft}px`);
      indicator.style.setProperty("--sliding-tab-y", `${buttonRect.top - tablistRect.top + tablist.scrollTop}px`);
      indicator.style.setProperty("--sliding-tab-width", `${buttonRect.width}px`);
      indicator.style.setProperty("--sliding-tab-height", `${buttonRect.height}px`);
      indicator.style.opacity = "1";

      if (indicator.dataset.ready !== "true") {
        readyFrame = window.requestAnimationFrame(() => {
          indicator.dataset.ready = "true";
        });
      }
    };

    updateIndicator();
    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(tablist);
    buttons.forEach((button) => resizeObserver.observe(button));

    return () => {
      window.cancelAnimationFrame(readyFrame);
      resizeObserver.disconnect();
    };
  }, [activeItem]);

  return <span ref={indicatorRef} className="sliding-tab-indicator" role="presentation" aria-hidden="true" />;
}

interface PendingConfirm extends AppConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface EditorSaveOptions {
  refresh?: boolean;
  showSuccess?: boolean;
  skipEmpty?: boolean;
  skipUnchanged?: boolean;
}

const emptyQuickForm: QuickProgressForm = {
  projectId: "",
  workItemId: "",
  content: "",
  nextStep: "",
  blocker: ""
};

const CREATE_PROJECT_OPTION = "__create_project__";
const CREATE_WORK_ITEM_OPTION = "__create_work_item__";
const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
const PROJECT_WORK_ITEM_TABS: readonly ProjectWorkItemTab[] = ["active", "completed"];

function localeFor(language: LanguagePreference): string {
  if (language === "en") {
    return "en-US";
  }
  return language;
}

function getLocalDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(dateKey: string, language: LanguagePreference): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (language === "en") {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(date);
  }
  return `${year}年${month}月${day}日 ${new Intl.DateTimeFormat(localeFor(language), {
    weekday: "long"
  }).format(date)}`;
}

function formatMonthDisplay(year: number, month: number, language: LanguagePreference): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "long"
  }).format(new Date(year, month - 1, 1));
}

function formatTimestamp(value: string | null, language: LanguagePreference, t: Translator): string {
  if (!value) {
    return t("none");
  }
  return new Intl.DateTimeFormat(localeFor(language), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTimeDisplay(value: string | null, language: LanguagePreference, t: Translator): string {
  if (!value) {
    return t("none");
  }
  return new Intl.DateTimeFormat(localeFor(language), {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateOnlyDisplay(dateKey: string, language: LanguagePreference): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (language === "en") {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(date);
  }
  return `${year}年${month}月${day}日`;
}

function formatShortDateDisplay(dateKey: string, language: LanguagePreference): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (language === "en") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric"
    }).format(date);
  }
  return `${month}月${day}日`;
}

function summary(value: string | null, t: Translator): string {
  return value?.trim() || t("none");
}

function countCharacters(value: string | null | undefined): number {
  return countTextMetricCharacters(value);
}

function filledCountLabel(value: string | null | undefined, t: Translator): string {
  const count = countCharacters(value);
  return value?.trim() ? t("filledWithCount").replace("{count}", String(count)) : t("unfilled");
}

function memoSummary(value: string | null | undefined, t: Translator): string {
  const normalized = (value ?? "")
    .replace(/!\[[^\]]*\]\(attachment:\/\/[^)]+\)/g, `[${t("imageAttachmentLabel")}]`)
    .replace(/[#>*_`-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || t("memoEmptySummary");
}

function statusLabel(value: DailyWorkItemStatus | null | undefined, t: Translator): string {
  if (value === "done_today") {
    return t("statusDoneToday");
  }
  if (value === "paused") {
    return t("statusPaused");
  }
  if (value === "in_progress") {
    return t("statusContinue");
  }
  return t("statusUnfilled");
}

function workItemRowStatus(block: DailyWorkItemBlock, t: Translator): { label: string; className: string } {
  if (block.entry?.status_for_today === "paused") {
    return { label: t("statusPaused"), className: "paused" };
  }
  if (block.entry?.status_for_today === "done_today" || block.workItem.status === "done") {
    return { label: t("statusDone"), className: "done" };
  }
  if (block.workItem.status === "paused") {
    return { label: t("statusPaused"), className: "paused" };
  }
  return { label: t("statusActive"), className: "active" };
}

function workItemLifecycleStatusLabel(status: WorkItemStatus, t: Translator): string {
  if (status === "done") {
    return t("statusDone");
  }
  if (status === "paused") {
    return t("statusPaused");
  }
  return t("statusActive");
}

function dateKeyParts(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

function parseDateKey(dateKey: string): Date | null {
  const [year, month, day] = dateKey.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day);
}

function dateRangeForReportFilter(filter: ReportTimeFilter): { start: Date; end: Date } | null {
  if (filter === "all") {
    return null;
  }
  const today = parseDateKey(getLocalDateKey()) ?? new Date();
  const start = new Date(today);
  const end = new Date(today);

  if (filter === "last7") {
    start.setDate(today.getDate() - 6);
  } else if (filter === "last30") {
    start.setDate(today.getDate() - 29);
  } else if (filter === "thisMonth") {
    start.setDate(1);
    end.setMonth(today.getMonth() + 1, 0);
  } else if (filter === "lastMonth") {
    start.setMonth(today.getMonth() - 1, 1);
    end.setMonth(today.getMonth(), 0);
  }

  return { start, end };
}

function reportMatchesTimeFilter(report: ReportItem, filter: ReportTimeFilter): boolean {
  const range = dateRangeForReportFilter(filter);
  if (!range) {
    return true;
  }
  const start = parseDateKey(report.periodStart);
  const end = parseDateKey(report.periodEnd);
  if (!start || !end) {
    return true;
  }
  return end >= range.start && start <= range.end;
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const candidates = values.filter(Boolean) as string[];
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((latest, value) => (new Date(value) > new Date(latest) ? value : latest));
}

function latestBlockSavedAt(block: DailyWorkItemBlock): string | null {
  return latestTimestamp([block.entry?.updated_at, block.workItemNote.updated_at]);
}

function todayBlocks(dailyView: DailyJournalView): DailyWorkItemBlock[] {
  return dailyView.groups.flatMap((group) => group.items);
}

function findDailyWorkItemBlock(
  dailyView: DailyJournalView | null,
  workItemId: string
): DailyWorkItemBlock | null {
  return dailyView ? todayBlocks(dailyView).find((block) => block.workItem.id === workItemId) ?? null : null;
}

function blockAppearsInTodayConstellation(block: DailyWorkItemBlock): boolean {
  return block.workItem.status !== "done" && block.entry?.status_for_today !== "done_today";
}

function workItemStatusAfterDailyEntrySave(
  block: DailyWorkItemBlock,
  entry: DailyWorkItemEntry | null,
  statusForToday?: DailyWorkItemStatus
): WorkItemStatus {
  const savedStatus = entry?.status_for_today ?? statusForToday;
  if (savedStatus === "done_today") {
    return "done";
  }
  if (savedStatus === "paused") {
    return "paused";
  }
  if (savedStatus === "in_progress") {
    return "active";
  }
  return block.workItem.status;
}

function dailyEntryCountsAsFilled(
  entry: DailyWorkItemEntry | null | undefined,
  previousEntry: DailyWorkItemEntry | null | undefined
): boolean {
  if (!entry) {
    return false;
  }
  const previousNextStep = normalizeDailyFormText(previousEntry?.next_step).trim();
  const previousBlocker = normalizeDailyFormText(previousEntry?.blocker).trim();
  return Boolean(
    entry.today_progress?.trim() ||
      (entry.next_step !== null && normalizeDailyFormText(entry.next_step).trim() !== previousNextStep) ||
      (entry.blocker !== null && normalizeDailyFormText(entry.blocker).trim() !== previousBlocker)
  );
}

function blockHasFilledDailyEntry(block: DailyWorkItemBlock): boolean {
  return dailyEntryCountsAsFilled(block.entry, block.previousEntry);
}

function dailyEntryHasChangeSummary(entry: DailyWorkItemEntry | null | undefined): boolean {
  return Boolean(entry?.today_progress?.trim());
}

function blockHasChangeSummary(block: DailyWorkItemBlock): boolean {
  return dailyEntryHasChangeSummary(block.entry);
}

function normalizeDailyFormText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function inheritedDailyFormField(
  currentValue: string | null | undefined,
  previousValue: string | null | undefined
): string {
  return currentValue === null || currentValue === undefined ? previousValue ?? "" : currentValue;
}

function dailyStatusForWorkItem(status: WorkItemStatus): DailyWorkItemStatus {
  if (status === "done") {
    return "done_today";
  }
  if (status === "paused") {
    return "paused";
  }
  return "in_progress";
}

function dailyStatusForBlock(block: DailyWorkItemBlock): DailyWorkItemStatus {
  return block.entry?.status_for_today ?? dailyStatusForWorkItem(block.workItem.status);
}

function dailyFormBaselineForBlock(block: DailyWorkItemBlock): DailyEntryForm {
  return {
    workItemNoteContent: block.workItemNote.content_markdown ?? "",
    todayProgress: block.entry?.today_progress ?? "",
    nextStep: inheritedDailyFormField(block.entry?.next_step, block.previousEntry?.next_step),
    blocker: inheritedDailyFormField(block.entry?.blocker, block.previousEntry?.blocker),
    statusForToday: dailyStatusForBlock(block)
  };
}

function dailyBlockerForDisplay(block: DailyWorkItemBlock): string {
  return dailyFormBaselineForBlock(block).blocker.trim();
}

function dailyFormPayloadForBlock(
  block: DailyWorkItemBlock,
  form: DailyEntryForm
): Pick<DailyEntryForm, "statusForToday"> &
  Partial<Pick<DailyEntryForm, "todayProgress" | "nextStep" | "blocker">> {
  const baseline = dailyFormBaselineForBlock(block);
  const payload: Pick<DailyEntryForm, "statusForToday"> &
    Partial<Pick<DailyEntryForm, "todayProgress" | "nextStep" | "blocker">> = {
    statusForToday: form.statusForToday
  };
  if (normalizeDailyFormText(form.todayProgress) !== normalizeDailyFormText(baseline.todayProgress)) {
    payload.todayProgress = form.todayProgress;
  }
  if (normalizeDailyFormText(form.nextStep) !== normalizeDailyFormText(baseline.nextStep)) {
    payload.nextStep = form.nextStep;
  }
  if (normalizeDailyFormText(form.blocker) !== normalizeDailyFormText(baseline.blocker)) {
    payload.blocker = form.blocker;
  }
  return payload;
}

function dailyFormDailyFieldsEqual(a: DailyEntryForm, b: DailyEntryForm): boolean {
  return (
    normalizeDailyFormText(a.todayProgress) === normalizeDailyFormText(b.todayProgress) &&
    normalizeDailyFormText(a.nextStep) === normalizeDailyFormText(b.nextStep) &&
    normalizeDailyFormText(a.blocker) === normalizeDailyFormText(b.blocker) &&
    a.statusForToday === b.statusForToday
  );
}

function hasDailyDisplayFieldChange(block: DailyWorkItemBlock, form: DailyEntryForm): boolean {
  return !dailyFormDailyFieldsEqual(form, dailyFormBaselineForBlock(block));
}

function updateDailyViewAfterEntrySave(
  dailyView: DailyJournalView,
  workItemId: string,
  entry: DailyWorkItemEntry | null,
  workItemNote: WorkItemNote,
  workItemStatus?: WorkItemStatus
): DailyJournalView {
  const groups = dailyView.groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.workItem.id === workItemId
        ? {
            ...item,
            workItem: workItemStatus
              ? {
                  ...item.workItem,
                  status: workItemStatus
                }
              : item.workItem,
            entry,
            workItemNote
          }
        : item
    )
  }));
  const blocks = groups.flatMap((group) => group.items);
  return {
    ...dailyView,
    stats: {
      ...dailyView.stats,
      filledEntries: blocks.filter(blockHasFilledDailyEntry).length,
      completedToday: blocks.filter((block) => block.entry?.status_for_today === "done_today").length
    },
    groups
  };
}

type TodayReminderTone = "warning" | "danger" | "neutral";

interface TodayReminder {
  id: string;
  tone: TodayReminderTone;
  label: string;
  title: string;
  meta: string;
  block?: DailyWorkItemBlock;
}

function buildTodayReminders(dailyView: DailyJournalView, t: Translator, language: LanguagePreference): TodayReminder[] {
  const blocks = todayBlocks(dailyView);
  const missingSummaryBlocks = blocks.filter((block) => !blockHasChangeSummary(block));
  const blockerBlocks = blocks.filter((block) => dailyBlockerForDisplay(block));
  const reminders: TodayReminder[] = [];

  if (missingSummaryBlocks.length > 0) {
    const first = missingSummaryBlocks[0];
    reminders.push({
      id: "missing-summary",
      tone: "warning",
      label: t("todayReminderMissingSummary"),
      title: t("todayReminderMissingSummaryCount").replace("{count}", String(missingSummaryBlocks.length)),
      meta: first.workItem.title,
      block: first
    });
  }

  if (blockerBlocks.length > 0) {
    const first = blockerBlocks[0];
    reminders.push({
      id: "has-blocker",
      tone: "danger",
      label: t("todayReminderHasBlocker"),
      title: t("todayReminderHasBlockerCount").replace("{count}", String(blockerBlocks.length)),
      meta: first.workItem.title,
      block: first
    });
  }

  if (dailyView.journal.status !== "closed") {
    reminders.push({
      id: "report-open",
      tone: "neutral",
      label: t("todayReminderReportOpen"),
      title: t("todayReminderReportOpenTitle"),
      meta: formatDateDisplay(dailyView.journalDate, language)
    });
  }

  return reminders.slice(0, 3);
}

function normalizeGeneratedWhitespace(value: string): string {
  return value
    .replace(/&amp;(?:nbsp|#0*160|#x0*a0);/gi, " ")
    .replace(/&(?:nbsp|#0*160|#x0*a0);/gi, " ")
    .replace(/\u00a0/g, " ");
}

function sanitizeGeneratedChangeDraft(value: string): string {
  return normalizeGeneratedWhitespace(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line) => !/^\s*(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownDiffBlocks(value: string): string[] {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push(paragraph.join(" ").replace(/\s+/g, " ").trim());
      paragraph = [];
    }
  };
  for (const rawLine of normalizeGeneratedWhitespace(value).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks.filter(Boolean);
}

function markdownImageRefs(value: string): string[] {
  return [...value.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]).filter(Boolean);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function diffAdded(current: string[], previous: string[]): string[] {
  const previousSet = new Set(previous);
  return current.filter((value) => !previousSet.has(value));
}

function cleanDiffBlock(value: string, t: Translator): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, `[${t("imageAttachmentLabel")}]`)
    .replace(/^#{1,6}\s+/, "")
    .replace(/[*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDiffList(values: string[], t: Translator): string {
  return values.map((value) => cleanDiffBlock(value, t)).filter(Boolean).map((value) => `  - ${value}`).join("\n");
}

function buildLocalChangeDraft(previousContent: string, currentContent: string, t: Translator): string {
  const previousBlocks = uniqueValues(markdownDiffBlocks(previousContent));
  const currentBlocks = uniqueValues(markdownDiffBlocks(currentContent));
  const addedBlocks = diffAdded(currentBlocks, previousBlocks);
  const removedBlocks = diffAdded(previousBlocks, currentBlocks);
  const previousImages = uniqueValues(markdownImageRefs(previousContent));
  const currentImages = uniqueValues(markdownImageRefs(currentContent));
  const addedImages = diffAdded(currentImages, previousImages);
  const removedImages = diffAdded(previousImages, currentImages);
  const lines: string[] = [];

  if (addedBlocks.length > 0 && removedBlocks.length > 0) {
    lines.push(`- ${t("changeDraftUpdated")}:\n${formatDiffList(addedBlocks, t)}`);
    lines.push(`- ${t("changeDraftRemoved")}:\n${formatDiffList(removedBlocks, t)}`);
  } else if (addedBlocks.length > 0) {
    lines.push(`- ${t("changeDraftAdded")}:\n${formatDiffList(addedBlocks, t)}`);
  } else if (removedBlocks.length > 0) {
    lines.push(`- ${t("changeDraftRemoved")}:\n${formatDiffList(removedBlocks, t)}`);
  }
  if (addedImages.length > 0) {
    lines.push(`- ${t("changeDraftAddedImages")}: ${addedImages.length}`);
  }
  if (removedImages.length > 0) {
    lines.push(`- ${t("changeDraftRemovedImages")}: ${removedImages.length}`);
  }
  return lines.length > 0 ? lines.join("\n") : t("changeDraftNoChanges");
}

function storageDisplay(
  settings: SettingsInfo | null,
  t: Translator
): { detail: string; title: string; isWarning: boolean } {
  if (!settings) {
    return { detail: t("storageLoading"), title: "", isWarning: false };
  }
  if (settings.isFallbackDataDirectory) {
    return {
      detail: t("storageAttention"),
      title: `${t("storageCurrentDir")}：${settings.dataDirectory}\n${t("storageConfiguredDir")}：${
        settings.configuredDataDirectory || t("storageConfiguredNone")
      }\n${t("storageReason")}：${settings.fallbackReason || t("storageDefaultFallback")}`,
      isWarning: true
    };
  }
  if (!settings.isCustomDataDirectory) {
    return {
      detail: t("storageNormal"),
      title: `${t("storageCurrentDir")}：${settings.dataDirectory}`,
      isWarning: false
    };
  }
  return {
    detail: t("storageNormal"),
    title: `${t("storageCurrentDir")}：${settings.dataDirectory}`,
    isWarning: false
  };
}

function formatVersionLabel(version: string | undefined): string {
  const cleanVersion = version?.trim();
  return cleanVersion ? `v${cleanVersion.replace(/^v/i, "")}` : "v0.1.0";
}

function sidebarUpdateDisplay(
  status: AppUpdateStatus | null,
  appVersion: string,
  t: Translator
): { label: string; title: string; hasUpdate: boolean } {
  const currentVersion = formatVersionLabel(status?.currentVersion ?? appVersion);
  if (status?.status === "update-available" && status.latestVersion) {
    const latestVersion = formatVersionLabel(status.latestVersion);
    return {
      label: t("sidebarUpdateAvailable").replace("{version}", latestVersion),
      title: t("sidebarUpdateAvailableTitle").replace("{version}", latestVersion),
      hasUpdate: true
    };
  }
  return {
    label: t("sidebarCurrentVersion").replace("{version}", currentVersion),
    title: t("sidebarCurrentVersionTitle").replace("{version}", currentVersion),
    hasUpdate: false
  };
}

function searchFieldLabel(value: string, t: Translator): string {
  if (value === "todayProgress" || value === "legacyProgress") {
    return t("progressToday");
  }
  if (value === "nextStep" || value === "legacyNextStep") {
    return t("nextStepPlan");
  }
  if (value === "blocker" || value === "legacyBlocker") {
    return t("blocker");
  }
  if (value === "dailyReport") {
    return t("dailyReport");
  }
  if (value === "projectMemo") {
    return t("projectMemo");
  }
  if (value === "workItemNote") {
    return t("workItemCurrentContent");
  }
  if (value === "workItemDescription") {
    return t("workItemDescription");
  }
  if (value === "workItemTitle") {
    return t("workItemTitle");
  }
  if (value === "projectName") {
    return t("projectName");
  }
  if (value === "进展内容") {
    return t("progressToday");
  }
  if (value === "下一步计划") {
    return t("nextStepPlan");
  }
  if (value === "阻碍") {
    return t("blocker");
  }
  if (value === "事项标题") {
    return t("workItemTitle");
  }
  if (value === "项目名称") {
    return t("projectName");
  }
  return value;
}

function dataDirectoryChangeMessage(operation: string | undefined, t: Translator): string {
  if (operation === "created") {
    return t("dataDirectoryCreateSuccess");
  }
  if (operation === "switched") {
    return t("dataDirectorySwitchSuccess");
  }
  if (operation === "unchanged") {
    return t("dataDirectoryUnchanged");
  }
  return t("dataDirectorySwitchSuccess");
}

function compactToastMessage(message: string): string {
  const masked = message.replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***");
  const compact = masked.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function markdownEditorLabels(t: Translator): MarkdownEditorLabels {
  return {
    toolbarLabel: t("editorToolbarLabel"),
    contextMenuLabel: t("editorContextMenuLabel"),
    paragraph: t("editorParagraph"),
    heading: t("editorHeading"),
    heading1: t("editorHeading1"),
    heading2: t("editorHeading2"),
    heading3: t("editorHeading3"),
    heading4: t("editorHeading4"),
    heading5: t("editorHeading5"),
    heading6: t("editorHeading6"),
    bulletedList: t("editorBulletedList"),
    numberedList: t("editorNumberedList"),
    taskList: t("editorTaskList"),
    quote: t("editorQuote"),
    codeBlock: t("editorCodeBlock"),
    highlightBlock: t("editorHighlightBlock"),
    cut: t("editorCut"),
    copy: t("editorCopy"),
    paste: t("editorPaste"),
    pasteAsPlainText: t("editorPasteAsPlainText"),
    saveImageAs: t("editorSaveImageAs"),
    saveImageAsUnsupported: t("editorSaveImageAsUnsupported"),
    imageSaved: t("editorImageSaved"),
    imageSaveFailed: t("editorImageSaveFailed"),
    clipboardEmpty: t("editorClipboardEmpty"),
    highlightPlaceholder: t("editorHighlightPlaceholder")
  };
}

function App() {
  const [view, setView] = useState<View>("today");
  const [userGuideReturnView, setUserGuideReturnView] = useState<UserGuideReturnView>("settings");
  const [dailyView, setDailyView] = useState<DailyJournalView | null>(null);
  const [dailyForms, setDailyForms] = useState<Record<string, DailyEntryForm>>({});
  const [dailyEditorTarget, setDailyEditorTarget] = useState<DailyEntryEditorTarget | null>(null);
  const [dailyEditorReturnView, setDailyEditorReturnView] = useState<"today" | "project-detail">("today");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ProjectListItem[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [dailyReports, setDailyReports] = useState<DailyReportListItem[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [weeklyReports, setWeeklyReports] = useState<PeriodReportListItem[]>([]);
  const [monthlyReports, setMonthlyReports] = useState<PeriodReportListItem[]>([]);
  const [selectedWeeklyReportId, setSelectedWeeklyReportId] = useState<string | null>(null);
  const [selectedMonthlyReportId, setSelectedMonthlyReportId] = useState<string | null>(null);
  const [heatmapYear, setHeatmapYear] = useState(() => new Date().getFullYear());
  const [heatmapMonth, setHeatmapMonth] = useState(() => new Date().getMonth() + 1);
  const [heatmapData, setHeatmapData] = useState<HeatmapMonth | null>(null);
  const [todayHeatmapData, setTodayHeatmapData] = useState<HeatmapMonth | null>(null);
  const [todayHeatmapFailed, setTodayHeatmapFailed] = useState(false);
  const [todayVisualPulse, setTodayVisualPulse] = useState<TodayVisualPulse | null>(null);
  const [todayConstellationTransition, setTodayConstellationTransition] =
    useState<TodayConstellationTransition | null>(null);
  const [selectedHeatmapDate, setSelectedHeatmapDate] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetailReturnView, setProjectDetailReturnView] = useState<"projects" | "archive">("projects");
  const [projectMemo, setProjectMemo] = useState<ProjectMemo | null>(null);
  const [projectMemoContent, setProjectMemoContent] = useState("");
  const [projectMemoReturnView, setProjectMemoReturnView] = useState<"today" | "project-detail">("project-detail");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [todayQuickCollapsed, setTodayQuickCollapsed] = useState(false);
  const [detailQuickCollapsed, setDetailQuickCollapsed] = useState(true);
  const [quickForm, setQuickForm] = useState<QuickProgressForm>(emptyQuickForm);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [todaySearchTarget, setTodaySearchTarget] = useState<TodaySearchTarget | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newWorkItemOpen, setNewWorkItemOpen] = useState(false);
  const [quickProjectOpen, setQuickProjectOpen] = useState(false);
  const [quickWorkItemOpen, setQuickWorkItemOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [editWorkItemTarget, setEditWorkItemTarget] = useState<WorkItemWithLatest | null>(null);
  const [workItemEditStatus, setWorkItemEditStatus] =
    useState<Extract<WorkItemStatus, "active" | "done" | "paused">>("active");
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string>("0.1.0");
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [settingsScrollTarget, setSettingsScrollTarget] = useState<string | null>(null);
  const [isChangingDataDirectory, setIsChangingDataDirectory] = useState(false);
  const [settingsBusyAction, setSettingsBusyAction] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<Toast | null>(null);
  const [projectForm, setProjectForm] = useState({ name: "", description: "" });
  const [workItemForm, setWorkItemForm] = useState({ title: "", description: "" });
  const [quickProjectForm, setQuickProjectForm] = useState({ name: "", description: "" });
  const [quickWorkItemForm, setQuickWorkItemForm] = useState({ title: "", description: "" });
  const [markdownPayload, setMarkdownPayload] = useState<MarkdownPayload | null>(null);
  const [historyRecoveryViewer, setHistoryRecoveryViewer] = useState<WorkItemHistoryRecovery | null>(null);
  const [projectDeleteSummary, setProjectDeleteSummary] = useState<ProjectDeleteSummary | null>(null);
  const [workItemDeleteTarget, setWorkItemDeleteTarget] = useState<{
    item: WorkItemWithLatest;
    summary: WorkItemDeleteSummary;
  } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [hasUnsavedReportChanges, setHasUnsavedReportChanges] = useState(false);
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const currentEditorSaveRef = useRef<(options?: EditorSaveOptions) => Promise<boolean>>(async () => false);
  const currentViewRef = useRef<View>(view);
  const selectedProjectIdRef = useRef<string | null>(selectedProjectId);
  const detailLoadRequestRef = useRef(0);
  const dailyEditorTargetRef = useRef<DailyEntryEditorTarget | null>(dailyEditorTarget);
  const dailyViewRef = useRef<DailyJournalView | null>(dailyView);
  const saveInFlightRef = useRef(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const todayScrollPositionsRef = useRef<Record<string, number>>({});
  const pendingTodayScrollRestoreKeyRef = useRef<string | null>(null);
  const todayConstellationTransitionSequenceRef = useRef(0);
  const todayConstellationTransitionRef = useRef<TodayConstellationTransition | null>(null);
  const todaySearchTargetSequenceRef = useRef(0);
  const language = settingsInfo?.language ?? "zh-CN";
  const effectiveTheme = settingsInfo?.effectiveTheme ?? "light";
  const t = useMemo(() => createTranslator(language), [language]);

  const showToast = (toastValue: Toast) => {
    setToast({ ...toastValue, message: compactToastMessage(toastValue.message) });
    window.setTimeout(() => setToast(null), 2600);
  };

  const queueTodayConstellationTransition = (
    kind: TodayConstellationTransitionKind,
    journalDate: string,
    projectId: string,
    workItemId: string,
    node: TodayConstellationNode | null
  ) => {
    todayConstellationTransitionSequenceRef.current += 1;
    const nextTransition: TodayConstellationTransition = {
      id: todayConstellationTransitionSequenceRef.current,
      journalDate,
      projectId,
      workItemId,
      kind,
      node
    };
    todayConstellationTransitionRef.current = nextTransition;
    setTodayVisualPulse(null);
    setTodayConstellationTransition(nextTransition);
  };

  const queueTodayVisualPulse = (pulse: TodayVisualPulse) => {
    if (todayConstellationTransitionRef.current) {
      return;
    }
    setTodayVisualPulse(pulse);
  };

  const handleTodayConstellationTransitionComplete = (transitionId: number) => {
    setTodayConstellationTransition((current) => {
      if (current?.id !== transitionId) {
        return current;
      }
      if (todayConstellationTransitionRef.current?.id === transitionId) {
        todayConstellationTransitionRef.current = null;
      }
      return null;
    });
  };

  useEffect(() => {
    currentViewRef.current = view;
    selectedProjectIdRef.current = selectedProjectId;
    dailyEditorTargetRef.current = dailyEditorTarget;
    dailyViewRef.current = dailyView;
  });

  const requestConfirm = (options: AppConfirmOptions): Promise<boolean> => {
    if (confirmResolveRef.current) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setPendingConfirm({
        secondaryLabel: t("cancel"),
        tone: "info",
        ...options,
        resolve
      });
    });
  };

  const resolveConfirm = (confirmed: boolean) => {
    const resolver = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setPendingConfirm(null);
    resolver?.(confirmed);
  };
  const todayScrollKey = (journalDate: string) => `today-scroll-position-${journalDate}`;

  const getTodayScrollElement = (): HTMLElement | null =>
    workspaceRef.current?.querySelector<HTMLElement>(".daily-page") ?? workspaceRef.current;

  const rememberTodayScrollPosition = (journalDate: string) => {
    const key = todayScrollKey(journalDate);
    const scrollTop = getTodayScrollElement()?.scrollTop ?? 0;
    todayScrollPositionsRef.current[key] = scrollTop;
    pendingTodayScrollRestoreKeyRef.current = key;
    try {
      window.sessionStorage.setItem(key, String(scrollTop));
    } catch {
      // sessionStorage can be unavailable in restricted contexts; in-memory restore still works.
    }
  };

  const loadTodayHeatmap = async (dateKey: string) => {
    const { year, month } = dateKeyParts(dateKey);
    try {
      const data = await window.workJournal.heatmap.getMonthlyHeatmap(year, month);
      setTodayHeatmapData(data);
      setTodayHeatmapFailed(false);
    } catch {
      setTodayHeatmapData(null);
      setTodayHeatmapFailed(true);
    }
  };

  const loadToday = async (constellationTarget?: TodayConstellationRefreshTarget) => {
    const previousDailyView = dailyViewRef.current;
    const nextDailyView = await window.workJournal.daily.getTodayJournal();
    if (constellationTarget && previousDailyView?.journalDate === nextDailyView.journalDate) {
      const previousBlock = findDailyWorkItemBlock(previousDailyView, constellationTarget.workItemId);
      const nextBlock = findDailyWorkItemBlock(nextDailyView, constellationTarget.workItemId);
      const wasVisible = previousBlock ? blockAppearsInTodayConstellation(previousBlock) : false;
      const isVisible = nextBlock ? blockAppearsInTodayConstellation(nextBlock) : false;

      if (wasVisible !== isVisible) {
        const kind: TodayConstellationTransitionKind = isVisible ? "enter" : "exit";
        queueTodayConstellationTransition(
          kind,
          nextDailyView.journalDate,
          nextBlock?.project.id ?? previousBlock?.project.id ?? constellationTarget.projectId,
          constellationTarget.workItemId,
          findTodayConstellationNode(kind === "enter" ? nextDailyView : previousDailyView, constellationTarget.workItemId)
        );
      }
    }
    dailyViewRef.current = nextDailyView;
    setDailyView(nextDailyView);
    void loadTodayHeatmap(nextDailyView.journalDate);
    setDailyForms(() => {
      const next: Record<string, DailyEntryForm> = {};
      for (const group of nextDailyView.groups) {
        for (const block of group.items) {
          next[block.workItem.id] = dailyFormBaselineForBlock(block);
        }
      }
      return next;
    });
  };

  const loadProjects = async () => {
    setProjects(await window.workJournal.projects.listActive());
  };

  const loadArchivedProjects = async () => {
    setArchivedProjects(await window.workJournal.projects.listArchived());
  };

  const loadReports = async () => {
    const [reports, weekly, monthly] = await Promise.all([
      window.workJournal.reports.listDaily(),
      window.workJournal.reports.listPeriod("weekly"),
      window.workJournal.reports.listPeriod("monthly")
    ]);
    setDailyReports(reports);
    setWeeklyReports(weekly);
    setMonthlyReports(monthly);
    setSelectedReportId((current) => {
      if (current && reports.some((report) => report.id === current)) {
        return current;
      }
      return reports[0]?.id ?? null;
    });
    setSelectedWeeklyReportId((current) => {
      if (current && weekly.some((report) => report.id === current)) {
        return current;
      }
      return weekly[0]?.id ?? null;
    });
    setSelectedMonthlyReportId((current) => {
      if (current && monthly.some((report) => report.id === current)) {
        return current;
      }
      return monthly[0]?.id ?? null;
    });
  };

  const loadHeatmap = async (year = heatmapYear, month = heatmapMonth) => {
    const data = await window.workJournal.heatmap.getMonthlyHeatmap(year, month);
    setHeatmapData(data);
    setSelectedHeatmapDate((current) => {
      if (current && data.days.some((day) => day.date === current)) {
        return current;
      }
      const today = getLocalDateKey();
      const todayInMonth = data.days.find((day) => day.date === today);
      return todayInMonth?.date ?? data.days.find((day) => day.activityScore > 0)?.date ?? data.days[0]?.date ?? null;
    });
  };

  const loadDetail = async (id: string) => {
    const requestId = ++detailLoadRequestRef.current;
    try {
      const nextDetail = await window.workJournal.projects.getDetail(id);
      if (detailLoadRequestRef.current !== requestId || selectedProjectIdRef.current !== id) {
        return false;
      }
      setDetail(nextDetail);
      return true;
    } catch (error) {
      if (detailLoadRequestRef.current !== requestId || selectedProjectIdRef.current !== id) {
        return false;
      }
      throw error;
    }
  };

  const applyEffectiveTheme = (settings: SettingsInfo) => {
    document.documentElement.dataset.theme = settings.effectiveTheme;
    document.documentElement.style.colorScheme = settings.effectiveTheme;
  };

  const loadSettings = async () => {
    const settings = await window.workJournal.settings.get();
    setSettingsInfo(settings);
    applyEffectiveTheme(settings);
    return settings;
  };

  const refreshActiveView = async (
    projectId: string | null = selectedProjectId,
    constellationTarget?: TodayConstellationRefreshTarget
  ) => {
    await Promise.all([loadToday(constellationTarget), loadProjects(), loadReports(), loadHeatmap()]);
    if (projectId) {
      await loadDetail(projectId);
    }
  };

  useLayoutEffect(() => {
    if (view !== "today" || !dailyView) {
      return;
    }

    const key = todayScrollKey(dailyView.journalDate);
    if (pendingTodayScrollRestoreKeyRef.current !== key) {
      return;
    }

    let storedScrollTop: number | undefined;
    try {
      const storedValue = window.sessionStorage.getItem(key);
      storedScrollTop = storedValue === null ? undefined : Number(storedValue);
    } catch {
      storedScrollTop = undefined;
    }

    const savedValue = todayScrollPositionsRef.current[key] ?? storedScrollTop;
    if (!Number.isFinite(savedValue)) {
      pendingTodayScrollRestoreKeyRef.current = null;
      return;
    }

    let restored = false;
    const restore = () => {
      if (restored) {
        return;
      }
      const element = getTodayScrollElement();
      if (!element) {
        return;
      }
      element.scrollTop = Math.max(0, savedValue);
      pendingTodayScrollRestoreKeyRef.current = null;
      restored = true;
    };

    const frame = window.requestAnimationFrame(restore);
    const handle = window.setTimeout(restore, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(handle);
    };
  }, [view, dailyView]);

  useEffect(() => {
    Promise.all([refreshActiveView(), loadArchivedProjects()]).catch((error) =>
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("loadFailed") })
    );
    loadSettings().catch((error) =>
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("settingsLoadFailed") })
    );
    const unsubscribe = window.workJournal.settings.onChanged((settings) => {
      setSettingsInfo(settings);
      applyEffectiveTheme(settings);
    });
    const unsubscribeAutoReport =
      typeof window.workJournal.daily.onAutoReportGenerated === "function"
        ? window.workJournal.daily.onAutoReportGenerated((event: DailyAutoReportEvent) => {
            if (!event.success) {
              showToast({ kind: "error", message: `${t("dailyAutoReportFailed")}：${event.error}` });
              return;
            }

            setMarkdownPayload(event);
            refreshActiveView().catch((error) =>
              showToast({ kind: "error", message: error instanceof Error ? error.message : t("loadFailed") })
            );
            showToast({
              kind: event.reportSyncError ? "error" : "success",
              message: event.reportSyncError
                ? `${t("dailyAutoReportSyncFailed")}：${event.reportSyncError}`
                : t("dailyAutoReportGenerated")
            });
          })
        : () => undefined;
    const unsubscribeAutoReportRequest =
      typeof window.workJournal.daily.onAutoReportRequest === "function"
        ? window.workJournal.daily.onAutoReportRequest(async (request: DailyAutoReportRequest) => {
            let ok = true;
            let errorMessage: string | undefined;
            try {
              const target = dailyEditorTargetRef.current;
              const currentDailyView = dailyViewRef.current;
              if (
                currentViewRef.current === "daily-entry-editor" &&
                target?.journalDate === request.journalDate &&
                currentDailyView?.journal.status !== "closed"
              ) {
                ok = await requestCurrentEditorSave({ refresh: false, showSuccess: false });
              }
            } catch (error) {
              ok = false;
              errorMessage = error instanceof Error ? error.message : String(error);
            } finally {
              window.workJournal.daily.completeAutoReportRequest({
                requestId: request.requestId,
                ok,
                ...(errorMessage ? { error: errorMessage } : {})
              });
            }
          })
        : () => undefined;
    return () => {
      unsubscribe();
      unsubscribeAutoReport();
      unsubscribeAutoReportRequest();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const handleStatus = (status: AppUpdateStatus) => {
      if (!isMounted) {
        return;
      }
      setUpdateStatus(status);
      setAppVersion(status.currentVersion);
    };

    window.workJournal.appInfo
      .getVersion()
      .then((version) => {
        if (isMounted) {
          setAppVersion(version);
        }
      })
      .catch(() => undefined);

    window.workJournal.updates
      .getStatus()
      .then(handleStatus)
      .catch(() => undefined);

    const dispose = window.workJournal.updates.onStatus(handleStatus);
    return () => {
      isMounted = false;
      dispose();
    };
  }, []);

  useEffect(() => {
    if (view !== "settings" || !settingsScrollTarget) {
      return;
    }

    const handle = window.setTimeout(() => {
      document.getElementById(settingsScrollTarget)?.scrollIntoView({ block: "start", behavior: "smooth" });
      setSettingsScrollTarget(null);
    }, 80);

    return () => window.clearTimeout(handle);
  }, [view, settingsScrollTarget]);

  useEffect(() => {
    loadHeatmap(heatmapYear, heatmapMonth).catch((error) =>
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("loadFailed") })
    );
  }, [heatmapYear, heatmapMonth]);

  useEffect(() => {
    const term = searchTerm.trim();
    if (!term) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    const handle = window.setTimeout(() => {
      window.workJournal.search
        .query(term)
        .then((results) => {
          const visibleResults = results
            .filter((result) =>
              ["project", "work_item", "progress", "daily_entry", "work_item_note"].includes(result.type)
            )
            .map<SearchResult>((result) =>
              result.type === "daily_entry" || result.type === "work_item_note"
                ? { ...result, type: "progress" }
                : result
            );
          setSearchResults(visibleResults);
        })
        .catch((error) =>
          showToast({ kind: "error", message: error instanceof Error ? error.message : t("searchFailed") })
        )
        .finally(() => setIsSearching(false));
    }, 160);

    return () => window.clearTimeout(handle);
  }, [searchTerm]);

  const allQuickItems = useMemo(() => {
    const items = new Map<string, WorkItemWithLatest>();
    dailyView?.groups.forEach((group) => {
      group.items.forEach((block) => items.set(block.workItem.id, block.workItem));
    });
    detail?.activeItems.forEach((item) => items.set(item.id, item));
    detail?.completedItems.forEach((item) => items.set(item.id, item));
    return [...items.values()];
  }, [dailyView, detail]);

  const quickWorkItems = allQuickItems.filter((item) => item.project_id === quickForm.projectId);

  const openProjectDetail = (projectId: string, returnView: "projects" | "archive" = "projects") => {
    setDetail(null);
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setProjectDetailReturnView(returnView);
    setDetailQuickCollapsed(true);
    currentViewRef.current = "project-detail";
    setView("project-detail");
    void loadDetail(projectId).catch((error) => {
      if (selectedProjectIdRef.current !== projectId) {
        return;
      }
      selectedProjectIdRef.current = null;
      setSelectedProjectId(null);
      setDetail(null);
      if (currentViewRef.current === "project-detail") {
        currentViewRef.current = returnView;
        setView(returnView);
      }
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectLoadFailed") });
    });
  };

  const openProjectMemo = async (projectId: string, returnView: "today" | "project-detail" = "project-detail") => {
    try {
      const [nextDetail, memo] = await Promise.all([
        window.workJournal.projects.getDetail(projectId),
        window.workJournal.memos.getProjectMemo(projectId)
      ]);
      selectedProjectIdRef.current = projectId;
      setSelectedProjectId(projectId);
      setDetail(nextDetail);
      setProjectMemo(memo);
      setProjectMemoContent(memo.content_markdown ?? "");
      setProjectMemoReturnView(returnView);
      setSearchTerm("");
      setSearchResults([]);
      setView("project-memo");
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectMemoLoadFailed") });
    }
  };

  const openDailyEntryEditor = (
    projectId: string,
    workItemId: string,
    journalDate = dailyView?.journalDate ?? getLocalDateKey(),
    returnView: "today" | "project-detail" = view === "project-detail" ? "project-detail" : "today"
  ) => {
    if (returnView === "today") {
      rememberTodayScrollPosition(journalDate);
    }
    setDailyEditorReturnView(returnView);
    setDailyEditorTarget({
      journalDate,
      projectId,
      workItemId
    });
    setView("daily-entry-editor");
  };

  const showHeatmapReport = (day: HeatmapDay) => {
    if (!day.reportMarkdown) {
      showToast({ kind: "error", message: t("noDailyReport") });
      return;
    }
    setMarkdownPayload({ date: day.date, markdown: day.reportMarkdown });
  };

  const moveHeatmapMonth = (offset: number) => {
    const next = new Date(heatmapYear, heatmapMonth - 1 + offset, 1);
    setHeatmapYear(next.getFullYear());
    setHeatmapMonth(next.getMonth() + 1);
  };

  const resetHeatmapToCurrentMonth = () => {
    const today = new Date();
    setHeatmapYear(today.getFullYear());
    setHeatmapMonth(today.getMonth() + 1);
  };

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const project = await window.workJournal.projects.create(projectForm);
      setProjectForm({ name: "", description: "" });
      setNewProjectOpen(false);
      await refreshActiveView();
      openProjectDetail(project.id);
      showToast({ kind: "success", message: t("projectCreateSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectCreateFailed") });
    }
  };

  const handleCreateQuickProject = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const project = await window.workJournal.projects.create(quickProjectForm);
      setQuickProjectForm({ name: "", description: "" });
      setQuickProjectOpen(false);
      setQuickForm((current) => ({
        ...current,
        projectId: project.id,
        workItemId: ""
      }));
      await refreshActiveView();
      showToast({ kind: "success", message: t("projectCreateSelectedSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectCreateFailed") });
    }
  };

  const handleUpdateProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail) {
      return;
    }
    try {
      await window.workJournal.projects.update({ id: detail.project.id, ...projectForm });
      setEditProjectOpen(false);
      await Promise.all([
        refreshActiveView(),
        detail.project.status === "archived" ? loadArchivedProjects() : Promise.resolve()
      ]);
      showToast({ kind: "success", message: t("projectUpdateSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectUpdateFailed") });
    }
  };

  const handleArchiveProject = async () => {
    if (!detail) {
      return;
    }
    const confirmed = await requestConfirm({
      title: t("archiveProjectConfirmTitle"),
      body: t("archiveProjectConfirmBody"),
      objectName: detail.project.name,
      primaryLabel: t("archiveProject"),
      tone: "warning"
    });
    if (!confirmed) {
      return;
    }
    try {
      await window.workJournal.projects.archive(detail.project.id);
      setView("projects");
      selectedProjectIdRef.current = null;
      setSelectedProjectId(null);
      setDetail(null);
      await Promise.all([refreshActiveView(null), loadArchivedProjects()]);
      showToast({ kind: "success", message: t("projectArchiveSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectArchiveFailed") });
    }
  };

  const handleUnarchiveProject = async () => {
    if (!detail || detail.project.status !== "archived") {
      return;
    }
    const confirmed = await requestConfirm({
      title: t("unarchiveProjectConfirmTitle"),
      body: t("unarchiveProjectConfirmBody"),
      objectName: detail.project.name,
      primaryLabel: t("unarchiveProject"),
      tone: "info"
    });
    if (!confirmed) {
      return;
    }
    const projectId = detail.project.id;
    const activeItemCount = detail.activeItems.length;
    let unarchivedProject: Project;
    try {
      unarchivedProject = await window.workJournal.projects.unarchive(projectId);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectUnarchiveFailed") });
      return;
    }

    setProjects((current) => [
      ...current.filter((project) => project.id !== projectId),
      { ...unarchivedProject, active_item_count: activeItemCount }
    ]);
    setArchivedProjects((current) => current.filter((project) => project.id !== projectId));
    currentViewRef.current = "projects";
    setView("projects");
    selectedProjectIdRef.current = null;
    setSelectedProjectId(null);
    setDetail(null);

    try {
      await Promise.all([refreshActiveView(null), loadArchivedProjects()]);
      showToast({ kind: "success", message: t("projectUnarchiveSuccess") });
    } catch {
      showToast({ kind: "warning", message: t("projectUnarchiveRefreshFailed") });
    }
  };


  const handleMoveProject = async (projectId: string, direction: SortMoveDirection) => {
    const index = projects.findIndex((project) => project.id === projectId);
    const isAtEdge = direction === "up" ? index <= 0 : index < 0 || index >= projects.length - 1;
    if (isAtEdge) {
      showToast({ kind: "info", message: direction === "up" ? t("alreadyAtTop") : t("alreadyAtBottom") });
      return;
    }
    try {
      await window.workJournal.projects.move(projectId, direction);
      await Promise.all([loadProjects(), loadToday()]);
      if (selectedProjectId) {
        await loadDetail(selectedProjectId);
      }
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectUpdateFailed") });
    }
  };

  const handleMoveWorkItem = async (item: WorkItemWithLatest, direction: SortMoveDirection, canMove: boolean) => {
    if (!canMove) {
      showToast({ kind: "info", message: direction === "up" ? t("alreadyAtTop") : t("alreadyAtBottom") });
      return;
    }
    try {
      await window.workJournal.workItems.move(item.id, direction);
      await Promise.all([loadToday(), selectedProjectId ? loadDetail(selectedProjectId) : Promise.resolve()]);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("workItemUpdateFailed") });
    }
  };
  const handleRequestDeleteProject = async () => {
    if (!detail) {
      return;
    }
    try {
      setProjectDeleteSummary(await window.workJournal.projects.getDeleteSummary(detail.project.id));
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("deleteFailed") });
    }
  };

  const handleConfirmDeleteProject = async () => {
    if (!detail) {
      return;
    }
    try {
      await window.workJournal.projects.delete(detail.project.id);
      setProjectDeleteSummary(null);
      selectedProjectIdRef.current = null;
      setSelectedProjectId(null);
      setDetail(null);
      setProjectMemo(null);
      setProjectMemoContent("");
      setView(projectDetailReturnView);
      setSearchTerm("");
      setSearchResults([]);
      await Promise.all([loadToday(), loadProjects(), loadArchivedProjects()]);
      showToast({ kind: "success", message: t("deleteSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("deleteFailed") });
    }
  };

  const handleCreateWorkItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail) {
      return;
    }
    const projectId = detail.project.id;
    try {
      const workItem = await window.workJournal.workItems.create({
        projectId,
        title: workItemForm.title,
        description: workItemForm.description
      });
      setWorkItemForm({ title: "", description: "" });
      setNewWorkItemOpen(false);
      await refreshActiveView(projectId, { projectId, workItemId: workItem.id });
      showToast({ kind: "success", message: t("workItemCreateSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("workItemCreateFailed") });
    }
  };

  const handleCreateQuickWorkItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!quickForm.projectId) {
      showToast({ kind: "error", message: t("chooseProjectFirst") });
      return;
    }
    const projectId = quickForm.projectId;
    try {
      const workItem = await window.workJournal.workItems.create({
        projectId,
        title: quickWorkItemForm.title,
        description: quickWorkItemForm.description
      });
      setQuickWorkItemForm({ title: "", description: "" });
      setQuickWorkItemOpen(false);
      setQuickForm((current) => ({
        ...current,
        workItemId: workItem.id
      }));
      await refreshActiveView(selectedProjectId, { projectId, workItemId: workItem.id });
      showToast({ kind: "success", message: t("workItemCreateSelectedSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("workItemCreateFailed") });
    }
  };

  const handleCompleteWorkItem = async (id: string) => {
    const projectId = detail?.project.id ?? findDailyWorkItemBlock(dailyViewRef.current, id)?.project.id ?? null;
    try {
      await window.workJournal.workItems.complete(id);
      await refreshActiveView(
        selectedProjectId,
        projectId ? { projectId, workItemId: id } : undefined
      );
      showToast({ kind: "success", message: t("workItemCompleteSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("workItemCompleteFailed") });
    }
  };

  const openEditWorkItem = (item: WorkItemWithLatest) => {
    setWorkItemForm({
      title: item.title,
      description: item.description || ""
    });
    setWorkItemEditStatus(item.status === "done" ? "done" : item.status === "paused" ? "paused" : "active");
    setEditWorkItemTarget(item);
  };

  const handleUpdateWorkItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!editWorkItemTarget) {
      return;
    }
    const target = editWorkItemTarget;
    const shouldRefreshArchivedProjects =
      detail?.project.status === "archived" && detail.project.id === target.project_id;
    try {
      await window.workJournal.workItems.update({
        id: target.id,
        title: workItemForm.title,
        description: workItemForm.description,
        status: workItemEditStatus
      });
      setEditWorkItemTarget(null);
      await Promise.all([
        refreshActiveView(selectedProjectId, { projectId: target.project_id, workItemId: target.id }),
        shouldRefreshArchivedProjects ? loadArchivedProjects() : Promise.resolve()
      ]);
      showToast({ kind: "success", message: t("workItemUpdateSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("workItemUpdateFailed") });
    }
  };

  const handleRequestDeleteWorkItem = async (item: WorkItemWithLatest) => {
    try {
      const summary = await window.workJournal.workItems.getDeleteSummary(item.id);
      setWorkItemDeleteTarget({ item, summary });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("deleteFailed") });
    }
  };

  const handleConfirmDeleteWorkItem = async () => {
    if (!workItemDeleteTarget) {
      return;
    }
    const shouldRefreshArchivedProjects =
      detail?.project.status === "archived" && detail.project.id === workItemDeleteTarget.item.project_id;
    try {
      await window.workJournal.workItems.delete(workItemDeleteTarget.item.id);
      setWorkItemDeleteTarget(null);
      setSearchTerm("");
      setSearchResults([]);
      await Promise.all([
        refreshActiveView(),
        shouldRefreshArchivedProjects ? loadArchivedProjects() : Promise.resolve()
      ]);
      showToast({ kind: "success", message: t("deleteSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("deleteFailed") });
    }
  };

  const handleSaveProjectMemo = async (options: EditorSaveOptions = {}): Promise<boolean> => {
    if (!detail) {
      return false;
    }
    if (options.skipUnchanged && projectMemoContent === (projectMemo?.content_markdown ?? "")) {
      return false;
    }
    if (options.skipEmpty && !projectMemoContent.trim() && !(projectMemo?.content_markdown ?? "").trim()) {
      return false;
    }
    try {
      const memo = await window.workJournal.memos.saveProjectMemo({
        projectId: detail.project.id,
        contentMarkdown: projectMemoContent
      });
      setProjectMemo(memo);
      if (options.refresh ?? true) {
        await loadProjects();
      }
      if (options.showSuccess ?? true) {
        showToast({ kind: "success", message: t("projectMemoSaveSuccess") });
      }
      return true;
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectMemoSaveFailed") });
      return false;
    }
  };

  const handleSaveProgress = async (event: FormEvent) => {
    event.preventDefault();
    if (!quickForm.projectId || !quickForm.workItemId) {
      showToast({ kind: "error", message: t("chooseProjectAndWorkItem") });
      return;
    }
    if (!quickForm.content.trim() && !quickForm.nextStep.trim() && !quickForm.blocker.trim()) {
      showToast({ kind: "error", message: t("fillProgressRequired") });
      return;
    }
    const journalDate = dailyView?.journalDate ?? getLocalDateKey();
    const previousBlock = findDailyWorkItemBlock(dailyView, quickForm.workItemId);
    const wasVisible = previousBlock ? blockAppearsInTodayConstellation(previousBlock) : false;
    const exitNode = previousBlock && wasVisible
      ? findTodayConstellationNode(dailyView, quickForm.workItemId)
      : null;
    try {
      const result = await window.workJournal.daily.upsertWorkItemEntry({
        journalDate,
        projectId: quickForm.projectId,
        workItemId: quickForm.workItemId,
        ...(quickForm.content.trim() ? { todayProgress: quickForm.content } : {}),
        ...(quickForm.nextStep.trim() ? { nextStep: quickForm.nextStep } : {}),
        ...(quickForm.blocker.trim() ? { blocker: quickForm.blocker } : {}),
        statusForToday: "in_progress"
      });
      setQuickForm((current) => ({
        ...current,
        content: "",
        nextStep: "",
        blocker: ""
      }));
      const nextWorkItemStatus = previousBlock
        ? workItemStatusAfterDailyEntrySave(previousBlock, result.entry, "in_progress")
        : null;
      const nextBlock = previousBlock
        ? {
            ...previousBlock,
            workItem: {
              ...previousBlock.workItem,
              status: nextWorkItemStatus ?? previousBlock.workItem.status
            },
            entry: result.entry
          }
        : null;
      const isVisible = nextBlock ? blockAppearsInTodayConstellation(nextBlock) : false;
      const constellationTransitionKind: TodayConstellationTransitionKind | null =
        previousBlock && wasVisible !== isVisible ? (isVisible ? "enter" : "exit") : null;
      const nextDailyView = previousBlock && dailyView
        ? updateDailyViewAfterEntrySave(
            dailyView,
            quickForm.workItemId,
            result.entry,
            previousBlock.workItemNote,
            nextWorkItemStatus ?? undefined
          )
        : null;
      const enterNode = constellationTransitionKind === "enter"
        ? findTodayConstellationNode(nextDailyView, quickForm.workItemId)
        : null;
      if (constellationTransitionKind) {
        queueTodayConstellationTransition(
          constellationTransitionKind,
          journalDate,
          quickForm.projectId,
          quickForm.workItemId,
          constellationTransitionKind === "exit" ? exitNode : enterNode
        );
      }
      await refreshActiveView();
      if (!constellationTransitionKind) {
        queueTodayVisualPulse({
          id: Date.now(),
          journalDate,
          projectId: quickForm.projectId,
          workItemId: quickForm.workItemId
        });
      }
      showToast({ kind: "success", message: t("progressSaveSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("progressSaveFailed") });
    }
  };

  const updateDailyForm = (workItemId: string, patch: Partial<DailyEntryForm>) => {
    setDailyForms((current) => {
      const existing = current[workItemId] ?? {
        workItemNoteContent: "",
        todayProgress: "",
        nextStep: "",
        blocker: "",
        statusForToday: "in_progress" as DailyWorkItemStatus
      };
      return {
        ...current,
        [workItemId]: {
          ...existing,
          ...patch
        }
      };
    });
  };

  const getDailyForm = (workItemId: string): DailyEntryForm =>
    dailyForms[workItemId] ?? {
      workItemNoteContent: "",
      todayProgress: "",
      nextStep: "",
      blocker: "",
      statusForToday: "in_progress"
    };

  const getDailyFormForBlock = (block: DailyWorkItemBlock): DailyEntryForm =>
    dailyForms[block.workItem.id] ?? dailyFormBaselineForBlock(block);

  const saveDailyEntryBlock = async (block: DailyWorkItemBlock, options: EditorSaveOptions = {}): Promise<boolean> => {
    if (!dailyView) {
      return false;
    }
    const form = getDailyFormForBlock(block);
    const displayDailyChanged = hasDailyDisplayFieldChange(block, form);
    const noteChanged = normalizeDailyFormText(form.workItemNoteContent) !== normalizeDailyFormText(block.workItemNote.content_markdown);
    const payloadDailyForm = dailyFormPayloadForBlock(block, form);
    const dailyChanged = displayDailyChanged;
    const wasVisible = blockAppearsInTodayConstellation(block);
    const exitNode = wasVisible ? findTodayConstellationNode(dailyView, block.workItem.id) : null;

    if (!dailyChanged && !noteChanged) {
      if (options.skipUnchanged) {
        return false;
      }
      if (options.showSuccess ?? true) {
        showToast({ kind: "info", message: t("dailyEntryNoChanges") });
      }
      return true;
    }

    try {
      const result = await window.workJournal.daily.upsertWorkItemEntry({
        journalDate: dailyView.journalDate,
        projectId: block.project.id,
        workItemId: block.workItem.id,
        ...payloadDailyForm,
        workItemNoteContentMarkdown: form.workItemNoteContent
      });
      const nextWorkItemStatus = workItemStatusAfterDailyEntrySave(
        block,
        result.entry,
        payloadDailyForm.statusForToday
      );
      const nextBlock = {
        ...block,
        workItem: {
          ...block.workItem,
          status: nextWorkItemStatus
        },
        entry: result.entry,
        workItemNote: result.workItemNote
      };
      const isVisible = blockAppearsInTodayConstellation(nextBlock);
      const constellationTransitionKind: TodayConstellationTransitionKind | null =
        wasVisible === isVisible ? null : isVisible ? "enter" : "exit";
      const nextDailyView = updateDailyViewAfterEntrySave(
        dailyView,
        block.workItem.id,
        result.entry,
        result.workItemNote,
        nextWorkItemStatus
      );
      const enterNode = constellationTransitionKind === "enter"
        ? findTodayConstellationNode(nextDailyView, block.workItem.id)
        : null;
      if (constellationTransitionKind) {
        queueTodayConstellationTransition(
          constellationTransitionKind,
          dailyView.journalDate,
          block.project.id,
          block.workItem.id,
          constellationTransitionKind === "exit" ? exitNode : enterNode
        );
      }
      setDailyView((current) =>
        current && current.journalDate === dailyView.journalDate
          ? updateDailyViewAfterEntrySave(
              current,
              block.workItem.id,
              result.entry,
              result.workItemNote,
              nextWorkItemStatus
            )
          : current
      );
      const nextForm = dailyFormBaselineForBlock(nextBlock);
      updateDailyForm(block.workItem.id, nextForm);
      if (options.refresh ?? true) {
        await refreshActiveView();
      }
      if (!constellationTransitionKind && dailyChanged) {
        queueTodayVisualPulse({
          id: Date.now(),
          journalDate: dailyView.journalDate,
          projectId: block.project.id,
          workItemId: block.workItem.id
        });
      }
      if (options.showSuccess ?? true) {
        showToast({ kind: "success", message: t("dailyEntrySaveSuccess") });
      }
      return true;
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("progressSaveFailed") });
      return false;
    }
  };
  const handleSaveDailyEntry = async (block: DailyWorkItemBlock): Promise<boolean> =>
    saveDailyEntryBlock(block, { refresh: true, showSuccess: true });

  const handleSaveDailyEntryAndReturn = async (block: DailyWorkItemBlock) => {
    const saved = await saveDailyEntryBlock(block, { refresh: true, showSuccess: true });
    if (saved) {
      setView(dailyEditorReturnView);
    }
  };

  const handleBackDailyEntry = async (block: DailyWorkItemBlock) => {
    if (dailyView?.journal.status === "closed" || block.project.status !== "active") {
      setView(dailyEditorReturnView);
      return;
    }
    const saved = await saveDailyEntryBlock(block, { refresh: true, showSuccess: false });
    if (saved) {
      setView(dailyEditorReturnView);
    }
  };

  const handleViewWorkItemHistory = async (block: DailyWorkItemBlock) => {
    try {
      const recovery = await window.workJournal.daily.getWorkItemHistoryRecovery(block.workItem.id);
      if (!recovery) {
        showToast({ kind: "error", message: t("historyRecoveryEmpty") });
        return;
      }
      setHistoryRecoveryViewer(recovery);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("historyRecoveryEmpty") });
    }
  };

  const handleRestoreWorkItemHistory = async (block: DailyWorkItemBlock) => {
    try {
      const result = await window.workJournal.daily.restoreWorkItemHistory(block.workItem.id);
      if (!result.restored) {
        showToast({
          kind: "error",
          message:
            result.skippedReason === "note_not_empty"
              ? t("historyRecoverySkippedNonEmpty")
              : t("historyRecoveryEmpty")
        });
        return;
      }
      updateDailyForm(block.workItem.id, {
        workItemNoteContent: result.workItemNote.content_markdown ?? ""
      });
      await refreshActiveView();
      showToast({ kind: "success", message: t("historyRecoverySuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("progressSaveFailed") });
    }
  };

  const handleCloseToday = async () => {
    if (!dailyView) {
      return;
    }
    const isRegenerating = dailyView.journal.status === "closed";
    const confirmed = await requestConfirm({
      title: isRegenerating ? t("regenerateDailyReportConfirmTitle") : t("endTodayConfirmTitle"),
      body: isRegenerating ? t("regenerateDailyReportConfirmBody") : t("endTodayConfirmBody"),
      primaryLabel: isRegenerating ? t("regenerateDailyReport") : t("endTodayWork"),
      tone: "info"
    });
    if (!confirmed) {
      return;
    }
    try {
      const payload = dailyView.journal.status === "closed"
        ? await window.workJournal.daily.generateReport(dailyView.journalDate)
        : await window.workJournal.daily.closeToday();
      setMarkdownPayload(payload);
      await refreshActiveView();
      showToast({
        kind: payload.reportSyncError ? "error" : "success",
        message: payload.reportSyncError
          ? `${t("periodReportsSyncFailed")}：${payload.reportSyncError}`
          : t("dailyReportGenerated")
      });
    } catch (error) {
      showToast({
        kind: "error",
        message: error instanceof Error ? error.message : t("markdownGenerateFailed")
      });
    }
  };

  const handleReopenToday = async () => {
    if (!dailyView) {
      return;
    }
    try {
      await window.workJournal.daily.reopenJournal(dailyView.journalDate);
      await refreshActiveView();
      showToast({ kind: "success", message: t("dailyJournalReopened") });
    } catch (error) {
      showToast({
        kind: "error",
        message: error instanceof Error ? error.message : t("progressSaveFailed")
      });
    }
  };

  const handleGenerateMarkdown = async () => {
    try {
      await handleCloseToday();
    } catch (error) {
      showToast({
        kind: "error",
        message: error instanceof Error ? error.message : t("markdownGenerateFailed")
      });
    }
  };

  const exportMarkdownPayload = async (payload: MarkdownPayload) => {
    try {
      const result = await window.workJournal.markdown.exportToday(payload);
      if (!result.canceled) {
        showToast({ kind: "success", message: t("markdownExportSuccess") });
      }
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("markdownExportFailed") });
    }
  };

  const handleExportMarkdown = async () => {
    if (!markdownPayload) {
      return;
    }
    await exportMarkdownPayload(markdownPayload);
  };

  const copyMarkdownPayload = async (payload: MarkdownPayload) => {
    try {
      await navigator.clipboard.writeText(payload.markdown);
      showToast({ kind: "success", message: t("markdownCopySuccess") });
    } catch {
      showToast({ kind: "error", message: t("markdownCopyFailed") });
    }
  };

  const handleCopyMarkdown = async () => {
    if (!markdownPayload) {
      return;
    }
    await copyMarkdownPayload(markdownPayload);
  };

  const handleSetTheme = async (theme: ThemePreference) => {
    try {
      const settings = await window.workJournal.settings.setTheme(theme);
      setSettingsInfo(settings);
      applyEffectiveTheme(settings);
      showToast({ kind: "success", message: t("themeSaveSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("themeSaveFailed") });
    }
  };

  const handleSetLanguage = async (nextLanguage: LanguagePreference) => {
    try {
      const settings = await window.workJournal.settings.setLanguage(nextLanguage);
      setSettingsInfo(settings);
      applyEffectiveTheme(settings);
      showToast({ kind: "success", message: createTranslator(nextLanguage)("languageSaveSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("languageSaveFailed") });
    }
  };

  const handleOpenDataDirectory = async () => {
    try {
      await window.workJournal.settings.openDataDirectory();
    } catch (error) {
      setSettingsMessage({
        kind: "error",
        message: error instanceof Error ? error.message : t("dataDirectoryOpenFailed")
      });
    }
  };

  const refreshAfterDataDirectoryChange = async () => {
    selectedProjectIdRef.current = null;
    setSelectedProjectId(null);
    setDetail(null);
    setProjectMemo(null);
    setProjectMemoContent("");
    setDailyEditorTarget(null);
    setProjectDetailReturnView("projects");
    setQuickForm((current) => ({ ...current, projectId: "", workItemId: "" }));
    await Promise.all([refreshActiveView(null), loadArchivedProjects(), loadSettings()]);
    setSearchTerm("");
    setSearchResults([]);
  };

  const handleChooseDataDirectory = async () => {
    const confirmed = await requestConfirm({
      title: t("dataDirectoryChangeConfirmTitle"),
      body: t("dataDirectoryChangeConfirmBody"),
      primaryLabel: t("chooseDataDirectory"),
      tone: "warning",
      calloutBody: t("dataDirectoryChangeConfirmNote")
    });
    if (!confirmed) {
      return;
    }
    setIsChangingDataDirectory(true);
    setSettingsBusyAction("data-directory");
    setSettingsMessage(null);
    try {
      const result = await window.workJournal.settings.chooseDataDirectory();
      if (!result.canceled) {
        if (result.settings) {
          setSettingsInfo(result.settings);
          applyEffectiveTheme(result.settings);
        }
        await refreshAfterDataDirectoryChange();
        const message = dataDirectoryChangeMessage(result.operation, t);
        setSettingsMessage(null);
        showToast({ kind: "success", message });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("dataDirectoryChangeFailed");
      setSettingsMessage({ kind: "error", message });
      showToast({ kind: "error", message });
    } finally {
      setIsChangingDataDirectory(false);
      setSettingsBusyAction(null);
    }
  };

  const handleReloadDataDirectory = async () => {
    setSettingsBusyAction("reload");
    setSettingsMessage(null);
    try {
      const result = await window.workJournal.settings.reloadDataDirectory();
      if (!result.canceled) {
        if (result.settings) {
          setSettingsInfo(result.settings);
          applyEffectiveTheme(result.settings);
        }
        await refreshAfterDataDirectoryChange();
        const message = t("reloadDataDirectorySuccess");
        setSettingsMessage(null);
        showToast({ kind: "success", message });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("reloadDataDirectoryFailed");
      setSettingsMessage({ kind: "error", message });
      showToast({ kind: "error", message });
    } finally {
      setSettingsBusyAction(null);
    }
  };

  const handleSaveAiSettings = async (
    input: AiSaveSettingsInput,
    options: { showSuccessToast?: boolean } = {}
  ): Promise<AiSettingsInfo> => {
    const ai = await window.workJournal.ai.saveSettings(input);
    const settings = await loadSettings();
    setSettingsInfo(settings);
    if (options.showSuccessToast !== false && (ai.canSecurelyStoreApiKey || !input.apiKey?.trim())) {
      showToast({ kind: "success", message: t("aiSettingsSaved") });
    }
    return ai;
  };

  const handleClearAiKey = async (): Promise<AiSettingsInfo> => {
    const ai = await window.workJournal.ai.clearApiKey();
    const settings = await loadSettings();
    setSettingsInfo(settings);
    showToast({ kind: "success", message: t("aiApiKeyCleared") });
    return ai;
  };

  const handleTestAiConnection = async (): Promise<AiOperationResult> => {
    const result = await window.workJournal.ai.testConnection();
    if (result.success) {
      showToast({ kind: "success", message: t("aiConnectionSuccess") });
    }
    return result;
  };

  const handleSearchResult = (result: SearchResult) => {
    setSearchTerm("");
    setSearchResults([]);

    if (!result.projectId) {
      setView("today");
      return;
    }

    const targetGroup = dailyView?.groups.find((group) => group.project.id === result.projectId);
    const targetBlock = result.workItemId
      ? targetGroup?.items.find((block) => block.workItem.id === result.workItemId)
      : null;
    if (!targetGroup || (result.workItemId && !targetBlock)) {
      setView("today");
      showToast({ kind: "warning", message: t("searchTargetUnavailableToday") });
      return;
    }

    if (result.type === "progress" && targetBlock) {
      openDailyEntryEditor(result.projectId, targetBlock.workItem.id, dailyView?.journalDate, "today");
      return;
    }

    todaySearchTargetSequenceRef.current += 1;
    setTodaySearchTarget({
      id: todaySearchTargetSequenceRef.current,
      projectId: result.projectId,
      workItemId: result.type === "work_item" ? result.workItemId : null
    });
    setView("today");
  };

  const navItems = [
    { id: "today" as View, label: t("navToday"), icon: CalendarDays },
    { id: "projects" as View, label: t("navProjects"), icon: Folder },
    { id: "reports" as View, label: t("navReports"), icon: FileText },
    { id: "heatmap" as View, label: t("navHeatmap"), icon: LayoutList },
    { id: "archive" as View, label: t("navArchive"), icon: Archive },
    { id: "settings" as View, label: t("navSettings"), icon: Settings }
  ];
  const handlePrimaryNavigation = async (targetView: View) => {
    if (targetView === view) {
      return;
    }
    if (view === "reports" && hasUnsavedReportChanges) {
      const confirmed = await requestConfirm({
        title: t("discardReportChangesTitle"),
        body: t("discardReportChangesBody"),
        primaryLabel: t("discardChanges"),
        secondaryLabel: t("continueEditing"),
        tone: "warning"
      });
      if (!confirmed) {
        return;
      }
      setHasUnsavedReportChanges(false);
    }
    if (targetView === "today") {
      loadToday().catch((error) =>
        showToast({ kind: "error", message: error instanceof Error ? error.message : t("loadFailed") })
      );
    }
    setView(targetView);
  };
  const shouldShowQuickProgressPanel = false;
  const quickCollapsed = view === "project-detail" ? detailQuickCollapsed : todayQuickCollapsed;
  const setQuickCollapsed = view === "project-detail" ? setDetailQuickCollapsed : setTodayQuickCollapsed;
  const appShellClassName = [
    "app-shell",
    shouldShowQuickProgressPanel ? (quickCollapsed ? "quick-is-collapsed" : "") : "quick-hidden"
  ]
    .filter(Boolean)
    .join(" ");
  const currentStorageDisplay = storageDisplay(settingsInfo, t);
  const currentSidebarUpdateDisplay = sidebarUpdateDisplay(updateStatus, appVersion, t);
  const openVersionUpdateSettings = () => {
    setSettingsScrollTarget("settings-version-updates");
    setView("settings");
  };
  const openUserGuide = (returnView: UserGuideReturnView = "settings") => {
    setUserGuideReturnView(returnView);
    setView("user-guide");
  };
  const dailyEditorBlock = useMemo(() => {
    if (!dailyEditorTarget || !dailyView || dailyEditorTarget.journalDate !== dailyView.journalDate) {
      return null;
    }
    for (const group of dailyView.groups) {
      const block = group.items.find((item) => item.workItem.id === dailyEditorTarget.workItemId);
      if (block) {
        return block;
      }
    }
    if (detail?.project.id === dailyEditorTarget.projectId) {
      const workItem = [...detail.activeItems, ...detail.completedItems].find(
        (item) => item.id === dailyEditorTarget.workItemId
      );
      if (workItem) {
        return {
          project: detail.project,
          workItem,
          entry: null,
          previousEntry: null,
          previousWorkDate: dailyView.previousWorkDate,
          workItemNote: workItem.workItemNote,
          previousNoteSnapshot: workItem.previousNoteSnapshot,
          recoverableHistory: null
        } satisfies DailyWorkItemBlock;
      }
    }
    return null;
  }, [dailyEditorTarget, dailyView, detail]);

  const saveCurrentEditor = async (options: EditorSaveOptions = {}): Promise<boolean> => {
    if (view === "daily-entry-editor") {
      if (!dailyEditorBlock) {
        return false;
      }
      if (dailyView?.journal.status === "closed" || dailyEditorBlock.project.status !== "active") {
        return true;
      }
      return saveDailyEntryBlock(dailyEditorBlock, options);
    }
    if (view === "project-memo" && detail && projectMemo) {
      return handleSaveProjectMemo(options);
    }
    return false;
  };

  useEffect(() => {
    currentEditorSaveRef.current = saveCurrentEditor;
  });

  const requestCurrentEditorSave = async (options: EditorSaveOptions = {}): Promise<boolean> => {
    if (saveInFlightRef.current) {
      return false;
    }
    saveInFlightRef.current = true;
    try {
      return await currentEditorSaveRef.current(options);
    } finally {
      saveInFlightRef.current = false;
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      void requestCurrentEditorSave({ refresh: false, showSuccess: true });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handle = window.setInterval(() => {
      void requestCurrentEditorSave({
        refresh: false,
        showSuccess: false,
        skipEmpty: true,
        skipUnchanged: true
      });
    }, AUTOSAVE_INTERVAL_MS);

    return () => window.clearInterval(handle);
  }, []);

  return (
    <div className={appShellClassName} spellCheck={false}>
      <aside className="sidebar">
        <div className="brand" aria-label={t("appFullName")}>
          <span className="brand-mark" aria-hidden="true">
            <Waypoints size={22} strokeWidth={1.8} />
          </span>
          <span className="brand-lockup" aria-hidden="true">
            <span className="brand-name">流梭</span>
            <span className="brand-subtitle">Flow Shuttle</span>
          </span>
        </div>
        <nav className="side-nav" aria-label={t("navAria")}>
          {navItems.map((item) => (
            <button
              className={`nav-item ${
                view === item.id ||
                (view === "daily-entry-editor" && item.id === "today") ||
                (view === "project-memo" && item.id === "projects") ||
                (view === "user-guide" && item.id === "settings")
                  ? "active"
                  : ""
              }`}
              key={item.id}
              type="button"
              onClick={() => void handlePrimaryNavigation(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer-info">
          <button
            className={`sidebar-version-link ${currentSidebarUpdateDisplay.hasUpdate ? "has-update" : ""}`}
            type="button"
            title={currentSidebarUpdateDisplay.title}
            onClick={openVersionUpdateSettings}
          >
            <span className={`dot version-dot ${currentSidebarUpdateDisplay.hasUpdate ? "update" : ""}`} />
            <span className="storage-status">{currentSidebarUpdateDisplay.label}</span>
          </button>
          <div className="storage-note" title={currentStorageDisplay.title}>
            <span className={`dot ${currentStorageDisplay.isWarning ? "warning" : ""}`} />
            <span className="storage-status">
              {t("storageLocal")} · {currentStorageDisplay.detail}
            </span>
          </div>
        </div>
      </aside>

      <main ref={workspaceRef} className={`workspace ${view === "daily-entry-editor" || view === "project-memo" ? "workspace-focus" : ""}`}>
        {view !== "daily-entry-editor" && view !== "project-memo" && (
          <WorkspaceAmbientField view={view} theme={effectiveTheme} />
        )}
        {view === "today" && dailyView && (
          <TodayPage
            dailyView={dailyView}
            heatmapData={todayHeatmapData}
            heatmapFailed={todayHeatmapFailed}
            language={language}
            theme={effectiveTheme}
            t={t}
            visualPulse={todayVisualPulse}
            onVisualPulseHandled={() => setTodayVisualPulse(null)}
            constellationTransition={todayConstellationTransition}
            onConstellationTransitionHandled={handleTodayConstellationTransitionComplete}
            searchTerm={searchTerm}
            searchResults={searchResults}
            isSearching={isSearching}
            onSearchTermChange={setSearchTerm}
            onSearchResult={handleSearchResult}
            searchTarget={todaySearchTarget}
            onSearchTargetHandled={(targetId) =>
              setTodaySearchTarget((current) => current?.id === targetId ? null : current)
            }
            onGenerateMarkdown={handleGenerateMarkdown}
            collapsedGroups={collapsedGroups}
            setCollapsedGroups={setCollapsedGroups}
            onOpenEntryEditor={(projectId, workItemId, journalDate) =>
              openDailyEntryEditor(projectId, workItemId, journalDate, "today")
            }
            onReopen={handleReopenToday}
            onOpenProject={openProjectDetail}
            onOpenMemo={(projectId) => openProjectMemo(projectId, "today")}
            onCreateProject={() => {
              setProjectForm({ name: "", description: "" });
              setNewProjectOpen(true);
            }}
            onOpenUserGuide={() => openUserGuide("today")}
          />
        )}
        {view === "daily-entry-editor" && dailyView && (
          dailyEditorBlock ? (
            <DailyEntryEditorPage
              dailyView={dailyView}
              block={dailyEditorBlock}
              form={getDailyFormForBlock(dailyEditorBlock)}
              language={language}
              theme={effectiveTheme}
              aiSettings={settingsInfo?.ai ?? null}
              t={t}
              onBack={() => handleBackDailyEntry(dailyEditorBlock)}
              onUpdate={(patch) => updateDailyForm(dailyEditorBlock.workItem.id, patch)}
              onSave={() => handleSaveDailyEntry(dailyEditorBlock)}
              onViewHistory={() => handleViewWorkItemHistory(dailyEditorBlock)}
              onRestoreHistory={() => handleRestoreWorkItemHistory(dailyEditorBlock)}
              onToast={showToast}
              onConfirm={requestConfirm}
            />
          ) : (
            <PlaceholderPage title={t("entryEditorMissingTitle")} body={t("entryEditorMissingBody")} />
          )
        )}
        {view === "projects" && (
          <ProjectsPage
            projects={projects}
            language={language}
            t={t}
            onCreateProject={() => {
              setProjectForm({ name: "", description: "" });
              setNewProjectOpen(true);
            }}
            onOpenProject={openProjectDetail}
            onMoveProject={handleMoveProject}
          />
        )}
        {view === "reports" && (
          <ReportsPage
            reports={dailyReports}
            projects={projects}
            selectedReportId={selectedReportId}
            onSelectReport={setSelectedReportId}
            weeklyReports={weeklyReports}
            selectedWeeklyReportId={selectedWeeklyReportId}
            onSelectWeeklyReport={setSelectedWeeklyReportId}
            monthlyReports={monthlyReports}
            selectedMonthlyReportId={selectedMonthlyReportId}
            onSelectMonthlyReport={setSelectedMonthlyReportId}
            t={t}
            language={language}
            theme={effectiveTheme}
            aiSettings={settingsInfo?.ai ?? null}
            onCopy={copyMarkdownPayload}
            onExport={exportMarkdownPayload}
            onReportsChanged={loadReports}
            onToast={showToast}
            onConfirm={requestConfirm}
            onUnsavedChangesChange={setHasUnsavedReportChanges}
          />
        )}
        {view === "heatmap" && heatmapData && (
          <HeatmapPage
            data={heatmapData}
            selectedDate={selectedHeatmapDate}
            t={t}
            language={language}
            onSelectDate={setSelectedHeatmapDate}
            onPreviousMonth={() => moveHeatmapMonth(-1)}
            onNextMonth={() => moveHeatmapMonth(1)}
            onCurrentMonth={resetHeatmapToCurrentMonth}
            onViewReport={showHeatmapReport}
          />
        )}
        {view === "project-detail" && (!detail || detail.project.id !== selectedProjectId) && (
          <section className="page detail-page project-detail-loading" role="status" aria-live="polite" aria-busy="true">
            <span>{t("loading")}</span>
          </section>
        )}
        {view === "project-detail" && detail && detail.project.id === selectedProjectId && (
          <ProjectDetailPage
            detail={detail}
            language={language}
            t={t}
            backLabel={t(projectDetailReturnView === "archive" ? "detailBackToArchive" : "detailBackToProjects")}
            onBack={() => setView(projectDetailReturnView)}
            onRecordProgress={(projectId, workItemId) => openDailyEntryEditor(projectId, workItemId, undefined, "project-detail")}
            onComplete={handleCompleteWorkItem}
            onEditWorkItem={openEditWorkItem}
            onMoveWorkItem={handleMoveWorkItem}
            onDeleteWorkItem={handleRequestDeleteWorkItem}
            onCreateWorkItem={() => {
              setWorkItemForm({ title: "", description: "" });
              setNewWorkItemOpen(true);
            }}
            onEditProject={() => {
              setProjectForm({
                name: detail.project.name,
                description: detail.project.description || ""
              });
              setEditProjectOpen(true);
            }}
            onArchiveProject={handleArchiveProject}
            onUnarchiveProject={handleUnarchiveProject}
            onDeleteProject={handleRequestDeleteProject}
            onOpenMemo={() => openProjectMemo(detail.project.id)}
          />
        )}
        {view === "project-memo" && detail && projectMemo && (
          <ProjectMemoPage
            project={detail.project}
            memo={projectMemo}
            content={projectMemoContent}
            language={language}
            theme={effectiveTheme}
            t={t}
            onBack={() => setView(projectMemoReturnView)}
            onContentChange={setProjectMemoContent}
            onSave={handleSaveProjectMemo}
            onToast={showToast}
          />
        )}
        {view === "archive" && (
          <ArchivePage
            projects={archivedProjects}
            language={language}
            t={t}
            onOpenProject={(projectId) => openProjectDetail(projectId, "archive")}
          />
        )}
        {view === "settings" && settingsInfo && (
          <SettingsPage
            settings={settingsInfo}
            t={t}
            message={settingsMessage}
            onToast={showToast}
            isChangingDataDirectory={isChangingDataDirectory}
            busyAction={settingsBusyAction}
            onSetTheme={handleSetTheme}
            onSetLanguage={handleSetLanguage}
            onOpenDataDirectory={handleOpenDataDirectory}
            onChooseDataDirectory={handleChooseDataDirectory}
            onReloadDataDirectory={handleReloadDataDirectory}
            onSaveAiSettings={handleSaveAiSettings}
            onClearAiKey={handleClearAiKey}
            onTestAiConnection={handleTestAiConnection}
            onOpenUserGuide={() => openUserGuide("settings")}
          />
        )}
        {view === "user-guide" && (
          <UserGuidePage
            t={t}
            content={language === "en" ? userGuideEn : userGuideZhCn}
            backLabel={userGuideReturnView === "today" ? t("backToTodayWorkPage") : t("userGuideBackToSettings")}
            onBack={() => setView(userGuideReturnView)}
          />
        )}
      </main>

      {shouldShowQuickProgressPanel && (
        <QuickProgressPanel
          collapsed={quickCollapsed}
          today={dailyView}
          language={language}
          theme={effectiveTheme}
          t={t}
          quickForm={quickForm}
          workItems={quickWorkItems}
          setQuickForm={setQuickForm}
          onToast={showToast}
          onCollapse={() => setQuickCollapsed(true)}
          onExpand={() => setQuickCollapsed(false)}
          onCreateProject={() => {
            setQuickProjectForm({ name: "", description: "" });
            setQuickProjectOpen(true);
          }}
          onCreateWorkItem={() => {
            if (!quickForm.projectId) {
              showToast({ kind: "error", message: t("chooseProjectFirst") });
              return;
            }
            setQuickWorkItemForm({ title: "", description: "" });
            setQuickWorkItemOpen(true);
          }}
          onSubmit={handleSaveProgress}
        />
      )}

      {newProjectOpen && (
        <FormModal
          title={t("newProject")}
          description={t("newProjectModalDescription")}
          primaryLabel={t("createProjectAction")}
          t={t}
          onClose={() => setNewProjectOpen(false)}
          onSubmit={handleCreateProject}
        >
          <label>
            <span className="label-text">{t("projectName")} <RequiredMark /></span>
            <input
              autoFocus
              value={projectForm.name}
              onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={t("projectNamePlaceholder")}
              required
            />
          </label>
          <label>
            {t("projectDescription")}
            <textarea
              value={projectForm.description}
              onChange={(event) =>
                setProjectForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t("projectDescriptionPlaceholder")}
              rows={4}
            />
          </label>
        </FormModal>
      )}

      {quickProjectOpen && (
        <FormModal
          title={t("newProject")}
          description={t("newProjectModalDescription")}
          primaryLabel={t("createProjectAction")}
          t={t}
          onClose={() => setQuickProjectOpen(false)}
          onSubmit={handleCreateQuickProject}
        >
          <label>
            <span className="label-text">{t("projectName")} <RequiredMark /></span>
            <input
              autoFocus
              value={quickProjectForm.name}
              onChange={(event) => setQuickProjectForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={t("projectNamePlaceholder")}
              required
            />
          </label>
          <label>
            {t("projectDescription")}
            <textarea
              value={quickProjectForm.description}
              onChange={(event) =>
                setQuickProjectForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t("projectDescriptionPlaceholder")}
              rows={4}
            />
          </label>
        </FormModal>
      )}

      {editProjectOpen && (
        <FormModal
          title={t("editProject")}
          description={t("editProjectModalDescription")}
          primaryLabel={t("saveChanges")}
          t={t}
          onClose={() => setEditProjectOpen(false)}
          onSubmit={handleUpdateProject}
        >
          <label>
            <span className="label-text">{t("projectName")} <RequiredMark /></span>
            <input
              autoFocus
              value={projectForm.name}
              onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label>
            {t("projectDescription")}
            <textarea
              value={projectForm.description}
              onChange={(event) =>
                setProjectForm((current) => ({ ...current, description: event.target.value }))
              }
              rows={4}
            />
          </label>
        </FormModal>
      )}

      {newWorkItemOpen && (
        <FormModal
          title={t("newWorkItem")}
          description={t("newWorkItemModalDescription")}
          primaryLabel={t("createWorkItemAction")}
          t={t}
          onClose={() => setNewWorkItemOpen(false)}
          onSubmit={handleCreateWorkItem}
        >
          <label>
            <span className="label-text">{t("workItemTitleShort")} <RequiredMark /></span>
            <input
              autoFocus
              value={workItemForm.title}
              onChange={(event) => setWorkItemForm((current) => ({ ...current, title: event.target.value }))}
              placeholder={t("workItemTitlePlaceholder")}
              required
            />
          </label>
          <label>
            {t("workItemDescriptionShort")}
            <textarea
              value={workItemForm.description}
              onChange={(event) =>
                setWorkItemForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t("workItemDescriptionPlaceholder")}
              rows={4}
            />
          </label>
        </FormModal>
      )}

      {editWorkItemTarget && (
        <FormModal
          title={t("editWorkItem")}
          description={t("editWorkItemModalDescription")}
          primaryLabel={t("saveChanges")}
          t={t}
          onClose={() => setEditWorkItemTarget(null)}
          onSubmit={handleUpdateWorkItem}
        >
          <label>
            <span className="label-text">{t("workItemTitleShort")} <RequiredMark /></span>
            <input
              autoFocus
              value={workItemForm.title}
              onChange={(event) => setWorkItemForm((current) => ({ ...current, title: event.target.value }))}
              placeholder={t("workItemTitlePlaceholder")}
              required
            />
          </label>
          <label>
            {t("workItemDescriptionShort")}
            <textarea
              value={workItemForm.description}
              onChange={(event) =>
                setWorkItemForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t("workItemDescriptionPlaceholder")}
              rows={4}
            />
          </label>
          <label>
            {t("workItemStatus")}
            <select
              value={workItemEditStatus}
              onChange={(event) =>
                setWorkItemEditStatus(event.target.value as Extract<WorkItemStatus, "active" | "done" | "paused">)
              }
            >
              <option value="active">{workItemLifecycleStatusLabel("active", t)}</option>
              <option value="done">{workItemLifecycleStatusLabel("done", t)}</option>
              <option value="paused">{workItemLifecycleStatusLabel("paused", t)}</option>
            </select>
          </label>
        </FormModal>
      )}

      {quickWorkItemOpen && (
        <FormModal
          title={t("newWorkItem")}
          description={t("newWorkItemModalDescription")}
          primaryLabel={t("createWorkItemAction")}
          t={t}
          onClose={() => setQuickWorkItemOpen(false)}
          onSubmit={handleCreateQuickWorkItem}
        >
          <label>
            <span className="label-text">{t("workItemTitle")} <RequiredMark /></span>
            <input
              autoFocus
              value={quickWorkItemForm.title}
              onChange={(event) => setQuickWorkItemForm((current) => ({ ...current, title: event.target.value }))}
              placeholder={t("workItemTitlePlaceholder")}
              required
            />
          </label>
          <label>
            {t("workItemDescription")}
            <textarea
              value={quickWorkItemForm.description}
              onChange={(event) =>
                setQuickWorkItemForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t("quickWorkItemDescriptionPlaceholder")}
              rows={4}
            />
          </label>
        </FormModal>
      )}

      {markdownPayload && (
        <div className="modal-backdrop" role="presentation">
          <section className="markdown-modal" role="dialog" aria-modal="true" aria-label={t("markdownPreviewAria")}>
            <header className="modal-header">
              <div>
                <p className="eyebrow">{t("markdownEyebrow")}</p>
                <h2>
                  {t("markdownTitlePrefix")} - {markdownPayload.date}
                </h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setMarkdownPayload(null)} aria-label={t("close")}>
                <X size={18} />
              </button>
            </header>
            <pre className="markdown-preview">{markdownPayload.markdown}</pre>
            <footer className="modal-actions">
              <button className="secondary-button" type="button" onClick={handleCopyMarkdown}>
                <Clipboard size={17} />
                {t("copyMarkdown")}
              </button>
              <button className="primary-button" type="button" onClick={handleExportMarkdown}>
                <FileDown size={17} />
                {t("exportMarkdown")}
              </button>
            </footer>
          </section>
        </div>
      )}

      {historyRecoveryViewer && (
        <div className="modal-backdrop" role="presentation">
          <section className="markdown-modal history-recovery-modal" role="dialog" aria-modal="true" aria-label={t("historicalRecordRecovery")}>
            <header className="modal-header">
              <div>
                <p className="eyebrow">{t("historyRecordsFound")}</p>
                <h2>{t("historicalRecordRecovery")}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setHistoryRecoveryViewer(null)}
                aria-label={t("close")}
              >
                <X size={18} />
              </button>
            </header>
            <pre className="markdown-preview history-recovery-preview">
              {historyRecoveryViewer.contentMarkdown}
            </pre>
            <footer className="modal-actions">
              <button className="primary-button" type="button" onClick={() => setHistoryRecoveryViewer(null)}>
                <Check size={17} />
                {t("close")}
              </button>
            </footer>
          </section>
        </div>
      )}

      {detail && projectDeleteSummary && (
        <ConfirmModal
          title={t("deleteProjectQuestion")}
          body={t("deleteProjectBody")}
          primaryLabel={t("confirmDelete")}
          secondaryLabel={t("cancel")}
          tone="danger"
          objectName={detail.project.name}
          calloutTitle={t("deleteCannotUndo")}
          onCancel={() => setProjectDeleteSummary(null)}
          onConfirm={handleConfirmDeleteProject}
        >
          <DeleteImpactList
            heading={t("projectContains")}
            rows={[
              [t("workItem"), projectDeleteSummary.workItemCount],
              [t("dailyEntryCountLabel"), projectDeleteSummary.dailyEntryCount],
              [t("legacyProgressCountLabel"), projectDeleteSummary.legacyProgressCount],
              [t("memoAttachmentCountLabel"), projectDeleteSummary.memoAttachmentCount]
            ]}
          />
          <p className="delete-impact-note">{t("projectMemoAttachmentsDeleteNote")}</p>
        </ConfirmModal>
      )}

      {workItemDeleteTarget && (
        <ConfirmModal
          title={t("deleteWorkItemQuestion")}
          body={t("deleteWorkItemBody")}
          primaryLabel={t("confirmDelete")}
          secondaryLabel={t("cancel")}
          tone="danger"
          objectName={workItemDeleteTarget.item.title}
          calloutTitle={t("deleteCannotUndo")}
          onCancel={() => setWorkItemDeleteTarget(null)}
          onConfirm={handleConfirmDeleteWorkItem}
        >
          <DeleteImpactList
            heading={t("workItemContains")}
            rows={[
              [t("dailyEntryCountLabel"), workItemDeleteTarget.summary.dailyEntryCount],
              [t("legacyProgressCountLabel"), workItemDeleteTarget.summary.legacyProgressCount]
            ]}
          />
        </ConfirmModal>
      )}

      {pendingConfirm && (
        <ConfirmModal
          title={pendingConfirm.title}
          body={pendingConfirm.body}
          primaryLabel={pendingConfirm.primaryLabel}
          secondaryLabel={pendingConfirm.secondaryLabel ?? t("cancel")}
          tone={pendingConfirm.tone ?? "info"}
          objectName={pendingConfirm.objectName}
          calloutTitle={pendingConfirm.calloutTitle}
          calloutBody={pendingConfirm.calloutBody}
          onCancel={() => resolveConfirm(false)}
          onConfirm={() => resolveConfirm(true)}
        />
      )}

      {toast && <ToastMessage toast={toast} />}
    </div>
  );
}

function HighlightedSearchText({ text, term }: { text: string; term: string }) {
  const needle = term.trim();
  if (!needle) {
    return <>{text}</>;
  }

  const source = text || "";
  const sourceLower = source.toLocaleLowerCase();
  const needleLower = needle.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = sourceLower.indexOf(needleLower, cursor);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(source.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + needle.length;
    parts.push(
      <mark className="search-highlight" key={`${matchIndex}-${matchEnd}`}>
        {source.slice(matchIndex, matchEnd)}
      </mark>
    );
    cursor = matchEnd;
    matchIndex = sourceLower.indexOf(needleLower, cursor);
  }

  if (cursor < source.length) {
    parts.push(source.slice(cursor));
  }

  return <>{parts}</>;
}
function SearchBox({
  term,
  results,
  isSearching,
  t,
  onTermChange,
  onResult
}: {
  term: string;
  results: SearchResult[];
  isSearching: boolean;
  t: Translator;
  onTermChange: (term: string) => void;
  onResult: (result: SearchResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedTerm = term.trim();

  return (
    <div className="search-wrap">
      <Search size={18} />
      <input
        ref={inputRef}
        value={term}
        onChange={(event) => onTermChange(event.target.value)}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchAria")}
        spellCheck={false}
      />
      {term && (
        <button
          className="search-clear-button"
          type="button"
          aria-label={t("clearSearch")}
          title={t("clearSearch")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onTermChange("");
            window.requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <X size={14} />
        </button>
      )}
      <span className="shortcut">Ctrl+F</span>
      {trimmedTerm && (
        <div className="search-popover">
          <div className="search-heading">{isSearching ? t("searchLoading") : t("searchResults")}</div>
          {results.length === 0 && !isSearching ? (
            <div className="empty-row">{t("searchNoResults")}</div>
          ) : (
            results.map((result) => (
              <button
                type="button"
                className="search-result"
                key={result.id}
                onClick={() => onResult(result)}
              >
                <span className="result-kind">
                  {result.type === "progress"
                    ? t("searchKindProgress")
                    : result.type === "work_item"
                      ? t("searchKindWorkItem")
                      : t("searchKindProject")}
                </span>
                <span className="result-title"><HighlightedSearchText text={result.title} term={term} /></span>
                <span className="result-context">
                  {result.entryDate ? `${result.entryDate} · ` : ""}
                  {result.projectName ? <HighlightedSearchText text={result.projectName} term={term} /> : t("todayWorkPageTitle")}
                  {result.workItemTitle ? (
                    <>
                      {" / "}
                      <HighlightedSearchText text={result.workItemTitle} term={term} />
                    </>
                  ) : ""}
                </span>
                <span className="result-snippet">
                  {searchFieldLabel(result.matchedField, t)}
                  {t("searchMatchedSeparator")}
                  <HighlightedSearchText text={result.snippet} term={term} />
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PageHeader({
  title,
  description,
  eyebrow,
  meta,
  backAction,
  actions,
  className = ""
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  backAction?: { label: string; onClick: () => void };
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`page-header ${className}`.trim()}>
      <div className="page-header-main">
        {backAction && (
          <button className="back-button page-header-back" type="button" onClick={backAction.onClick}>
            <ChevronLeft size={17} />
            {backAction.label}
          </button>
        )}
        <div className="page-header-copy">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {description && <p className="page-header-description">{description}</p>}
          {meta && <p className="page-header-meta">{meta}</p>}
        </div>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

type TooltipTag = "div" | "span" | "h3" | "dd";

function HoverTooltip({
  as: Tag = "span",
  content,
  className = "",
  showWhen = "truncated",
  focusable = true,
  align = "start",
  children
}: {
  as?: TooltipTag;
  content?: string | null;
  className?: string;
  showWhen?: "truncated" | "always";
  focusable?: boolean;
  align?: "start" | "center";
  children: ReactNode;
}) {
  const [position, setPosition] = useState<{
    x: number;
    y: number;
    placement: "top" | "bottom";
    maxWidth: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const text = content?.trim() ?? "";

  const hasTruncatedContent = (element: HTMLElement) => {
    const candidates = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))];

    return candidates.some((node) => {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const clipsText =
        style.overflowX === "hidden" ||
        style.overflowX === "clip" ||
        style.overflowY === "hidden" ||
        style.overflowY === "clip";

      return clipsText && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1);
    });
  };

  useLayoutEffect(() => {
    if (!position || !tooltipRef.current) {
      return;
    }

    const margin = 16;
    const rect = tooltipRef.current.getBoundingClientRect();
    let nextX = position.x;
    let nextY = position.y;

    if (rect.right > window.innerWidth - margin) {
      nextX -= rect.right - (window.innerWidth - margin);
    }
    if (rect.left < margin) {
      nextX += margin - rect.left;
    }
    if (rect.bottom > window.innerHeight - margin) {
      nextY -= rect.bottom - (window.innerHeight - margin);
    }
    if (rect.top < margin) {
      nextY += margin - rect.top;
    }

    if (Math.abs(nextX - position.x) > 0.5 || Math.abs(nextY - position.y) > 0.5) {
      setPosition({ ...position, x: nextX, y: nextY });
    }
  }, [position, text]);

  const openTooltip = (element: HTMLElement) => {
    if (!text || (showWhen === "truncated" && !hasTruncatedContent(element))) {
      setPosition(null);
      return;
    }

    const margin = 16;
    const maxWidth = Math.min(560, window.innerWidth - margin * 2);
    const rect = element.getBoundingClientRect();
    const x =
      align === "center"
        ? rect.left + rect.width / 2
        : Math.min(Math.max(rect.left, margin), window.innerWidth - maxWidth - margin);
    const placement = rect.top > window.innerHeight - rect.bottom ? "top" : "bottom";
    const y = placement === "top" ? rect.top - 8 : rect.bottom + 8;
    setPosition({ x, y, placement, maxWidth });
  };

  const closeTooltip = () => setPosition(null);

  const tooltipStyle = position
    ? ({
        "--tooltip-x": `${position.x}px`,
        "--tooltip-y": `${position.y}px`,
        "--tooltip-max-width": `${position.maxWidth}px`
      } as CSSProperties)
    : undefined;

  return (
    <Tag
      className={["hover-tooltip-trigger", className].filter(Boolean).join(" ")}
      tabIndex={text && focusable ? 0 : undefined}
      onMouseEnter={(event) => openTooltip(event.currentTarget)}
      onMouseLeave={closeTooltip}
      onFocus={(event) => openTooltip(event.currentTarget)}
      onBlur={closeTooltip}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          closeTooltip();
        }
      }}
    >
      {children}
      {text && position && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tooltipRef}
              className={`floating-tooltip ${position.placement} align-${align}`}
              role="tooltip"
              style={tooltipStyle}
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </Tag>
  );
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function compactElementText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function htmlToReadableMarkdown(value: string): string {
  if (typeof DOMParser === "undefined") {
    return value
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(h[1-6]|p|div|section|article|li|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const parsed = new DOMParser().parseFromString(value, "text/html");
  parsed.querySelectorAll("script, style, noscript").forEach((element) => element.remove());
  const lines: string[] = [];
  const pushLine = (line: string) => {
    const normalized = line.trim();
    if (normalized) {
      lines.push(normalized);
    }
  };

  const pushBlank = () => {
    if (lines.length > 0 && lines.at(-1) !== "") {
      lines.push("");
    }
  };

  const walk = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(Number(tag.slice(1)), 4);
      pushLine(`${"#".repeat(level)} ${compactElementText(element)}`);
      pushBlank();
      return;
    }
    if (tag === "li") {
      pushLine(`- ${compactElementText(element)}`);
      return;
    }
    if (tag === "br") {
      pushBlank();
      return;
    }
    if (["p", "blockquote", "pre"].includes(tag)) {
      pushLine((element.textContent ?? "").trim());
      pushBlank();
      return;
    }
    if (["ul", "ol"].includes(tag)) {
      Array.from(element.children).forEach(walk);
      pushBlank();
      return;
    }
    if (["div", "section", "article", "main", "header", "footer", "body"].includes(tag)) {
      Array.from(element.children).forEach(walk);
      if (tag !== "body") {
        pushBlank();
      }
      return;
    }
    const text = compactElementText(element);
    if (text) {
      pushLine(text);
      pushBlank();
    }
  };

  walk(parsed.body);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function releaseNotesToReadableMarkdown(value: string): string {
  const trimmed = value.trim();
  return looksLikeHtml(trimmed) ? htmlToReadableMarkdown(trimmed) : trimmed;
}

const releaseSummarySkipHeadings = new Set([
  "中文",
  "简体中文",
  "繁體中文",
  "English",
  "修复",
  "修復",
  "优化",
  "優化",
  "Fixed",
  "Improved",
  "Release Notes",
  "Release notes"
]);

function markdownLineToSummaryText(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function releaseNotesLinesForLanguage(markdown: string, language: LanguagePreference): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const headingIndexes = lines
    .map((line, index) => ({ index, match: /^#{1,6}\s+(.+?)\s*$/.exec(line.trim()) }))
    .filter((item): item is { index: number; match: RegExpExecArray } => Boolean(item.match));
  const wantedHeadings = language === "en" ? ["English"] : ["中文", "简体中文", "繁體中文"];
  const startHeading = headingIndexes.find((item) => wantedHeadings.includes(item.match[1].trim()));

  if (!startHeading) {
    if (language !== "en") {
      const englishHeading = headingIndexes.find((item) => item.match[1].trim() === "English");
      return englishHeading ? lines.slice(0, englishHeading.index) : lines;
    }
    return lines;
  }

  const endHeading = headingIndexes.find(
    (item) => item.index > startHeading.index && item.match[0].trim().startsWith("## ")
  );
  return lines.slice(startHeading.index + 1, endHeading?.index ?? lines.length);
}

function truncateReleaseSummary(value: string, maxLength = 210): string {
  const chars = Array.from(value);
  if (chars.length <= maxLength) {
    return value;
  }
  return chars.slice(0, Math.max(0, maxLength - 1)).join("").trimEnd() + "…";
}

function firstReleaseSummarySentence(value: string): string {
  const match = /^(.+?[。！？.!?])(?:\s|$)/.exec(value);
  return match?.[1] ?? value;
}

function releaseNotesToSummary(value: string, language: LanguagePreference, t: Translator): string {
  const readable = releaseNotesToReadableMarkdown(value);
  const candidate = releaseNotesLinesForLanguage(readable, language)
    .map((line) => line.trim())
    .filter((line) => line && !/^[-*_]{3,}$/.test(line))
    .find((line) => {
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        return false;
      }
      const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line);
      const plainHeading = headingMatch?.[1]?.trim();
      if (plainHeading && (releaseSummarySkipHeadings.has(plainHeading) || /release notes/i.test(plainHeading))) {
        return false;
      }
      if (headingMatch) {
        return false;
      }
      const text = markdownLineToSummaryText(line);
      return Boolean(text && !releaseSummarySkipHeadings.has(text) && !/release notes/i.test(text));
    });

  if (!candidate) {
    return t("updateReleaseSummaryFallback");
  }
  const summary = firstReleaseSummarySentence(markdownLineToSummaryText(candidate));
  if (language !== "en" && !/[\u3400-\u9fff]/.test(summary)) {
    return t("updateReleaseSummaryFallback");
  }
  return truncateReleaseSummary(summary);
}

function parseMarkdownImageLine(line: string): { alt: string; src: string } | null {
  const match = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line.trim());
  if (!match) {
    return null;
  }
  return {
    alt: match[1] || "image",
    src: match[2]
  };
}

function canRenderReadableImage(src: string): boolean {
  return src.startsWith("attachment://");
}

function ReadableMarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="readable-markdown-image-missing">
        <span>{alt || "image"}</span>
        <code>{src}</code>
      </div>
    );
  }
  return (
    <figure className="readable-markdown-image-block">
      <img src={src} alt={alt || "image"} loading="lazy" onError={() => setFailed(true)} />
      {alt && alt !== "image" && <figcaption>{alt}</figcaption>}
    </figure>
  );
}

function unescapeReadableMarkdownText(value: string): string {
  return value.replace(/\\([\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E])/g, "$1");
}

function readableMarkdownSearchText(value: string): string {
  return unescapeReadableMarkdownText(value)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_`~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function searchContextSnippet(
  text: string,
  term: string,
  language: LanguagePreference,
  maxLength = 120,
  preferredContextBefore?: number
): string {
  const needle = term.trim();
  if (!needle) {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}…`;
  }
  if (text.length <= maxLength) {
    return text;
  }
  const matchIndex = text
    .toLocaleLowerCase(localeFor(language))
    .indexOf(needle.toLocaleLowerCase(localeFor(language)));
  if (matchIndex < 0) {
    return `${text.slice(0, maxLength).trimEnd()}…`;
  }

  const windowLength = Math.max(maxLength, needle.length + 24);
  const contextBefore = Math.min(
    preferredContextBefore ?? Math.floor((windowLength - needle.length) * 0.42),
    windowLength - needle.length
  );
  const start = Math.max(0, matchIndex - contextBefore);
  const end = Math.min(text.length, start + windowLength);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function ReadableMarkdown({
  content,
  compact = false,
  searchTerm = ""
}: {
  content: string;
  compact?: boolean;
  searchTerm?: string;
}) {
  const readableContent = compact ? normalizeReferenceMarkdownSpacing(content) : content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = readableContent.split("\n");
  const elements: ReactNode[] = [];
  let codeLines: string[] = [];
  let activeFence: MarkdownFence | null = null;

  const flushCodeBlock = (key: string) => {
    elements.push(
      <pre className="readable-markdown-code" key={key}>
        <code><HighlightedSearchText text={codeLines.join("\n")} term={searchTerm} /></code>
      </pre>
    );
    codeLines = [];
  };

  lines.forEach((line, index) => {
    if (activeFence) {
      if (isMarkdownFenceClosing(line, activeFence)) {
        flushCodeBlock(`code-${index}`);
        activeFence = null;
      } else {
        codeLines.push(line);
      }
      return;
    }

    const openingFence = parseMarkdownFenceOpening(line);
    if (openingFence) {
      activeFence = openingFence;
      codeLines = [];
      return;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      elements.push(<div className="readable-markdown-space" key={`space-${index}`} />);
      return;
    }

    const image = parseMarkdownImageLine(line);
    if (image && canRenderReadableImage(image.src)) {
      elements.push(<ReadableMarkdownImage key={`image-${index}`} src={image.src} alt={image.alt} />);
      return;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const headingLevel = heading[1].length;
      if (headingLevel === 1) {
        elements.push(
          <h2 key={`heading-${index}`}>
            <HighlightedSearchText text={unescapeReadableMarkdownText(heading[2])} term={searchTerm} />
          </h2>
        );
      } else if (headingLevel === 2) {
        elements.push(
          <h3 key={`heading-${index}`}>
            <HighlightedSearchText text={unescapeReadableMarkdownText(heading[2])} term={searchTerm} />
          </h3>
        );
      } else {
        elements.push(
          <h4 className={`readable-markdown-heading-level-${headingLevel}`} key={`heading-${index}`}>
            <HighlightedSearchText text={unescapeReadableMarkdownText(heading[2])} term={searchTerm} />
          </h4>
        );
      }
      return;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (unordered) {
      elements.push(
        <p className="readable-markdown-list-line" key={`list-${index}`}>
          <span aria-hidden="true">•</span>
          <span><HighlightedSearchText text={unescapeReadableMarkdownText(unordered[1])} term={searchTerm} /></span>
        </p>
      );
      return;
    }

    const ordered = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      elements.push(
        <p className="readable-markdown-list-line" key={`ordered-${index}`}>
          <span>{ordered[1]}.</span>
          <span><HighlightedSearchText text={unescapeReadableMarkdownText(ordered[2])} term={searchTerm} /></span>
        </p>
      );
      return;
    }

    elements.push(
      <p className="readable-markdown-paragraph" key={`paragraph-${index}`}>
        <HighlightedSearchText text={unescapeReadableMarkdownText(line)} term={searchTerm} />
      </p>
    );
  });

  if (activeFence || codeLines.length > 0) {
    flushCodeBlock("code-end");
  }

  return (
    <div className={`readable-markdown-preview ${compact ? "compact" : ""}`}>
      {elements.length > 0 ? elements : (
        <p className="readable-markdown-paragraph">
          <HighlightedSearchText text={content} term={searchTerm} />
        </p>
      )}
    </div>
  );
}

const PROJECT_VISUAL_TONES = ["cobalt", "cyan", "teal", "emerald", "amber", "coral", "rose", "violet"] as const;

function projectVisualTone(projectId: string): (typeof PROJECT_VISUAL_TONES)[number] {
  let hash = 2166136261;
  for (const character of projectId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return PROJECT_VISUAL_TONES[(hash >>> 0) % PROJECT_VISUAL_TONES.length];
}

function ProjectIdentityMark({
  projectId,
  large = false,
  className = ""
}: {
  projectId: string;
  large?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`project-identity-mark${large ? " large" : ""} ${projectVisualTone(projectId)} ${className}`.trim()}
      aria-hidden="true"
    >
      <Orbit size={large ? 22 : 18} strokeWidth={1.8} />
    </span>
  );
}

function WorkspaceAmbientField({
  view,
  theme
}: {
  view: View;
  theme: SettingsInfo["effectiveTheme"];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const viewSeed = Array.from(view).reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0);
    let width = 0;
    let height = 0;
    let deviceScale = 1;
    let frame = 0;
    let lastPaint = 0;

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      deviceScale = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * deviceScale);
      canvas.height = Math.round(height * deviceScale);
    };

    const draw = (time: number) => {
      if (width <= 1 || height <= 1) {
        return;
      }

      const rootStyle = window.getComputedStyle(document.documentElement);
      const accent = rootStyle.getPropertyValue("--accent").trim() || "#0b63f6";
      const cyan = rootStyle.getPropertyValue("--pixel-cyan").trim() || "#28c9eb";
      const success = rootStyle.getPropertyValue("--success").trim() || "#12835a";
      const motionTime = reduceMotion ? 0 : time * 0.000045;
      const darkTheme = theme === "dark";

      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      context.clearRect(0, 0, width, height);

      const ribbons = [
        { baseline: 0.22, amplitude: 0.055, frequency: 7.2, phase: viewSeed * 0.013 },
        { baseline: 0.78, amplitude: 0.072, frequency: 6.1, phase: viewSeed * 0.021 + 1.8 }
      ];

      ribbons.forEach((ribbon, ribbonIndex) => {
        context.save();
        context.beginPath();
        for (let step = 0; step <= 72; step += 1) {
          const progress = step / 72;
          const x = progress * width;
          const y =
            ribbon.baseline * height +
            Math.sin(progress * ribbon.frequency + ribbon.phase + motionTime * (ribbonIndex + 1)) *
              height * ribbon.amplitude;
          if (step === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }
        context.strokeStyle = ribbonIndex === 0 ? accent : cyan;
        context.globalAlpha = darkTheme ? 0.08 : 0.045;
        context.lineWidth = 1;
        context.stroke();
        context.restore();

        const particleCount = ribbonIndex === 0 ? 64 : 52;
        for (let index = 0; index < particleCount; index += 1) {
          const seed = viewSeed * 47 + ribbonIndex * 997 + index * 61;
          const baseProgress = seededUnit(seed + 7);
          const speed = 0.016 + seededUnit(seed + 13) * 0.02;
          const progress = reduceMotion ? baseProgress : (baseProgress + motionTime * speed * 18) % 1;
          const x = progress * width;
          const scatter = (seededUnit(seed + 29) - 0.5) * height * 0.12;
          const y =
            ribbon.baseline * height +
            Math.sin(progress * ribbon.frequency + ribbon.phase + motionTime * (ribbonIndex + 1)) *
              height * ribbon.amplitude +
            scatter;
          const size = 0.8 + seededUnit(seed + 43) * 1.9;
          const color = index % 17 === 0 ? success : index % 5 === 0 ? cyan : accent;

          context.save();
          context.fillStyle = color;
          context.globalAlpha = (darkTheme ? 0.13 : 0.075) + seededUnit(seed + 53) * (darkTheme ? 0.11 : 0.075);
          context.fillRect(x - size / 2, y - size / 2, size, size);
          context.restore();
        }
      });
    };

    const tick = (time: number) => {
      if (!document.hidden && time - lastPaint >= 50) {
        draw(time);
        lastPaint = time;
      }
      frame = window.requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    observer.observe(host);
    resize();
    draw(performance.now());
    if (!reduceMotion) {
      frame = window.requestAnimationFrame(tick);
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [theme, view]);

  return <canvas ref={canvasRef} className="workspace-ambient-field" aria-hidden="true" />;
}

function TodayGlassActionButton({
  children,
  onClick
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="primary-button today-glass-action"
      type="button"
      onClick={onClick}
    >
      <span className="today-glass-action-content">{children}</span>
    </button>
  );
}

function todayWorkItemDisplayStatus(
  block: DailyWorkItemBlock,
  t: Translator
): { label: string; className: "filled" | "done" | "paused" | "active" | "not-started" } {
  if (blockHasFilledDailyEntry(block)) {
    return { label: t("filled"), className: "filled" };
  }
  const statusForToday = dailyStatusForBlock(block);
  if (statusForToday === "done_today") {
    return { label: t("statusDone"), className: "done" };
  }
  if (statusForToday === "paused") {
    return { label: t("statusPaused"), className: "paused" };
  }
  if (
    block.entry ||
    block.previousEntry ||
    block.workItemNote.content_markdown?.trim() ||
    block.workItem.description?.trim()
  ) {
    return { label: t("statusContinue"), className: "active" };
  }
  return { label: t("statusNotStarted"), className: "not-started" };
}

function TodayPage({
  dailyView,
  heatmapData,
  heatmapFailed,
  language,
  theme,
  t,
  visualPulse,
  onVisualPulseHandled,
  constellationTransition,
  onConstellationTransitionHandled,
  searchTerm,
  searchResults,
  isSearching,
  onSearchTermChange,
  onSearchResult,
  searchTarget,
  onSearchTargetHandled,
  onGenerateMarkdown,
  collapsedGroups,
  setCollapsedGroups,
  onOpenEntryEditor,
  onReopen,
  onOpenProject,
  onOpenMemo,
  onCreateProject,
  onOpenUserGuide
}: {
  dailyView: DailyJournalView;
  heatmapData: HeatmapMonth | null;
  heatmapFailed: boolean;
  language: LanguagePreference;
  theme: SettingsInfo["effectiveTheme"];
  t: Translator;
  visualPulse: TodayVisualPulse | null;
  onVisualPulseHandled: () => void;
  constellationTransition: TodayConstellationTransition | null;
  onConstellationTransitionHandled: (transitionId: number) => void;
  searchTerm: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  onSearchTermChange: (term: string) => void;
  onSearchResult: (result: SearchResult) => void;
  searchTarget: TodaySearchTarget | null;
  onSearchTargetHandled: (targetId: number) => void;
  onGenerateMarkdown: () => void;
  collapsedGroups: Record<string, boolean>;
  setCollapsedGroups: (value: Record<string, boolean>) => void;
  onOpenEntryEditor: (projectId: string, workItemId: string, journalDate?: string) => void;
  onReopen: () => void;
  onOpenProject: (id: string) => void;
  onOpenMemo: (projectId: string) => void;
  onCreateProject: () => void;
  onOpenUserGuide: () => void;
}) {
  const isClosed = dailyView.journal.status === "closed";
  const isLocalToday = dailyView.journalDate === getLocalDateKey();
  const activeEnterTransition =
    constellationTransition?.journalDate === dailyView.journalDate && constellationTransition.kind === "enter"
      ? constellationTransition
      : null;
  const activeVisualPulse: TodayVisualPulse | null =
    activeEnterTransition ?? (visualPulse?.journalDate === dailyView.journalDate ? visualPulse : null);
  const openBlockEditor = (block: DailyWorkItemBlock) =>
    onOpenEntryEditor(block.project.id, block.workItem.id, dailyView.journalDate);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>(() => dailyView.groups[0]?.project.id ?? "");
  const [isLocatorSearchOpen, setIsLocatorSearchOpen] = useState(false);
  const [locatorQuery, setLocatorQuery] = useState("");
  const [locatorSort, setLocatorSort] = useState<"default" | "recent">("default");
  const todayPageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (dailyView.groups.some((group) => group.project.id === selectedProjectKey)) {
      return;
    }
    setSelectedProjectKey(dailyView.groups[0]?.project.id ?? "");
  }, [dailyView.groups, selectedProjectKey]);

  useEffect(() => {
    if (
      activeVisualPulse &&
      dailyView.groups.some((group) => group.project.id === activeVisualPulse.projectId)
    ) {
      setSelectedProjectKey(activeVisualPulse.projectId);
    }
  }, [activeVisualPulse, dailyView.groups]);

  useEffect(() => {
    if (searchTarget && dailyView.groups.some((group) => group.project.id === searchTarget.projectId)) {
      setLocatorQuery("");
      setSelectedProjectKey(searchTarget.projectId);
    }
  }, [dailyView.groups, searchTarget]);

  const visibleProjectGroups = useMemo(() => {
    const normalizedQuery = locatorQuery.trim().toLocaleLowerCase();
    const groups = normalizedQuery
      ? dailyView.groups.filter((group) => group.project.name.toLocaleLowerCase().includes(normalizedQuery))
      : [...dailyView.groups];

    if (locatorSort === "recent") {
      return groups.sort((left, right) => {
        const latest = (group: DailyProjectGroup) =>
          latestTimestamp(group.items.map((block) => latestBlockSavedAt(block))) ?? group.project.updated_at;
        return new Date(latest(right)).getTime() - new Date(latest(left)).getTime();
      });
    }
    return groups;
  }, [dailyView.groups, locatorQuery, locatorSort]);

  const selectedGroup = dailyView.groups.find((group) => group.project.id === selectedProjectKey) ?? null;
  const focusedBlocks = selectedGroup?.items ?? [];

  useLayoutEffect(() => {
    if (!searchTarget || selectedProjectKey !== searchTarget.projectId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const root = todayPageRef.current;
      if (!root) {
        return;
      }
      const selector = searchTarget.workItemId ? "[data-work-item-id]" : "[data-project-id]";
      const dataKey = searchTarget.workItemId ? "workItemId" : "projectId";
      const targetId = searchTarget.workItemId ?? searchTarget.projectId;
      const targetElement = Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
        (element) => element.dataset[dataKey] === targetId
      );
      if (!targetElement) {
        return;
      }
      targetElement.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      targetElement.focus({ preventScroll: true });
      onSearchTargetHandled(searchTarget.id);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusedBlocks, onSearchTargetHandled, searchTarget, selectedProjectKey]);

  return (
    <section ref={todayPageRef} className="page daily-page">
      <PageHeader
        className="today-header-row"
        title={t("todayWorkPageTitle")}
        description={formatDateDisplay(dailyView.journalDate, language)}
        actions={
          <div className="today-header-actions">
            <SearchBox
              term={searchTerm}
              results={searchResults}
              isSearching={isSearching}
              t={t}
              onTermChange={onSearchTermChange}
              onResult={onSearchResult}
            />
            {isLocalToday && (
              <TodayGlassActionButton onClick={onGenerateMarkdown}>
                <FileText size={18} />
                {isClosed ? t("regenerateDailyReport") : t("endTodayWork")}
              </TodayGlassActionButton>
            )}
            {isClosed && (
              <button className="secondary-button" type="button" onClick={onReopen}>
                <Undo2 size={17} />
                {t("reopenDailyJournal")}
              </button>
            )}
          </div>
        }
      />

      <TodayMonthOverviewBar
        dailyView={dailyView}
        heatmapData={heatmapData}
        heatmapFailed={heatmapFailed}
        t={t}
        language={language}
        theme={theme}
        transition={
          constellationTransition?.journalDate === dailyView.journalDate
            ? constellationTransition
            : null
        }
        onTransitionHandled={onConstellationTransitionHandled}
      />

      <div className="today-focus-workspace">
        <aside className="today-project-locator">
          <header className="today-locator-header">
            <div>
              <h2>{t("todayProjectLocatorTitle")}</h2>
              <span>{dailyView.groups.length}</span>
            </div>
            <div className="today-locator-tools">
              <button
                className={`today-tool-button${isLocatorSearchOpen ? " active" : ""}`}
                type="button"
                aria-label={t("todaySearchProjects")}
                title={t("todaySearchProjects")}
                aria-expanded={isLocatorSearchOpen}
                onClick={() => {
                  setIsLocatorSearchOpen((current) => {
                    if (current) {
                      setLocatorQuery("");
                    }
                    return !current;
                  });
                }}
              >
                <Search size={18} aria-hidden="true" />
              </button>
              <button
                className={`today-tool-button${locatorSort === "recent" ? " active" : ""}`}
                type="button"
                aria-label={t("todayProjectSortAria")}
                aria-pressed={locatorSort === "recent"}
                title={t("todaySortRecent")}
                onClick={() => setLocatorSort((current) => (current === "recent" ? "default" : "recent"))}
              >
                <Bell size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          {isLocatorSearchOpen && (
            <label className="today-locator-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={locatorQuery}
                autoFocus
                aria-label={t("todaySearchProjects")}
                placeholder={t("todaySearchProjects")}
                onChange={(event) => setLocatorQuery(event.target.value)}
              />
              {locatorQuery && (
                <button type="button" aria-label={t("clearSearch")} onClick={() => setLocatorQuery("")}>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </label>
          )}

          <div className="today-locator-list">
            {visibleProjectGroups.map((group) => {
              const latestSavedAt = latestTimestamp(group.items.map((block) => latestBlockSavedAt(block)));
              return (
                <button
                  className={`today-locator-item${selectedProjectKey === group.project.id ? " active" : ""}`}
                  type="button"
                  key={group.project.id}
                  data-project-id={group.project.id}
                  onClick={() => setSelectedProjectKey(group.project.id)}
                >
                  <ProjectIdentityMark projectId={group.project.id} />
                  <span className="today-locator-item-copy">
                    <strong>{group.project.name}</strong>
                    <small>
                      {formatTimestamp(latestSavedAt, language, t)} {t("savedShort")}
                    </small>
                  </span>
                  <span className="today-locator-count">
                    {t("todayProjectItemCount").replace("{count}", String(group.items.length))}
                  </span>
                </button>
              );
            })}
          </div>

          {dailyView.groups.length === 0 && (
            <div className="today-locator-empty">
              <p>{t("todayGuideEmptyBody")}</p>
              <button className="primary-button" type="button" onClick={onCreateProject}>
                <Plus size={16} />
                {t("newProject")}
              </button>
              <button className="text-button" type="button" onClick={onOpenUserGuide}>
                {t("viewUserGuide")}
              </button>
            </div>
          )}
        </aside>

        <section className={`today-focused-project${selectedGroup ? "" : " empty"}`}>
          {selectedGroup ? (
            <>
              <header className="today-focused-header">
                <div className="today-focused-identity">
                  <ProjectIdentityMark projectId={selectedGroup.project.id} large />
                  <div>
                    <h2>{selectedGroup.project.name}</h2>
                    <span className="detail-status-pill">{t("statusActive")}</span>
                  </div>
                  <span className="today-focused-count">
                    {t("todayProjectItemCount").replace("{count}", String(focusedBlocks.length))}
                  </span>
                </div>
                <button className="today-memo-button" type="button" onClick={() => onOpenMemo(selectedGroup.project.id)}>
                  <StickyNote size={17} />
                  <span>{t("projectMemo")}</span>
                </button>
              </header>

              <div className="today-focus-table">
                <div className="today-focus-table-head" aria-hidden="true">
                  <span className="today-focus-title-heading">{t("workItem")}</span>
                  <span>{t("todayStatus")}</span>
                  <span>{t("todayRecentRecord")}</span>
                  <span>{t("todaySavedTime")}</span>
                  <span>{t("workItemActions")}</span>
                </div>
                {focusedBlocks.length > 0 ? (
                  focusedBlocks.map((block) => {
                const displayStatus = todayWorkItemDisplayStatus(block, t);
                const effectiveForm = dailyFormBaselineForBlock(block);
                const hasBlocker = Boolean(effectiveForm.blocker.trim());
                const isPaused = dailyStatusForBlock(block) === "paused";
                const recentText =
                  block.entry?.today_progress?.trim() ||
                  effectiveForm.nextStep.trim() ||
                  block.previousEntry?.today_progress?.trim() ||
                  block.workItemNote.content_markdown?.trim() ||
                  block.workItem.description?.trim() ||
                  t("none");
                return (
                    <article
                      className={`today-focus-row${
                       activeVisualPulse?.workItemId === block.workItem.id ? " visual-pulse" : ""
                      }`}
                    key={`${block.project.id}-${block.workItem.id}`}
                    data-work-item-id={block.workItem.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openBlockEditor(block)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openBlockEditor(block);
                      }
                    }}
                  >
                    <span className="today-focus-title">
                      <span
                        className={`today-work-item-icon${hasBlocker ? " blocked" : isPaused ? " paused" : ""}`}
                        role={hasBlocker || isPaused ? "img" : undefined}
                        aria-label={hasBlocker ? t("hasBlocker") : isPaused ? t("statusPaused") : undefined}
                        aria-hidden={hasBlocker || isPaused ? undefined : true}
                        title={hasBlocker ? t("hasBlocker") : isPaused ? t("statusPaused") : undefined}
                      >
                        {hasBlocker ? (
                          <AlertTriangle size={17} />
                        ) : isPaused ? (
                          <CirclePause size={17} />
                        ) : (
                          <FileText size={17} />
                        )}
                      </span>
                      <strong title={block.workItem.title}>{block.workItem.title}</strong>
                    </span>
                    <span className={`today-state-pill ${displayStatus.className}`}>{displayStatus.label}</span>
                    <span className="today-focus-recent" title={recentText}>
                      {summary(recentText, t)}
                    </span>
                    <time>{formatTimestamp(latestBlockSavedAt(block), language, t)}</time>
                    <button
                      className="today-focus-action"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openBlockEditor(block);
                      }}
                    >
                      <SquarePen size={16} />
                      {t("recordProgress")}
                    </button>
                  </article>
                );
                  })
                ) : (
                  <EmptyState title={t("todayGuideEmptyTitle")} body={t("todayGuideEmptyBody")} />
                )}
              </div>
            </>
          ) : (
            <EmptyState title={t("todayGuideEmptyTitle")} body={t("todayGuideEmptyBody")} />
          )}
        </section>
      </div>
      <TodayHeartFlightLayer
        pulse={activeVisualPulse}
        theme={theme}
        onComplete={() => {
          if (activeEnterTransition) {
            onConstellationTransitionHandled(activeEnterTransition.id);
            return;
          }
          onVisualPulseHandled();
        }}
      />
    </section>
  );
}

function TodayMonthOverviewBar({
  dailyView,
  t,
  language,
  theme,
  transition,
  onTransitionHandled
}: {
  dailyView: DailyJournalView;
  heatmapData: HeatmapMonth | null;
  heatmapFailed: boolean;
  t: Translator;
  language: LanguagePreference;
  theme: SettingsInfo["effectiveTheme"];
  transition: TodayConstellationTransition | null;
  onTransitionHandled: (transitionId: number) => void;
}) {
  const blocks = todayBlocks(dailyView);
  const missingSummaryCount = blocks.filter((block) => !blockHasChangeSummary(block)).length;
  const blockerCount = blocks.filter((block) => dailyBlockerForDisplay(block)).length;
  const { year, month, day } = dateKeyParts(dailyView.journalDate);
  const selectedDate = new Date(year, month - 1, day);
  const monday = new Date(selectedDate);
  monday.setDate(selectedDate.getDate() - ((selectedDate.getDay() + 6) % 7));
  const locale = localeFor(language);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
  const pendingEnterTransition = transition?.kind === "enter" ? transition : null;
  const pendingEnterWorkItemId = pendingEnterTransition?.workItemId ?? null;
  const constellationLayout = useMemo(
    () =>
      buildTodayConstellationLayout(
        todayBlocks(dailyView).filter(blockAppearsInTodayConstellation)
      ),
    [dailyView]
  );
  const pendingEnterIsOverflow = Boolean(
    pendingEnterWorkItemId &&
      constellationLayout.overflowNodes.some((node) => node.workItemId === pendingEnterWorkItemId)
  );
  const pendingEnterTargetNode = pendingEnterWorkItemId
    ? constellationLayout.nodes.find((node) => node.workItemId === pendingEnterWorkItemId) ??
      pendingEnterTransition?.node ??
      null
    : null;
  const visibleOverflowCount = Math.max(
    0,
    constellationLayout.overflowNodes.length - (pendingEnterIsOverflow ? 1 : 0)
  );
  const overviewStats = [
    { label: t("statsDailyWorkItems"), value: dailyView.stats.workItems, tone: "info" },
    { label: t("statsDailyEntries"), value: dailyView.stats.filledEntries, tone: "success" },
    { label: t("todayMissingSummary"), value: missingSummaryCount, tone: "info" },
    { label: t("todayBlockerItems"), value: blockerCount, tone: "danger" }
  ];

  return (
    <section className="today-month-overview">
      <div className="today-month-calendar">
        <div className="today-month-overview-title">
          <strong>{t("todaySidebarCalendarTitle")}</strong>
          <span>·</span>
          <span>{formatMonthDisplay(year, month, language)}</span>
        </div>
        <div className="today-overview-week">
          {weekDays.map((date) => {
            const isSelected =
              date.getFullYear() === selectedDate.getFullYear() &&
              date.getMonth() === selectedDate.getMonth() &&
              date.getDate() === selectedDate.getDate();
            const isOutsideMonth = date.getMonth() !== selectedDate.getMonth();
            return (
              <span className={`${isSelected ? "selected" : ""}${isOutsideMonth ? " outside" : ""}`} key={date.toISOString()}>
                <small>{new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(date)}</small>
                <strong>{date.getDate()}</strong>
              </span>
            );
          })}
        </div>
      </div>

      <div className="today-constellation-summary">
        <TodayConstellationField
          nodes={constellationLayout.nodes}
          suppressedWorkItemId={pendingEnterWorkItemId}
          suppressedPoint={pendingEnterTargetNode}
          theme={theme}
        />
        <TodayConstellationTransitionLayer
          transition={transition?.kind === "exit" ? transition : null}
          theme={theme}
          onComplete={onTransitionHandled}
        />
        {constellationLayout.nodes.map((node) => (
          <span
            aria-hidden="true"
            className="today-constellation-target"
            data-constellation-state={node.state}
            data-constellation-work-item-id={node.workItemId}
            key={node.workItemId}
            style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
          />
        ))}
        {visibleOverflowCount > 0 && (
          <span className="today-constellation-overflow-count" aria-hidden="true">
            <span className="today-constellation-overflow-star">
              <Star size={10} strokeWidth={2.2} />
            </span>
            <strong>+{visibleOverflowCount}</strong>
          </span>
        )}
        {constellationLayout.overflowNodes.map((node) => (
          <span
            aria-hidden="true"
            className="today-constellation-target today-constellation-overflow-target"
            data-constellation-state={node.state}
            data-constellation-work-item-id={node.workItemId}
            key={node.workItemId}
          />
        ))}
      </div>

      <div className="today-overview-stats">
        {overviewStats.map((item) => (
          <div className={item.tone} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

type TodayConstellationState = "default" | "filled" | "blocked";

interface TodayConstellationNode {
  workItemId: string;
  x: number;
  y: number;
  state: TodayConstellationState;
  seed: number;
}

interface TodayConstellationOverflowNode {
  workItemId: string;
  state: TodayConstellationState;
}

interface TodayConstellationLayout {
  nodes: TodayConstellationNode[];
  overflowNodes: TodayConstellationOverflowNode[];
}

function seededUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const TODAY_CONSTELLATION_VISIBLE_LIMIT = 16;

function todayConstellationSeed(value: string): number {
  return Array.from(value).reduce(
    (total, character, index) => (total + (character.codePointAt(0) ?? 0) * (index + 17)) % 104729,
    0
  );
}

function todayConstellationState(block: DailyWorkItemBlock): TodayConstellationState {
  return dailyBlockerForDisplay(block)
    ? "blocked"
    : blockHasFilledDailyEntry(block)
      ? "filled"
      : "default";
}

function buildTodayConstellationLayout(blocks: DailyWorkItemBlock[]): TodayConstellationLayout {
  const prioritizedBlocks = [
    ...blocks.filter((block) => todayConstellationState(block) === "blocked"),
    ...blocks.filter((block) => todayConstellationState(block) !== "blocked")
  ];
  const visibleWorkItemIds = new Set(
    prioritizedBlocks
      .slice(0, TODAY_CONSTELLATION_VISIBLE_LIMIT)
      .map((block) => block.workItem.id)
  );
  const visibleBlocks = blocks.filter((block) => visibleWorkItemIds.has(block.workItem.id));
  const overflowBlocks = blocks.filter((block) => !visibleWorkItemIds.has(block.workItem.id));

  return {
    nodes: buildTodayConstellationNodes(visibleBlocks),
    overflowNodes: overflowBlocks.map((block) => ({
      workItemId: block.workItem.id,
      state: todayConstellationState(block)
    }))
  };
}

function findTodayConstellationNode(
  dailyView: DailyJournalView | null,
  workItemId: string
): TodayConstellationNode | null {
  if (!dailyView) {
    return null;
  }
  return buildTodayConstellationLayout(
    todayBlocks(dailyView).filter(blockAppearsInTodayConstellation)
  ).nodes.find((node) => node.workItemId === workItemId) ?? null;
}

function buildTodayConstellationNodes(blocks: DailyWorkItemBlock[]): TodayConstellationNode[] {
  return blocks.map((block) => {
    const seed = todayConstellationSeed(block.workItem.id);
    return {
      workItemId: block.workItem.id,
      x: 0.055 + seededUnit(seed + 3) * 0.89,
      y: 0.1 + seededUnit(seed + 11) * 0.78,
      state: todayConstellationState(block),
      seed
    };
  });
}

function TodayConstellationField({
  nodes,
  suppressedWorkItemId,
  suppressedPoint,
  theme
}: {
  nodes: TodayConstellationNode[];
  suppressedWorkItemId: string | null;
  suppressedPoint: Pick<TodayConstellationNode, "x" | "y"> | null;
  theme: SettingsInfo["effectiveTheme"];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visibleNodes = useMemo(
    () =>
      nodes.filter((node) => {
        if (node.workItemId === suppressedWorkItemId) {
          return false;
        }
        if (!suppressedPoint) {
          return true;
        }

        const horizontalDistance = (node.x - suppressedPoint.x) / 0.06;
        const verticalDistance = (node.y - suppressedPoint.y) / 0.22;
        return horizontalDistance ** 2 + verticalDistance ** 2 >= 1;
      }),
    [nodes, suppressedPoint, suppressedWorkItemId]
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let width = 0;
    let height = 0;
    let deviceScale = 1;
    let lastPaint = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * deviceScale);
      canvas.height = Math.round(height * deviceScale);
    };

    const draw = (time: number) => {
      if (width <= 1 || height <= 1) {
        return;
      }
      const rootStyle = window.getComputedStyle(document.documentElement);
      const accent = rootStyle.getPropertyValue("--accent").trim() || "#0b63f6";
      const cyan = rootStyle.getPropertyValue("--pixel-cyan").trim() || "#28c9eb";
      const success = rootStyle.getPropertyValue("--success").trim() || "#12835a";
      const danger = rootStyle.getPropertyValue("--danger").trim() || "#b42318";
      const border = rootStyle.getPropertyValue("--border-strong").trim() || "#d4deeb";
      const stateColor = (state: TodayConstellationState) =>
        state === "blocked" ? danger : state === "filled" ? success : accent;
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      context.clearRect(0, 0, width, height);

      if (visibleNodes.length === 0) {
        return;
      }

      const motionTime = reduceMotion ? 0 : time * 0.00055;
      const points = visibleNodes.map((node) => {
        const phase = seededUnit(node.seed + 37) * Math.PI * 2;
        const driftStrength = node.x > 0.32 && node.x < 0.72 ? 4.2 : 2.8;
        return {
          ...node,
          px: node.x * width + Math.sin(motionTime * 1.65 + phase) * driftStrength,
          py: node.y * height + Math.cos(motionTime * 1.25 + phase) * driftStrength * 0.72
        };
      });

      for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        const controlOffset = (seededUnit(current.seed + next.seed) - 0.5) * height * 0.28;
        const controlA = {
          x: current.px + (next.px - current.px) * 0.34,
          y: current.py + controlOffset
        };
        const controlB = {
          x: current.px + (next.px - current.px) * 0.7,
          y: next.py - controlOffset
        };
        const pointOnConnection = (progress: number) => {
          const inverse = 1 - progress;
          return {
            x:
              inverse * inverse * inverse * current.px +
              3 * inverse * inverse * progress * controlA.x +
              3 * inverse * progress * progress * controlB.x +
              progress * progress * progress * next.px,
            y:
              inverse * inverse * inverse * current.py +
              3 * inverse * inverse * progress * controlA.y +
              3 * inverse * progress * progress * controlB.y +
              progress * progress * progress * next.py
          };
        };
        context.save();
        context.beginPath();
        context.moveTo(current.px, current.py);
        context.bezierCurveTo(
          controlA.x,
          controlA.y,
          controlB.x,
          controlB.y,
          next.px,
          next.py
        );
        context.strokeStyle = border;
        context.globalAlpha = theme === "dark" ? 0.27 : 0.22;
        context.lineWidth = 1;
        context.setLineDash([1, 7]);
        context.stroke();
        context.restore();

        for (let streamIndex = 0; streamIndex < 2; streamIndex += 1) {
          const streamSeed = current.seed + next.seed + streamIndex * 97;
          const baseProgress = seededUnit(streamSeed + 13);
          const streamProgress = reduceMotion
            ? baseProgress
            : (baseProgress + motionTime * (0.095 + streamIndex * 0.025)) % 1;
          const streamPoint = pointOnConnection(streamProgress);
          const size = 1.7 + streamIndex * 0.7;
          context.save();
          context.fillStyle = streamIndex === 0 ? stateColor(next.state) : cyan;
          context.globalAlpha = theme === "dark" ? 0.74 : 0.58;
          context.shadowColor = stateColor(next.state);
          context.shadowBlur = 5;
          context.fillRect(streamPoint.x - size / 2, streamPoint.y - size / 2, size, size);
          context.restore();
        }
      }

      const ambientCount = Math.min(112, 34 + visibleNodes.length * 9);
      for (let index = 0; index < ambientCount; index += 1) {
        const localSeed = 1709 + index * 61 + visibleNodes.length * 19;
        const sourceIndex = Math.floor(seededUnit(localSeed) * points.length) % points.length;
        const targetIndex = (sourceIndex + 1 + (index % Math.min(3, points.length))) % points.length;
        const source = points[sourceIndex];
        const target = points[targetIndex];
        const baseProgress = seededUnit(localSeed + 7);
        const progress = reduceMotion ? baseProgress : (baseProgress + motionTime * 0.026) % 1;
        const drift = Math.sin(motionTime * 1.8 + localSeed) * 2.4;
        const scatterX = (seededUnit(localSeed + 13) - 0.5) * width * 0.11;
        const scatterY = (seededUnit(localSeed + 29) - 0.5) * height * 0.38;
        const x = source.px + (target.px - source.px) * progress + scatterX + drift;
        const y = source.py + (target.py - source.py) * progress + scatterY - drift * 0.5;
        const size = 0.8 + seededUnit(localSeed + 43) * 1.65;
        context.save();
        context.fillStyle = index % 9 === 0 ? cyan : stateColor(source.state);
        context.globalAlpha = theme === "dark" ? 0.16 : 0.11;
        context.fillRect(x - size / 2, y - size / 2, size, size);
        context.restore();
      }

      for (const node of points) {
        const color = stateColor(node.state);
        const pulse = reduceMotion ? 1 : 1 + Math.sin(motionTime * 2.4 + node.seed) * 0.065;
        const scale = (visibleNodes.length > 14 ? 0.78 : visibleNodes.length > 9 ? 0.88 : 1) * pulse;
        const cell = 3.25 * scale;
        const gap = 0.85 * scale;
        const step = cell + gap;

        for (let particleIndex = 0; particleIndex < 9; particleIndex += 1) {
          const particleSeed = node.seed + particleIndex * 47;
          const angle = seededUnit(particleSeed + 5) * Math.PI * 2 + motionTime * 0.16;
          const distance = 14 + seededUnit(particleSeed + 17) * 17;
          const drift = Math.sin(motionTime * 2 + particleSeed) * 2;
          const size = 1 + seededUnit(particleSeed + 31) * 1.7;
          context.save();
          context.fillStyle = particleIndex % 4 === 0 ? cyan : color;
          context.globalAlpha = theme === "dark" ? 0.4 : 0.3;
          context.fillRect(
            node.px + Math.cos(angle) * (distance + drift) - size / 2,
            node.py + Math.sin(angle) * (distance + drift) - size / 2,
            size,
            size
          );
          context.restore();
        }

        const halo = context.createRadialGradient(node.px, node.py, 0, node.px, node.py, 28 * scale);
        halo.addColorStop(0, color);
        halo.addColorStop(1, "transparent");
        context.save();
        context.fillStyle = halo;
        context.globalAlpha = theme === "dark" ? 0.2 : 0.13;
        context.fillRect(node.px - 30 * scale, node.py - 30 * scale, 60 * scale, 60 * scale);
        context.restore();

        context.save();
        context.fillStyle = color;
        context.shadowColor = color;
        context.shadowBlur = theme === "dark" ? 12 : 9;
        context.globalAlpha = theme === "dark" ? 0.98 : 0.9;
        for (let row = -1; row <= 1; row += 1) {
          for (let column = -1; column <= 1; column += 1) {
            context.fillRect(
              node.px + column * step - cell / 2,
              node.py + row * step - cell / 2,
              cell,
              cell
            );
          }
        }
        context.globalAlpha = theme === "dark" ? 0.74 : 0.62;
        context.fillRect(node.px - step - cell / 2 + step * 0.55, node.py - step * 2 - cell / 2, cell, cell);
        context.fillRect(node.px - cell / 2 + step * 0.55, node.py - step * 2 - cell / 2, cell, cell);
        context.fillRect(node.px + step * 1.55 - cell / 2, node.py - step - cell / 2, cell, cell);
        context.fillRect(node.px + step * 1.55 - cell / 2, node.py - cell / 2, cell, cell);
        context.restore();

        context.save();
        context.fillStyle = theme === "dark" ? "#ffffff" : "#f8fbff";
        context.globalAlpha = theme === "dark" ? 0.7 : 0.82;
        context.fillRect(node.px - step - cell / 2 + 0.8, node.py - step - cell / 2 + 0.8, 1.2, 1.2);
        context.restore();
      }
    };

    const tick = (time: number) => {
      if (time - lastPaint >= 34) {
        draw(time);
        lastPaint = time;
      }
      frame = window.requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    observer.observe(container);
    resize();
    draw(performance.now());
    if (!reduceMotion) {
      frame = window.requestAnimationFrame(tick);
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [theme, visibleNodes]);

  return <canvas ref={canvasRef} className="today-constellation-field" aria-hidden="true" />;
}

function TodayConstellationTransitionLayer({
  transition,
  theme,
  onComplete
}: {
  transition: TodayConstellationTransition | null;
  theme: SettingsInfo["effectiveTheme"];
  onComplete: (transitionId: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!transition || !canvas || !container) {
      return;
    }

    const node = transition.node;
    if (!node) {
      const completionTimer = window.setTimeout(() => onCompleteRef.current(transition.id), 0);
      return () => window.clearTimeout(completionTimer);
    }

    const context = canvas.getContext("2d");
    if (!context) {
      const completionTimer = window.setTimeout(() => onCompleteRef.current(transition.id), 0);
      return () => window.clearTimeout(completionTimer);
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 320 : transition.kind === "exit" ? 1160 : 760;
    const startedAt = performance.now();
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let deviceScale = 1;
    let cancelled = false;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * deviceScale);
      canvas.height = Math.round(height * deviceScale);
    };

    const drawStar = (x: number, y: number, color: string, scale: number, alpha: number) => {
      const cell = 3.25 * scale;
      const gap = 0.85 * scale;
      const step = cell + gap;
      context.save();
      context.fillStyle = color;
      context.shadowColor = color;
      context.shadowBlur = theme === "dark" ? 14 : 10;
      context.globalAlpha = alpha;
      for (let row = -1; row <= 1; row += 1) {
        for (let column = -1; column <= 1; column += 1) {
          context.fillRect(x + column * step - cell / 2, y + row * step - cell / 2, cell, cell);
        }
      }
      context.globalAlpha = alpha * 0.72;
      context.fillRect(x - step - cell / 2 + step * 0.55, y - step * 2 - cell / 2, cell, cell);
      context.fillRect(x - cell / 2 + step * 0.55, y - step * 2 - cell / 2, cell, cell);
      context.fillRect(x + step * 1.55 - cell / 2, y - step - cell / 2, cell, cell);
      context.fillRect(x + step * 1.55 - cell / 2, y - cell / 2, cell, cell);
      context.restore();
    };

    const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);
    const easeInOutCubic = (value: number) =>
      value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
    const pointOnQuadraticCurve = (
      startX: number,
      startY: number,
      controlX: number,
      controlY: number,
      endX: number,
      endY: number,
      progress: number
    ) => {
      const inverse = 1 - progress;
      return {
        x: inverse * inverse * startX + 2 * inverse * progress * controlX + progress * progress * endX,
        y: inverse * inverse * startY + 2 * inverse * progress * controlY + progress * progress * endY
      };
    };

    const draw = (time: number) => {
      if (cancelled || width <= 1 || height <= 1) {
        return;
      }

      const progress = Math.min(1, Math.max(0, (time - startedAt) / duration));
      const rootStyle = window.getComputedStyle(document.documentElement);
      const accent = rootStyle.getPropertyValue("--accent").trim() || "#0b63f6";
      const cyan = rootStyle.getPropertyValue("--pixel-cyan").trim() || "#28c9eb";
      const success = rootStyle.getPropertyValue("--success").trim() || "#12835a";
      const danger = rootStyle.getPropertyValue("--danger").trim() || "#b42318";
      const color = node.state === "blocked" ? danger : node.state === "filled" ? success : accent;
      const x = node.x * width;
      const y = node.y * height;

      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      context.clearRect(0, 0, width, height);

      if (transition.kind === "exit") {
        if (reduceMotion) {
          drawStar(x, y, color, 1 - progress * 0.12, 1 - progress);
        } else {
          const focusEnd = 0.22;
          const focusProgress = Math.min(1, progress / focusEnd);
          const focus = easeInOutCubic(focusProgress);
          const release = Math.max(0, (progress - focusEnd) / (1 - focusEnd));
          const releaseEase = easeInOutCubic(release);
          const direction = seededUnit(node.seed + 211) > 0.5 ? 1 : -1;
          const coreX = x + direction * releaseEase * 4;
          const coreY = y - releaseEase * 7;
          const coreFade = Math.pow(1 - release, 1.35);
          const glintPulse = Math.exp(-Math.pow((progress - focusEnd) / 0.055, 2));

          if (progress < focusEnd) {
            drawStar(x, y, color, 1 - focus * 0.14, 1 - focus * 0.82);
          }

          const glowRadius = 9 + glintPulse * 5;
          const glow = context.createRadialGradient(coreX, coreY, 0, coreX, coreY, glowRadius);
          glow.addColorStop(
            0,
            theme === "dark" ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.94)"
          );
          glow.addColorStop(0.24, cyan);
          glow.addColorStop(0.62, color);
          glow.addColorStop(1, "transparent");
          context.save();
          context.globalCompositeOperation = "lighter";
          context.fillStyle = glow;
          context.globalAlpha = Math.max(0, (0.12 + glintPulse * 0.28) * coreFade);
          context.fillRect(coreX - glowRadius, coreY - glowRadius, glowRadius * 2, glowRadius * 2);
          context.restore();

          if (glintPulse > 0.01) {
            const verticalExtent = 5 + glintPulse * 15;
            const horizontalExtent = 4 + glintPulse * 9;
            const verticalGlint = context.createLinearGradient(
              coreX,
              coreY - verticalExtent,
              coreX,
              coreY + verticalExtent
            );
            verticalGlint.addColorStop(0, "transparent");
            verticalGlint.addColorStop(0.5, theme === "dark" ? "#ffffff" : "#dff5ff");
            verticalGlint.addColorStop(1, "transparent");
            const horizontalGlint = context.createLinearGradient(
              coreX - horizontalExtent,
              coreY,
              coreX + horizontalExtent,
              coreY
            );
            horizontalGlint.addColorStop(0, "transparent");
            horizontalGlint.addColorStop(0.5, cyan);
            horizontalGlint.addColorStop(1, "transparent");
            context.save();
            context.globalCompositeOperation = "lighter";
            context.beginPath();
            context.moveTo(coreX, coreY - verticalExtent);
            context.lineTo(coreX, coreY + verticalExtent);
            context.strokeStyle = verticalGlint;
            context.lineWidth = 0.8;
            context.globalAlpha = glintPulse * 0.72;
            context.stroke();
            context.beginPath();
            context.moveTo(coreX - horizontalExtent, coreY);
            context.lineTo(coreX + horizontalExtent, coreY);
            context.strokeStyle = horizontalGlint;
            context.lineWidth = 0.7;
            context.globalAlpha = glintPulse * 0.56;
            context.stroke();
            context.restore();
          }

          if (release > 0) {
            for (let trailIndex = 0; trailIndex < 4; trailIndex += 1) {
              const trailSeed = node.seed + trailIndex * 149;
              const spread = (seededUnit(trailSeed + 5) - 0.5) * 28;
              const reach = 28 + seededUnit(trailSeed + 17) * 34;
              const endX = x + direction * (9 + seededUnit(trailSeed + 29) * 19) + spread;
              const endY = y - reach;
              const controlX = x - direction * (8 + seededUnit(trailSeed + 41) * 12);
              const controlY = y - reach * 0.38;
              const trailGradient = context.createLinearGradient(x, y, endX, endY);
              trailGradient.addColorStop(0, color);
              trailGradient.addColorStop(0.48, cyan);
              trailGradient.addColorStop(1, "transparent");
              context.save();
              context.beginPath();
              context.moveTo(x, y);
              context.quadraticCurveTo(controlX, controlY, endX, endY);
              context.strokeStyle = trailGradient;
              context.lineCap = "round";
              context.lineWidth = 0.75 + trailIndex * 0.22;
              context.globalAlpha = Math.sin(release * Math.PI) * (0.16 + trailIndex * 0.035);
              context.stroke();
              context.restore();
            }

            for (let index = 0; index < 26; index += 1) {
              const particleSeed = node.seed + index * 83;
              const delay = seededUnit(particleSeed + 3) * 0.22;
              const particleProgress = Math.min(
                1,
                Math.max(0, (release - delay) / (1 - delay))
              );
              if (particleProgress <= 0) {
                continue;
              }
              const curvedProgress = easeOutCubic(particleProgress);
              const angle =
                -Math.PI / 2 + (seededUnit(particleSeed + 5) - 0.5) * Math.PI * 1.55;
              const distance = 22 + seededUnit(particleSeed + 17) * 48;
              const endX =
                x + Math.cos(angle) * distance + direction * seededUnit(particleSeed + 23) * 12;
              const endY = y + Math.sin(angle) * distance - seededUnit(particleSeed + 31) * 15;
              const controlX = x - direction * (6 + seededUnit(particleSeed + 37) * 18);
              const controlY = y - 8 - seededUnit(particleSeed + 43) * 20;
              const point = pointOnQuadraticCurve(
                x,
                y,
                controlX,
                controlY,
                endX,
                endY,
                curvedProgress
              );
              const particleAlpha =
                Math.sin(particleProgress * Math.PI) *
                (0.32 + seededUnit(particleSeed + 53) * 0.46);
              const particleSize = 0.65 + seededUnit(particleSeed + 61) * 1.75;
              const particleColor =
                index % 6 === 0
                  ? theme === "dark"
                    ? "#ffffff"
                    : "#eaf7ff"
                  : index % 3 === 0
                    ? cyan
                    : color;
              context.save();
              context.beginPath();
              context.fillStyle = particleColor;
              context.globalAlpha = particleAlpha;
              context.shadowColor = index % 3 === 0 ? cyan : color;
              context.shadowBlur = 6 + particleSize * 2;
              context.arc(point.x, point.y, particleSize, 0, Math.PI * 2);
              context.fill();
              context.restore();
            }
          }

          const coreRadius = Math.max(0, (2.8 + glintPulse * 1.3) * coreFade);
          if (coreRadius > 0.1) {
            context.save();
            context.globalCompositeOperation = "lighter";
            context.beginPath();
            context.fillStyle = theme === "dark" ? "#ffffff" : "#f7fbff";
            context.globalAlpha = Math.max(0, 0.82 * coreFade);
            context.shadowColor = cyan;
            context.shadowBlur = 8 + glintPulse * 10;
            context.arc(coreX, coreY, coreRadius, 0, Math.PI * 2);
            context.fill();
            context.restore();
          }
        }
      } else {
        const arrival = easeOutCubic(progress);

        if (!reduceMotion) {
          for (let index = 0; index < 24; index += 1) {
            const particleSeed = node.seed + index * 79;
            const angle = seededUnit(particleSeed + 7) * Math.PI * 2;
            const startDistance = 34 + seededUnit(particleSeed + 19) * 44;
            const distance = startDistance * (1 - arrival);
            const orbital = Math.sin(progress * Math.PI * 2 + particleSeed) * (1 - arrival) * 4;
            const size = 1 + seededUnit(particleSeed + 31) * 2;
            context.save();
            context.fillStyle = index % 5 === 0 ? cyan : color;
            context.globalAlpha = Math.sin(progress * Math.PI) * (0.38 + seededUnit(particleSeed + 43) * 0.48);
            context.fillRect(
              x + Math.cos(angle) * distance - Math.sin(angle) * orbital - size / 2,
              y + Math.sin(angle) * distance + Math.cos(angle) * orbital - size / 2,
              size,
              size
            );
            context.restore();
          }

          const haloRadius = 22 + (1 - arrival) * 24;
          const halo = context.createRadialGradient(x, y, 0, x, y, haloRadius);
          halo.addColorStop(0, color);
          halo.addColorStop(1, "transparent");
          context.save();
          context.fillStyle = halo;
          context.globalAlpha = Math.sin(progress * Math.PI) * 0.26;
          context.fillRect(x - haloRadius, y - haloRadius, haloRadius * 2, haloRadius * 2);
          context.restore();
        }
      }

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(draw);
        return;
      }

      context.clearRect(0, 0, width, height);
      onCompleteRef.current(transition.id);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    animationFrame = window.requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [theme, transition]);

  return <canvas ref={canvasRef} className="today-constellation-transition-layer" aria-hidden="true" />;
}

function TodayHeartFlightLayer({
  pulse,
  theme,
  onComplete
}: {
  pulse: TodayVisualPulse | null;
  theme: SettingsInfo["effectiveTheme"];
  onComplete: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.closest<HTMLElement>(".daily-page");
    if (!pulse || !canvas || !host) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      onCompleteRef.current();
      return;
    }

    let prepareFrame = 0;
    let animationFrame = 0;
    let completionTimer = 0;
    let attempt = 0;
    let cancelled = false;

    const finish = () => {
      if (cancelled) {
        return;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      onCompleteRef.current();
    };

    const prepare = () => {
      if (cancelled) {
        return;
      }
      const origin = Array.from(host.querySelectorAll<HTMLElement>(".today-focus-row")).find(
        (element) => element.dataset.workItemId === pulse.workItemId
      );
      const target = Array.from(host.querySelectorAll<HTMLElement>(".today-constellation-target")).find(
        (element) => element.dataset.constellationWorkItemId === pulse.workItemId
      );
      if ((!origin || !target) && attempt < 18) {
        attempt += 1;
        prepareFrame = window.requestAnimationFrame(prepare);
        return;
      }
      if (!origin || !target) {
        finish();
        return;
      }

      const hostRect = host.getBoundingClientRect();
      const originRect = origin.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const width = Math.max(host.scrollWidth, host.clientWidth);
      const height = Math.max(host.scrollHeight, host.clientHeight);
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * deviceScale);
      canvas.height = Math.round(height * deviceScale);

      const start = {
        x: originRect.left - hostRect.left + originRect.width * 0.58 + host.scrollLeft,
        y: originRect.top - hostRect.top + originRect.height * 0.5 + host.scrollTop
      };
      const end = {
        x: targetRect.left - hostRect.left + targetRect.width * 0.5 + host.scrollLeft,
        y: targetRect.top - hostRect.top + targetRect.height * 0.5 + host.scrollTop
      };
      const horizontalDistance = Math.abs(end.x - start.x);
      const controlA = {
        x: start.x + Math.max(72, horizontalDistance * 0.28),
        y: start.y - Math.max(54, Math.abs(end.y - start.y) * 0.16)
      };
      const controlB = {
        x: end.x - Math.max(62, horizontalDistance * 0.18),
        y: end.y + 48
      };
      const rootStyle = window.getComputedStyle(document.documentElement);
      const accent = rootStyle.getPropertyValue("--accent").trim() || "#0b63f6";
      const cyan = rootStyle.getPropertyValue("--pixel-cyan").trim() || "#28c9eb";
      const success = rootStyle.getPropertyValue("--success").trim() || "#12835a";
      const danger = rootStyle.getPropertyValue("--danger").trim() || "#b42318";
      const targetState = target.dataset.constellationState as TodayConstellationState | undefined;
      const targetColor = targetState === "blocked" ? danger : targetState === "filled" ? success : accent;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = reduceMotion ? 240 : 1180;
      const startedAt = performance.now();

      const heartCells = [
        [-2, -2],
        [-1, -3],
        [0, -2],
        [1, -3],
        [2, -2],
        [-3, -1],
        [-2, -1],
        [-1, -1],
        [0, -1],
        [1, -1],
        [2, -1],
        [3, -1],
        [-3, 0],
        [-2, 0],
        [-1, 0],
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [-2, 1],
        [-1, 1],
        [0, 1],
        [1, 1],
        [2, 1],
        [-1, 2],
        [0, 2],
        [1, 2],
        [0, 3]
      ] as const;

      const pointAt = (progress: number) => {
        const inverse = 1 - progress;
        return {
          x:
            inverse * inverse * inverse * start.x +
            3 * inverse * inverse * progress * controlA.x +
            3 * inverse * progress * progress * controlB.x +
            progress * progress * progress * end.x,
          y:
            inverse * inverse * inverse * start.y +
            3 * inverse * inverse * progress * controlA.y +
            3 * inverse * progress * progress * controlB.y +
            progress * progress * progress * end.y
        };
      };

      const draw = (time: number) => {
        if (cancelled) {
          return;
        }
        const rawProgress = Math.min(1, (time - startedAt) / duration);
        const progress = reduceMotion ? rawProgress : 1 - Math.pow(1 - rawProgress, 3);
        context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
        context.clearRect(0, 0, width, height);

        const trailLength = reduceMotion ? 4 : 24;
        for (let index = trailLength - 1; index >= 0; index -= 1) {
          const trailProgress = progress - index * (reduceMotion ? 0.04 : 0.014);
          if (trailProgress < 0) {
            continue;
          }
          const point = pointAt(Math.min(1, trailProgress));
          const strength = 1 - index / trailLength;
          const size = 1.2 + strength * 3.8;
          context.save();
          context.globalAlpha = strength * (theme === "dark" ? 0.82 : 0.72);
          context.fillStyle = index % 4 === 0 ? cyan : targetColor;
          context.shadowColor = targetColor;
          context.shadowBlur = 4 + strength * 8;
          context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
          context.restore();
        }

        const head = pointAt(progress);
        const heartCellSize = reduceMotion ? 1.8 : 2.1 + Math.sin(rawProgress * Math.PI) * 0.35;
        context.save();
        context.fillStyle = targetColor;
        context.shadowColor = targetColor;
        context.shadowBlur = theme === "dark" ? 13 : 10;
        context.globalAlpha = theme === "dark" ? 0.98 : 0.92;
        for (const [column, row] of heartCells) {
          const size = heartCellSize - (Math.abs(column) + Math.abs(row) > 4 ? 0.2 : 0);
          context.fillRect(
            head.x + column * (heartCellSize + 0.45) - size / 2,
            head.y + row * (heartCellSize + 0.45) - size / 2,
            size,
            size
          );
        }
        context.restore();

        if (rawProgress > 0.76) {
          const activation = Math.min(1, (rawProgress - 0.76) / 0.24);
          const fade = 1 - activation;
          context.save();
          context.shadowColor = targetColor;
          context.shadowBlur = 7;
          for (let index = 0; index < 26; index += 1) {
            const particleSeed = 311 + index * 53;
            const angle = seededUnit(particleSeed) * Math.PI * 2;
            const reach = 8 + seededUnit(particleSeed + 13) * 34;
            const distance = activation * reach;
            const size = 1.2 + seededUnit(particleSeed + 29) * 2.5 * fade;
            context.globalAlpha = fade * (theme === "dark" ? 0.82 : 0.68);
            context.fillStyle = index % 5 === 0 ? cyan : targetColor;
            context.fillRect(
              end.x + Math.cos(angle) * distance - size / 2,
              end.y + Math.sin(angle) * distance - size / 2,
              size,
              size
            );
          }
          context.restore();
        }

        if (rawProgress < 1) {
          animationFrame = window.requestAnimationFrame(draw);
          return;
        }
        completionTimer = window.setTimeout(finish, 220);
      };

      animationFrame = window.requestAnimationFrame(draw);
    };

    prepareFrame = window.requestAnimationFrame(prepare);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(prepareFrame);
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(completionTimer);
    };
  }, [pulse, theme]);

  return <canvas ref={canvasRef} className="today-heart-flight-layer" aria-hidden="true" />;
}

function TodaySidebar({
  dailyView,
  heatmapData,
  heatmapFailed,
  t,
  language,
  onOpenEntryEditor
}: {
  dailyView: DailyJournalView;
  heatmapData: HeatmapMonth | null;
  heatmapFailed: boolean;
  t: Translator;
  language: LanguagePreference;
  onOpenEntryEditor: (block: DailyWorkItemBlock) => void;
}) {
  const reminders = buildTodayReminders(dailyView, t, language);

  return (
    <aside className="today-sidebar-panel" aria-label={t("todayOverviewTitle")}>
      <TodayMiniCalendar
        dateKey={dailyView.journalDate}
        heatmapData={heatmapData}
        heatmapFailed={heatmapFailed}
        t={t}
        language={language}
      />
      <TodayOverviewCard
        dailyView={dailyView}
        reminders={reminders}
        t={t}
        language={language}
        onOpenEntryEditor={onOpenEntryEditor}
      />
    </aside>
  );
}

function TodayMiniCalendar({
  dateKey,
  heatmapData,
  heatmapFailed,
  t,
  language
}: {
  dateKey: string;
  heatmapData: HeatmapMonth | null;
  heatmapFailed: boolean;
  t: Translator;
  language: LanguagePreference;
}) {
  const { year, month, day: currentDay } = dateKeyParts(dateKey);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const locale = localeFor(language);
  const monthLabel = formatMonthDisplay(year, month, language);
  const matchingHeatmap =
    heatmapData?.year === year && heatmapData.month === month && !heatmapFailed ? heatmapData : null;
  const heatmapByDate = new Map<string, HeatmapDay>(
    matchingHeatmap?.days.map((item) => [item.date, item]) ?? []
  );
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2026, 5, index + 1))
  );
  const blankCells = Array.from({ length: firstDayOffset }, (_, index) => index);
  const days = Array.from({ length: daysInMonth }, (_, index) => index + 1);

  return (
    <section className="today-side-card today-mini-calendar-card">
      <header className="today-side-card-header">
        <div>
          <p>{t("todaySidebarCalendarTitle")}</p>
          <h2>{monthLabel}</h2>
        </div>
        {heatmapFailed ? <span>{t("todayMiniCalendarFallback")}</span> : null}
      </header>

      <div className="today-mini-weekdays" aria-hidden="true">
        {weekdayLabels.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>

      <div className="today-mini-calendar-grid" aria-label={monthLabel}>
        {blankCells.map((index) => (
          <span key={`blank-${index}`} className="today-mini-day blank" aria-hidden="true" />
        ))}
        {days.map((calendarDay) => {
          const date = `${year}-${String(month).padStart(2, "0")}-${String(calendarDay).padStart(2, "0")}`;
          const heatmapDay = heatmapByDate.get(date);
          const dayActivity = heatmapDay ? getHeatmapDisplayActivity(heatmapDay) : null;
          const level = dayActivity?.level ?? 0;
          const isToday = calendarDay === currentDay;
          const isFuture = date > getLocalDateKey();
          return (
            <span
              key={date}
              className={`today-mini-day${isToday ? " current" : ""}${
                isFuture ? " future" : ""
              }`}
              title={`${date} · ${heatmapDisplayLevelLabel(level, t)}${
                dayActivity && dayActivity.total > 0 ? ` · ${t("activityScore")}: ${dayActivity.total}` : ""
              }`}
            >
              <span className="today-mini-day-number">{calendarDay}</span>
              <HeatmapConstellation dayNumber={calendarDay} level={level} variant="mini" />
            </span>
          );
        })}
      </div>

      <div className="today-mini-legend" aria-label={t("heatmapLegend")}>
        <span>{t("heatmapLess")}</span>
        <span className="today-mini-constellation-scale" aria-hidden="true">
          {[1, 2, 3, 4].map((sampleLevel) => (
            <HeatmapConstellation
              dayNumber={17}
              level={sampleLevel as HeatmapDay["level"]}
              variant="mini-legend"
              key={sampleLevel}
            />
          ))}
        </span>
        <span>{t("heatmapMore")}</span>
      </div>
    </section>
  );
}

function TodayOverviewCard({
  dailyView,
  reminders,
  t,
  language,
  onOpenEntryEditor
}: {
  dailyView: DailyJournalView;
  reminders: TodayReminder[];
  t: Translator;
  language: LanguagePreference;
  onOpenEntryEditor: (block: DailyWorkItemBlock) => void;
}) {
  const blocks = todayBlocks(dailyView);
  const missingSummaryCount = blocks.filter((block) => !blockHasChangeSummary(block)).length;
  const blockerCount = blocks.filter((block) => dailyBlockerForDisplay(block)).length;
  const latestSavedAt = latestTimestamp(
    blocks.flatMap((block) => [block.entry?.updated_at, block.workItemNote?.updated_at])
  );
  const numberFormat = new Intl.NumberFormat(localeFor(language));
  const overviewStats = [
    {
      label: t("statsDailyWorkItems"),
      value: numberFormat.format(dailyView.stats.workItems)
    },
    {
      label: t("statsDailyEntries"),
      value: numberFormat.format(dailyView.stats.filledEntries)
    },
    {
      label: t("statsCompletedToday"),
      value: numberFormat.format(dailyView.stats.completedToday)
    },
    {
      label: t("todayMissingSummary"),
      value: numberFormat.format(missingSummaryCount)
    },
    {
      label: t("todayBlockerItems"),
      value: numberFormat.format(blockerCount)
    },
    {
      label: t("todayLatestSavedTime"),
      value: formatTimestamp(latestSavedAt, language, t)
    }
  ];

  return (
    <section className="today-side-card today-overview-card">
      <header className="today-side-card-header">
        <div>
          <p>{t("todayTitle")}</p>
          <h2>{t("todayOverviewTitle")}</h2>
        </div>
      </header>

      <div className="today-overview-grid">
        {overviewStats.map((item) => (
          <div key={item.label} className="today-overview-stat">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="today-reminders">
        <div className="today-reminders-header">
          <h3>{t("todayRemindersTitle")}</h3>
          <span>{numberFormat.format(reminders.length)}</span>
        </div>

        {reminders.length > 0 ? (
          <div className="today-reminder-list">
            {reminders.map((reminder) =>
              reminder.block ? (
                <button
                  key={reminder.id}
                  type="button"
                  className={`today-reminder-item ${reminder.tone}`}
                  onClick={() => onOpenEntryEditor(reminder.block!)}
                >
                  <span>{reminder.label}</span>
                  <strong>{reminder.title}</strong>
                  <small>{reminder.meta}</small>
                </button>
              ) : (
                <div key={reminder.id} className={`today-reminder-item ${reminder.tone}`}>
                  <span>{reminder.label}</span>
                  <strong>{reminder.title}</strong>
                  <small>{reminder.meta}</small>
                </div>
              )
            )}
          </div>
        ) : (
          <div className="today-reminder-empty">
            <strong>{t("todayReminderEmptyTitle")}</strong>
            <p>{t("todayReminderEmptyBody")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon: Icon,
  tone
}: {
  label: string;
  value: number;
  suffix: string;
  icon: typeof FolderOpen;
  tone: "blue" | "amber" | "green";
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon size={24} />
      </div>
      <div>
        <p>{label}</p>
        <strong>
          {value}
          <span>{suffix}</span>
        </strong>
      </div>
    </div>
  );
}

function DailyGroupCard({
  group,
  collapsed,
  onToggle,
  onOpenEntryEditor,
  onOpenProject,
  onOpenMemo,
  t,
  language
}: {
  group: DailyProjectGroup;
  collapsed: boolean;
  onToggle: () => void;
  onOpenEntryEditor: (block: DailyWorkItemBlock) => void;
  onOpenProject: (id: string) => void;
  onOpenMemo: (projectId: string) => void;
  t: Translator;
  language: LanguagePreference;
}) {
  return (
    <section className="project-card daily-project-card">
      <header className="project-card-header">
        <button className="project-title-button" type="button" onClick={() => onOpenProject(group.project.id)}>
          <Folder size={20} />
          <span>{group.project.name}</span>
          <em>{group.project.status === "active" ? t("statusActive") : t("statusArchived")}</em>
        </button>
        <div className="project-card-actions">
          <span>
            {t("todayGroupItemCount").replace("{count}", String(group.items.length))}
          </span>
          <span>
            {t("activeCountPrefix")} {group.activeCount} {t("unitCount")}
          </span>
          <button className="icon-button" type="button" onClick={onToggle} aria-label={t("toggleProjectAria")} aria-expanded={!collapsed}>
            <ChevronDown className={collapsed ? "rotated" : ""} size={18} />
          </button>
        </div>
      </header>
      {!collapsed && (
        <div className="daily-entry-list">
          <ProjectMemoSummaryCard
            project={group.project}
            memo={group.projectMemo}
            onOpen={() => onOpenMemo(group.project.id)}
            t={t}
            language={language}
          />
          {group.items.map((block) => (
            <DailyWorkItemSummaryCard
              key={block.workItem.id}
              block={block}
              onOpen={() => onOpenEntryEditor(block)}
              t={t}
              language={language}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectMemoSummaryCard({
  project,
  memo,
  onOpen,
  t,
  language
}: {
  project: Project;
  memo: ProjectMemo;
  onOpen: () => void;
  t: Translator;
  language: LanguagePreference;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  const summaryText = memoSummary(memo.content_markdown, t);

  return (
    <article
      className="project-memo-summary-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <div className="memo-summary-icon">
        <StickyNote size={16} />
      </div>
      <div className="memo-summary-main">
        <div className="memo-summary-title-row">
          <div>
            <span className="eyebrow">{t("projectMemoDocumentPill")}</span>
            <h3>{t("projectMemo")}</h3>
          </div>
          <span className="memo-document-pill">{t("openMemo")}</span>
        </div>
        <p className="memo-summary-text" title={summaryText}>
          {summaryText}
        </p>
        <footer>
          <span>
            {t("memoRecentlySaved")}: {formatTimestamp(memo.updated_at, language, t)}
          </span>
        </footer>
      </div>
    </article>
  );
}

function DailyWorkItemSummaryCard({
  block,
  onOpen,
  t,
  language
}: {
  block: DailyWorkItemBlock;
  onOpen: () => void;
  t: Translator;
  language: LanguagePreference;
}) {
  const entry = block.entry;
  const progressText = entry?.today_progress?.trim();
  const nextStepText = entry?.next_step?.trim();
  const blockerText = dailyBlockerForDisplay(block);
  const entryBlockerText = entry?.blocker?.trim();
  const isPaused = dailyStatusForBlock(block) === "paused";
  const summaryFilled = blockHasChangeSummary(block);
  const hasDailyText = Boolean(progressText || nextStepText || entryBlockerText);
  const itemStatus = workItemRowStatus(block, t);
  const previousText =
    block.previousEntry?.today_progress?.trim() ||
    block.previousEntry?.next_step?.trim() ||
    block.workItem.description?.trim() ||
    t("noPreviousWorkdayReference");
  const hintLabel = summaryFilled ? t("todayEntrySummary") : hasDailyText ? t("dailyEditorTitle") : t("previousWorkdayReference");
  const hintText = progressText || nextStepText || entryBlockerText || previousText;
  const latestSavedAt = latestBlockSavedAt(block);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <article
      className="daily-entry-row summary-card"
      data-work-item-id={block.workItem.id}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <div className={`daily-entry-row-icon${blockerText ? " blocked" : isPaused ? " paused" : ""}`}>
        {blockerText ? (
          <AlertTriangle size={17} />
        ) : isPaused ? (
          <CirclePause size={17} />
        ) : (
          <FileText size={17} />
        )}
      </div>
      <div className="daily-entry-row-main">
        <div className="daily-entry-row-title">
          <h3>{block.workItem.title}</h3>
          <span className={`daily-status-pill ${itemStatus.className}`}>{itemStatus.label}</span>
        </div>
        <p className="daily-entry-row-hint" title={hintText}>
          <span>{hintLabel}</span>
          {hintText}
        </p>
      </div>
      <div className="daily-entry-row-meta" aria-label={t("todayEntryMeta")}>
        <span className={`row-status-chip ${summaryFilled ? "filled" : "unfilled"}`}>
          <SquarePen size={14} />
          {summaryFilled ? t("summaryFilled") : t("summaryMissing")}
        </span>
        <span className={`row-status-chip ${blockerText ? "risk" : ""}`}>
          <AlertTriangle size={14} />
          {blockerText ? t("hasBlocker") : t("noBlocker")}
        </span>
        <time>{formatTimestamp(latestSavedAt, language, t)}</time>
      </div>
    </article>
  );
}

function DailyStatusDropdown({
  value,
  disabled,
  t,
  onChange
}: {
  value: DailyWorkItemStatus;
  disabled: boolean;
  t: Translator;
  onChange: (value: DailyWorkItemStatus) => void;
}) {
  const options: Array<{
    value: DailyWorkItemStatus;
    label: string;
    tone: "active" | "done" | "paused";
  }> = [
    { value: "in_progress", label: t("statusContinue"), tone: "active" },
    { value: "done_today", label: t("statusDoneToday"), tone: "done" },
    { value: "paused", label: t("statusPaused"), tone: "paused" }
  ];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const focusOption = (index: number) => {
    const nextIndex = (index + options.length) % options.length;
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const closeMenu = (restoreTriggerFocus = false) => {
    setOpen(false);
    if (restoreTriggerFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const openMenu = (index = selectedIndex) => {
    if (disabled) {
      return;
    }
    setActiveIndex(index);
    setOpen(true);
  };

  const selectOption = (nextValue: DailyWorkItemStatus) => {
    if (nextValue !== value) {
      onChange(nextValue);
    }
    closeMenu(true);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus());
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <div
      ref={rootRef}
      className={`daily-status-select entry-status-control entry-topbar-status ${open ? "open" : ""}`.trim()}
      data-status={value}
    >
      <button
        ref={triggerRef}
        className="entry-status-trigger"
        type="button"
        aria-label={`${t("todayStatus")}: ${selectedOption.label}`}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(selectedIndex);
          } else if (event.key === "Home") {
            event.preventDefault();
            openMenu(0);
          } else if (event.key === "End") {
            event.preventDefault();
            openMenu(options.length - 1);
          }
        }}
      >
        <span className={`entry-status-dot ${selectedOption.tone}`} aria-hidden="true" />
        <span className="entry-status-value">{selectedOption.label}</span>
        <ChevronDown className="entry-status-chevron" size={16} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} className="entry-status-menu" role="listbox" aria-label={t("todayStatus")}>
          <div className="entry-status-options" role="presentation">
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  key={option.value}
                  className={`${selected ? "selected" : ""} ${activeIndex === index ? "active" : ""}`.trim()}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusOption(index + 1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusOption(index - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      focusOption(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      focusOption(options.length - 1);
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectOption(option.value);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      closeMenu(true);
                    } else if (event.key === "Tab") {
                      setOpen(false);
                    }
                  }}
                >
                  <span className={`entry-status-option-dot ${option.tone}`} aria-hidden="true" />
                  <span className="entry-status-option-label">{option.label}</span>
                  <span className="entry-status-option-check" aria-hidden="true">
                    {selected && <Check size={14} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DailyEntryEditorPage({
  dailyView,
  block,
  form,
  language,
  theme,
  aiSettings,
  t,
  onBack,
  onUpdate,
  onSave,
  onViewHistory,
  onRestoreHistory,
  onToast,
  onConfirm
}: {
  dailyView: DailyJournalView;
  block: DailyWorkItemBlock;
  form: DailyEntryForm;
  language: LanguagePreference;
  theme: "light" | "dark";
  aiSettings: AiSettingsInfo | null;
  t: Translator;
  onBack: () => void;
  onUpdate: (patch: Partial<DailyEntryForm>) => void;
  onSave: () => void;
  onViewHistory: () => void;
  onRestoreHistory: () => void;
  onToast: (toast: Toast) => void;
  onConfirm: (options: AppConfirmOptions) => Promise<boolean>;
}) {
  const isClosed = dailyView.journal.status === "closed";
  const previousEntry = block.previousEntry;
  const [activePrimarySection, setActivePrimarySection] = useState<DailyPrimaryEditorSection>("currentContent");
  const [activeSection, setActiveSection] = useState<DailyEditorSection>("todayProgress");
  const [referenceSidebarCollapsed, setReferenceSidebarCollapsed] = useState(false);
  const [savingImageTarget, setSavingImageTarget] = useState<"note" | "daily" | null>(null);
  const [draftingMode, setDraftingMode] = useState<"local" | "ai" | null>(null);
  const [editorWallpaper, setEditorWallpaper] = useState<EditorWallpaper>(readEditorWallpaperPreference);
  const [wallpaperPickerOpen, setWallpaperPickerOpen] = useState(false);
  const wallpaperPickerRef = useRef<HTMLDivElement | null>(null);
  const isDrafting = draftingMode !== null;
  const canGenerateAiDraft = Boolean(aiSettings?.enabled && aiSettings.apiKeyConfigured && aiSettings.baseUrl && aiSettings.model);
  const aiDraftDisabled = isClosed || isDrafting || !canGenerateAiDraft;
  const aiDraftTooltip = canGenerateAiDraft ? t("generateAiChangeSummaryHelp") : t("aiDraftUnavailableHint");
  const showHistoryRecoveryCard =
    !isClosed &&
    !form.workItemNoteContent.trim() &&
    Boolean(block.recoverableHistory);
  const primaryEditorSections: Array<{ id: DailyPrimaryEditorSection; label: string; description: string }> = [
    {
      id: "currentContent",
      label: t("workItemCurrentContent"),
      description: t("workItemCurrentContentHelp")
    },
    {
      id: "dailyChange",
      label: t("dailyEditorTitle"),
      description: t("todayChangeSummaryHelp")
    }
  ];
  const previousNoteContent = block.previousNoteSnapshot?.content_markdown ?? "";
  const previousRows = [
    [t("dateLabel"), block.previousWorkDate, false, false],
    [t("workItemPreviousContent"), previousNoteContent, true, true],
    [t("changeSummary"), previousEntry?.today_progress, true, true],
    [t("nextStepPlan"), previousEntry?.next_step, true, true],
    [t("blockerHelp"), previousEntry?.blocker, true, true]
  ] as Array<[string, string | null | undefined, boolean, boolean]>;
  const editorSections: Array<{
    id: DailyEditorSection;
    label: string;
    value: string;
    placeholder: string;
  }> = [
    {
      id: "todayProgress",
      label: t("progressToday"),
      value: form.todayProgress,
      placeholder: t("dailyProgressPlaceholder")
    },
    {
      id: "nextStep",
      label: t("nextStepPlan"),
      value: form.nextStep,
      placeholder: t("nextStepPlaceholder")
    },
    {
      id: "blocker",
      label: t("blockerHelp"),
      value: form.blocker,
      placeholder: t("blockerPlaceholder")
    }
  ];
  const primaryEditorSectionIds = primaryEditorSections.map((section) => section.id);
  const editorSectionIds = editorSections.map((section) => section.id);
  const activeEditor = editorSections.find((section) => section.id === activeSection) ?? editorSections[0];
  const wallpaperOptions: Array<{ id: EditorWallpaper; label: string; previewImage: string | null }> = [
    { id: "clean", label: t("editorWallpaperClean"), previewImage: null },
    { id: "cloud", label: t("editorWallpaperCloud"), previewImage: editorPaperCloudMist },
    { id: "forest", label: t("editorWallpaperForest"), previewImage: editorPaperForestWhisper },
    { id: "night", label: t("editorWallpaperNight"), previewImage: editorPaperNightVoyage }
  ];
  const activeWallpaperLabel = wallpaperOptions.find((option) => option.id === editorWallpaper)?.label ?? "";
  const editorPaperImage = wallpaperOptions.find((option) => option.id === editorWallpaper)?.previewImage ?? null;
  const editorPaperStyle = editorPaperImage
    ? ({ "--editor-paper-image": `url("${editorPaperImage}")` } as CSSProperties)
    : undefined;

  useEffect(() => {
    if (!wallpaperPickerOpen) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!wallpaperPickerRef.current?.contains(event.target as Node)) {
        setWallpaperPickerOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setWallpaperPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [wallpaperPickerOpen]);

  const selectEditorWallpaper = (nextWallpaper: EditorWallpaper) => {
    setEditorWallpaper(nextWallpaper);
    setWallpaperPickerOpen(false);
    try {
      window.localStorage.setItem(EDITOR_WALLPAPER_STORAGE_KEY, nextWallpaper);
    } catch {
      // The visual preference can remain session-only if localStorage is unavailable.
    }
  };

  const updateActiveSection = (value: string) => {
    if (activeSection === "todayProgress") {
      onUpdate({ todayProgress: value });
      return;
    }
    if (activeSection === "nextStep") {
      onUpdate({ nextStep: value });
      return;
    }
    onUpdate({ blocker: value });
  };
  const saveDailyEditorImage = async (file: File | Blob) => {
    setSavingImageTarget("daily");
    try {
      const data = await file.arrayBuffer();
      const result = await window.workJournal.daily.saveAttachment({
        projectId: block.project.id,
        workItemId: block.workItem.id,
        journalDate: dailyView.journalDate,
        mimeType: file.type || "image/png",
        data
      });
      onToast({ kind: "success", message: t("imagePasteSuccess") });
      return result.markdownUrl;
    } finally {
      setSavingImageTarget(null);
    }
  };
  const saveWorkItemNoteImage = async (file: File | Blob) => {
    setSavingImageTarget("note");
    try {
      const data = await file.arrayBuffer();
      const result = await window.workJournal.daily.saveWorkItemNoteAttachment({
        projectId: block.project.id,
        workItemId: block.workItem.id,
        mimeType: file.type || "image/png",
        data
      });
      onToast({ kind: "success", message: t("imagePasteSuccess") });
      return result.markdownUrl;
    } finally {
      setSavingImageTarget(null);
    }
  };
  const copyReferenceText = async (value: string | null | undefined) => {
    const text = value ?? "";
    if (!text.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(normalizeReferenceMarkdownSpacing(text));
      onToast({ kind: "success", message: t("referenceTextCopied") });
    } catch {
      onToast({ kind: "error", message: t("referenceTextCopyFailed") });
    }
  };

  const shouldReplaceTodayProgress = async () => {
    if (!form.todayProgress.trim()) {
      return true;
    }
    return onConfirm({
      title: t("changeDraftOverwriteConfirmTitle"),
      body: t("changeDraftOverwriteConfirm"),
      primaryLabel: t("confirmAction"),
      tone: "warning"
    });
  };
  const buildCurrentLocalDraft = () =>
    buildLocalChangeDraft(block.previousNoteSnapshot?.content_markdown ?? "", form.workItemNoteContent, t);
  const applyGeneratedChangeDraft = (draft: string, message: string, kind: Toast["kind"] = "success") => {
    const sanitizedDraft = sanitizeGeneratedChangeDraft(draft) || t("changeDraftNoChanges");
    onUpdate({ todayProgress: sanitizedDraft });
    setActivePrimarySection("dailyChange");
    setActiveSection("todayProgress");
    onToast({ kind, message });
  };

  const handleGenerateLocalChangeDraft = async () => {
    if (isClosed || isDrafting) {
      return;
    }
    if (!(await shouldReplaceTodayProgress())) {
      return;
    }
    setDraftingMode("local");
    try {
      applyGeneratedChangeDraft(buildCurrentLocalDraft(), t("localChangeDraftGenerated"));
    } finally {
      setDraftingMode(null);
    }
  };

  const handleGenerateAiChangeDraft = async () => {
    if (isClosed || isDrafting) {
      return;
    }
    if (!canGenerateAiDraft) {
      onToast({ kind: "warning", message: t("aiDraftConfigureFirst") });
      return;
    }
    const costConfirmed = await onConfirm({
      title: t("aiDraftCostConfirmTitle"),
      body: t("aiDraftCostConfirm"),
      primaryLabel: t("continueAction"),
      tone: "warning"
    });
    if (!costConfirmed) {
      return;
    }
    const hasExistingSummary = Boolean(form.todayProgress.trim());
    const secondConfirm = hasExistingSummary ? t("aiDraftOverwriteConfirm") : t("aiDraftSendConfirm");
    const sendConfirmed = await onConfirm({
      title: t("aiDraftSendConfirmTitle"),
      body: secondConfirm,
      primaryLabel: t("generateAiChangeSummary"),
      tone: hasExistingSummary ? "warning" : "info"
    });
    if (!sendConfirmed) {
      return;
    }
    setDraftingMode("ai");
    try {
      const localDraft = buildCurrentLocalDraft();
      const result = await window.workJournal.ai.draftDailyChange({
        projectName: block.project.name,
        workItemTitle: block.workItem.title,
        localDraft
      });
      if (result.success) {
        applyGeneratedChangeDraft(result.draft, t("aiChangeDraftGenerated"));
      } else {
        applyGeneratedChangeDraft(
          localDraft,
          `${t("aiDraftFailedUseLocal")}${result.error ? `: ${result.error}` : ""}`,
          "error"
        );
      }
    } finally {
      setDraftingMode(null);
    }
  };

  return (
    <section className="page daily-entry-editor-page">
      <header className="entry-page-header daily-entry-topbar">
        <div className="daily-entry-route">
          <button className="entry-back-icon" type="button" aria-label={t("backToTodayWorkPage")} onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
          <span className="entry-route-project" title={block.project.name}>
            {block.project.name}
          </span>
          <span className="entry-route-divider">/</span>
          <span className="entry-route-work-item" title={block.workItem.title}>
            {block.workItem.title}
          </span>
        </div>
        <div className="entry-header-actions">
          <span className="entry-header-saved">
            {t("lastSavedAt")} {formatTimeDisplay(block.entry?.updated_at ?? null, language, t)}
          </span>
          <div ref={wallpaperPickerRef} className="editor-wallpaper-picker">
            <button
              className={`entry-wallpaper-trigger ${wallpaperPickerOpen ? "active" : ""}`}
              type="button"
              title={`${t("editorWallpaper")}: ${activeWallpaperLabel}`}
              aria-label={`${t("editorWallpaper")}: ${activeWallpaperLabel}`}
              aria-haspopup="menu"
              aria-expanded={wallpaperPickerOpen}
              onClick={() => setWallpaperPickerOpen((open) => !open)}
            >
              <Wallpaper size={18} />
            </button>
            {wallpaperPickerOpen && (
              <div className="editor-wallpaper-menu" role="menu" aria-label={t("editorWallpaper")}>
                <span className="editor-wallpaper-menu-title">{t("editorWallpaper")}</span>
                <div className="editor-wallpaper-options">
                  {wallpaperOptions.map((option) => (
                    <button
                      key={option.id}
                      className={editorWallpaper === option.id ? "selected" : ""}
                      type="button"
                      role="menuitemradio"
                      aria-checked={editorWallpaper === option.id}
                      onClick={() => selectEditorWallpaper(option.id)}
                    >
                      <span
                        className={`editor-paper-preview ${option.id}`}
                        style={
                          option.previewImage
                            ? ({ backgroundImage: `url("${option.previewImage}")` } as CSSProperties)
                            : undefined
                        }
                        aria-hidden="true"
                      />
                      <span className="editor-paper-choice-name">{option.label}</span>
                      {editorWallpaper === option.id && (
                        <span className="editor-paper-choice-check" aria-hidden="true">
                          <Check size={13} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DailyStatusDropdown
            value={form.statusForToday}
            disabled={isClosed}
            t={t}
            onChange={(statusForToday) => onUpdate({ statusForToday })}
          />
          <button className="secondary-button entry-save-button" type="button" onClick={onSave} disabled={isClosed}>
            {t("saveAction")}
          </button>
        </div>
      </header>

      {isClosed && (
        <div className="closed-banner">
          <Check size={18} />
          <div>
            <strong>{t("dailyJournalClosedTitle")}</strong>
            <span>{t("dailyJournalClosedBody")}</span>
          </div>
        </div>
      )}

      <div className={`daily-entry-editor-layout ${referenceSidebarCollapsed ? "reference-sidebar-collapsed" : ""}`}>
        {!referenceSidebarCollapsed && (
          <aside className="reference-panel-card expanded">
            <div className="reference-compact-row">
              <div className="reference-compact-main">
                <div className="reference-card-heading">
                  <div className="reference-heading-row">
                    <strong>{t("previousWorkdayReference")}</strong>
                    <button
                      className="reference-sidebar-control reference-sidebar-toggle"
                      type="button"
                      aria-label={t("collapseReferenceSidebar")}
                      aria-expanded={true}
                      onClick={() => setReferenceSidebarCollapsed(true)}
                    >
                      <ChevronLeft size={16} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="reference-detail-scroll">
              <dl className="previous-reference-list">
                {previousRows.map(([label, value, canCopy, renderMarkdown]) => {
                  const referenceText = value ?? "";
                  const hasReferenceText = Boolean(referenceText.trim());
                  return (
                    <div key={label}>
                      <dt>
                        <span>{label}</span>
                        {canCopy && hasReferenceText && (
                          <button
                            className="reference-copy-button"
                            type="button"
                            title={`${t("copyOriginal")}: ${label}`}
                            aria-label={`${t("copyOriginal")}: ${label}`}
                            onClick={() => void copyReferenceText(referenceText)}
                          >
                            <Clipboard size={13} />
                            <span>{t("copyOriginal")}</span>
                          </button>
                        )}
                      </dt>
                      <dd>
                        {hasReferenceText ? (
                          renderMarkdown ? (
                            <ReadableMarkdown content={referenceText} compact />
                          ) : (
                            referenceText
                          )
                        ) : (
                          t("none")
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </aside>
        )}

        <section
          className={`entry-editor-switcher editor-workspace editor-paper-${editorWallpaper}`}
          style={editorPaperStyle}
        >
          <div className="primary-editor-navigation">
            {referenceSidebarCollapsed && (
              <button
                className="reference-sidebar-control reference-sidebar-reveal"
                type="button"
                aria-label={t("expandReferenceSidebar")}
                aria-expanded={false}
                title={t("expandReferenceSidebar")}
                onClick={() => setReferenceSidebarCollapsed(false)}
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            )}
            <div
              className="editor-tabs primary-editor-tabs sliding-tab-list"
              role="tablist"
              aria-label={t("dailyEditorTitle")}
              onKeyDown={(event) =>
                handleSegmentedKeyDown(event, primaryEditorSectionIds, activePrimarySection, setActivePrimarySection)
              }
            >
              <SlidingTabIndicator activeItem={activePrimarySection} />
              {primaryEditorSections.map((section) => (
                <button
                  key={section.id}
                  data-tab-id={section.id}
                  className={activePrimarySection === section.id ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activePrimarySection === section.id}
                  tabIndex={activePrimarySection === section.id ? 0 : -1}
                  title={section.description}
                  onClick={() => setActivePrimarySection(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

        {activePrimarySection === "currentContent" ? (
          <section className="entry-editor-form work-item-note-editor">
            <div className="daily-editor-header">
              <div>
                <span>{t("workItemCurrentContent")}</span>
                <em>{savingImageTarget === "note" ? t("memoSavingImage") : t("workItemCurrentContentHelp")}</em>
              </div>
            </div>
            {showHistoryRecoveryCard && block.recoverableHistory && (
              <div className="history-recovery-card">
                <div className="history-recovery-icon">
                  <BookOpenText size={18} />
                </div>
                <div className="history-recovery-copy">
                  <strong>{t("historyRecordsFound")}</strong>
                  <span>{t("historyRecordsFoundBody")}</span>
                  <small>
                    {t("historyRecoveryStatsSafe")} · {block.recoverableHistory.recordCount} {t("unitEntry")}
                  </small>
                </div>
                <div className="history-recovery-actions">
                  <button className="secondary-button" type="button" onClick={onViewHistory}>
                    <BookOpenText size={16} />
                    {t("viewHistoricalRecords")}
                  </button>
                  <button className="primary-button" type="button" onClick={onRestoreHistory}>
                    <Undo2 size={16} />
                    {t("restoreToCurrentWorkItemContent")}
                  </button>
                </div>
              </div>
            )}
            <div className="daily-field editor-note-field" role="group" aria-label={t("workItemCurrentContent")}>
              <span className="sr-only">{t("workItemCurrentContent")}</span>
              <MarkdownWysiwygEditor
                value={form.workItemNoteContent}
                language={language}
                theme={theme}
                labels={markdownEditorLabels(t)}
                onFeedback={onToast}
                placeholder={t("workItemCurrentContentPlaceholder")}
                height="100%"
                minHeight="0px"
                disabled={isClosed}
                compact
                onChange={(value) => onUpdate({ workItemNoteContent: value })}
                onImageUpload={saveWorkItemNoteImage}
                onImageError={(error) =>
                  onToast({ kind: "error", message: error instanceof Error ? error.message : t("memoImagePasteFailed") })
                }
              />
            </div>
          </section>
        ) : (
          <section className="entry-editor-form">
            <div className="change-section-bar">
              <div
                className="editor-tabs change-section-tabs sliding-tab-list"
                role="tablist"
                aria-label={t("dailyEditorTitle")}
                onKeyDown={(event) => handleSegmentedKeyDown(event, editorSectionIds, activeSection, setActiveSection)}
              >
                <SlidingTabIndicator activeItem={activeSection} />
                {editorSections.map((section) => (
                  <button
                    key={section.id}
                    data-tab-id={section.id}
                    className={activeSection === section.id ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={activeSection === section.id}
                    tabIndex={activeSection === section.id ? 0 : -1}
                    onClick={() => setActiveSection(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
              {(activeSection === "todayProgress" || savingImageTarget === "daily") && (
                <div className="change-section-tools">
                  {activeSection === "todayProgress" && (
                    <div className="change-summary-actions" role="group" aria-label={t("changeSummaryGenerationActions")}>
                      <HoverTooltip
                        className="change-summary-action-tooltip"
                        content={t("generateLocalChangeSummaryHelp")}
                        showWhen="always"
                        focusable={isClosed || isDrafting}
                        align="center"
                      >
                        <button
                          className="change-summary-action"
                          type="button"
                          onClick={() => void handleGenerateLocalChangeDraft()}
                          disabled={isClosed || isDrafting}
                        >
                          <FileText size={16} aria-hidden="true" />
                          {draftingMode === "local" ? t("changeDraftGenerating") : t("generateLocalChangeSummary")}
                        </button>
                      </HoverTooltip>
                      <HoverTooltip
                        className="change-summary-action-tooltip"
                        content={aiDraftTooltip}
                        showWhen="always"
                        focusable={aiDraftDisabled}
                        align="center"
                      >
                        <button
                          className="change-summary-action ai"
                          type="button"
                          aria-label={
                            canGenerateAiDraft
                              ? t("generateAiChangeSummary")
                              : `${t("generateAiChangeSummary")}: ${t("aiDraftUnavailableHint")}`
                          }
                          onClick={() => void handleGenerateAiChangeDraft()}
                          disabled={aiDraftDisabled}
                        >
                          <Sparkles size={16} aria-hidden="true" />
                          {draftingMode === "ai" ? t("changeDraftGenerating") : t("generateAiChangeSummary")}
                        </button>
                      </HoverTooltip>
                    </div>
                  )}
                  {savingImageTarget === "daily" && (
                    <span className="change-editor-saving">{t("memoSavingImage")}</span>
                  )}
                </div>
              )}
            </div>
            <div className="daily-field editor-note-field change-editor-field" role="group" aria-label={activeEditor.label}>
              <MarkdownWysiwygEditor
                key={activeEditor.id}
                value={activeEditor.value}
                language={language}
                theme={theme}
                labels={markdownEditorLabels(t)}
                onFeedback={onToast}
                placeholder={activeEditor.placeholder}
                height="100%"
                minHeight="0px"
                disabled={isClosed}
                compact
                onChange={updateActiveSection}
                onImageUpload={saveDailyEditorImage}
                onImageError={(error) =>
                  onToast({ kind: "error", message: error instanceof Error ? error.message : t("memoImagePasteFailed") })
                }
              />
            </div>
          </section>
        )}
        </section>
      </div>
    </section>
  );
}

function WorkItemRow({
  item,
  mode,
  compact = false,
  language,
  showCompletionControl = true,
  onRecordProgress,
  onComplete,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  onEdit,
  onDelete,
  t
}: {
  item: WorkItemWithLatest;
  mode: "today" | "detail";
  compact?: boolean;
  language: LanguagePreference;
  showCompletionControl?: boolean;
  onRecordProgress?: () => void;
  onComplete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  t: Translator;
}) {
  const recentRecord = summary(item.latest_content || item.latest_next_step || item.description, t);
  const updatedAt = formatTimestamp(item.latest_created_at ?? item.updated_at, language, t);

  return (
    <article className={`work-item-row ${item.status === "done" ? "done" : ""} ${compact ? "compact" : ""}`.trim()}>
      {showCompletionControl ? (
        <button
          className="check-button"
          type="button"
          onClick={onComplete}
          disabled={item.status === "done" || !onComplete}
          aria-label={t("completeAria")}
        >
          {item.status === "done" && <Check size={14} strokeWidth={2.4} />}
        </button>
      ) : (
        <span className="check-button-placeholder" aria-hidden="true" />
      )}
      <HoverTooltip as="div" className="work-item-title-cell" content={[item.title, item.description].filter(Boolean).join("\n")}>
        <strong>{item.title}</strong>
        {item.description && <p className="description">{item.description}</p>}
      </HoverTooltip>
      {mode === "detail" && <span className="work-item-status-pill">{workItemLifecycleStatusLabel(item.status, t)}</span>}
      <HoverTooltip as="div" className="work-item-recent-wrap" content={recentRecord}>
        <p className="work-item-recent">{recentRecord}</p>
      </HoverTooltip>
      <time className="work-item-updated">{updatedAt}</time>
      <div className="work-item-actions">
        {(onMoveUp || onMoveDown) && (
          <span className="work-item-reorder-buttons" role="group" aria-label={t("reorder")}>
            {onMoveUp && (
              <button
                className="icon-button reorder-icon-button"
                type="button"
                aria-label={canMoveUp ? t("moveUp") : t("alreadyAtTop")}
                onClick={onMoveUp}
              >
                <ArrowUp size={14} />
              </button>
            )}
            {onMoveDown && (
              <button
                className="icon-button reorder-icon-button"
                type="button"
                aria-label={canMoveDown ? t("moveDown") : t("alreadyAtBottom")}
                onClick={onMoveDown}
              >
                <ArrowDown size={14} />
              </button>
            )}
          </span>
        )}
        {onRecordProgress && (
          <button className="work-item-record-button" type="button" onClick={onRecordProgress}>
            <Clock3 size={14} />
            {t("recordProgress")}
          </button>
        )}
        {onEdit && (
          <button
            className="work-item-edit-icon-button"
            type="button"
            title={t("editWorkItem")}
            aria-label={t("editWorkItem")}
            onClick={onEdit}
          >
            <SquarePen size={15} />
          </button>
        )}
        {onDelete && (
          <button
            className="ghost-button danger-ghost work-item-delete-button"
            type="button"
            title={t("deleteWorkItem")}
            aria-label={t("deleteWorkItem")}
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </article>
  );
}

function ProjectsPage({
  projects,
  language,
  t,
  onCreateProject,
  onOpenProject,
  onMoveProject
}: {
  projects: ProjectListItem[];
  language: LanguagePreference;
  t: Translator;
  onCreateProject: () => void;
  onOpenProject: (id: string) => void;
  onMoveProject: (id: string, direction: SortMoveDirection) => void;
}) {
  const handleProjectCardKeyDown = (event: KeyboardEvent<HTMLElement>, projectId: string) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenProject(projectId);
    }
  };

  return (
    <section className="page projects-page">
      <PageHeader
        title={t("projectsTitle")}
        description={t("projectsSubtitle")}
        actions={
          <button className="primary-button" type="button" onClick={onCreateProject}>
            <Plus size={18} />
            {t("newProject")}
          </button>
        }
      />
      <div className="project-grid">
        {projects.length === 0 ? (
          <div className="projects-empty-panel">
            <EmptyState title={t("projectsEmptyTitle")} body={t("projectsEmptyBody")} />
            <button className="primary-button" type="button" onClick={onCreateProject}>
              <Plus size={18} />
              {t("newProject")}
            </button>
          </div>
        ) : (
          projects.map((project, index) => {
            const description = project.description?.trim();
            const canMoveUp = index > 0;
            const canMoveDown = index < projects.length - 1;
            const tone = projectVisualTone(project.id);
            return (
              <article
                className={`project-list-card project-tone-${tone}`}
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenProject(project.id)}
                onKeyDown={(event) => handleProjectCardKeyDown(event, project.id)}
              >
                <ProjectIdentityMark projectId={project.id} className="project-list-card-icon" />

                <div className="project-list-card-main">
                  <div className="project-list-card-title-block">
                    <span className="project-list-card-title" title={project.name}>{project.name}</span>
                    <span className={`project-list-status ${project.status}`}>
                      {project.status === "archived" ? t("statusArchived") : t("statusActive")}
                    </span>
                  </div>
                  <p className={`project-list-description ${description ? "" : "empty"}`.trim()}>
                    {description || t("noProjectDescription")}
                  </p>
                </div>

                <div className="project-list-card-metric">
                  <span>{t("activeCountPrefix")}</span>
                  <strong>{project.active_item_count} {t("unitCount")}</strong>
                </div>

                <div className="project-list-card-metric updated">
                  <span>{t("updatedPrefix")}</span>
                  <strong>{formatTimestamp(project.updated_at, language, t)}</strong>
                </div>

                <div className="project-list-card-actions">
                  <span className="project-list-card-reorder" role="group" aria-label={t("reorder")}>
                    <button
                      className="icon-button reorder-icon-button"
                      type="button"
                      aria-label={canMoveUp ? t("moveUp") : t("alreadyAtTop")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMoveProject(project.id, "up");
                      }}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="icon-button reorder-icon-button"
                      type="button"
                      aria-label={canMoveDown ? t("moveDown") : t("alreadyAtBottom")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMoveProject(project.id, "down");
                      }}
                    >
                      <ArrowDown size={15} />
                    </button>
                  </span>
                  <span className="project-list-card-enter">
                    {t("viewProject")}
                    <ChevronRight size={16} />
                  </span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
function ArchivePage({
  projects,
  language,
  t,
  onOpenProject
}: {
  projects: ProjectListItem[];
  language: LanguagePreference;
  t: Translator;
  onOpenProject: (id: string) => void;
}) {
  return (
    <section className="page archive-page">
      <PageHeader title={t("archiveTitle")} description={t("archiveBody")} />
      {projects.length === 0 ? (
        <div className="archive-empty-panel">
          <span className="archive-empty-icon" aria-hidden="true">
            <Archive size={32} />
          </span>
          <EmptyState title={t("archiveEmptyTitle")} body={t("archiveEmptyBody")} />
        </div>
      ) : (
        <div className="project-grid archive-grid">
          {projects.map((project) => {
            const description = project.description?.trim();
            return (
              <button
                className="project-list-card archive-project-card"
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project.id)}
              >
                <span className="project-list-card-icon project-identity-mark archive-project-card-icon" aria-hidden="true">
                  <Archive size={20} />
                </span>

                <span className="project-list-card-main">
                  <span className="project-list-card-title-block">
                    <span className="project-list-card-title" title={project.name}>{project.name}</span>
                    <span className="project-list-status archived">{t("statusArchived")}</span>
                  </span>
                  <span className={`project-list-description ${description ? "" : "empty"}`.trim()}>
                    {description || t("noProjectDescription")}
                  </span>
                </span>

                <span className="project-list-card-metric">
                  <span>{t("activeCountPrefix")}</span>
                  <strong>{project.active_item_count} {t("unitCount")}</strong>
                </span>

                <span className="project-list-card-metric updated">
                  <span>{t("updatedPrefix")}</span>
                  <strong>{formatTimestamp(project.archived_at ?? project.updated_at, language, t)}</strong>
                </span>

                <span className="project-list-card-actions">
                  <span className="project-list-card-enter">
                    {t("viewProject")}
                    <ChevronRight size={15} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReportsPage({
  reports,
  projects,
  selectedReportId,
  onSelectReport,
  weeklyReports,
  selectedWeeklyReportId,
  onSelectWeeklyReport,
  monthlyReports,
  selectedMonthlyReportId,
  onSelectMonthlyReport,
  t,
  language,
  theme,
  aiSettings,
  onCopy,
  onExport,
  onReportsChanged,
  onToast,
  onConfirm,
  onUnsavedChangesChange
}: {
  reports: DailyReportListItem[];
  projects: ProjectListItem[];
  selectedReportId: string | null;
  onSelectReport: (id: string) => void;
  weeklyReports: PeriodReportListItem[];
  selectedWeeklyReportId: string | null;
  onSelectWeeklyReport: (id: string) => void;
  monthlyReports: PeriodReportListItem[];
  selectedMonthlyReportId: string | null;
  onSelectMonthlyReport: (id: string) => void;
  t: Translator;
  language: LanguagePreference;
  theme: EffectiveTheme;
  aiSettings: AiSettingsInfo | null;
  onCopy: (payload: MarkdownPayload) => void;
  onExport: (payload: MarkdownPayload) => void;
  onReportsChanged: () => Promise<void>;
  onToast: (toastValue: Toast) => void;
  onConfirm: (options: AppConfirmOptions) => Promise<boolean>;
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<ReportTab>("daily");
  const reportTabIds: ReportTab[] = ["daily", "weekly", "monthly"];
  const reportVersionIds: Array<"rule" | "ai"> = ["rule", "ai"];
  const [previewMode, setPreviewMode] = useState<"rule" | "ai">("rule");
  const [timeFilter, setTimeFilter] = useState<ReportTimeFilter>("all");
  const [reportQuery, setReportQuery] = useState("");
  const [reportLocateRequest, setReportLocateRequest] = useState(0);
  const [projectFilter, setProjectFilter] = useState("all");
  const reportListRef = useRef<HTMLDivElement>(null);
  const reportPreviewPanelRef = useRef<HTMLElement>(null);
  const [refineTarget, setRefineTarget] = useState<ReportItem | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [reportEdit, setReportEdit] = useState<{
    reportId: string;
    reportKind: ReportItem["reportKind"];
    version: "rule" | "ai";
    originalMarkdown: string;
    draftMarkdown: string;
  } | null>(null);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [message, setMessage] = useState<Toast | null>(null);
  const dailyItems: ReportItem[] = reports.map((report) => ({
    id: report.id,
    reportKind: "daily" as const,
    title: `${formatDateDisplay(report.date, language)} ${t("dailyReport")}`,
    meta: formatTimestamp(report.closed_at ?? report.updated_at, language, t),
    markdown: report.markdown,
    date: report.date,
    fileName: `work-log-${report.date}.md`,
    typeLabel: t("dailyReport"),
    generatedAt: report.closed_at ?? report.updated_at,
    periodStart: report.date,
    periodEnd: report.date
  }));
  const weeklyItems: ReportItem[] = weeklyReports.map((report) => ({
    id: report.id,
    reportKind: "weekly" as const,
    title: `${report.period_start} ${t("periodTo")} ${report.period_end}`,
    meta: formatTimestamp(report.updated_at, language, t),
    markdown: report.markdown,
    date: report.period_start,
    fileName: `work-weekly-report-${report.period_start}_to_${report.period_end}.md`,
    typeLabel: t("weeklyWorkReport"),
    generatedAt: report.updated_at,
    periodStart: report.period_start,
    periodEnd: report.period_end,
    aiFileName: `work-weekly-report-${report.period_start}_to_${report.period_end}-ai.md`,
    aiRefinedMarkdown: report.aiRefinedMarkdown,
    aiRefinedAt: report.aiRefinedAt,
    aiProvider: report.aiProvider,
    aiModel: report.aiModel,
    aiIsStale: report.aiIsStale
  }));
  const monthlyItems: ReportItem[] = monthlyReports.map((report) => ({
    id: report.id,
    reportKind: "monthly" as const,
    title: formatMonthDisplay(Number(report.period_start.slice(0, 4)), Number(report.period_start.slice(5, 7)), language),
    meta: formatTimestamp(report.updated_at, language, t),
    markdown: report.markdown,
    date: report.period_start.slice(0, 7),
    fileName: `work-monthly-report-${report.period_start.slice(0, 7)}.md`,
    typeLabel: t("monthlyWorkReport"),
    generatedAt: report.updated_at,
    periodStart: report.period_start,
    periodEnd: report.period_end,
    aiFileName: `work-monthly-report-${report.period_start.slice(0, 7)}-ai.md`,
    aiRefinedMarkdown: report.aiRefinedMarkdown,
    aiRefinedAt: report.aiRefinedAt,
    aiProvider: report.aiProvider,
    aiModel: report.aiModel,
    aiIsStale: report.aiIsStale
  }));
  const tabConfig = {
    daily: {
      heading: t("generatedDailyReports"),
      emptyTitle: t("noDailyReportsTitle"),
      emptyBody: t("noDailyReportsBody"),
      items: dailyItems,
      selectedId: selectedReportId,
      onSelect: onSelectReport
    },
    weekly: {
      heading: t("generatedWeeklyReports"),
      emptyTitle: t("noWeeklyReportsTitle"),
      emptyBody: t("noWeeklyReportsBody"),
      items: weeklyItems,
      selectedId: selectedWeeklyReportId,
      onSelect: onSelectWeeklyReport
    },
    monthly: {
      heading: t("generatedMonthlyReports"),
      emptyTitle: t("noMonthlyReportsTitle"),
      emptyBody: t("noMonthlyReportsBody"),
      items: monthlyItems,
      selectedId: selectedMonthlyReportId,
      onSelect: onSelectMonthlyReport
    }
  }[activeTab];
  const reportSearchLocale = localeFor(language);
  const normalizedQuery = reportQuery.trim().toLocaleLowerCase(reportSearchLocale);
  const projectOptions = projects.filter((project) => project.name.trim());
  const reportMatchesProject = (report: ReportItem, projectId: string) => {
    if (projectId === "all") {
      return true;
    }
    const project = projectOptions.find((item) => item.id === projectId);
    if (!project) {
      return true;
    }
    const projectName = project.name.trim().toLocaleLowerCase(localeFor(language));
    if (!projectName) {
      return true;
    }
    const reportText = [report.markdown, report.aiRefinedMarkdown ?? ""]
      .join(" ")
      .toLocaleLowerCase(localeFor(language));
    return reportText.includes(projectName);
  };
  const reportMatchesQuery = (report: ReportItem) => {
    if (!normalizedQuery) {
      return true;
    }
    const searchText = [
      report.title,
      report.typeLabel,
      report.meta,
      report.date,
      report.periodStart,
      report.periodEnd,
      report.markdown,
      report.aiRefinedMarkdown ?? ""
    ]
      .join(" ")
      .toLocaleLowerCase(reportSearchLocale);
    return searchText.includes(normalizedQuery);
  };
  const baseFilteredItems = tabConfig.items.filter((report) => reportMatchesTimeFilter(report, timeFilter));
  const filteredItems = baseFilteredItems.filter((report) => reportMatchesProject(report, projectFilter));
  const reportSearchResults = normalizedQuery ? tabConfig.items.filter(reportMatchesQuery) : [];
  const reportListItems = normalizedQuery ? tabConfig.items : filteredItems;
  const reportSearchPreview = (report: ReportItem, compact = false) => {
    const readableVersions = [
      readableMarkdownSearchText(report.markdown),
      readableMarkdownSearchText(report.aiRefinedMarkdown ?? "")
    ].filter(Boolean);
    const matchingVersion = normalizedQuery
      ? readableVersions.find((value) => value.toLocaleLowerCase(reportSearchLocale).includes(normalizedQuery))
      : readableVersions[0];
    return searchContextSnippet(
      matchingVersion ?? readableVersions[0] ?? "",
      reportQuery,
      language,
      compact ? 84 : 120,
      compact ? 14 : undefined
    );
  };
  const projectFilterOptions = projectOptions.map((project) => ({
    id: project.id,
    name: project.name,
    count: baseFilteredItems.filter((report) => reportMatchesProject(report, project.id)).length
  }));
  const selectedReport =
    reportListItems.find((report) => report.id === tabConfig.selectedId) ??
    reportSearchResults[0] ??
    reportListItems[0] ??
    null;
  const hasAiVersion = Boolean(selectedReport?.reportKind !== "daily" && selectedReport?.aiRefinedMarkdown);
  const currentMarkdown =
    previewMode === "ai" && hasAiVersion && selectedReport?.aiRefinedMarkdown
      ? selectedReport.aiRefinedMarkdown
      : selectedReport?.markdown ?? "";
  const currentVersion: "rule" | "ai" = previewMode === "ai" && hasAiVersion ? "ai" : "rule";
  const isEditingReport = Boolean(reportEdit && reportEdit.reportId === selectedReport?.id);
  const hasUnsavedChanges = Boolean(
    isEditingReport && reportEdit && reportEdit.draftMarkdown !== reportEdit.originalMarkdown
  );
  const displayedMarkdown = isEditingReport && reportEdit ? reportEdit.draftMarkdown : currentMarkdown;
  const selectedPayload = selectedReport
    ? {
      date: selectedReport.date,
      markdown: displayedMarkdown,
      fileName:
        previewMode === "ai" && hasAiVersion && selectedReport.reportKind !== "daily"
          ? selectedReport.aiFileName
          : selectedReport.fileName
    }
    : null;
  const exportButtonLabel =
    selectedReport?.reportKind !== "daily" && previewMode === "ai" && hasAiVersion
      ? t("exportAiMarkdown")
      : selectedReport?.reportKind !== "daily"
        ? t("exportRuleMarkdown")
        : t("exportMarkdown");
  const selectedReportCanUseAiRefine = Boolean(
    selectedReport &&
      selectedReport.reportKind !== "daily" &&
      aiSettings?.enabled &&
      aiSettings.apiKeyConfigured &&
      aiSettings.baseUrl &&
      aiSettings.model
  );
  const aiRefineButtonTitle = selectedReport && !selectedReportCanUseAiRefine
    ? t("aiConfigureFirst")
    : undefined;
  const aiRefineDisabledReasonId = aiRefineButtonTitle ? "ai-refine-disabled-reason" : undefined;
  const timeFilterOptions: Array<{ value: ReportTimeFilter; label: string }> = [
    { value: "all", label: t("reportTimeAll") },
    { value: "today", label: t("reportTimeToday") },
    { value: "last7", label: t("reportTimeLast7") },
    { value: "last30", label: t("reportTimeLast30") },
    { value: "thisMonth", label: t("reportTimeThisMonth") },
    { value: "lastMonth", label: t("reportTimeLastMonth") }
  ];
  const hasActiveFilters = timeFilter !== "all" || Boolean(normalizedQuery) || projectFilter !== "all";
  const filterSummary = hasActiveFilters
    ? t("reportFilterSummaryActive")
        .replace("{filtered}", String(normalizedQuery ? reportSearchResults.length : filteredItems.length))
        .replace("{total}", String(tabConfig.items.length))
    : t("reportFilterSummaryAll").replace("{count}", String(tabConfig.items.length));
  const emptyTitle = tabConfig.items.length === 0 ? tabConfig.emptyTitle : t("reportFilteredEmptyTitle");
  const emptyBody = tabConfig.items.length === 0 ? tabConfig.emptyBody : t("reportFilteredEmptyBody");
  const clearReportFilters = () => {
    setTimeFilter("all");
    setReportQuery("");
    setProjectFilter("all");
  };
  const selectReportSearchResult = (report: ReportItem) => {
    tabConfig.onSelect(report.id);
    if (normalizedQuery) {
      setReportLocateRequest((current) => current + 1);
    }
  };
  const reportSearchResultIds = reportSearchResults.map((report) => report.id).join("|");

  const handleStartReportEdit = () => {
    if (!selectedReport) {
      return;
    }
    setMessage(null);
    setReportEdit({
      reportId: selectedReport.id,
      reportKind: selectedReport.reportKind,
      version: currentVersion,
      originalMarkdown: currentMarkdown,
      draftMarkdown: currentMarkdown
    });
  };

  const handleCancelReportEdit = async () => {
    if (!reportEdit) {
      return;
    }
    if (reportEdit.draftMarkdown !== reportEdit.originalMarkdown) {
      const confirmed = await onConfirm({
        title: t("discardReportChangesTitle"),
        body: t("discardReportChangesBody"),
        primaryLabel: t("discardChanges"),
        secondaryLabel: t("continueEditing"),
        tone: "warning"
      });
      if (!confirmed) {
        return;
      }
    }
    setMessage(null);
    setReportEdit(null);
  };

  const handleSaveReport = async () => {
    if (!reportEdit || !selectedReport || reportEdit.reportId !== selectedReport.id) {
      return;
    }
    if (!reportEdit.draftMarkdown.trim()) {
      setMessage({ kind: "error", message: t("reportCannotBeEmpty") });
      return;
    }

    setIsSavingReport(true);
    setMessage(null);
    try {
      await window.workJournal.reports.saveMarkdown({
        reportId: reportEdit.reportId,
        reportType: reportEdit.reportKind,
        version: reportEdit.version,
        markdown: reportEdit.draftMarkdown
      });
      await onReportsChanged();
      setReportEdit(null);
      onToast({ kind: "success", message: t("reportSaved") });
    } catch {
      setMessage({ kind: "error", message: t("reportSaveFailed") });
    } finally {
      setIsSavingReport(false);
    }
  };

  useEffect(() => {
    onUnsavedChangesChange(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(
    () => () => {
      onUnsavedChangesChange(false);
    },
    [onUnsavedChangesChange]
  );

  useEffect(() => {
    setPreviewMode("rule");
    setMessage(null);
    setReportEdit(null);
    setIsSavingReport(false);
  }, [activeTab, selectedReport?.id]);

  useEffect(() => {
    if (!selectedReport || !normalizedQuery || isEditingReport) {
      return;
    }
    const matchesQuery = (value: string | null | undefined) =>
      Boolean(value?.toLocaleLowerCase(reportSearchLocale).includes(normalizedQuery));
    if (matchesQuery(currentMarkdown)) {
      return;
    }
    if (matchesQuery(selectedReport.markdown)) {
      setPreviewMode("rule");
    } else if (selectedReport.reportKind !== "daily" && matchesQuery(selectedReport.aiRefinedMarkdown)) {
      setPreviewMode("ai");
    }
  }, [
    currentMarkdown,
    isEditingReport,
    normalizedQuery,
    reportSearchLocale,
    selectedReport?.aiRefinedMarkdown,
    selectedReport?.id,
    selectedReport?.markdown,
    selectedReport?.reportKind
  ]);

  useEffect(() => {
    if (!normalizedQuery || isEditingReport || reportSearchResults.length === 0) {
      return;
    }
    tabConfig.onSelect(reportSearchResults[0].id);
    setReportLocateRequest((current) => current + 1);
  }, [activeTab, isEditingReport, normalizedQuery, reportSearchResultIds]);

  useLayoutEffect(() => {
    if (!normalizedQuery || isEditingReport) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const selectedListItem = Array.from(
        reportListRef.current?.querySelectorAll<HTMLElement>("[data-report-id]") ?? []
      ).find((element) => element.dataset.reportId === selectedReport?.id);
      selectedListItem?.scrollIntoView({ behavior: "smooth", block: "nearest" });

      const scrollContainer = reportPreviewPanelRef.current?.querySelector<HTMLElement>(
        ".readable-markdown-preview"
      );
      if (!scrollContainer) {
        return;
      }
      scrollContainer
        .querySelectorAll("mark.report-search-current")
        .forEach((element) => element.classList.remove("report-search-current"));
      const firstMatch = scrollContainer.querySelector<HTMLElement>("mark.search-highlight");
      if (!firstMatch) {
        return;
      }
      firstMatch.classList.add("report-search-current");
      const containerRect = scrollContainer.getBoundingClientRect();
      const matchRect = firstMatch.getBoundingClientRect();
      const targetTop = Math.max(
        0,
        scrollContainer.scrollTop + matchRect.top - containerRect.top - Math.min(120, scrollContainer.clientHeight * 0.24)
      );
      scrollContainer.scrollTo({ top: targetTop, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentVersion, isEditingReport, normalizedQuery, reportLocateRequest, selectedReport?.id]);

  useEffect(() => {
    if (projectFilter !== "all" && !projects.some((project) => project.id === projectFilter)) {
      setProjectFilter("all");
    }
  }, [projectFilter, projects]);

  useEffect(() => {
    if (!isEditingReport) {
      return;
    }
    const handleSaveShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        if (!isSavingReport) {
          void handleSaveReport();
        }
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [isEditingReport, isSavingReport, reportEdit]);

  const handleRequestAiRefine = (report: ReportItem) => {
    if (report.reportKind === "daily") {
      return;
    }
    if (!aiSettings?.enabled || !aiSettings.apiKeyConfigured || !aiSettings.baseUrl || !aiSettings.model) {
      setMessage({ kind: "error", message: t("aiConfigureFirst") });
      return;
    }
    setRefineTarget(report);
  };

  const handleConfirmAiRefine = async () => {
    if (!refineTarget || refineTarget.reportKind === "daily") {
      setRefineTarget(null);
      return;
    }
    const target = refineTarget;
    setRefineTarget(null);
    setIsRefining(true);
    setMessage(null);
    try {
      const result = await window.workJournal.ai.refineReport({
        reportId: target.id,
        reportType: target.reportKind as PeriodReportType,
        sourceMarkdown: target.markdown,
        refinementMode: "standard"
      });
      if (!result.success) {
        setMessage({ kind: "error", message: result.error ?? t("aiRefineFailed") });
        return;
      }
      await onReportsChanged();
      setPreviewMode("ai");
      setMessage(null);
      onToast({ kind: "success", message: t("aiRefineSuccess") });
    } catch (error) {
      setMessage({ kind: "error", message: error instanceof Error ? error.message : t("aiRefineFailed") });
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <section className="page reports-page">
      <PageHeader
        title={t("reportsTitle")}
        description={t("reportsSubtitle")}
        actions={
          <div
            className="report-tabs sliding-tab-list"
            role="tablist"
            aria-label={t("reportsTitle")}
            onKeyDown={isEditingReport ? undefined : (event) => handleSegmentedKeyDown(event, reportTabIds, activeTab, setActiveTab)}
          >
            <SlidingTabIndicator activeItem={activeTab} />
            <button
              data-tab-id="daily"
              className={activeTab === "daily" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "daily"}
              tabIndex={activeTab === "daily" ? 0 : -1}
              disabled={isEditingReport}
              onClick={() => setActiveTab("daily")}
            >
              {t("dailyReports")}
            </button>
            <button
              data-tab-id="weekly"
              className={activeTab === "weekly" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "weekly"}
              tabIndex={activeTab === "weekly" ? 0 : -1}
              disabled={isEditingReport}
              onClick={() => setActiveTab("weekly")}
            >
              {t("weeklyReports")}
            </button>
            <button
              data-tab-id="monthly"
              className={activeTab === "monthly" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "monthly"}
              tabIndex={activeTab === "monthly" ? 0 : -1}
              disabled={isEditingReport}
              onClick={() => setActiveTab("monthly")}
            >
              {t("monthlyReports")}
            </button>
          </div>
        }
      />

      <div className="reports-layout">
        <aside className="reports-filter-panel" aria-label={t("reportFilters")}>
          <div className="reports-filter-header">
            <div className="reports-filter-title-row">
              <strong>{t("reportArchive")}</strong>
              <small>{filterSummary}</small>
            </div>
            {hasActiveFilters && (
              <div className="reports-filter-action-row">
                <button
                  className="ghost-button reports-header-clear"
                  type="button"
                  disabled={isEditingReport}
                  onClick={clearReportFilters}
                >
                  {t("clearReportFilters")}
                </button>
              </div>
            )}
          </div>

          <label className="reports-search-field reports-filter-search-field">
            <div className="reports-search-box">
              <Search size={16} />
              <input
                value={reportQuery}
                type="search"
                aria-label={t("reportsSearchPlaceholder")}
                placeholder={t("reportsSearchPlaceholder")}
                disabled={isEditingReport}
                onChange={(event) => setReportQuery(event.target.value)}
              />
              {reportQuery.trim() && (
                <button
                  type="button"
                  aria-label={t("clearSearch")}
                  disabled={isEditingReport}
                  onClick={() => setReportQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </label>

          {normalizedQuery ? (
            <div className="reports-filter-search-results">
              <div className="reports-filter-search-heading">
                <strong>{t("searchResults")}</strong>
                <small aria-live="polite">
                  {t("reportFilterCount").replace("{count}", String(reportSearchResults.length))}
                </small>
              </div>
              <div className="reports-filter-search-list">
                {reportSearchResults.length === 0 ? (
                  <div className="reports-filter-search-empty">{t("searchNoResults")}</div>
                ) : (
                  reportSearchResults.map((report) => {
                    const preview = reportSearchPreview(report, true);
                    const isSelected = selectedReport?.id === report.id;
                    return (
                      <button
                        className={`reports-filter-search-result${isSelected ? " active" : ""}`}
                        key={report.id}
                        type="button"
                        aria-current={isSelected ? "true" : undefined}
                        disabled={isEditingReport}
                        onClick={() => selectReportSearchResult(report)}
                      >
                        <span className="reports-filter-search-result-title">
                          <FileText size={15} aria-hidden="true" />
                          <strong><HighlightedSearchText text={report.title} term={reportQuery} /></strong>
                        </span>
                        <p>{preview ? <HighlightedSearchText text={preview} term={reportQuery} /> : t("none")}</p>
                        <small>{report.meta}</small>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="reports-filter-section">
                <span>{t("reportTimeRange")}</span>
                <div className="reports-filter-options">
                  {timeFilterOptions.map((option) => (
                    <button
                      className={timeFilter === option.value ? "active" : ""}
                      key={option.value}
                      type="button"
                      disabled={isEditingReport}
                      onClick={() => setTimeFilter(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="reports-filter-section reports-project-section">
                <span>{t("reportProjectFilter")}</span>
                <div className="reports-filter-options reports-project-options">
                  <button
                    className={projectFilter === "all" ? "active" : ""}
                    type="button"
                    disabled={isEditingReport}
                    onClick={() => setProjectFilter("all")}
                  >
                    <span>{t("reportProjectAll")}</span>
                    <em>{baseFilteredItems.length}</em>
                  </button>
                  {projectFilterOptions.length === 0 ? (
                    <small>{t("reportProjectNoOptions")}</small>
                  ) : (
                    projectFilterOptions.map((project) => (
                      <button
                        className={projectFilter === project.id ? "active" : ""}
                        key={project.id}
                        type="button"
                        title={project.name}
                        disabled={isEditingReport}
                        onClick={() => setProjectFilter(project.id)}
                      >
                        <span>{project.name}</span>
                        <em>{project.count}</em>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="reports-list-panel">
          <header className="reports-list-header">
            <div className="reports-list-title-row">
              <div>
                <span className="eyebrow">{t("reportArchiveList")}</span>
                <h2>{tabConfig.heading}</h2>
              </div>
              <small aria-live="polite">
                {t("reportFilterCount").replace("{count}", String(reportListItems.length))}
              </small>
            </div>
          </header>

          <div ref={reportListRef} className="report-list">
            {reportListItems.length === 0 ? (
              <div className="reports-list-empty">
                <strong>{emptyTitle}</strong>
                <p>{emptyBody}</p>
              </div>
            ) : (
              reportListItems.map((report) => {
                const isSelected = selectedReport?.id === report.id;
                const preview = reportSearchPreview(report);
                return (
                  <button
                    className={`report-list-item ${isSelected ? "active" : ""}`}
                    key={report.id}
                    type="button"
                    data-report-id={report.id}
                    aria-current={isSelected ? "true" : undefined}
                    disabled={isEditingReport}
                    onClick={() => selectReportSearchResult(report)}
                  >
                    <span className="report-list-heading">
                      <span className="report-kind-pill">{report.typeLabel}</span>
                      <strong><HighlightedSearchText text={report.title} term={reportQuery} /></strong>
                    </span>
                    <span className="report-list-meta">
                      <span>{report.meta}</span>
                      <span>{countCharacters(report.markdown)} {t("unitChar")}</span>
                    </span>
                    {report.reportKind !== "daily" && report.aiRefinedMarkdown && (
                      <span className="report-list-meta">
                        <span>{t("aiRefinedVersion")}</span>
                        <span>{report.aiRefinedAt ? formatTimestamp(report.aiRefinedAt, language, t) : t("none")}</span>
                      </span>
                    )}
                    <p>
                      {preview ? <HighlightedSearchText text={preview} term={reportQuery} /> : t("none")}
                    </p>
                    {report.reportKind !== "daily" && report.aiIsStale && (
                      <small className="stale-badge">{t("aiReportStale")}</small>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section ref={reportPreviewPanelRef} className="report-preview-panel">
          {selectedReport ? (
            <>
              <header className="report-preview-header">
                <div className="report-preview-copy">
                  <span className="eyebrow">{selectedReport.typeLabel}</span>
                  <h2>{selectedReport.title}</h2>
                  <div className="report-preview-meta">
                    <span>{t("reportGeneratedAt")}{t("searchMatchedSeparator")}{selectedReport.meta}</span>
                    <span>{countCharacters(displayedMarkdown)} {t("unitChar")}</span>
                  </div>
                  {selectedReport.reportKind !== "daily" && selectedReport.aiIsStale && (
                    <p className="report-stale-message">{t("aiReportStale")}</p>
                  )}
                </div>
                {isEditingReport ? (
                  <div className="button-row report-edit-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isSavingReport}
                      onClick={() => void handleCancelReportEdit()}
                    >
                      {t("cancel")}
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={isSavingReport}
                      onClick={() => void handleSaveReport()}
                    >
                      <Save size={17} />
                      {isSavingReport ? t("savingReport") : t("saveReport")}
                    </button>
                  </div>
                ) : (
                  <div className="button-row">
                    {selectedReport.reportKind !== "daily" && (
                      <>
                        <HoverTooltip
                          className="report-ai-tooltip-trigger"
                          content={aiRefineButtonTitle}
                          showWhen="always"
                          focusable={Boolean(aiRefineButtonTitle)}
                        >
                          <button
                            className="secondary-button"
                            type="button"
                            aria-label={aiRefineButtonTitle ? `${t("aiRefine")}: ${aiRefineButtonTitle}` : t("aiRefine")}
                            aria-describedby={aiRefineDisabledReasonId}
                            onClick={() => handleRequestAiRefine(selectedReport)}
                            disabled={isRefining || !selectedReportCanUseAiRefine}
                          >
                            <Sparkles size={17} />
                            {isRefining ? t("aiRefining") : t("aiRefine")}
                          </button>
                        </HoverTooltip>
                        {aiRefineButtonTitle && (
                          <span id={aiRefineDisabledReasonId} className="sr-only">
                            {aiRefineButtonTitle}
                          </span>
                        )}
                      </>
                    )}
                    <button className="secondary-button" type="button" onClick={() => selectedPayload && onCopy(selectedPayload)}>
                      <Clipboard size={17} />
                      {t("copyMarkdown")}
                    </button>
                    <button className="secondary-button" type="button" onClick={() => selectedPayload && onExport(selectedPayload)}>
                      <FileDown size={17} />
                      {exportButtonLabel}
                    </button>
                    <button
                      className="secondary-button report-edit-button"
                      type="button"
                      title={t("editReport")}
                      aria-label={t("editReport")}
                      onClick={handleStartReportEdit}
                    >
                      <SquarePen size={17} />
                    </button>
                  </div>
                )}
              </header>
              {message && <div className={`inline-message ${message.kind}`}>{message.message}</div>}
              {selectedReport.reportKind !== "daily" && hasAiVersion && (
                <div
                  className="report-version-toggle sliding-tab-list"
                  role="tablist"
                  aria-label={t("reportVersion")}
                  onKeyDown={isEditingReport ? undefined : (event) => handleSegmentedKeyDown(event, reportVersionIds, previewMode, setPreviewMode)}
                >
                  <SlidingTabIndicator activeItem={previewMode} />
                  <button
                    data-tab-id="rule"
                    className={previewMode === "rule" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={previewMode === "rule"}
                    tabIndex={previewMode === "rule" ? 0 : -1}
                    disabled={isEditingReport}
                    onClick={() => setPreviewMode("rule")}
                  >
                    {t("ruleReportVersion")}
                  </button>
                  <button
                    data-tab-id="ai"
                    className={previewMode === "ai" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={previewMode === "ai"}
                    tabIndex={previewMode === "ai" ? 0 : -1}
                    disabled={isEditingReport}
                    onClick={() => setPreviewMode("ai")}
                  >
                    {t("aiRefinedVersion")}
                  </button>
                </div>
              )}
              {isEditingReport && reportEdit ? (
                <div className="report-editor-stage">
                  <div className="report-edit-hint">
                    <Info size={15} />
                    <span>{t("reportEditHint")}</span>
                  </div>
                  <MarkdownWysiwygEditor
                    value={reportEdit.draftMarkdown}
                    language={language}
                    theme={theme}
                    placeholder={t("reportEditPlaceholder")}
                    height="100%"
                    minHeight="0"
                    hideModeSwitch
                    labels={markdownEditorLabels(t)}
                    onFeedback={onToast}
                    onChange={(markdown) =>
                      setReportEdit((current) => current ? { ...current, draftMarkdown: markdown } : current)
                    }
                  />
                </div>
              ) : (
                <ReadableMarkdown content={currentMarkdown} searchTerm={reportQuery} />
              )}
            </>
          ) : (
            <EmptyState title={t("reportPreviewEmptyTitle")} body={t("reportPreviewEmptyBody")} />
          )}
        </section>
      </div>
      {refineTarget && (
        <ConfirmModal
          title={refineTarget.aiRefinedMarkdown ? t("aiRefineReplaceConfirmTitle") : t("aiRefineConfirmTitle")}
          body={refineTarget.aiRefinedMarkdown ? t("aiRefineReplaceConfirmBody") : t("aiRefineConfirmBody")}
          primaryLabel={t("aiRefine")}
          secondaryLabel={t("cancel")}
          onConfirm={handleConfirmAiRefine}
          onCancel={() => setRefineTarget(null)}
        />
      )}
    </section>
  );
}

function activityLevelLabel(level: HeatmapDay["level"], t: Translator): string {
  if (level === 1) {
    return t("heatmapLevelLight");
  }
  if (level === 2) {
    return t("heatmapLevelNormal");
  }
  if (level === 3) {
    return t("heatmapLevelDeep");
  }
  if (level === 4) {
    return t("heatmapLevelHigh");
  }
  return t("heatmapLevelNone");
}

type HeatmapConstellationVariant = "cell" | "detail" | "legend" | "mini" | "mini-legend";

interface HeatmapConstellationPoint {
  x: number;
  y: number;
}

function createHeatmapConstellation(dayNumber: number): HeatmapConstellationPoint[] {
  const normalizedDay = Math.max(1, Math.min(31, Math.trunc(dayNumber) || 1));
  let state = Math.imul(normalizedDay, 0x9e3779b1) >>> 0;
  const nextValue = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
  const xAnchors = [0.11, 0.37, 0.64, 0.89];
  const points: HeatmapConstellationPoint[] = [];

  xAnchors.forEach((xAnchor, pointIndex) => {
    const x = Math.max(0.07, Math.min(0.93, xAnchor + (nextValue() - 0.5) * 0.09));
    let y = 0.18 + nextValue() * 0.64;
    const previousY = points[pointIndex - 1]?.y;
    if (previousY !== undefined && Math.abs(previousY - y) < 0.14) {
      y = y < 0.5 ? Math.min(0.82, y + 0.2) : Math.max(0.18, y - 0.2);
    }
    points.push({ x, y });
  });

  return points;
}

function HeatmapConstellation({
  dayNumber,
  level,
  variant
}: {
  dayNumber: number;
  level: HeatmapDay["level"];
  variant: HeatmapConstellationVariant;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const points = useMemo(() => createHeatmapConstellation(dayNumber), [dayNumber]);
  const activePointCount = Math.max(0, Math.min(4, level));

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const drawConnections = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        return;
      }
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
      const pixelHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);

      const activeSegmentCount = Math.max(0, activePointCount - 1);
      if (activeSegmentCount === 0) {
        return;
      }
      const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#1677ff";
      context.save();
      context.strokeStyle = accent;
      context.globalAlpha = variant === "detail" ? 0.72 : 0.62;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = variant === "detail" ? 1.6 : variant === "cell" ? 1.2 : 1;
      context.shadowColor = accent;
      context.shadowBlur = variant === "detail" ? 4 : 2;
      for (let pointIndex = 0; pointIndex < activeSegmentCount; pointIndex += 1) {
        const from = points[pointIndex];
        const to = points[pointIndex + 1];
        context.beginPath();
        context.moveTo(from.x * bounds.width, from.y * bounds.height);
        context.lineTo(to.x * bounds.width, to.y * bounds.height);
        context.stroke();
      }
      context.restore();
    };

    drawConnections();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(drawConnections);
    resizeObserver?.observe(canvas);
    const themeObserver = new MutationObserver(drawConnections);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("resize", drawConnections);

    return () => {
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("resize", drawConnections);
    };
  }, [activePointCount, points, variant]);

  return (
    <span className={`heatmap-constellation heatmap-constellation-${variant}`} aria-hidden="true">
      <canvas ref={canvasRef} />
      {points.map((point, pointIndex) => {
        const isActive = pointIndex < activePointCount;
        const duration = 2.15 + ((dayNumber * 17 + pointIndex * 29) % 19) / 10;
        const delay = -((dayNumber * 11 + pointIndex * 23) % 31) / 10;
        const nodeStyle = {
          left: `${point.x * 100}%`,
          top: `${point.y * 100}%`,
          "--constellation-duration": `${duration}s`,
          "--constellation-delay": `${delay}s`
        } as CSSProperties;

        return isActive ? (
          <Star
            className="heatmap-constellation-node is-active"
            fill="currentColor"
            key={pointIndex}
            strokeWidth={1.35}
            style={nodeStyle}
          />
        ) : (
          <Circle
            className="heatmap-constellation-node is-dormant"
            key={pointIndex}
            strokeWidth={1.8}
            style={nodeStyle}
          />
        );
      })}
    </span>
  );
}

interface HeatmapDisplayActivity {
  total: number;
  level: HeatmapDay["level"];
  updatedItemCount: number;
  contentDepth: number;
  structure: number;
  breadth: number;
  closeout: number;
}

interface HeatmapCalendarCell {
  key: string;
  day: HeatmapDay | null;
  dayNumber: number | null;
  outsideMonth: boolean;
}

interface HeatmapStreakInfo {
  length: number;
  startDate: string | null;
  endDate: string | null;
}

function scoreHeatmapTotalTextLength(length: number): number {
  if (length <= 0) {
    return 0;
  }
  if (length <= 80) {
    return 8;
  }
  if (length <= 240) {
    return 16;
  }
  if (length <= 600) {
    return 24;
  }
  return 30;
}

function scoreHeatmapAverageTextLength(length: number): number {
  if (length <= 0) {
    return 0;
  }
  if (length <= 60) {
    return 5;
  }
  if (length <= 180) {
    return 10;
  }
  if (length <= 400) {
    return 15;
  }
  return 20;
}

function heatmapDisplayLevel(score: number): HeatmapDay["level"] {
  if (score <= 0) {
    return 0;
  }
  if (score <= 24) {
    return 1;
  }
  if (score <= 49) {
    return 2;
  }
  if (score <= 74) {
    return 3;
  }
  return 4;
}

function heatmapDisplayLevelLabel(level: HeatmapDay["level"], t: Translator): string {
  if (level === 1) {
    return t("heatmapDisplayLevelLow");
  }
  if (level === 2) {
    return t("heatmapDisplayLevelMediumLow");
  }
  if (level === 3) {
    return t("heatmapDisplayLevelMediumHigh");
  }
  if (level === 4) {
    return t("heatmapDisplayLevelHigh");
  }
  return t("heatmapLevelNone");
}

function getHeatmapUpdatedItemCount(day: HeatmapDay): number {
  if (day.textEntryCount <= 0 || day.totalTextLength <= 0) {
    return 0;
  }
  return day.textEntryCount;
}

function getHeatmapDisplayActivity(day: HeatmapDay): HeatmapDisplayActivity {
  const updatedItemCount = getHeatmapUpdatedItemCount(day);
  const hasRealUpdate = updatedItemCount > 0;

  if (!hasRealUpdate) {
    return {
      total: 0,
      level: 0,
      updatedItemCount: 0,
      contentDepth: 0,
      structure: 0,
      breadth: 0,
      closeout: 0
    };
  }

  const averageTextLength = day.totalTextLength / updatedItemCount;
  const contentDepth =
    scoreHeatmapTotalTextLength(day.totalTextLength) + scoreHeatmapAverageTextLength(averageTextLength);
  const structure =
    5 +
    (day.totalTextLength >= 80 ? 5 : 0) +
    (day.totalTextLength >= 240 ? 5 : 0) +
    (updatedItemCount >= 2 ? 5 : 0);
  const breadth =
    updatedItemCount >= 4 ? 20 : updatedItemCount === 3 ? 16 : updatedItemCount === 2 ? 12 : 8;
  const closeout = day.hasReport ? 10 : 0;
  const total = Math.min(100, contentDepth + structure + breadth + closeout);

  return {
    total,
    level: heatmapDisplayLevel(total),
    updatedItemCount,
    contentDepth,
    structure,
    breadth,
    closeout
  };
}

function getHeatmapDisplayStreak(days: HeatmapDisplayActivity[]): number {
  let longest = 0;
  let current = 0;
  for (const day of days) {
    if (day.total > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function getHeatmapDisplayStreakInfo(days: HeatmapDay[], displayByDate: Map<string, HeatmapDisplayActivity>): HeatmapStreakInfo {
  let longest = 0;
  let current = 0;
  let currentStart: string | null = null;
  let bestStart: string | null = null;
  let bestEnd: string | null = null;

  for (const day of days) {
    const activity = displayByDate.get(day.date) ?? getHeatmapDisplayActivity(day);
    if (activity.total > 0) {
      current += 1;
      currentStart = currentStart ?? day.date;
      if (current > longest) {
        longest = current;
        bestStart = currentStart;
        bestEnd = day.date;
      }
    } else {
      current = 0;
      currentStart = null;
    }
  }

  return {
    length: longest,
    startDate: bestStart,
    endDate: bestEnd
  };
}

function HeatmapDetailRow({
  label,
  value,
  icon: Icon,
  withChevron = false
}: {
  label: string;
  value: string;
  icon: typeof FolderOpen;
  withChevron?: boolean;
}) {
  return (
    <div className="heatmap-detail-row">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      {withChevron && <ChevronRight size={16} />}
    </div>
  );
}

function HeatmapPage({
  data,
  selectedDate,
  t,
  language,
  onSelectDate,
  onPreviousMonth,
  onNextMonth,
  onCurrentMonth,
  onViewReport
}: {
  data: HeatmapMonth;
  selectedDate: string | null;
  t: Translator;
  language: LanguagePreference;
  onSelectDate: (date: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onCurrentMonth: () => void;
  onViewReport: (day: HeatmapDay) => void;
}) {
  const selectedDay = data.days.find((day) => day.date === selectedDate) ?? data.days[0] ?? null;
  const displayByDate = useMemo(
    () => new Map(data.days.map((day) => [day.date, getHeatmapDisplayActivity(day)])),
    [data.days]
  );
  const dayActivities = data.days.map((day) => displayByDate.get(day.date) ?? getHeatmapDisplayActivity(day));
  const selectedDayActivity = selectedDay
    ? displayByDate.get(selectedDay.date) ?? getHeatmapDisplayActivity(selectedDay)
    : null;
  const activeDisplayDays = dayActivities.filter((day) => day.total > 0).length;
  const highDisplayDays = dayActivities.filter((day) => day.total >= 75).length;
  const streakInfo = getHeatmapDisplayStreakInfo(data.days, displayByDate);
  const streakMeta =
    streakInfo.startDate && streakInfo.endDate
      ? `${formatShortDateDisplay(streakInfo.startDate, language)} - ${formatShortDateDisplay(streakInfo.endDate, language)}`
      : t("heatmapStreakNoRange");
  const firstDayOffset = (new Date(data.year, data.month - 1, 1).getDay() + 6) % 7;
  const previousMonthDayCount = new Date(data.year, data.month - 1, 0).getDate();
  const baseCalendarCells: HeatmapCalendarCell[] = [
    ...Array.from({ length: firstDayOffset }, (_, index) => ({
      key: `previous-${index}`,
      day: null,
      dayNumber: previousMonthDayCount - firstDayOffset + index + 1,
      outsideMonth: true
    })),
    ...data.days.map((day) => ({
      key: day.date,
      day,
      dayNumber: day.day,
      outsideMonth: false
    }))
  ];
  const trailingCellCount = (7 - (baseCalendarCells.length % 7)) % 7;
  const calendarCells: HeatmapCalendarCell[] = [
    ...baseCalendarCells,
    ...Array.from({ length: trailingCellCount }, (_, index) => ({
      key: `next-${index}`,
      day: null,
      dayNumber: index + 1,
      outsideMonth: true
    }))
  ];
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(localeFor(language), { weekday: "short" }).format(new Date(2026, 5, 1 + index))
  );
  const monthLabel = formatMonthDisplay(data.year, data.month, language);
  const numberFormat = new Intl.NumberFormat(localeFor(language));
  const today = getLocalDateKey();
  const selectedReportTime = selectedDay?.closedAt ? formatTimeDisplay(selectedDay.closedAt, language, t) : t("none");
  const overviewMetricGroups = [
    {
      label: t("heatmapOutputGroup"),
      metrics: [
        {
          label: t("heatmapClosedReports"),
          value: numberFormat.format(data.summary.closedJournalDays),
          suffix: t("unitDay"),
          context: null
        },
        {
          label: t("heatmapTotalChars"),
          value: numberFormat.format(data.summary.totalTextLength),
          suffix: t("unitChar"),
          context: null
        }
      ]
    },
    {
      label: t("heatmapRhythmGroup"),
      metrics: [
        {
          label: t("heatmapHighDays"),
          value: numberFormat.format(highDisplayDays),
          suffix: t("unitDay"),
          context: t("heatmapStatHighActivityMeta")
        },
        {
          label: t("heatmapLongestStreak"),
          value: numberFormat.format(streakInfo.length),
          suffix: t("unitDay"),
          context: streakMeta
        }
      ]
    }
  ];
  const recordedDayProgress = data.days.length > 0
    ? Math.min(100, (activeDisplayDays / data.days.length) * 100)
    : 0;

  return (
    <section className="page heatmap-page">
      <div className="page-title-row heatmap-title-row">
        <div>
          <h1>{t("heatmapTitle")}</h1>
          <p>{t("heatmapSubtitle")}</p>
        </div>
        <div className="heatmap-month-controls">
          <button className="secondary-button heatmap-icon-button" type="button" aria-label={t("previousMonth")} onClick={onPreviousMonth}>
            <ChevronLeft size={17} />
          </button>
          <strong>{monthLabel}</strong>
          <button className="secondary-button heatmap-icon-button" type="button" aria-label={t("nextMonth")} onClick={onNextMonth}>
            <ChevronRight size={17} />
          </button>
          <button className="secondary-button" type="button" onClick={onCurrentMonth}>
            {t("backToCurrentMonth")}
          </button>
        </div>
      </div>

      <section className="heatmap-overview-card" aria-label={t("heatmapMonthlyOverview")}>
        <div className="heatmap-overview-primary">
          <div className="heatmap-overview-primary-heading">
            <span className="heatmap-overview-primary-icon" aria-hidden="true">
              <CalendarDays size={18} />
            </span>
            <span>{t("heatmapActiveDays")}</span>
          </div>
          <div className="heatmap-overview-primary-value">
            <strong>{numberFormat.format(activeDisplayDays)}</strong>
            <span>
              / {numberFormat.format(data.days.length)} {t("unitDay")}
            </span>
          </div>
          <div
            className="heatmap-overview-primary-progress"
            role="progressbar"
            aria-label={t("heatmapActiveDays")}
            aria-valuemin={0}
            aria-valuemax={data.days.length}
            aria-valuenow={activeDisplayDays}
          >
            <span style={{ width: `${recordedDayProgress}%` }} />
          </div>
          <p>{t("heatmapStatRecordedThisMonth")}</p>
        </div>
        <div className="heatmap-overview-groups">
          {overviewMetricGroups.map((group) => (
            <section className="heatmap-overview-group" aria-label={group.label} key={group.label}>
              <div className="heatmap-overview-group-title">
                <span>{group.label}</span>
              </div>
              <div className="heatmap-overview-group-grid">
                {group.metrics.map((metric) => (
                  <div className="heatmap-overview-item" key={metric.label}>
                    <span className="heatmap-overview-item-label">{metric.label}</span>
                    <strong>
                      {metric.value}
                      <small>{metric.suffix}</small>
                    </strong>
                    <em className={metric.context ? "" : "is-empty"} aria-hidden={metric.context ? undefined : true}>
                      {metric.context ?? "\u00a0"}
                    </em>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <div className="heatmap-layout">
        <section className="heatmap-calendar-panel">
          <header className="heatmap-calendar-header">
            <div>
              <h2>{monthLabel}</h2>
            </div>
          </header>

          <div className="heatmap-weekdays">
            {weekdayLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="heatmap-calendar-grid">
            {calendarCells.map((cell) => {
              if (!cell.day) {
                return (
                  <span
                    className={`heatmap-day-cell outside-month${cell.outsideMonth ? " muted" : ""}`}
                    key={cell.key}
                    aria-hidden="true"
                  >
                    <span className="heatmap-day-number">{cell.dayNumber}</span>
                  </span>
                );
              }

              const day = cell.day;
              const dayActivity = displayByDate.get(day.date) ?? getHeatmapDisplayActivity(day);
              const isFuture = day.date > today;

              return (
                <button
                  className={[
                    "heatmap-day-cell",
                    day.date === selectedDay?.date ? "selected" : "",
                    day.date === today ? "today" : "",
                    dayActivity.total > 0 ? "has-activity" : "",
                    isFuture ? "future" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={day.date}
                  type="button"
                  title={`${day.date} · ${t("heatmapUnifiedIntensity")}: ${heatmapDisplayLevelLabel(dayActivity.level, t)}`}
                  aria-label={`${formatDateOnlyDisplay(day.date, language)} · ${t("heatmapUnifiedIntensity")}: ${heatmapDisplayLevelLabel(dayActivity.level, t)}`}
                  aria-pressed={day.date === selectedDay?.date}
                  aria-current={day.date === today ? "date" : undefined}
                  onClick={() => onSelectDate(day.date)}
                >
                  <span className="heatmap-day-number">{day.day}</span>
                  <HeatmapConstellation dayNumber={day.day} level={dayActivity.level} variant="cell" />
                </button>
              );
            })}
          </div>

          <footer className="heatmap-calendar-footer">
            <div className="heatmap-legend-group heatmap-unified-legend">
              <strong>{t("heatmapUnifiedIntensity")}</strong>
              <div className="heatmap-legend" aria-label={t("heatmapUnifiedIntensity")}>
                <span>{t("heatmapLess")}</span>
                <span className="heatmap-constellation-scale" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((sampleLevel) => (
                    <HeatmapConstellation
                      dayNumber={17}
                      level={sampleLevel as HeatmapDay["level"]}
                      variant="legend"
                      key={sampleLevel}
                    />
                  ))}
                </span>
                <span>{t("heatmapMore")}</span>
              </div>
            </div>
          </footer>
        </section>

        <aside className="heatmap-detail-panel">
          {selectedDay && selectedDayActivity ? (
            <>
              <header className="heatmap-detail-header">
                <span className="heatmap-detail-date-icon" aria-hidden="true">
                  <CalendarDays size={19} />
                </span>
                <div>
                  <span>{t("daySummary")}</span>
                  <h2>{formatDateOnlyDisplay(selectedDay.date, language)}</h2>
                </div>
              </header>
              <section
                className="heatmap-density-card"
                aria-label={t("heatmapDayRecordSummary")
                  .replace("{items}", numberFormat.format(selectedDayActivity.updatedItemCount))
                  .replace("{projects}", numberFormat.format(selectedDay.projectCount))
                  .replace("{chars}", numberFormat.format(selectedDay.totalTextLength))}
              >
                <div className={`heatmap-activity-mark heatmap-activity-mark-${selectedDayActivity.level}`}>
                  <span>{t("heatmapUnifiedIntensity")}</span>
                  <strong>
                    <Star size={13} fill="currentColor" strokeWidth={1.4} aria-hidden="true" />
                    {heatmapDisplayLevelLabel(selectedDayActivity.level, t)}
                  </strong>
                </div>
                <HeatmapConstellation
                  dayNumber={selectedDay.day}
                  level={selectedDayActivity.level}
                  variant="detail"
                />
                <div className="heatmap-day-facts">
                  <div>
                    <span>{t("heatmapRealUpdatedItems")}</span>
                    <strong>
                      {numberFormat.format(selectedDayActivity.updatedItemCount)}
                      <small>{t("unitCount")}</small>
                    </strong>
                  </div>
                  <div>
                    <span>{t("heatmapProjectCount")}</span>
                    <strong>
                      {numberFormat.format(selectedDay.projectCount)}
                      <small>{t("unitCount")}</small>
                    </strong>
                  </div>
                  <div>
                    <span>{t("heatmapTotalChars")}</span>
                    <strong>
                      {numberFormat.format(selectedDay.totalTextLength)}
                      <small>{t("unitChar")}</small>
                    </strong>
                  </div>
                </div>
              </section>
              {selectedDayActivity.total > 0 ? (
                <>
                  <div className="heatmap-detail-list">
                    <HeatmapDetailRow label={t("statusDoneToday")} value={`${numberFormat.format(selectedDay.doneCount)} ${t("unitCount")}`} icon={Check} />
                    <HeatmapDetailRow label={t("heatmapTextEntries")} value={selectedDayActivity.updatedItemCount > 0 ? t("heatmapYes") : t("heatmapNo")} icon={BookOpenText} />
                    <HeatmapDetailRow label={t("heatmapPausedItems")} value={`${numberFormat.format(selectedDay.pausedCount)} ${t("unitCount")}`} icon={AlertTriangle} />
                    <HeatmapDetailRow label={t("heatmapReportStatus")} value={selectedDay.hasReport ? `${t("heatmapReportGenerated")} · ${selectedReportTime}` : t("heatmapReportMissing")} icon={FileText} />
                  </div>
                </>
              ) : (
                <div className="heatmap-empty-day">
                  <strong>{t("heatmapNoRecordTitle")}</strong>
                  <p>{t("heatmapNoRecordBody")}</p>
                </div>
              )}
              {selectedDay.legacyEntryCount > 0 && selectedDay.entryCount === 0 && (
                <p className="heatmap-legacy-note">
                  {t("heatmapLegacyNote").replace("{count}", numberFormat.format(selectedDay.legacyEntryCount))}
                </p>
              )}
              <div className="heatmap-detail-actions">
                <button
                  className={selectedDay.hasReport ? "primary-button" : "secondary-button"}
                  type="button"
                  disabled={!selectedDay.hasReport}
                  onClick={() => onViewReport(selectedDay)}
                >
                  <FileText size={17} />
                  {selectedDay.hasReport ? t("viewDailyReport") : t("noDailyReport")}
                </button>
              </div>
            </>
          ) : (
            <EmptyState title={t("heatmapNoRecordTitle")} body={t("heatmapNoRecordBody")} />
          )}
        </aside>
      </div>
    </section>
  );
}

function ProjectMemoPage({
  project,
  memo,
  content,
  language,
  theme,
  t,
  onBack,
  onContentChange,
  onSave,
  onToast
}: {
  project: Project;
  memo: ProjectMemo;
  content: string;
  language: LanguagePreference;
  theme: "light" | "dark";
  t: Translator;
  onBack: () => void;
  onContentChange: (value: string) => void;
  onSave: () => Promise<boolean>;
  onToast: (toast: Toast) => void;
}) {
  const [isSavingImage, setIsSavingImage] = useState(false);

  const saveMemoEditorImage = async (file: File | Blob) => {
    setIsSavingImage(true);
    try {
      const data = await file.arrayBuffer();
      const result = await window.workJournal.memos.saveAttachment({
        projectId: project.id,
        mimeType: file.type || "image/png",
        data
      });
      onToast({ kind: "success", message: t("imagePasteSuccess") });
      return result.markdownUrl;
    } finally {
      setIsSavingImage(false);
    }
  };

  return (
    <section className="page project-memo-page">
      <header className="memo-page-topbar">
        <div className="memo-page-route">
          <button className="entry-back-icon" type="button" aria-label={t("backToProjectDetail")} onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
          <ProjectIdentityMark projectId={project.id} className="memo-project-identity" />
          <span className="memo-route-project" title={project.name}>
            {project.name}
          </span>
          <span className="memo-route-divider">/</span>
          <h1 className="memo-route-document">{t("projectMemo")}</h1>
          <span className="detail-status-pill">
            {project.status === "active" ? t("statusActive") : t("statusArchived")}
          </span>
        </div>
        <div className="memo-header-actions">
          <span className="memo-header-saved">
            {t("memoLastSaved")}
            {t("searchMatchedSeparator")}
            {formatTimestamp(memo.updated_at, language, t)}
          </span>
          <button className="primary-button memo-save-button" type="button" onClick={onSave}>
            <Save size={17} />
            {t("saveMemo")}
          </button>
        </div>
      </header>

      <div className="memo-workspace">
        <section className="memo-editor-card">
          <div className="memo-card-header">
            <div className="memo-document-meta">
              <span className="memo-document-icon" aria-hidden="true">
                <StickyNote size={17} />
              </span>
              <span>{t("projectMemoDocumentPill")}</span>
              <span className="memo-document-separator">/</span>
              <span>{t("memoEditor")}</span>
            </div>
            {isSavingImage && <span className="memo-saving-image">{t("memoSavingImage")}</span>}
          </div>
          <MarkdownWysiwygEditor
            value={content}
            language={language}
            theme={theme}
            labels={markdownEditorLabels(t)}
            onFeedback={onToast}
            placeholder={t("memoPlaceholder")}
            height="100%"
            minHeight="0px"
            hideModeSwitch
            onChange={onContentChange}
            onImageUpload={saveMemoEditorImage}
            onImageError={(error) =>
              onToast({ kind: "error", message: error instanceof Error ? error.message : t("memoImagePasteFailed") })
            }
          />
        </section>
      </div>
    </section>
  );
}

function MemoPreview({ content, t }: { content: string; t: Translator }) {
  if (!content.trim()) {
    return <div className="memo-preview-empty">{t("memoEmptyPreview")}</div>;
  }

  const parts: Array<{ type: "text"; value: string } | { type: "image"; alt: string; src: string }> = [];
  const pattern = /!\[([^\]]*)\]\((attachment:\/\/[^)]+)\)/g;
  let lastIndex = 0;
  for (const match of content.matchAll(pattern)) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: "image", alt: match[1] || "image", src: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }

  return (
    <div className="memo-preview-content">
      {parts.map((part, index) =>
        part.type === "image" ? (
          <figure className="memo-preview-image" key={`${part.src}-${index}`}>
            <img src={part.src} alt={part.alt} />
          </figure>
        ) : (
          <pre className="memo-preview-text" key={`text-${index}`}>
            {part.value}
          </pre>
        )
      )}
    </div>
  );
}

function UserGuidePage({
  t,
  content,
  backLabel,
  onBack
}: {
  t: Translator;
  content: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <section className="page user-guide-page">
      <PageHeader
        title={t("userGuide")}
        description={t("userGuideSubtitle")}
        backAction={{ label: backLabel, onClick: onBack }}
      />
      <article className="user-guide-reader">
        <ReadableMarkdown content={content} />
      </article>
    </section>
  );
}

function ProjectDetailPage({
  detail,
  language,
  t,
  backLabel,
  onBack,
  onRecordProgress,
  onComplete,
  onEditWorkItem,
  onMoveWorkItem,
  onDeleteWorkItem,
  onCreateWorkItem,
  onEditProject,
  onArchiveProject,
  onUnarchiveProject,
  onDeleteProject,
  onOpenMemo
}: {
  detail: ProjectDetail;
  language: LanguagePreference;
  t: Translator;
  backLabel: string;
  onBack: () => void;
  onRecordProgress: (projectId: string, workItemId: string) => void;
  onComplete: (id: string) => void;
  onEditWorkItem: (item: WorkItemWithLatest) => void;
  onMoveWorkItem: (item: WorkItemWithLatest, direction: SortMoveDirection, canMove: boolean) => void;
  onDeleteWorkItem: (item: WorkItemWithLatest) => void;
  onCreateWorkItem: () => void;
  onEditProject: () => void;
  onArchiveProject: () => void;
  onUnarchiveProject: () => void;
  onDeleteProject: () => void;
  onOpenMemo: () => void;
}) {
  const [projectActionsOpen, setProjectActionsOpen] = useState(false);
  const [workItemTab, setWorkItemTab] = useState<ProjectWorkItemTab>("active");
  const projectActionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectActionsOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (projectActionsMenuRef.current && !projectActionsMenuRef.current.contains(event.target as Node)) {
        setProjectActionsOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectActionsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectActionsOpen]);

  useEffect(() => {
    setWorkItemTab("active");
  }, [detail.project.id]);

  const isActiveWorkItemTab = workItemTab === "active";
  const isActiveProject = detail.project.status === "active";
  const visibleWorkItems = isActiveWorkItemTab ? detail.activeItems : detail.completedItems;
  const emptyWorkItemTitle = isActiveWorkItemTab ? t("noActiveWorkItemsTitle") : t("noCompletedItemsTitle");
  const emptyWorkItemBody = isActiveWorkItemTab ? t("noActiveWorkItemsBody") : t("noCompletedItemsBody");
  return (
    <section className="page detail-page">
      <header className="project-detail-topbar">
        <div className="project-detail-heading">
          <div className="project-detail-route">
            <button
              className="project-detail-back-icon"
              type="button"
              aria-label={backLabel}
              onClick={onBack}
            >
              <ChevronLeft size={20} />
            </button>
            <ProjectIdentityMark projectId={detail.project.id} className="project-detail-identity-mark" />
            <div className="project-detail-title-line">
              <h1 title={detail.project.name}>{detail.project.name}</h1>
              <span className="detail-status-pill">
                {detail.project.status === "active" ? t("statusActive") : t("statusArchived")}
              </span>
            </div>
          </div>
        </div>
        <div className="project-detail-actions">
          <button className="secondary-button" type="button" onClick={onOpenMemo}>
            <StickyNote size={17} />
            {t("projectMemo")}
          </button>
          <div className={`project-more-menu ${projectActionsOpen ? "open" : ""}`.trim()} ref={projectActionsMenuRef}>
            <button
              className="project-more-trigger"
              type="button"
              aria-label={t("moreActions")}
              aria-haspopup="menu"
              aria-expanded={projectActionsOpen}
              onClick={() => setProjectActionsOpen((current) => !current)}
            >
              <Ellipsis size={19} aria-hidden="true" />
            </button>
            {projectActionsOpen && (
              <div className="project-more-menu-list" role="menu" aria-label={t("moreActions")}>
                <button
                  className="ghost-button"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProjectActionsOpen(false);
                    onEditProject();
                  }}
                >
                  <SquarePen size={16} />
                  {t("editProject")}
                </button>
                {isActiveProject && (
                  <button
                    className="ghost-button"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProjectActionsOpen(false);
                      onArchiveProject();
                    }}
                  >
                    <Archive size={16} />
                    {t("archiveProject")}
                  </button>
                )}
                {!isActiveProject && (
                  <button
                    className="ghost-button"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProjectActionsOpen(false);
                      onUnarchiveProject();
                    }}
                  >
                    <ArchiveRestore size={16} />
                    {t("unarchiveProject")}
                  </button>
                )}
                <span className="project-menu-divider" aria-hidden="true" />
                <button
                  className="ghost-button danger-ghost"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProjectActionsOpen(false);
                    onDeleteProject();
                  }}
                >
                  <Trash2 size={16} />
                  {t("deleteProject")}
                </button>
              </div>
            )}
          </div>
          {isActiveProject && (
            <button className="primary-button" type="button" onClick={onCreateWorkItem}>
              <Plus size={17} />
              {t("newWorkItem")}
            </button>
          )}
        </div>
      </header>

      <div className="detail-workbench">
        <section className="detail-section project-work-items-section">
          <header className="detail-section-header work-item-tabs-header">
            <div
              className="work-item-tabs sliding-tab-list"
              role="tablist"
              aria-label={t("workItem")}
              onKeyDown={(event) => handleSegmentedKeyDown<ProjectWorkItemTab>(event, PROJECT_WORK_ITEM_TABS, workItemTab, setWorkItemTab)}
            >
              <SlidingTabIndicator activeItem={workItemTab} />
              {PROJECT_WORK_ITEM_TABS.map((tab) => {
                const label = tab === "active" ? t("activeWorkItems") : t("completedWorkItems");
                const count = tab === "active" ? detail.activeItems.length : detail.completedItems.length;
                const selected = workItemTab === tab;
                return (
                  <button
                    key={tab}
                    id={`work-item-tab-${tab}`}
                    className={`work-item-tab-button ${selected ? "active" : ""}`.trim()}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="work-item-tab-panel"
                    tabIndex={selected ? 0 : -1}
                    data-tab-id={tab}
                    onClick={() => setWorkItemTab(tab)}
                  >
                    <span>{label}</span>
                    <span className="work-item-tab-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </header>
          <div
            id="work-item-tab-panel"
            className="work-item-tab-panel"
            role="tabpanel"
            aria-labelledby={`work-item-tab-${workItemTab}`}
          >
            {visibleWorkItems.length === 0 ? (
              <EmptyState title={emptyWorkItemTitle} body={emptyWorkItemBody} />
            ) : (
              <div className={`project-workitem-table ${isActiveProject ? "" : "archived"}`.trim()}>
                <div className="project-workitem-table-head" aria-hidden="true">
                  <span />
                  <span>{t("workItem")}</span>
                  <span>{t("workItemStatus")}</span>
                  <span>{t("workItemRecentRecord")}</span>
                  <span>{t("workItemUpdatedAt")}</span>
                  <span>{t("workItemActions")}</span>
                </div>
                {visibleWorkItems.map((item, index) => (
                  <WorkItemRow
                    key={item.id}
                    item={item}
                    mode="detail"
                    language={language}
                    showCompletionControl={isActiveProject}
                    onRecordProgress={isActiveProject ? () => onRecordProgress(detail.project.id, item.id) : undefined}
                    onComplete={isActiveProject && isActiveWorkItemTab ? () => onComplete(item.id) : undefined}
                    onMoveUp={isActiveProject ? () => onMoveWorkItem(item, "up", index > 0) : undefined}
                    onMoveDown={isActiveProject ? () => onMoveWorkItem(item, "down", index < visibleWorkItems.length - 1) : undefined}
                    canMoveUp={isActiveProject && index > 0}
                    canMoveDown={isActiveProject && index < visibleWorkItems.length - 1}
                    onEdit={() => onEditWorkItem(item)}
                    onDelete={() => onDeleteWorkItem(item)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="timeline-section">
        <header className="detail-section-header">
          <h2>{t("timelineTitle")}</h2>
        </header>
        {detail.timeline.length === 0 ? (
          <EmptyState title={t("noTimelineTitle")} body={t("noTimelineBody")} />
        ) : (
          <div className="timeline">
            {detail.timeline.map((entry) => (
              <article className="timeline-entry" key={entry.id}>
                <time>{formatTimestamp(entry.created_at, language, t)}</time>
                <div>
                  <HoverTooltip as="h3" content={entry.work_item_title || t("unlinkedWorkItem")}>
                    <span className="timeline-entry-title">{entry.work_item_title || t("unlinkedWorkItem")}</span>
                    <span className={`timeline-source ${entry.source}`}>
                      {entry.source === "daily" ? t("timelineSourceDaily") : t("timelineSourceLegacy")}
                    </span>
                  </HoverTooltip>
                  <HoverTooltip as="div" className="timeline-entry-summary" content={entry.content}>
                    <p>{summary(entry.content, t)}</p>
                  </HoverTooltip>
                  <dl>
                    <div>
                      <dt>{t("nextStep")}</dt>
                      <HoverTooltip as="dd" content={entry.next_step || t("none")}>
                        {entry.next_step || t("none")}
                      </HoverTooltip>
                    </div>
                    <div>
                      <dt>{t("blocker")}</dt>
                      <HoverTooltip as="dd" content={entry.blocker || t("none")}>
                        {entry.blocker || t("none")}
                      </HoverTooltip>
                    </div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function RequiredMark() {
  return (
    <span className="required-mark" aria-hidden="true">
      *
    </span>
  );
}

function QuickProgressPanel({
  collapsed,
  today,
  language,
  theme,
  t,
  quickForm,
  workItems,
  setQuickForm,
  onToast,
  onCollapse,
  onExpand,
  onCreateProject,
  onCreateWorkItem,
  onSubmit
}: {
  collapsed: boolean;
  today: DailyJournalView | null;
  language: LanguagePreference;
  theme: "light" | "dark";
  t: Translator;
  quickForm: QuickProgressForm;
  workItems: WorkItemWithLatest[];
  setQuickForm: (value: QuickProgressForm | ((current: QuickProgressForm) => QuickProgressForm)) => void;
  onToast: (toast: Toast) => void;
  onCollapse: () => void;
  onExpand: () => void;
  onCreateProject: () => void;
  onCreateWorkItem: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const [isSavingImage, setIsSavingImage] = useState(false);

  const saveQuickEditorImage = async (file: File | Blob) => {
    if (!quickForm.projectId || !quickForm.workItemId) {
      throw new Error(t("chooseProjectAndWorkItem"));
    }

    setIsSavingImage(true);
    try {
      const data = await file.arrayBuffer();
      const result = await window.workJournal.daily.saveAttachment({
        projectId: quickForm.projectId,
        workItemId: quickForm.workItemId,
        journalDate: today?.journalDate ?? getLocalDateKey(),
        mimeType: file.type || "image/png",
        data
      });
      onToast({ kind: "success", message: t("imagePasteSuccess") });
      return result.markdownUrl;
    } finally {
      setIsSavingImage(false);
    }
  };

  if (collapsed) {
    return (
      <aside className="quick-rail">
        <button className="quick-toggle-button" type="button" onClick={onExpand} aria-label={t("expandQuickAria")}>
          <PanelRightOpen size={20} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="quick-panel">
      <header>
        <div>
          <h2>{t("quickTitle")}</h2>
          <p>{t("quickSubtitle")}</p>
        </div>
        <button className="icon-button quick-toggle-button active" type="button" onClick={onCollapse} aria-label={t("collapseQuickAria")}>
          <PanelRightClose size={19} />
        </button>
      </header>
      <form className="quick-form" onSubmit={onSubmit}>
        {isSavingImage && <span className="quick-saving-image">{t("memoSavingImage")}</span>}
        <label>
          <span className="label-text">{t("project")} <RequiredMark /></span>
          <select
            value={quickForm.projectId}
            onChange={(event) => {
              if (event.target.value === CREATE_PROJECT_OPTION) {
                onCreateProject();
                return;
              }
              setQuickForm((current) => ({
                ...current,
                projectId: event.target.value,
                workItemId: ""
              }));
            }}
            required
          >
            <option value="">{t("chooseProject")}</option>
            <option value={CREATE_PROJECT_OPTION}>{t("addProjectOption")}</option>
            {today?.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label-text">{t("workItem")} <RequiredMark /></span>
          <select
            value={quickForm.workItemId}
            onChange={(event) => {
              if (event.target.value === CREATE_WORK_ITEM_OPTION) {
                onCreateWorkItem();
                return;
              }
              setQuickForm((current) => ({ ...current, workItemId: event.target.value }));
            }}
            required
          >
            <option value="">{t("chooseWorkItem")}</option>
            <option value={CREATE_WORK_ITEM_OPTION}>{t("addWorkItemOption")}</option>
            {workItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="editor-form-field" role="group" aria-label={t("progressToday")}>
          <span>{t("progressToday")}</span>
          <MarkdownWysiwygEditor
            value={quickForm.content}
            language={language}
            theme={theme}
            labels={markdownEditorLabels(t)}
            onFeedback={onToast}
            placeholder={t("progressPlaceholder")}
            height="210px"
            minHeight="150px"
            compact
            onChange={(value) => setQuickForm((current) => ({ ...current, content: value }))}
            onImageUpload={saveQuickEditorImage}
            onImageError={(error) =>
              onToast({ kind: "error", message: error instanceof Error ? error.message : t("memoImagePasteFailed") })
            }
          />
        </div>
        <div className="editor-form-field" role="group" aria-label={t("nextStepPlan")}>
          <span>{t("nextStepPlan")}</span>
          <MarkdownWysiwygEditor
            value={quickForm.nextStep}
            language={language}
            theme={theme}
            labels={markdownEditorLabels(t)}
            onFeedback={onToast}
            placeholder={t("nextStepPlaceholder")}
            height="160px"
            minHeight="130px"
            compact
            onChange={(value) => setQuickForm((current) => ({ ...current, nextStep: value }))}
            onImageUpload={saveQuickEditorImage}
            onImageError={(error) =>
              onToast({ kind: "error", message: error instanceof Error ? error.message : t("memoImagePasteFailed") })
            }
          />
        </div>
        <div className="editor-form-field" role="group" aria-label={t("blockerHelp")}>
          <span>{t("blockerHelp")}</span>
          <MarkdownWysiwygEditor
            value={quickForm.blocker}
            language={language}
            theme={theme}
            labels={markdownEditorLabels(t)}
            onFeedback={onToast}
            placeholder={t("blockerPlaceholder")}
            height="160px"
            minHeight="130px"
            compact
            onChange={(value) => setQuickForm((current) => ({ ...current, blocker: value }))}
            onImageUpload={saveQuickEditorImage}
            onImageError={(error) =>
              onToast({ kind: "error", message: error instanceof Error ? error.message : t("memoImagePasteFailed") })
            }
          />
        </div>
        <button className="primary-button full-width" type="submit">
          <Save size={17} />
          {t("saveProgress")}
        </button>
      </form>
    </aside>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatUpdateReleaseDate(value: string | undefined, language: LanguagePreference, t: Translator): string {
  if (!value) {
    return t("none");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function updateStatusLabel(status: AppUpdateStatus, t: Translator): string {
  if (status.status === "checking") {
    return t("updateChecking");
  }
  if (status.status === "update-not-available") {
    return t("updateLatest");
  }
  if (status.status === "update-available") {
    return status.latestVersion
      ? t("updateAvailableWithVersion").replace("{version}", status.latestVersion)
      : t("updateAvailable");
  }
  if (status.status === "download-progress") {
    return t("updateDownloading");
  }
  if (status.status === "update-downloaded") {
    return t("updateDownloaded");
  }
  if (status.status === "development") {
    return t("updateDevelopmentUnavailable");
  }
  if (status.status === "error") {
    return updateErrorMessage(status, t);
  }
  return t("updateStatusIdle");
}

function updateErrorMessage(status: AppUpdateStatus, t: Translator): string {
  if (status.errorCode === "no-release") {
    return t("updateNoRelease");
  }
  if (status.errorCode === "no-update-metadata") {
    return t("updateMetadataMissing");
  }
  if (status.errorCode === "no-compatible-artifact") {
    return t("updateNoCompatiblePackage");
  }
  if (status.errorCode === "signature") {
    return t("updateSignatureFailed");
  }
  if (status.errorCode === "network") {
    return t("updateNetworkFailed");
  }
  if (status.errorCode === "development") {
    return t("updateDevelopmentUnavailable");
  }
  return t("updateCheckFailed");
}

function updatePanelDescription(status: AppUpdateStatus, t: Translator): string {
  if (status.status === "update-available") {
    return t("updateAvailableDescription");
  }
  if (status.status === "download-progress") {
    return t("updateDownloadingDescription");
  }
  if (status.status === "update-downloaded") {
    return t("updateDownloadedDescription");
  }
  if (status.status === "update-not-available") {
    return t("updateLatestDescription");
  }
  if (status.status === "checking") {
    return t("updateCheckingDescription");
  }
  if (status.status === "development") {
    return t("updateDevelopmentDescription");
  }
  if (status.status === "error") {
    return t("updateErrorDescription");
  }
  return t("updateIdleDescription");
}


function SettingsPage({
  settings,
  t,
  message,
  onToast,
  isChangingDataDirectory,
  busyAction,
  onSetTheme,
  onSetLanguage,
  onSaveAiSettings,
  onClearAiKey,
  onTestAiConnection,
  onOpenDataDirectory,
  onChooseDataDirectory,
  onReloadDataDirectory,
  onOpenUserGuide
}: {
  settings: SettingsInfo;
  t: Translator;
  message: Toast | null;
  onToast: (toast: Toast) => void;
  isChangingDataDirectory: boolean;
  busyAction: string | null;
  onSetTheme: (theme: ThemePreference) => void;
  onSetLanguage: (language: LanguagePreference) => void;
  onSaveAiSettings: (
    input: AiSaveSettingsInput,
    options?: { showSuccessToast?: boolean }
  ) => Promise<AiSettingsInfo>;
  onClearAiKey: () => Promise<AiSettingsInfo>;
  onTestAiConnection: () => Promise<AiOperationResult>;
  onOpenDataDirectory: () => void;
  onChooseDataDirectory: () => void;
  onReloadDataDirectory: () => void;
  onOpenUserGuide: () => void;
}) {
  const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Monitor }> = [
    { value: "system", label: t("themeSystem"), icon: Monitor },
    { value: "light", label: t("themeLight"), icon: Sun },
    { value: "dark", label: t("themeDark"), icon: Moon }
  ];
  const [aiForm, setAiForm] = useState<AiSaveSettingsInput>({
    enabled: settings.ai.enabled,
    provider: settings.ai.provider,
    baseUrl: settings.ai.baseUrl,
    model: settings.ai.model,
    apiKey: ""
  });
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiMessage, setAiMessage] = useState<Toast | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [updateAction, setUpdateAction] = useState<"check" | "download" | "install" | null>(null);
  const [updateMessage, setUpdateMessage] = useState<Toast | null>(null);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [expandedSettingsSection, setExpandedSettingsSection] = useState<"ai" | "storage" | "update" | null>(null);
  const [isTransferGuideOpen, setIsTransferGuideOpen] = useState(false);

  useEffect(() => {
    setAiForm({
      enabled: settings.ai.enabled,
      provider: settings.ai.provider,
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      apiKey: ""
    });
  }, [settings.ai.enabled, settings.ai.provider, settings.ai.baseUrl, settings.ai.model]);

  useEffect(() => {
    let isMounted = true;
    const handleStatus = (status: AppUpdateStatus) => {
      if (!isMounted) {
        return;
      }
      setUpdateStatus(status);
      setAppVersion(status.currentVersion);
    };

    window.workJournal.appInfo
      .getVersion()
      .then((version) => {
        if (isMounted) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        if (isMounted) {
          setAppVersion("0.1.0");
        }
      });

    window.workJournal.updates
      .getStatus()
      .then(handleStatus)
      .catch(() => {
        if (isMounted) {
          setUpdateStatus(null);
        }
      });

    const dispose = window.workJournal.updates.onStatus(handleStatus);
    return () => {
      isMounted = false;
      dispose();
    };
  }, []);

  const checkUpdates = async () => {
    setExpandedSettingsSection("update");
    setUpdateAction("check");
    setUpdateMessage(null);
    try {
      const result = await window.workJournal.updates.checkForUpdates();
      setAppVersion(result.currentVersion);
      setUpdateStatus(result);
    } catch {
      setUpdateMessage({ kind: "warning", message: t("updateCheckFailed") });
    } finally {
      setUpdateAction(null);
    }
  };

  const downloadUpdate = async () => {
    setExpandedSettingsSection("update");
    setUpdateAction("download");
    setUpdateMessage(null);
    try {
      const result = await window.workJournal.updates.downloadUpdate();
      setUpdateStatus(result);
    } catch {
      setUpdateMessage({ kind: "warning", message: t("updateDownloadFailed") });
    } finally {
      setUpdateAction(null);
    }
  };

  const quitAndInstallUpdate = async () => {
    setUpdateAction("install");
    setUpdateMessage(null);
    try {
      const result = await window.workJournal.updates.quitAndInstall();
      setUpdateStatus(result);
    } catch {
      setUpdateMessage({ kind: "warning", message: t("updateInstallFailed") });
      setUpdateAction(null);
    }
  };

  const installLater = () => {
    setUpdateMessage({ kind: "info", message: t("updateInstallLaterMessage") });
  };

  const openReleases = async () => {
    try {
      await window.workJournal.updates.openReleasePage();
    } catch (error) {
      console.error("Failed to open the release page.", error);
      onToast({ kind: "warning", message: t("openReleasesFailed") });
    }
  };

  const openRepository = async () => {
    setUpdateMessage(null);
    try {
      await window.workJournal.updates.openRepositoryPage();
    } catch (error) {
      console.error("Failed to open the repository page.", error);
      onToast({ kind: "warning", message: t("openRepositoryFailed") });
    }
  };

  const saveAi = async () => {
    setAiBusy("save");
    setAiMessage(null);
    try {
      const result = await onSaveAiSettings(aiForm);
      setAiForm((current) => ({ ...current, apiKey: "" }));
      setAiMessage(
        result.canSecurelyStoreApiKey || !aiForm.apiKey?.trim()
          ? null
          : { kind: "error", message: t("aiSafeStorageUnavailable") }
      );
    } catch (error) {
      setAiMessage({ kind: "error", message: error instanceof Error ? error.message : t("aiSettingsSaveFailed") });
    } finally {
      setAiBusy(null);
    }
  };

  const clearAiKey = async () => {
    setAiBusy("clear");
    setAiMessage(null);
    try {
      await onClearAiKey();
      setAiForm((current) => ({ ...current, apiKey: "" }));
      setAiMessage(null);
    } catch (error) {
      setAiMessage({ kind: "error", message: error instanceof Error ? error.message : t("aiApiKeyClearFailed") });
    } finally {
      setAiBusy(null);
    }
  };

  const testAi = async () => {
    setAiBusy("test");
    setAiMessage(null);
    try {
      await onSaveAiSettings(aiForm, { showSuccessToast: false });
      const result = await onTestAiConnection();
      setAiMessage(result.success ? null : { kind: "error", message: result.error ?? t("aiConnectionFailed") });
    } catch (error) {
      setAiMessage({ kind: "error", message: error instanceof Error ? error.message : t("aiConnectionFailed") });
    } finally {
      setAiBusy(null);
    }
  };
  const displayedUpdateStatus: AppUpdateStatus = updateStatus ?? {
    status: "idle",
    currentVersion: appVersion || "0.1.0"
  };
  const updatePercent = Math.max(0, Math.min(100, displayedUpdateStatus.progress?.percent ?? 0));
  const updateIsChecking = updateAction === "check" || displayedUpdateStatus.status === "checking";
  const updateIsDownloading = updateAction === "download" || displayedUpdateStatus.status === "download-progress";
  const updateIsInstalling = updateAction === "install";
  const latestVersionDisplay = displayedUpdateStatus.latestVersion
    ? `v${displayedUpdateStatus.latestVersion}`
    : t("updateUnknownVersion");
  const releaseDateDisplay = formatUpdateReleaseDate(displayedUpdateStatus.releaseDate, settings.language, t);
  const releaseNotes = displayedUpdateStatus.releaseNotes?.trim();
  const releaseSummary = releaseNotes ? releaseNotesToSummary(releaseNotes, settings.language, t) : "";
  const shouldShowReleaseSummary = Boolean(
    releaseNotes && releaseSummary && displayedUpdateStatus.status !== "error" && displayedUpdateStatus.status !== "development"
  );

  const aiKeyStatus = settings.ai.apiKeyConfigured
    ? `${t("aiApiKeyConfigured")} ${settings.ai.apiKeyPreview}`
    : t("aiApiKeyNotConfigured");

  return (
    <section className="page settings-page">
      <PageHeader title={t("settingsTitle")} description={t("settingsSubtitle")} />

      <div className="settings-overview">
        <section className="settings-group" id="settings-appearance-language">
          <h2 className="settings-group-label">{t("settingsPreferencesGroup")}</h2>
          <div className="settings-table">
            <div className="settings-row">
              <div className="settings-row-icon" aria-hidden="true">
                <Monitor size={21} />
              </div>
              <div className="settings-row-copy">
                <h3>{t("appearanceTitle")}</h3>
                <p>{t("appearanceDescription")}</p>
              </div>
              <div className="settings-row-actions">
                <div className="segmented-control settings-segmented" role="radiogroup" aria-label={t("chooseAppearanceAria")}>
                  {themeOptions.map((option) => (
                    <button
                      key={option.value}
                      className={settings.theme === option.value ? "selected" : ""}
                      type="button"
                      role="radio"
                      aria-checked={settings.theme === option.value}
                      onClick={() => onSetTheme(option.value)}
                    >
                      <option.icon size={16} />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-icon" aria-hidden="true">
                <Languages size={21} />
              </div>
              <div className="settings-row-copy">
                <h3>{t("languageTitle")}</h3>
                <p>{t("languageDescription")}</p>
              </div>
              <div className="settings-row-actions">
                <div className="segmented-control settings-segmented language" role="radiogroup" aria-label={t("chooseLanguageAria")}>
                  {languageOptions.map((option) => (
                    <button
                      key={option.value}
                      className={settings.language === option.value ? "selected" : ""}
                      type="button"
                      role="radio"
                      aria-checked={settings.language === option.value}
                      onClick={() => onSetLanguage(option.value)}
                    >
                      {t(option.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-label">{t("settingsIntelligenceGroup")}</h2>
          <div className="settings-table" id="settings-ai">
            <div className={`settings-row settings-summary-row${expandedSettingsSection === "ai" ? " is-expanded" : ""}`}>
              <div className="settings-row-icon" aria-hidden="true">
                <Sparkles size={21} />
              </div>
              <div className="settings-row-copy">
                <h3>{t("aiSettingsTitle")}</h3>
                <span className="settings-row-meta">
                  {t("aiProviderOpenAICompatible")} · {aiKeyStatus}
                </span>
              </div>
              <div className="settings-row-actions settings-command-actions">
                <label className="settings-switch-control">
                  <button
                    className={`settings-switch${aiForm.enabled ? " is-on" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={aiForm.enabled}
                    aria-label={t("aiEnabled")}
                    onClick={() => {
                      const nextEnabled = !aiForm.enabled;
                      setAiForm((current) => ({ ...current, enabled: nextEnabled }));
                      if (nextEnabled) {
                        setExpandedSettingsSection("ai");
                      }
                    }}
                  >
                    <span />
                  </button>
                  <span>{aiForm.enabled ? t("aiEnabledOption") : t("aiDisabled")}</span>
                </label>
                <button
                  className="secondary-button settings-disclosure-button"
                  type="button"
                  aria-expanded={expandedSettingsSection === "ai"}
                  onClick={() => setExpandedSettingsSection((current) => (current === "ai" ? null : "ai"))}
                >
                  {expandedSettingsSection === "ai" ? t("collapse") : t("settingsConfigure")}
                  <ChevronRight className={expandedSettingsSection === "ai" ? "is-open" : ""} size={16} />
                </button>
              </div>
            </div>

            {expandedSettingsSection === "ai" && (
              <div className="settings-expanded-panel settings-ai-panel">
                {!settings.ai.canSecurelyStoreApiKey && (
                  <div className="warning-panel">
                    <AlertTriangle size={18} />
                    <div>
                      <strong>{t("aiSafeStorageTitle")}</strong>
                      <span>{t("aiSafeStorageUnavailable")}</span>
                    </div>
                  </div>
                )}

                <div className="settings-form-grid">
                  <label>
                    <span className="label-text">{t("aiBaseUrl")}</span>
                    <input
                      value={aiForm.baseUrl}
                      onChange={(event) => setAiForm((current) => ({ ...current, baseUrl: event.target.value }))}
                      placeholder={t("aiBaseUrlPlaceholder")}
                    />
                  </label>
                  <label>
                    <span className="label-text">{t("aiModel")}</span>
                    <input
                      value={aiForm.model}
                      onChange={(event) => setAiForm((current) => ({ ...current, model: event.target.value }))}
                      placeholder={t("aiModelPlaceholder")}
                    />
                  </label>
                  <label className="span-two">
                    <span className="label-text">{t("aiApiKey")}</span>
                    <input
                      type="password"
                      value={aiForm.apiKey ?? ""}
                      onChange={(event) => setAiForm((current) => ({ ...current, apiKey: event.target.value }))}
                      placeholder={settings.ai.apiKeyConfigured ? settings.ai.apiKeyPreview : t("aiApiKeyPlaceholder")}
                    />
                  </label>
                </div>

                <div className="ai-key-status-row">
                  <span>{t("aiApiKeyStatus")}</span>
                  <code>{aiKeyStatus}</code>
                </div>

                <div className="settings-help-callout">
                  <AlertTriangle size={16} />
                  <p>{t("aiPrivacyNote")}</p>
                </div>

                {aiMessage && <div className={`inline-message ${aiMessage.kind}`}>{aiMessage.message}</div>}

                <div className="settings-actions">
                  <button className="secondary-button" type="button" onClick={testAi} disabled={aiBusy !== null}>
                    <Sparkles size={17} />
                    {aiBusy === "test" ? t("testing") : t("aiTestConnection")}
                  </button>
                  <button
                    className="ghost-button danger-ghost"
                    type="button"
                    onClick={clearAiKey}
                    disabled={aiBusy !== null || !settings.ai.apiKeyConfigured}
                  >
                    <X size={17} />
                    {t("aiClearApiKey")}
                  </button>
                  <button className="primary-button" type="button" onClick={saveAi} disabled={aiBusy !== null}>
                    <Save size={17} />
                    {aiBusy === "save" ? t("saving") : t("aiSaveSettings")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-label">{t("settingsDataAppGroup")}</h2>
          <div className="settings-table">
            <section className="settings-row-block" id="settings-storage">
              <div className={`settings-row settings-summary-row${expandedSettingsSection === "storage" ? " is-expanded" : ""}`}>
                <div className="settings-row-icon" aria-hidden="true">
                  <HardDrive size={21} />
                </div>
                <div className="settings-row-copy">
                  <h3>{t("dataStorageTitle")}</h3>
                  <span
                    className={`settings-row-meta settings-storage-meta${settings.isFallbackDataDirectory ? " is-warning" : ""}`}
                  >
                    <span className={`settings-status-dot${settings.isFallbackDataDirectory ? " warning" : ""}`} />
                    {settings.isFallbackDataDirectory ? t("storageAttention") : t("storageNormal")}
                    <span className="settings-meta-divider" />
                    <span className="settings-storage-description">{t("dataStorageDescription")}</span>
                  </span>
                </div>
                <div className="settings-row-actions settings-command-actions">
                  <button
                    className="settings-icon-button"
                    type="button"
                    onClick={onOpenDataDirectory}
                    aria-label={t("openDataDirectory")}
                    title={t("openDataDirectory")}
                  >
                    <FolderOpen size={17} />
                  </button>
                  <button
                    className="secondary-button settings-disclosure-button"
                    type="button"
                    aria-expanded={expandedSettingsSection === "storage"}
                    onClick={() => setExpandedSettingsSection((current) => (current === "storage" ? null : "storage"))}
                  >
                    {expandedSettingsSection === "storage" ? t("collapse") : t("settingsManage")}
                    <ChevronRight className={expandedSettingsSection === "storage" ? "is-open" : ""} size={16} />
                  </button>
                </div>
              </div>

              {expandedSettingsSection === "storage" && (
                <div className="settings-expanded-panel settings-storage-panel">
                  {settings.isFallbackDataDirectory && (
                    <div className="warning-panel">
                      <AlertTriangle size={18} />
                      <div>
                        <strong>{t("fallbackTitle")}</strong>
                        <span>{settings.fallbackReason}</span>
                        {settings.configuredDataDirectory && (
                          <code>
                            {t("fallbackConfiguredDirectory")}：{settings.configuredDataDirectory}
                          </code>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="settings-data-grid compact">
                    <InfoRow label={t("currentDataDirectory")} value={settings.dataDirectory} />
                    <InfoRow label={t("currentDatabaseFile")} value={settings.databasePath} />
                    <InfoRow label={t("databaseSize")} value={formatBytes(settings.databaseSize)} />
                    <InfoRow
                      label={t("directoryType")}
                      value={
                        settings.isFallbackDataDirectory
                          ? t("directoryFallback")
                          : settings.isCustomDataDirectory
                            ? t("directoryCustom")
                            : t("directoryDefault")
                      }
                    />
                    <InfoRow label={t("configFile")} value={settings.configPath} />
                  </div>

                  <p className="settings-storage-note">
                    <Info size={16} />
                    <span>{t("dataStorageNote")}</span>
                  </p>

                  <div className="settings-storage-footer">
                    <button
                      className="settings-transfer-toggle"
                      type="button"
                      aria-expanded={isTransferGuideOpen}
                      onClick={() => setIsTransferGuideOpen((current) => !current)}
                    >
                      {t("copyGuidanceTitle")}
                      <ChevronRight className={isTransferGuideOpen ? "is-open" : ""} size={16} />
                    </button>
                    <div className="settings-actions">
                      <button className="secondary-button" type="button" onClick={onOpenDataDirectory}>
                        <FolderOpen size={17} />
                        {t("openDataDirectory")}
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={onChooseDataDirectory}
                        disabled={isChangingDataDirectory || busyAction !== null}
                      >
                        <HardDrive size={17} />
                        {isChangingDataDirectory ? t("changingDataDirectory") : t("chooseDataDirectory")}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={onReloadDataDirectory}
                        disabled={busyAction !== null}
                      >
                        <RefreshCw size={17} />
                        {busyAction === "reload" ? t("reloading") : t("reloadDataDirectory")}
                      </button>
                    </div>
                  </div>

                  {isTransferGuideOpen && (
                    <div className="copy-guidance">
                      <strong>{t("copyGuidanceTitle")}</strong>
                      <p>{t("copyGuidanceSummary")}</p>
                      <p>{t("copyGuidanceWarning")}</p>
                    </div>
                  )}

                  {message && <div className={`inline-message ${message.kind}`}>{message.message}</div>}
                </div>
              )}
            </section>

            <section className="settings-row-block" id="settings-version-updates">
              <div className={`settings-row settings-summary-row${expandedSettingsSection === "update" ? " is-expanded" : ""}`}>
                <div className="settings-row-icon" aria-hidden="true">
                  <RefreshCw size={21} />
                </div>
                <div className="settings-row-copy">
                  <h3>{t("versionUpdatesTitle")}</h3>
                  <span className="settings-row-meta settings-update-meta">
                    <span
                      className={`settings-status-dot${displayedUpdateStatus.status === "error" ? " danger" : ""}`}
                    />
                    {updateStatusLabel(displayedUpdateStatus, t)}
                    <span className="settings-meta-divider" aria-hidden="true" />
                    <span className="settings-update-version">
                      {t("currentVersion")} {appVersion ? `v${appVersion}` : t("loading")}
                    </span>
                  </span>
                </div>
                <div className="settings-row-actions settings-command-actions settings-update-actions">
                  {displayedUpdateStatus.status === "update-available" ? (
                    <button className="primary-button" type="button" onClick={downloadUpdate} disabled={updateIsDownloading}>
                      <RefreshCw size={17} />
                      {updateIsDownloading ? t("updateDownloadingShort") : t("downloadAndInstallUpdate")}
                    </button>
                  ) : displayedUpdateStatus.status === "download-progress" ? (
                    <button className="primary-button" type="button" disabled>
                      <RefreshCw size={17} />
                      {t("updateDownloadingShort")}
                    </button>
                  ) : displayedUpdateStatus.status === "update-downloaded" ? (
                    <button className="primary-button" type="button" onClick={quitAndInstallUpdate} disabled={updateIsInstalling}>
                      <RefreshCw size={17} />
                      {updateIsInstalling ? t("updateInstalling") : t("restartAndInstallUpdate")}
                    </button>
                  ) : (
                    <button className="secondary-button" type="button" onClick={checkUpdates} disabled={updateIsChecking}>
                      {updateIsChecking
                        ? t("updateCheckingShort")
                        : displayedUpdateStatus.status === "error"
                          ? t("retry")
                          : t("checkForUpdates")}
                    </button>
                  )}
                  <button
                    className="secondary-button settings-disclosure-button"
                    type="button"
                    aria-expanded={expandedSettingsSection === "update"}
                    aria-controls="settings-update-details"
                    onClick={() => setExpandedSettingsSection((current) => (current === "update" ? null : "update"))}
                  >
                    {expandedSettingsSection === "update" ? t("collapse") : t("settingsDetails")}
                    <ChevronRight className={expandedSettingsSection === "update" ? "is-open" : ""} size={16} />
                  </button>
                </div>
              </div>

              {expandedSettingsSection === "update" && (
                <div className="settings-expanded-panel settings-update-panel" id="settings-update-details">
                  {(displayedUpdateStatus.latestVersion ||
                    displayedUpdateStatus.status === "update-available" ||
                    displayedUpdateStatus.releaseDate) && (
                    <div className="settings-data-grid compact">
                      {(displayedUpdateStatus.latestVersion || displayedUpdateStatus.status === "update-available") && (
                        <InfoRow label={t("updateLatestVersion")} value={latestVersionDisplay} />
                      )}
                      {displayedUpdateStatus.releaseDate && (
                        <InfoRow label={t("updateReleaseDate")} value={releaseDateDisplay} />
                      )}
                    </div>
                  )}

                  <div className={`update-status-panel ${displayedUpdateStatus.status}`}>
                    <strong>{updateStatusLabel(displayedUpdateStatus, t)}</strong>
                    <span>{updatePanelDescription(displayedUpdateStatus, t)}</span>
                  </div>

                  {displayedUpdateStatus.status === "download-progress" && (
                    <div className="update-progress-panel" aria-label={t("updateDownloadProgressLabel")}>
                      <div className="update-progress-meta">
                        <span>{t("updateDownloadProgressLabel")}</span>
                        <strong>{Math.round(updatePercent)}%</strong>
                      </div>
                      <div className="update-progress-track">
                        <div className="update-progress-bar" style={{ width: `${updatePercent}%` }} />
                      </div>
                      {displayedUpdateStatus.progress?.total && (
                        <p className="settings-note compact">
                          {t("updateDownloadedSize")}：{formatBytes(displayedUpdateStatus.progress.transferred ?? 0)} /{" "}
                          {formatBytes(displayedUpdateStatus.progress.total)}
                        </p>
                      )}
                    </div>
                  )}

                  {shouldShowReleaseSummary && (
                    <div className="update-release-summary">
                      <strong>{t("updateReleaseSummary")}</strong>
                      <p>{releaseSummary}</p>
                    </div>
                  )}

                  <p className="settings-note compact">{t("updateDataSafetyNote")}</p>
                  {updateMessage && <div className={`inline-message ${updateMessage.kind}`}>{updateMessage.message}</div>}

                  <div className="settings-star-reminder">
                    <div className="settings-star-reminder-copy">
                      <Star size={17} aria-hidden="true" />
                      <span>{t("updateStarReminder")}</span>
                    </div>
                    <div className="settings-star-reminder-actions">
                      <button className="secondary-button" type="button" onClick={openReleases}>
                        <ExternalLink size={16} />
                        {t("viewReleaseDetails")}
                      </button>
                      <button
                        className="secondary-button settings-star-action"
                        type="button"
                        onClick={openRepository}
                      >
                        <Star size={16} aria-hidden="true" />
                        {t("updateStarAction")}
                      </button>
                    </div>
                  </div>

                  {displayedUpdateStatus.status === "update-downloaded" && (
                    <div className="settings-update-footer">
                      <button className="secondary-button" type="button" onClick={installLater}>
                        {t("updateLater")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            <div className="settings-row" id="settings-user-guide">
              <div className="settings-row-icon" aria-hidden="true">
                <BookOpenText size={21} />
              </div>
              <div className="settings-row-copy">
                <h3>{t("helpUserGuideTitle")}</h3>
                <p>{t("helpUserGuideDescription")}</p>
              </div>
              <div className="settings-row-actions settings-command-actions">
                <button className="secondary-button settings-footer-action" type="button" onClick={onOpenUserGuide}>
                  <ExternalLink size={16} />
                  {t("openUserGuide")}
                </button>
              </div>
            </div>

            <div className="settings-row" id="settings-about-flow-shuttle">
              <div className="settings-row-icon" aria-hidden="true">
                <Info size={21} />
              </div>
              <div className="settings-row-copy">
                <h3>{t("aboutFlowShuttleTitle")}</h3>
                <p>{t("aboutFlowShuttleDescription")}</p>
              </div>
              <div className="settings-row-actions settings-command-actions">
                <button
                  className="secondary-button settings-footer-action"
                  type="button"
                  onClick={() => setIsAboutModalOpen(true)}
                >
                  <ExternalLink size={16} />
                  {t("openAboutFlowShuttle")}
                </button>
              </div>
            </div>

          </div>
        </section>
      </div>

      {isAboutModalOpen && <AboutFlowShuttleModal t={t} onClose={() => setIsAboutModalOpen(false)} />}
    </section>
  );
}

function AboutFlowShuttleModal({ t, onClose }: { t: Translator; onClose: () => void }) {
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      trapModalFocus(event, modalRef.current);
    };
    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      getFocusableElements(modalRef.current)[0]?.focus();
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [onClose]);

  const links = [
    { label: t("aboutPersonalWebsite"), value: "https://www.sunyuanrui.com/", href: "https://www.sunyuanrui.com/" },
    { label: t("aboutFlowShuttlePage"), value: "https://www.sunyuanrui.com/flow-shuttle/", href: "https://www.sunyuanrui.com/flow-shuttle/" }
  ];
  const textRows = [
    { label: t("aboutOfficialAccount"), value: "睿见产品" },
    { label: t("aboutXiaohongshu"), value: "7930978517" }
  ];

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section ref={modalRef} className="form-modal about-modal" role="dialog" aria-modal="true" aria-label={t("aboutFlowShuttleModalTitle")} tabIndex={-1}>
        <header className="modal-header">
          <div>
            <h2>{t("aboutFlowShuttleModalTitle")}</h2>
            <p className="modal-description">{t("aboutFlowShuttleModalDescription")}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("close")}>
            <X size={18} />
          </button>
        </header>

        <div className="about-link-list">
          {links.map((link) => (
            <a className="about-link-row" key={link.href} href={link.href} target="_blank" rel="noreferrer">
              <span>{link.label}</span>
              <code>{link.value}</code>
              <ExternalLink size={15} />
            </a>
          ))}
          {textRows.map((row) => (
            <div className="about-link-row text-only" key={row.label}>
              <span>{row.label}</span>
              <code>{row.value}</code>
            </div>
          ))}
        </div>

        <footer className="modal-actions">
          <button className="primary-button" type="button" onClick={onClose}>
            {t("close")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function PlaceholderPage({
  title,
  body,
  emptyTitle,
  emptyBody
}: {
  title: string;
  body: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  return (
    <section className="page placeholder-page">
      <PageHeader title={title} description={body} />
      <div className="placeholder-panel">
        <EmptyState title={emptyTitle ?? title} body={emptyBody ?? body} />
      </div>
    </section>
  );
}

function EmptyState({ title, body, actions }: { title: string; body: string; actions?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{body}</span>
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}

function ToastMessage({ toast }: { toast: Toast }) {
  const Icon = toast.kind === "success" ? Check : toast.kind === "error" ? X : toast.kind === "warning" ? AlertTriangle : Info;
  return (
    <div
      className={`toast ${toast.kind}`}
      role="status"
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="toast-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="toast-copy">{toast.message}</span>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  primaryLabel,
  secondaryLabel,
  children,
  tone = "info",
  objectName,
  calloutTitle,
  calloutBody,
  onConfirm,
  onCancel
}: {
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  children?: React.ReactNode;
  tone?: ConfirmTone;
  objectName?: string;
  calloutTitle?: string;
  calloutBody?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => cancelRef.current?.focus());
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      trapModalFocus(event, modalRef.current);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const primaryClass = tone === "danger" ? "secondary-button danger" : "primary-button";
  const hasDetail = Boolean(calloutTitle || calloutBody || children);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        ref={modalRef}
        className={`form-modal confirm-modal ${tone} ${hasDetail ? "has-detail" : ""}`.trim()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="confirm-modal-lead">
          <span className={`confirm-modal-emblem ${tone}`.trim()} aria-hidden="true">
            {tone === "danger" ? <AlertTriangle size={18} /> : <FileText size={18} />}
          </span>
          <div className="confirm-modal-copy">
            <header className="confirm-modal-header">
              <h2>{title}</h2>
              {objectName && <p className="modal-object-name">{objectName}</p>}
            </header>
            <div className="confirm-modal-body">
              <p className="confirm-body">{body}</p>
            </div>
          </div>
        </div>
        {hasDetail && (
          <div className="confirm-modal-content">
            {(calloutTitle || calloutBody) && (
              <div className={`confirm-callout ${tone}`.trim()}>
                {tone === "danger" ? <AlertTriangle size={17} /> : <FileText size={17} />}
                <div>
                  {calloutTitle && <strong>{calloutTitle}</strong>}
                  {calloutBody && <span>{calloutBody}</span>}
                </div>
              </div>
            )}
            {children}
          </div>
        )}
        <footer className="modal-actions">
          <button className="secondary-button" type="button" ref={cancelRef} onClick={onCancel}>
            {secondaryLabel}
          </button>
          <button className={primaryClass} type="button" onClick={onConfirm}>
            {primaryLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function DeleteImpactList({
  heading,
  rows
}: {
  heading: string;
  rows: Array<[label: string, value: number]>;
}) {
  return (
    <div className="delete-impact">
      <strong>{heading}</strong>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FormModal({
  title,
  primaryLabel,
  description,
  children,
  onClose,
  onSubmit,
  t
}: {
  title: string;
  primaryLabel: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  t: Translator;
}) {
  const modalRef = useRef<HTMLFormElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      trapModalFocus(event, modalRef.current);
    };
    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      const firstField = getFocusableElements(modalRef.current).find((element) => !element.classList.contains("icon-button"));
      firstField?.focus();
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form ref={modalRef} className="form-modal" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {description && <p className="modal-description">{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("close")}>
            <X size={18} />
          </button>
        </header>
        <div className="form-stack">{children}</div>
        <footer className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="primary-button" type="submit">
            <Plus size={17} />
            {primaryLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

export default App;
