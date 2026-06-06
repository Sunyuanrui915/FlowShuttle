import {
  Archive,
  AlertTriangle,
  BookOpenText,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Clipboard,
  FileDown,
  FileText,
  Folder,
  FolderCog,
  FolderOpen,
  HardDrive,
  RefreshCw,
  LayoutList,
  Monitor,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Sun,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { countTextMetricCharacters } from "../../shared/textMetrics";
import { createTranslator, languageOptions, type Translator } from "./i18n";
import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";
import type {
  AiOperationResult,
  AiSaveSettingsInput,
  AiSettingsInfo,
  DailyAutoReportEvent,
  LanguagePreference,
  MarkdownPayload,
  Project,
  ProjectMemo,
  ProjectDeleteSummary,
  ProjectDetail,
  ProjectListItem,
  SearchResult,
  SettingsInfo,
  ThemePreference,
  DailyJournalView,
  DailyProjectGroup,
  DailyReportListItem,
  DailyWorkItemBlock,
  DailyWorkItemStatus,
  HeatmapDay,
  HeatmapMonth,
  PeriodReportType,
  PeriodReportListItem,
  WorkItemHistoryRecovery,
  WorkItemDeleteSummary,
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
  | "settings";
type ReportTab = "daily" | "weekly" | "monthly";
type ReportTimeFilter = "all" | "today" | "last7" | "last30" | "thisMonth" | "lastMonth";
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
  return { label: t("statusActive"), className: "active" };
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
  const missingSummaryBlocks = blocks.filter((block) => !block.entry?.today_progress?.trim());
  const blockerBlocks = blocks.filter((block) => block.entry?.blocker?.trim());
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

function markdownDiffBlocks(value: string): string[] {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push(paragraph.join(" ").replace(/\s+/g, " ").trim());
      paragraph = [];
    }
  };
  for (const rawLine of value.split(/\r?\n/)) {
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
  if (operation === "switched") {
    return t("dataDirectorySwitchSuccess");
  }
  if (operation === "unchanged") {
    return t("dataDirectoryUnchanged");
  }
  return t("dataDirectoryMigrateSuccess");
}

function compactToastMessage(message: string): string {
  const masked = message.replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***");
  const compact = masked.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function App() {
  const [view, setView] = useState<View>("today");
  const [dailyView, setDailyView] = useState<DailyJournalView | null>(null);
  const [dailyForms, setDailyForms] = useState<Record<string, DailyEntryForm>>({});
  const [dailyEditorTarget, setDailyEditorTarget] = useState<DailyEntryEditorTarget | null>(null);
  const [focusedWorkItemId, setFocusedWorkItemId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
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
  const [selectedHeatmapDate, setSelectedHeatmapDate] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
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
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newWorkItemOpen, setNewWorkItemOpen] = useState(false);
  const [quickProjectOpen, setQuickProjectOpen] = useState(false);
  const [quickWorkItemOpen, setQuickWorkItemOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfo | null>(null);
  const [isMigratingData, setIsMigratingData] = useState(false);
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
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const currentEditorSaveRef = useRef<(options?: EditorSaveOptions) => Promise<boolean>>(async () => false);
  const saveInFlightRef = useRef(false);
  const language = settingsInfo?.language ?? "zh-CN";
  const effectiveTheme = settingsInfo?.effectiveTheme ?? "light";
  const t = useMemo(() => createTranslator(language), [language]);

  const showToast = (toastValue: Toast) => {
    setToast({ ...toastValue, message: compactToastMessage(toastValue.message) });
    window.setTimeout(() => setToast(null), 2600);
  };

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

  const loadToday = async () => {
    const nextDailyView = await window.workJournal.daily.getTodayJournal();
    setDailyView(nextDailyView);
    void loadTodayHeatmap(nextDailyView.journalDate);
    setDailyForms(() => {
      const next: Record<string, DailyEntryForm> = {};
      for (const group of nextDailyView.groups) {
        for (const block of group.items) {
          next[block.workItem.id] = {
            workItemNoteContent: block.workItemNote.content_markdown ?? "",
            todayProgress: block.entry?.today_progress ?? "",
            nextStep: block.entry ? block.entry.next_step ?? "" : block.previousEntry?.next_step ?? "",
            blocker: block.entry ? block.entry.blocker ?? "" : block.previousEntry?.blocker ?? "",
            statusForToday: block.entry?.status_for_today ?? "in_progress"
          };
        }
      }
      return next;
    });
  };

  const loadProjects = async () => {
    setProjects(await window.workJournal.projects.listActive());
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
    setDetail(await window.workJournal.projects.getDetail(id));
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

  const refreshActiveView = async () => {
    await Promise.all([loadToday(), loadProjects(), loadReports(), loadHeatmap()]);
    if (selectedProjectId) {
      await loadDetail(selectedProjectId);
    }
  };

  useEffect(() => {
    refreshActiveView().catch((error) =>
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
    return () => {
      unsubscribe();
      unsubscribeAutoReport();
    };
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    loadDetail(selectedProjectId).catch((error) =>
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectLoadFailed") })
    );
  }, [selectedProjectId]);

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
        .then(setSearchResults)
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

  const openProjectDetail = (projectId: string) => {
    setSelectedProjectId(projectId);
    setDetailQuickCollapsed(true);
    setView("project-detail");
  };

  const openProjectMemo = async (projectId: string, returnView: "today" | "project-detail" = "project-detail") => {
    try {
      const [nextDetail, memo] = await Promise.all([
        window.workJournal.projects.getDetail(projectId),
        window.workJournal.memos.getProjectMemo(projectId)
      ]);
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

  const openDailyEntryEditor = (projectId: string, workItemId: string, journalDate = dailyView?.journalDate ?? getLocalDateKey()) => {
    setDailyEditorTarget({
      journalDate,
      projectId,
      workItemId
    });
    setFocusedWorkItemId(workItemId);
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
      await refreshActiveView();
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
      setSelectedProjectId(null);
      setDetail(null);
      await refreshActiveView();
      showToast({ kind: "success", message: t("projectArchiveSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectArchiveFailed") });
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
      setSelectedProjectId(null);
      setDetail(null);
      setProjectMemo(null);
      setProjectMemoContent("");
      setView("projects");
      setSearchTerm("");
      setSearchResults([]);
      await Promise.all([loadToday(), loadProjects()]);
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
    try {
      await window.workJournal.workItems.create({
        projectId: detail.project.id,
        title: workItemForm.title,
        description: workItemForm.description
      });
      setWorkItemForm({ title: "", description: "" });
      setNewWorkItemOpen(false);
      await refreshActiveView();
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
    try {
      const workItem = await window.workJournal.workItems.create({
        projectId: quickForm.projectId,
        title: quickWorkItemForm.title,
        description: quickWorkItemForm.description
      });
      setQuickWorkItemForm({ title: "", description: "" });
      setQuickWorkItemOpen(false);
      setQuickForm((current) => ({
        ...current,
        workItemId: workItem.id
      }));
      await refreshActiveView();
      showToast({ kind: "success", message: t("workItemCreateSelectedSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("workItemCreateFailed") });
    }
  };

  const handleCompleteWorkItem = async (id: string) => {
    try {
      await window.workJournal.workItems.complete(id);
      await refreshActiveView();
      showToast({ kind: "success", message: t("workItemCompleteSuccess") });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : t("workItemCompleteFailed") });
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
    try {
      await window.workJournal.workItems.delete(workItemDeleteTarget.item.id);
      setWorkItemDeleteTarget(null);
      setSearchTerm("");
      setSearchResults([]);
      await refreshActiveView();
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
    try {
      await window.workJournal.daily.upsertWorkItemEntry({
        journalDate: dailyView?.journalDate ?? "",
        projectId: quickForm.projectId,
        workItemId: quickForm.workItemId,
        todayProgress: quickForm.content,
        nextStep: quickForm.nextStep,
        blocker: quickForm.blocker,
        statusForToday: "in_progress"
      });
      setQuickForm((current) => ({
        ...current,
        content: "",
        nextStep: "",
        blocker: ""
      }));
      await refreshActiveView();
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
    dailyForms[block.workItem.id] ?? {
      workItemNoteContent: block.workItemNote.content_markdown ?? "",
      todayProgress: block.entry?.today_progress ?? "",
      nextStep: block.entry ? block.entry.next_step ?? "" : block.previousEntry?.next_step ?? "",
      blocker: block.entry ? block.entry.blocker ?? "" : block.previousEntry?.blocker ?? "",
      statusForToday: block.entry?.status_for_today ?? "in_progress"
    };

  const saveDailyEntryBlock = async (block: DailyWorkItemBlock, options: EditorSaveOptions = {}): Promise<boolean> => {
    if (!dailyView) {
      return false;
    }
    const form = getDailyFormForBlock(block);
    const dailyFieldsEmpty =
      !form.todayProgress.trim() &&
      !form.nextStep.trim() &&
      !form.blocker.trim() &&
      form.statusForToday === "in_progress";
    const noteChanged = form.workItemNoteContent !== (block.workItemNote.content_markdown ?? "");
    if (dailyFieldsEmpty && !form.workItemNoteContent.trim() && !noteChanged) {
      if (!options.skipEmpty) {
        showToast({ kind: "error", message: t("fillProgressRequired") });
      }
      return false;
    }
    if (
      options.skipUnchanged &&
      form.todayProgress === (block.entry?.today_progress ?? "") &&
      form.nextStep === (block.entry?.next_step ?? "") &&
      form.blocker === (block.entry?.blocker ?? "") &&
      form.statusForToday === (block.entry?.status_for_today ?? "in_progress") &&
      form.workItemNoteContent === (block.workItemNote.content_markdown ?? "")
    ) {
      return false;
    }
    try {
      await window.workJournal.daily.upsertWorkItemEntry({
        journalDate: dailyView.journalDate,
        projectId: block.project.id,
        workItemId: block.workItem.id,
        todayProgress: form.todayProgress,
        nextStep: form.nextStep,
        blocker: form.blocker,
        statusForToday: form.statusForToday,
        workItemNoteContentMarkdown: form.workItemNoteContent
      });
      if (options.refresh ?? true) {
        await refreshActiveView();
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
      setView("today");
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
    await Promise.all([refreshActiveView(), loadSettings()]);
    if (view === "project-memo" && selectedProjectId) {
      const memo = await window.workJournal.memos.getProjectMemo(selectedProjectId);
      setProjectMemo(memo);
      setProjectMemoContent(memo.content_markdown ?? "");
    }
    setSearchTerm("");
    setSearchResults([]);
  };

  const handleMigrateDataDirectory = async () => {
    const confirmed = await requestConfirm({
      title: t("dataDirectoryChangeConfirmTitle"),
      body: t("dataDirectoryChangeConfirmBody"),
      primaryLabel: t("migrateDataDirectory"),
      tone: "warning",
      calloutBody: t("dataDirectoryChangeConfirmNote")
    });
    if (!confirmed) {
      return;
    }
    setIsMigratingData(true);
    setSettingsBusyAction("migrate");
    setSettingsMessage(null);
    try {
      const result = await window.workJournal.settings.chooseAndMigrateDataDirectory();
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
      const message = error instanceof Error ? error.message : t("dataDirectoryMigrateFailed");
      setSettingsMessage({ kind: "error", message });
      showToast({ kind: "error", message });
    } finally {
      setIsMigratingData(false);
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
    if (result.type === "project_memo" && result.projectId) {
      openProjectMemo(result.projectId);
      return;
    }
    if (result.type === "work_item_note" && result.projectId && result.workItemId) {
      window.workJournal.projects
        .getDetail(result.projectId)
        .then((nextDetail) => {
          setSelectedProjectId(result.projectId);
          setDetail(nextDetail);
          openDailyEntryEditor(result.projectId as string, result.workItemId as string);
        })
        .catch((error) =>
          showToast({ kind: "error", message: error instanceof Error ? error.message : t("projectLoadFailed") })
        );
      setSearchTerm("");
      setSearchResults([]);
      return;
    }
    if (
      result.type === "daily_entry" &&
      result.projectId &&
      result.workItemId &&
      result.entryDate === dailyView?.journalDate
    ) {
      openDailyEntryEditor(result.projectId, result.workItemId, result.entryDate);
      setSearchTerm("");
      setSearchResults([]);
      return;
    }
    if (result.workItemId) {
      setFocusedWorkItemId(result.workItemId);
    }
    if (result.projectId) {
      openProjectDetail(result.projectId);
    } else {
      setView("today");
    }
    setSearchTerm("");
    setSearchResults([]);
  };

  const navItems = [
    { id: "today" as View, label: t("navToday"), icon: CalendarDays },
    { id: "projects" as View, label: t("navProjects"), icon: Folder },
    { id: "reports" as View, label: t("navReports"), icon: FileText },
    { id: "heatmap" as View, label: t("navHeatmap"), icon: LayoutList },
    { id: "archive" as View, label: t("navArchive"), icon: Archive },
    { id: "settings" as View, label: t("navSettings"), icon: Settings }
  ];
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
      if (!dailyEditorBlock || dailyView?.journal.status === "closed") {
        return false;
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
    <div className={appShellClassName}>
      <aside className="sidebar">
        <div className="brand">
          <BookOpenText size={22} />
          <span>{t("appName")}</span>
        </div>
        <nav className="side-nav" aria-label={t("navAria")}>
          {navItems.map((item) => (
            <button
              className={`nav-item ${
                view === item.id ||
                (view === "daily-entry-editor" && item.id === "today") ||
                (view === "project-memo" && item.id === "projects")
                  ? "active"
                  : ""
              }`}
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === "today") {
                  loadToday().catch((error) =>
                    showToast({ kind: "error", message: error instanceof Error ? error.message : t("loadFailed") })
                  );
                }
                setView(item.id);
              }}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="storage-note">
          <span className={`dot ${currentStorageDisplay.isWarning ? "warning" : ""}`} />
          <span className="storage-status">
            {t("storageLocal")} · {currentStorageDisplay.detail}
          </span>
        </div>
      </aside>

      <main className={`workspace ${view === "daily-entry-editor" || view === "project-memo" ? "workspace-focus" : ""}`}>
        {view === "today" && dailyView && (
          <TodayPage
            dailyView={dailyView}
            heatmapData={todayHeatmapData}
            heatmapFailed={todayHeatmapFailed}
            language={language}
            t={t}
            searchTerm={searchTerm}
            searchResults={searchResults}
            isSearching={isSearching}
            onSearchTermChange={setSearchTerm}
            onSearchResult={handleSearchResult}
            onGenerateMarkdown={handleGenerateMarkdown}
            collapsedGroups={collapsedGroups}
            setCollapsedGroups={setCollapsedGroups}
            focusedWorkItemId={focusedWorkItemId}
            onClearFocus={() => setFocusedWorkItemId(null)}
            onOpenEntryEditor={openDailyEntryEditor}
            onReopen={handleReopenToday}
            onOpenProject={openProjectDetail}
            onOpenMemo={(projectId) => openProjectMemo(projectId, "today")}
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
              onBack={() => setView("today")}
              onUpdate={(patch) => updateDailyForm(dailyEditorBlock.workItem.id, patch)}
              onSave={() => handleSaveDailyEntry(dailyEditorBlock)}
              onSaveAndReturn={() => handleSaveDailyEntryAndReturn(dailyEditorBlock)}
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
            aiSettings={settingsInfo?.ai ?? null}
            onCopy={copyMarkdownPayload}
            onExport={exportMarkdownPayload}
            onReportsChanged={loadReports}
            onToast={showToast}
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
        {view === "project-detail" && detail && (
          <ProjectDetailPage
            detail={detail}
            language={language}
            t={t}
            onBack={() => setView("projects")}
            onRecordProgress={openDailyEntryEditor}
            onComplete={handleCompleteWorkItem}
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
            projects={projects.filter((project) => project.status === "archived")}
            language={language}
            t={t}
            onOpenProject={openProjectDetail}
          />
        )}
        {view === "settings" && settingsInfo && (
          <SettingsPage
            settings={settingsInfo}
            t={t}
            message={settingsMessage}
            isMigrating={isMigratingData}
            busyAction={settingsBusyAction}
            onSetTheme={handleSetTheme}
            onSetLanguage={handleSetLanguage}
            onOpenDataDirectory={handleOpenDataDirectory}
            onMigrateDataDirectory={handleMigrateDataDirectory}
            onReloadDataDirectory={handleReloadDataDirectory}
            onSaveAiSettings={handleSaveAiSettings}
            onClearAiKey={handleClearAiKey}
            onTestAiConnection={handleTestAiConnection}
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
          t={t}
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
          t={t}
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
          t={t}
          onCancel={() => resolveConfirm(false)}
          onConfirm={() => resolveConfirm(true)}
        />
      )}

      {toast && <ToastMessage toast={toast} />}
    </div>
  );
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
  return (
    <div className="search-wrap">
      <Search size={18} />
      <input
        value={term}
        onChange={(event) => onTermChange(event.target.value)}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchAria")}
      />
      <span className="shortcut">Ctrl+F</span>
      {term.trim() && (
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
                  {result.type === "daily_entry"
                    ? t("searchKindDailyEntry")
                    : result.type === "daily_report"
                      ? t("searchKindDailyReport")
                      : result.type === "project_memo"
                        ? t("searchKindProjectMemo")
                      : result.type === "work_item_note"
                        ? t("searchKindWorkItemNote")
                      : result.type === "progress"
                    ? t("searchKindProgress")
                    : result.type === "work_item"
                      ? t("searchKindWorkItem")
                      : t("searchKindProject")}
                </span>
                <span className="result-title">{result.title}</span>
                <span className="result-context">
                  {result.entryDate ? `${result.entryDate} · ` : ""}
                  {result.projectName ?? t("todayWorkPageTitle")}
                  {result.workItemTitle ? ` / ${result.workItemTitle}` : ""}
                </span>
                <span className="result-snippet">
                  {searchFieldLabel(result.matchedField, t)}
                  {t("searchMatchedSeparator")}
                  {result.snippet}
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
  children
}: {
  as?: TooltipTag;
  content?: string | null;
  className?: string;
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
    if (!text || !hasTruncatedContent(element)) {
      setPosition(null);
      return;
    }

    const margin = 16;
    const maxWidth = Math.min(560, window.innerWidth - margin * 2);
    const rect = element.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left, margin), window.innerWidth - maxWidth - margin);
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
      tabIndex={text ? 0 : undefined}
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
      {text && position && (
        <span ref={tooltipRef} className={`floating-tooltip ${position.placement}`} role="tooltip" style={tooltipStyle}>
          {text}
        </span>
      )}
    </Tag>
  );
}

function ReadableMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const elements: ReactNode[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

  const flushCodeBlock = (key: string) => {
    elements.push(
      <pre className="readable-markdown-code" key={key}>
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
    codeLines = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock(`code-${index}`);
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLines = [];
      }
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    if (!trimmed) {
      elements.push(<div className="readable-markdown-space" key={`space-${index}`} />);
      return;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      if (heading[1].length === 1) {
        elements.push(<h2 key={`heading-${index}`}>{heading[2]}</h2>);
      } else if (heading[1].length === 2) {
        elements.push(<h3 key={`heading-${index}`}>{heading[2]}</h3>);
      } else {
        elements.push(<h4 key={`heading-${index}`}>{heading[2]}</h4>);
      }
      return;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (unordered) {
      elements.push(
        <p className="readable-markdown-list-line" key={`list-${index}`}>
          <span aria-hidden="true">•</span>
          <span>{unordered[1]}</span>
        </p>
      );
      return;
    }

    const ordered = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      elements.push(
        <p className="readable-markdown-list-line" key={`ordered-${index}`}>
          <span>{ordered[1]}.</span>
          <span>{ordered[2]}</span>
        </p>
      );
      return;
    }

    elements.push(
      <p className="readable-markdown-paragraph" key={`paragraph-${index}`}>
        {line}
      </p>
    );
  });

  if (inCodeBlock || codeLines.length > 0) {
    flushCodeBlock("code-end");
  }

  return (
    <div className="readable-markdown-preview">
      {elements.length > 0 ? elements : <p className="readable-markdown-paragraph">{content}</p>}
    </div>
  );
}

function TodayPage({
  dailyView,
  heatmapData,
  heatmapFailed,
  language,
  t,
  searchTerm,
  searchResults,
  isSearching,
  onSearchTermChange,
  onSearchResult,
  onGenerateMarkdown,
  collapsedGroups,
  setCollapsedGroups,
  focusedWorkItemId,
  onClearFocus,
  onOpenEntryEditor,
  onReopen,
  onOpenProject,
  onOpenMemo
}: {
  dailyView: DailyJournalView;
  heatmapData: HeatmapMonth | null;
  heatmapFailed: boolean;
  language: LanguagePreference;
  t: Translator;
  searchTerm: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  onSearchTermChange: (term: string) => void;
  onSearchResult: (result: SearchResult) => void;
  onGenerateMarkdown: () => void;
  collapsedGroups: Record<string, boolean>;
  setCollapsedGroups: (value: Record<string, boolean>) => void;
  focusedWorkItemId: string | null;
  onClearFocus: () => void;
  onOpenEntryEditor: (projectId: string, workItemId: string, journalDate?: string) => void;
  onReopen: () => void;
  onOpenProject: (id: string) => void;
  onOpenMemo: (projectId: string) => void;
}) {
  useEffect(() => {
    if (!focusedWorkItemId) {
      return;
    }
    const handle = window.setTimeout(() => {
      const element = document.querySelector(`[data-work-item-id="${focusedWorkItemId}"]`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      onClearFocus();
    }, 80);
    return () => window.clearTimeout(handle);
  }, [focusedWorkItemId, onClearFocus]);

  const isClosed = dailyView.journal.status === "closed";
  const isLocalToday = dailyView.journalDate === getLocalDateKey();
  const openBlockEditor = (block: DailyWorkItemBlock) =>
    onOpenEntryEditor(block.project.id, block.workItem.id, dailyView.journalDate);

  return (
    <section className="page daily-page">
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
              <button className="primary-button" type="button" onClick={onGenerateMarkdown}>
                <FileText size={18} />
                {isClosed ? t("regenerateDailyReport") : t("endTodayWork")}
              </button>
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

      <div className="today-workspace">
        <div className="today-main-column">
          <div className="stats-grid today-stats-grid">
            <StatCard label={t("statsActiveProjects")} value={dailyView.stats.activeProjects} suffix={t("unitCount")} icon={FolderOpen} tone="blue" />
            <StatCard label={t("statsDailyWorkItems")} value={dailyView.stats.workItems} suffix={t("unitCount")} icon={LayoutList} tone="amber" />
            <StatCard label={t("statsDailyEntries")} value={dailyView.stats.filledEntries} suffix={t("unitEntry")} icon={FileText} tone="green" />
            <StatCard label={t("statsCompletedToday")} value={dailyView.stats.completedToday} suffix={t("unitCount")} icon={Check} tone="green" />
          </div>

          {isClosed && (
            <div className="closed-banner">
              <Check size={18} />
              <div>
                <strong>{t("dailyJournalClosedTitle")}</strong>
                <span>{t("dailyJournalClosedBody")}</span>
              </div>
            </div>
          )}

          <section className="today-projects-panel">
            <header className="today-section-header">
              <div>
                <h2>{t("todayProjectsTitle")}</h2>
                <p>{t("todayProjectsSubtitle")}</p>
              </div>
            </header>
            <div className="project-groups">
              {dailyView.groups.length === 0 ? (
                <EmptyState title={t("todayEmptyTitle")} body={t("todayEmptyBody")} />
              ) : (
                dailyView.groups.map((group) => (
                  <DailyGroupCard
                    key={group.project.id}
                    group={group}
                    collapsed={Boolean(collapsedGroups[group.project.id])}
                    onToggle={() =>
                      setCollapsedGroups({
                        ...collapsedGroups,
                        [group.project.id]: !collapsedGroups[group.project.id]
                      })
                    }
                    onOpenEntryEditor={openBlockEditor}
                    onOpenProject={onOpenProject}
                    onOpenMemo={onOpenMemo}
                    t={t}
                    language={language}
                  />
                ))
              )}
            </div>
          </section>
        </div>

        <TodaySidebar
          dailyView={dailyView}
          heatmapData={heatmapData}
          heatmapFailed={heatmapFailed}
          t={t}
          language={language}
          onOpenEntryEditor={openBlockEditor}
        />
      </div>
    </section>
  );
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
          const blockCount = dayActivity?.blockCount ?? 0;
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
              <span className="today-mini-day-blocks" aria-hidden="true">
                {Array.from({ length: HEATMAP_BLOCK_LIMIT }, (_, blockIndex) => (
                  <i
                    className={[
                      "today-mini-day-block",
                      blockIndex < blockCount ? "active" : "empty",
                      blockIndex < blockCount ? `heatmap-display-level-${level}` : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={blockIndex}
                  />
                ))}
              </span>
            </span>
          );
        })}
      </div>

      <div className="today-mini-legend" aria-label={t("heatmapLegend")}>
        <span>{t("heatmapLess")}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i
            key={level}
            className={level > 0 ? `heatmap-display-level-${level}` : ""}
            aria-hidden="true"
          />
        ))}
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
  const missingSummaryCount = blocks.filter((block) => !block.entry?.today_progress?.trim()).length;
  const blockerCount = blocks.filter((block) => block.entry?.blocker?.trim()).length;
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
        <BookOpenText size={16} />
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
  const blockerText = entry?.blocker?.trim();
  const itemStatus = workItemRowStatus(block, t);
  const previousText =
    block.previousEntry?.today_progress?.trim() ||
    block.previousEntry?.next_step?.trim() ||
    block.workItem.description?.trim() ||
    t("noPreviousWorkdayReference");
  const hintLabel = progressText ? t("todayEntrySummary") : t("previousWorkdayReference");
  const hintText = progressText || previousText;
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
      <div className="daily-entry-row-icon">
        <FileText size={17} />
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
        <span className={`row-status-chip ${progressText ? "filled" : "unfilled"}`}>
          <SquarePen size={14} />
          {progressText ? t("summaryFilled") : t("summaryMissing")}
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
  onSaveAndReturn,
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
  onSaveAndReturn: () => void;
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
  const isDrafting = draftingMode !== null;
  const canGenerateAiDraft = Boolean(aiSettings?.enabled && aiSettings.apiKeyConfigured && aiSettings.baseUrl && aiSettings.model);
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
    [t("dateLabel"), previousEntry ? block.previousWorkDate : null, false],
    [t("workItemPreviousContent"), previousNoteContent, true],
    [t("changeSummary"), previousEntry?.today_progress, true],
    [t("nextStepPlan"), previousEntry?.next_step, true],
    [t("blockerHelp"), previousEntry?.blocker, true]
  ] as Array<[string, string | null | undefined, boolean]>;
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
    const text = value?.trim();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
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
    onUpdate({ todayProgress: draft });
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
      <PageHeader
        className="entry-page-header"
        eyebrow={block.project.name}
        title={block.workItem.title}
        description={block.workItem.description || t("none")}
        meta={`${t("lastSaved")}: ${formatTimestamp(block.entry?.updated_at ?? null, language, t)}`}
        backAction={{ label: t("backToTodayWorkPage"), onClick: onBack }}
        actions={
          <div className="entry-header-actions">
            <label className="daily-status-select entry-status-control">
              <span>{t("todayStatus")}</span>
              <select
                value={form.statusForToday}
                onChange={(event) => onUpdate({ statusForToday: event.target.value as DailyWorkItemStatus })}
                disabled={isClosed}
              >
                <option value="in_progress">{t("statusContinue")}</option>
                <option value="done_today">{t("statusDoneToday")}</option>
                <option value="paused">{t("statusPaused")}</option>
              </select>
            </label>
            <div className="button-row entry-save-actions">
              <button className="secondary-button" type="button" onClick={onSave} disabled={isClosed}>
                <Save size={17} />
                {t("saveThisItem")}
              </button>
              <button className="primary-button" type="button" onClick={onSaveAndReturn} disabled={isClosed}>
                <Save size={17} />
                {t("saveAndReturn")}
              </button>
            </div>
          </div>
        }
      />

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
        {referenceSidebarCollapsed ? (
          <aside className="reference-rail" aria-label={t("previousWorkdayReference")}>
            <button
              className="reference-rail-button"
              type="button"
              aria-label={t("expandReferenceSidebar")}
              aria-expanded={false}
              onClick={() => setReferenceSidebarCollapsed(false)}
            >
              <ChevronRight size={17} />
              <span>{t("previousWorkdayReference")}</span>
            </button>
          </aside>
        ) : (
          <aside className="reference-panel-card expanded">
            <div className="reference-compact-row">
              <div className="reference-compact-main">
                <div className="reference-card-heading">
                  <div className="reference-heading-row">
                    <strong>{t("previousWorkdayReference")}</strong>
                    <button
                      className="icon-button reference-sidebar-toggle"
                      type="button"
                      aria-label={t("collapseReferenceSidebar")}
                      aria-expanded={true}
                      onClick={() => setReferenceSidebarCollapsed(true)}
                    >
                      <ChevronLeft size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="reference-detail-scroll">
              <dl className="previous-reference-list">
                {previousRows.map(([label, value, canCopy]) => {
                  const referenceText = value?.trim();
                  return (
                    <div key={label}>
                      <dt>
                        <span>{label}</span>
                        {canCopy && referenceText && (
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
                      <dd>{referenceText || t("none")}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </aside>
        )}

        <section className="entry-editor-switcher editor-workspace">
        <div
          className="editor-tabs primary-editor-tabs"
          role="tablist"
          aria-label={t("dailyEditorTitle")}
          onKeyDown={(event) => handleSegmentedKeyDown(event, primaryEditorSectionIds, activePrimarySection, setActivePrimarySection)}
        >
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
            <label className="daily-field editor-note-field">
              <span className="sr-only">{t("workItemCurrentContent")}</span>
              <MarkdownWysiwygEditor
                value={form.workItemNoteContent}
                language={language}
                theme={theme}
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
            </label>
          </section>
        ) : (
          <section className="entry-editor-form">
            <div className="daily-editor-header">
              <div>
                <span>{t("dailyEditorTitle")}</span>
                {savingImageTarget === "daily" && <em>{t("memoSavingImage")}</em>}
              </div>
            </div>
            <div className="change-draft-actions" role="group" aria-label={t("changeSummaryGenerationActions")}>
              <button
                className="change-draft-card local-draft-action"
                type="button"
                onClick={handleGenerateLocalChangeDraft}
                disabled={isClosed || isDrafting}
              >
                <span className="change-draft-icon">
                  <FileText size={18} />
                </span>
                <span className="change-draft-copy">
                  <strong>{draftingMode === "local" ? t("changeDraftGenerating") : t("generateLocalChangeSummary")}</strong>
                  <small>{t("generateLocalChangeSummaryHelp")}</small>
                </span>
              </button>
              <button
                className="change-draft-card ai-draft-action"
                type="button"
                onClick={handleGenerateAiChangeDraft}
                disabled={isClosed || isDrafting}
              >
                <span className="change-draft-icon">
                  <Sparkles size={18} />
                </span>
                <span className="change-draft-copy">
                  <strong>{draftingMode === "ai" ? t("changeDraftGenerating") : t("generateAiChangeSummary")}</strong>
                  <small>{canGenerateAiDraft ? t("generateAiChangeSummaryHelp") : t("aiDraftUnavailableHint")}</small>
                </span>
              </button>
            </div>
            <div
              className="editor-tabs"
              role="tablist"
              aria-label={t("dailyEditorTitle")}
              onKeyDown={(event) => handleSegmentedKeyDown(event, editorSectionIds, activeSection, setActiveSection)}
            >
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
            <label className="daily-field editor-note-field">
              {activeEditor.label}
              <MarkdownWysiwygEditor
                key={activeEditor.id}
                value={activeEditor.value}
                language={language}
                theme={theme}
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
            </label>
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
  onRecordProgress,
  onComplete,
  onDelete,
  t
}: {
  item: WorkItemWithLatest;
  mode: "today" | "detail";
  compact?: boolean;
  language: LanguagePreference;
  onRecordProgress: () => void;
  onComplete?: () => void;
  onDelete?: () => void;
  t: Translator;
}) {
  const recentRecord = summary(item.latest_content || item.latest_next_step || item.description, t);
  const updatedAt = formatTimestamp(item.latest_created_at ?? item.updated_at, language, t);

  return (
    <article className={`work-item-row ${item.status === "done" ? "done" : ""} ${compact ? "compact" : ""}`.trim()}>
      <button
        className="check-button"
        type="button"
        onClick={onComplete}
        disabled={item.status === "done" || !onComplete}
        aria-label={t("completeAria")}
      >
        {item.status === "done" && <Check size={15} />}
      </button>
      <HoverTooltip as="div" className="work-item-title-cell" content={[item.title, item.description].filter(Boolean).join("\n")}>
        <strong>{item.title}</strong>
        {item.description && <p className="description">{item.description}</p>}
      </HoverTooltip>
      {mode === "detail" && <span className="work-item-status-pill">{item.status === "done" ? t("statusDone") : t("statusActive")}</span>}
      <HoverTooltip as="div" className="work-item-recent-wrap" content={recentRecord}>
        <p className="work-item-recent">{recentRecord}</p>
      </HoverTooltip>
      <time className="work-item-updated">{updatedAt}</time>
      <div className="work-item-actions">
        <button className="text-button" type="button" onClick={onRecordProgress}>
          {t("recordProgress")}
        </button>
        {onDelete && (
          <button
            className="ghost-button danger-ghost work-item-delete-button"
            type="button"
            aria-label={t("deleteWorkItem")}
            onClick={onDelete}
          >
            <Trash2 size={14} />
            {t("deleteWorkItem")}
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
  onOpenProject
}: {
  projects: ProjectListItem[];
  language: LanguagePreference;
  t: Translator;
  onCreateProject: () => void;
  onOpenProject: (id: string) => void;
}) {
  return (
    <section className="page">
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
          projects.map((project) => {
            const description = project.description?.trim();
            return (
              <button
                className="project-list-card"
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project.id)}
              >
                <header className="project-list-card-header">
                  <span className="project-list-card-icon" aria-hidden="true">
                    <FolderOpen size={20} />
                  </span>
                  <span className="project-list-card-title-block">
                    <span className="project-list-card-title">{project.name}</span>
                    <span className={`project-list-status ${project.status}`}>
                      {project.status === "archived" ? t("statusArchived") : t("statusActive")}
                    </span>
                  </span>
                </header>

                <p className={`project-list-description ${description ? "" : "empty"}`.trim()}>
                  {description || t("noProjectDescription")}
                </p>

                <footer className="project-list-card-footer">
                  <span>
                    {t("activeCountPrefix")} <strong>{project.active_item_count}</strong> {t("unitCount")}
                  </span>
                  <span>
                    {t("updatedPrefix")} <strong>{formatTimestamp(project.updated_at, language, t)}</strong>
                  </span>
                </footer>

                <span className="project-list-card-enter">
                  {t("viewProject")}
                  <ChevronRight size={15} />
                </span>
              </button>
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
                <header className="project-list-card-header">
                  <span className="project-list-card-icon archive-project-card-icon" aria-hidden="true">
                    <Archive size={19} />
                  </span>
                  <span className="project-list-card-title-block">
                    <span className="project-list-card-title">{project.name}</span>
                    <span className="project-list-status archived">{t("statusArchived")}</span>
                  </span>
                </header>

                {description ? <p className="project-list-description">{description}</p> : null}

                <footer className="project-list-card-footer">
                  <span>
                    {t("activeCountPrefix")} <strong>{project.active_item_count}</strong> {t("unitCount")}
                  </span>
                  <span>
                    {t("updatedPrefix")} <strong>{formatTimestamp(project.archived_at ?? project.updated_at, language, t)}</strong>
                  </span>
                </footer>

                <span className="project-list-card-enter">
                  {t("viewProject")}
                  <ChevronRight size={15} />
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
  aiSettings,
  onCopy,
  onExport,
  onReportsChanged,
  onToast
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
  aiSettings: AiSettingsInfo | null;
  onCopy: (payload: MarkdownPayload) => void;
  onExport: (payload: MarkdownPayload) => void;
  onReportsChanged: () => Promise<void>;
  onToast: (toastValue: Toast) => void;
}) {
  const [activeTab, setActiveTab] = useState<ReportTab>("daily");
  const reportTabIds: ReportTab[] = ["daily", "weekly", "monthly"];
  const reportVersionIds: Array<"rule" | "ai"> = ["rule", "ai"];
  const [previewMode, setPreviewMode] = useState<"rule" | "ai">("rule");
  const [timeFilter, setTimeFilter] = useState<ReportTimeFilter>("all");
  const [reportQuery, setReportQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [refineTarget, setRefineTarget] = useState<ReportItem | null>(null);
  const [isRefining, setIsRefining] = useState(false);
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
  const normalizedQuery = reportQuery.trim().toLocaleLowerCase(localeFor(language));
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
  const baseFilteredItems = tabConfig.items.filter((report) => {
    const matchesTime = reportMatchesTimeFilter(report, timeFilter);
    if (!matchesTime) {
      return false;
    }
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
      .toLocaleLowerCase(localeFor(language));
    return searchText.includes(normalizedQuery);
  });
  const filteredItems = baseFilteredItems.filter((report) => reportMatchesProject(report, projectFilter));
  const projectFilterOptions = projectOptions.map((project) => ({
    id: project.id,
    name: project.name,
    count: baseFilteredItems.filter((report) => reportMatchesProject(report, project.id)).length
  }));
  const selectedReport = filteredItems.find((report) => report.id === tabConfig.selectedId) ?? filteredItems[0] ?? null;
  const hasAiVersion = Boolean(selectedReport?.reportKind !== "daily" && selectedReport?.aiRefinedMarkdown);
  const currentMarkdown =
    previewMode === "ai" && hasAiVersion && selectedReport?.aiRefinedMarkdown
      ? selectedReport.aiRefinedMarkdown
      : selectedReport?.markdown ?? "";
  const selectedPayload = selectedReport
    ? {
      date: selectedReport.date,
      markdown: currentMarkdown,
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
  const aiRefineButtonTitle = selectedReport?.reportKind === "daily"
    ? t("aiRefineDailyUnavailable")
    : selectedReport && !selectedReportCanUseAiRefine
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
        .replace("{filtered}", String(filteredItems.length))
        .replace("{total}", String(tabConfig.items.length))
    : t("reportFilterSummaryAll").replace("{count}", String(tabConfig.items.length));
  const emptyTitle = tabConfig.items.length === 0 ? tabConfig.emptyTitle : t("reportFilteredEmptyTitle");
  const emptyBody = tabConfig.items.length === 0 ? tabConfig.emptyBody : t("reportFilteredEmptyBody");
  const clearReportFilters = () => {
    setTimeFilter("all");
    setReportQuery("");
    setProjectFilter("all");
  };

  useEffect(() => {
    setPreviewMode("rule");
    setMessage(null);
  }, [activeTab, selectedReport?.id]);

  useEffect(() => {
    if (projectFilter !== "all" && !projects.some((project) => project.id === projectFilter)) {
      setProjectFilter("all");
    }
  }, [projectFilter, projects]);

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
      <PageHeader title={t("reportsTitle")} description={t("reportsSubtitle")} />

      <div className="reports-toolbar">
        <div
          className="report-tabs"
          role="tablist"
          aria-label={t("reportsTitle")}
          onKeyDown={(event) => handleSegmentedKeyDown(event, reportTabIds, activeTab, setActiveTab)}
        >
          <button
            data-tab-id="daily"
            className={activeTab === "daily" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === "daily"}
            tabIndex={activeTab === "daily" ? 0 : -1}
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
            onClick={() => setActiveTab("monthly")}
          >
            {t("monthlyReports")}
          </button>
        </div>
      </div>

      <div className="reports-layout">
        <aside className="reports-filter-panel" aria-label={t("reportFilters")}>
          <div className="reports-filter-header">
            <div className="reports-filter-title-row">
              <strong>{t("reportArchive")}</strong>
              <small>{filterSummary}</small>
            </div>
            {hasActiveFilters && (
              <div className="reports-filter-action-row">
                <button className="ghost-button reports-header-clear" type="button" onClick={clearReportFilters}>
                  {t("clearReportFilters")}
                </button>
              </div>
            )}
          </div>

          <label className="reports-search-field">
            <div className="reports-search-box">
              <Search size={16} />
              <input
                value={reportQuery}
                type="search"
                placeholder={t("reportsSearchPlaceholder")}
                onChange={(event) => setReportQuery(event.target.value)}
              />
              {reportQuery.trim() && (
                <button type="button" aria-label={t("clearReportFilters")} onClick={() => setReportQuery("")}>
                  <X size={15} />
                </button>
              )}
            </div>
          </label>

          <div className="reports-filter-section">
            <span>{t("reportTimeRange")}</span>
            <div className="reports-filter-options">
              {timeFilterOptions.map((option) => (
                <button
                  className={timeFilter === option.value ? "active" : ""}
                  key={option.value}
                  type="button"
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
                    onClick={() => setProjectFilter(project.id)}
                  >
                    <span>{project.name}</span>
                    <em>{project.count}</em>
                  </button>
                ))
              )}
            </div>
          </div>

        </aside>

        <section className="reports-list-panel">
          <header className="reports-list-header">
            <div>
              <span className="eyebrow">{t("reportArchiveList")}</span>
              <h2>{tabConfig.heading}</h2>
            </div>
            <small>{t("reportFilterCount").replace("{count}", String(filteredItems.length))}</small>
          </header>

          <div className="report-list">
            {filteredItems.length === 0 ? (
              <div className="reports-list-empty">
                <strong>{emptyTitle}</strong>
                <p>{emptyBody}</p>
              </div>
            ) : (
              filteredItems.map((report) => {
                const isSelected = selectedReport?.id === report.id;
                const preview = report.markdown.replace(/\s+/g, " ").trim();
                return (
                  <button
                    className={`report-list-item ${isSelected ? "active" : ""}`}
                    key={report.id}
                    type="button"
                    onClick={() => tabConfig.onSelect(report.id)}
                  >
                    <span className="report-kind-pill">{report.typeLabel}</span>
                    <strong>{report.title}</strong>
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
                    <p>{preview ? `${preview.slice(0, 120)}${preview.length > 120 ? "..." : ""}` : t("none")}</p>
                    {report.reportKind !== "daily" && report.aiIsStale && (
                      <small className="stale-badge">{t("aiReportStale")}</small>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="report-preview-panel">
          {selectedReport ? (
            <>
              <header className="report-preview-header">
                <div>
                  <span className="eyebrow">{selectedReport.typeLabel}</span>
                  <h2>{selectedReport.title}</h2>
                  <div className="report-preview-meta">
                    <span>{t("reportGeneratedAt")}{t("searchMatchedSeparator")}{selectedReport.meta}</span>
                    <span>{countCharacters(currentMarkdown)} {t("unitChar")}</span>
                  </div>
                  {selectedReport.reportKind !== "daily" && selectedReport.aiIsStale && (
                    <p className="report-stale-message">{t("aiReportStale")}</p>
                  )}
                </div>
                <div className="button-row">
                  <button
                    className="secondary-button"
                    type="button"
                    title={aiRefineButtonTitle}
                    aria-label={aiRefineButtonTitle ? `${t("aiRefine")}: ${aiRefineButtonTitle}` : t("aiRefine")}
                    aria-describedby={aiRefineDisabledReasonId}
                    onClick={() => handleRequestAiRefine(selectedReport)}
                    disabled={isRefining || selectedReport.reportKind === "daily" || !selectedReportCanUseAiRefine}
                  >
                    <Sparkles size={17} />
                    {isRefining ? t("aiRefining") : t("aiRefine")}
                  </button>
                  {aiRefineButtonTitle && (
                    <span id={aiRefineDisabledReasonId} className="sr-only">
                      {aiRefineButtonTitle}
                    </span>
                  )}
                  <button className="secondary-button" type="button" onClick={() => selectedPayload && onCopy(selectedPayload)}>
                    <Clipboard size={17} />
                    {t("copyMarkdown")}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => selectedPayload && onExport(selectedPayload)}>
                    <FileDown size={17} />
                    {exportButtonLabel}
                  </button>
                </div>
              </header>
              {message && <div className={`inline-message ${message.kind}`}>{message.message}</div>}
              {selectedReport.reportKind !== "daily" && hasAiVersion && (
                <div
                  className="report-version-toggle"
                  role="tablist"
                  aria-label={t("reportVersion")}
                  onKeyDown={(event) => handleSegmentedKeyDown(event, reportVersionIds, previewMode, setPreviewMode)}
                >
                  <button
                    data-tab-id="rule"
                    className={previewMode === "rule" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={previewMode === "rule"}
                    tabIndex={previewMode === "rule" ? 0 : -1}
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
                    onClick={() => setPreviewMode("ai")}
                  >
                    {t("aiRefinedVersion")}
                  </button>
                </div>
              )}
              <ReadableMarkdown content={currentMarkdown} />
            </>
          ) : (
            <EmptyState title={t("reportPreviewEmptyTitle")} body={t("reportPreviewEmptyBody")} />
          )}
        </section>
      </div>
      {refineTarget && (
        <ConfirmModal
          title={t("aiRefineConfirmTitle")}
          body={t("aiRefineConfirmBody")}
          primaryLabel={t("aiRefine")}
          secondaryLabel={t("cancel")}
          onConfirm={handleConfirmAiRefine}
          onCancel={() => setRefineTarget(null)}
          t={t}
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

const HEATMAP_BLOCK_LIMIT = 4;

interface HeatmapDisplayActivity {
  total: number;
  level: HeatmapDay["level"];
  updatedItemCount: number;
  blockCount: number;
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
      blockCount: 0,
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
    blockCount: Math.min(HEATMAP_BLOCK_LIMIT, updatedItemCount),
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
  const selectedReportTime = selectedDay?.closedAt ? `${t("todayTitle")} ${formatTimeDisplay(selectedDay.closedAt, language, t)}` : t("none");
  const overviewMetrics = [
    {
      label: t("heatmapActiveDays"),
      value: numberFormat.format(activeDisplayDays),
      suffix: t("unitDay"),
      meta: t("heatmapStatRecordedThisMonth")
    },
    {
      label: t("heatmapClosedReports"),
      value: numberFormat.format(data.summary.closedJournalDays),
      suffix: t("unitDay"),
      meta: t("heatmapStatReportsThisMonth")
    },
    {
      label: t("heatmapTotalChars"),
      value: numberFormat.format(data.summary.totalTextLength),
      suffix: t("unitChar"),
      meta: t("heatmapStatTotalCharsMeta")
    },
    {
      label: t("heatmapHighDays"),
      value: numberFormat.format(highDisplayDays),
      suffix: t("unitDay"),
      meta: t("heatmapStatHighActivityMeta")
    },
    {
      label: t("heatmapLongestStreak"),
      value: numberFormat.format(streakInfo.length),
      suffix: t("unitDay"),
      meta: streakMeta
    }
  ];

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

      <div className="heatmap-overview-card">
        <header>
          <span>{t("heatmapMonthlyOverview")}</span>
          <small>{monthLabel}</small>
        </header>
        <div className="heatmap-overview-metrics">
          {overviewMetrics.map((metric) => (
            <div className="heatmap-overview-item" key={metric.label}>
              <span>{metric.label}</span>
              <strong>
                {metric.value}
                <small>{metric.suffix}</small>
              </strong>
              <em>{metric.meta}</em>
            </div>
          ))}
        </div>
      </div>

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
                    isFuture ? "future" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={day.date}
                  type="button"
                  title={`${day.date} · ${heatmapDisplayLevelLabel(dayActivity.level, t)} · ${t("activityScore")}: ${numberFormat.format(dayActivity.total)}`}
                  onClick={() => onSelectDate(day.date)}
                >
                  <span className="heatmap-day-number">{day.day}</span>
                  <div className="heatmap-day-blocks" aria-hidden="true">
                    {Array.from({ length: HEATMAP_BLOCK_LIMIT }, (_, blockIndex) => (
                      <i
                        className={[
                          "heatmap-day-block",
                          blockIndex < dayActivity.blockCount ? "active" : "empty",
                          blockIndex < dayActivity.blockCount ? `heatmap-display-level-${dayActivity.level}` : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={blockIndex}
                      />
                    ))}
                  </div>
                  {dayActivity.total > 0 && <em>{numberFormat.format(dayActivity.total)}</em>}
                </button>
              );
            })}
          </div>

          <footer className="heatmap-calendar-footer">
            <div className="heatmap-legend" aria-label={t("heatmapLegend")}>
              <span>{t("heatmapLess")}</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i
                  className={[
                    "heatmap-block-sample",
                    level > 0 ? `heatmap-display-level-${level}` : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={level}
                />
              ))}
              <span>{t("heatmapMore")}</span>
            </div>
            <p>{t("heatmapLegendShort")}</p>
          </footer>
        </section>

        <aside className="heatmap-detail-panel">
          {selectedDay && selectedDayActivity ? (
            <>
              <header>
                <CalendarDays size={22} />
                <h2>{formatDateOnlyDisplay(selectedDay.date, language)}</h2>
              </header>
              <section className="heatmap-score-card">
                <div>
                  <p>{t("activityScore")}</p>
                  <strong>
                    {numberFormat.format(selectedDayActivity.total)}
                    <span>/100</span>
                  </strong>
                </div>
                <span className={`daily-status-pill heatmap-display-pill heatmap-display-pill-${selectedDayActivity.level}`}>
                  {heatmapDisplayLevelLabel(selectedDayActivity.level, t)}
                </span>
              </section>
              <p className="heatmap-score-note">{t("heatmapScoreFormulaNote")}</p>
              {selectedDayActivity.total > 0 ? (
                <>
                  <div className="heatmap-detail-list">
                    <HeatmapDetailRow label={t("heatmapRealUpdatedItems")} value={`${numberFormat.format(selectedDayActivity.updatedItemCount)} ${t("unitCount")}`} icon={CalendarDays} withChevron />
                    <HeatmapDetailRow label={t("heatmapTextEntries")} value={selectedDayActivity.updatedItemCount > 0 ? t("heatmapYes") : t("heatmapNo")} icon={Check} />
                    <HeatmapDetailRow label={t("heatmapProjectCount")} value={`${numberFormat.format(selectedDay.projectCount)} ${t("unitCount")}`} icon={FolderOpen} />
                    <HeatmapDetailRow label={t("heatmapTotalChars")} value={`${numberFormat.format(selectedDay.totalTextLength)} ${t("unitChar")}`} icon={BookOpenText} />
                    <HeatmapDetailRow label={t("statusDoneToday")} value={`${numberFormat.format(selectedDay.doneCount)} ${t("unitCount")}`} icon={FileText} withChevron />
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
      <div className="memo-page-header">
        <div>
          <button className="back-button" type="button" onClick={onBack}>
            <ChevronLeft size={17} />
            {t("backToProjectDetail")}
          </button>
          <p className="eyebrow">{project.name}</p>
          <h1>{t("projectMemo")}</h1>
          <p>{t("projectMemoDescription")}</p>
        </div>
        <div className="memo-header-actions">
          <span>
            {t("memoLastSaved")}
            {t("searchMatchedSeparator")}
            {formatTimestamp(memo.updated_at, language, t)}
          </span>
          <button className="primary-button" type="button" onClick={onSave}>
            <Save size={17} />
            {t("saveMemo")}
          </button>
        </div>
      </div>

      <div className="memo-workspace">
        <section className="memo-editor-card">
          <div className="memo-card-header">
            <div>
              <h2>{t("memoEditor")}</h2>
              <p>{t("memoPasteHint")}</p>
            </div>
            {isSavingImage && <span className="memo-saving-image">{t("memoSavingImage")}</span>}
          </div>
          <MarkdownWysiwygEditor
            value={content}
            language={language}
            theme={theme}
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

function ProjectDetailPage({
  detail,
  language,
  t,
  onBack,
  onRecordProgress,
  onComplete,
  onDeleteWorkItem,
  onCreateWorkItem,
  onEditProject,
  onArchiveProject,
  onDeleteProject,
  onOpenMemo
}: {
  detail: ProjectDetail;
  language: LanguagePreference;
  t: Translator;
  onBack: () => void;
  onRecordProgress: (projectId: string, workItemId: string) => void;
  onComplete: (id: string) => void;
  onDeleteWorkItem: (item: WorkItemWithLatest) => void;
  onCreateWorkItem: () => void;
  onEditProject: () => void;
  onArchiveProject: () => void;
  onDeleteProject: () => void;
  onOpenMemo: () => void;
}) {
  const [projectActionsOpen, setProjectActionsOpen] = useState(false);
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

  return (
    <section className="page detail-page">
      <PageHeader
        title={
          <span className="detail-title-inline">
            <span>{detail.project.name}</span>
            <span className="detail-status-pill">
              {detail.project.status === "active" ? t("statusActive") : t("statusArchived")}
            </span>
          </span>
        }
        description={detail.project.description || t("noProjectDescription")}
        backAction={{ label: t("detailBackToProjects"), onClick: onBack }}
        actions={
          <div className="project-detail-actions">
            <button className="secondary-button" type="button" onClick={onOpenMemo}>
              <BookOpenText size={17} />
              {t("projectMemo")}
            </button>
            <div className={`project-more-menu ${projectActionsOpen ? "open" : ""}`.trim()} ref={projectActionsMenuRef}>
              <button
                className="ghost-button project-more-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={projectActionsOpen}
                onClick={() => setProjectActionsOpen((current) => !current)}
              >
                <ChevronDown size={16} />
                {t("moreActions")}
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
            <button className="primary-button" type="button" onClick={onCreateWorkItem}>
              <Plus size={17} />
              {t("newWorkItem")}
            </button>
          </div>
        }
      />

      <div className="detail-workbench">
        <section className="detail-section active-work-section">
          <header className="detail-section-header">
            <h2>
              {t("activeWorkItems")}
              <span>{detail.activeItems.length}</span>
            </h2>
          </header>
          {detail.activeItems.length === 0 ? (
            <EmptyState title={t("noActiveWorkItemsTitle")} body={t("noActiveWorkItemsBody")} />
          ) : (
            <div className="project-workitem-table">
              <div className="project-workitem-table-head" aria-hidden="true">
                <span />
                <span>{t("workItem")}</span>
                <span>{t("workItemStatus")}</span>
                <span>{t("workItemRecentRecord")}</span>
                <span>{t("workItemUpdatedAt")}</span>
                <span>{t("workItemActions")}</span>
              </div>
              {detail.activeItems.map((item) => (
                <WorkItemRow
                  key={item.id}
                  item={item}
                  mode="detail"
                  language={language}
                  onRecordProgress={() => onRecordProgress(detail.project.id, item.id)}
                  onComplete={() => onComplete(item.id)}
                  onDelete={() => onDeleteWorkItem(item)}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>
        <section className="detail-section completed-work-section">
          <header className="detail-section-header">
            <h2>
              {t("completedWorkItems")}
              <span>{detail.completedItems.length}</span>
            </h2>
          </header>
          {detail.completedItems.length === 0 ? (
            <EmptyState title={t("noCompletedItemsTitle")} body={t("noCompletedItemsBody")} />
          ) : (
            <div className="completed-work-list">
              {detail.completedItems.map((item) => (
                <WorkItemRow
                  key={item.id}
                  item={item}
                  mode="detail"
                  compact
                  language={language}
                  onRecordProgress={() => onRecordProgress(detail.project.id, item.id)}
                  onDelete={() => onDeleteWorkItem(item)}
                  t={t}
                />
              ))}
            </div>
          )}
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
        <label>
          {t("progressToday")}
          <MarkdownWysiwygEditor
            value={quickForm.content}
            language={language}
            theme={theme}
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
        </label>
        <label>
          {t("nextStepPlan")}
          <MarkdownWysiwygEditor
            value={quickForm.nextStep}
            language={language}
            theme={theme}
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
        </label>
        <label>
          {t("blockerHelp")}
          <MarkdownWysiwygEditor
            value={quickForm.blocker}
            language={language}
            theme={theme}
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
        </label>
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

function themeLabel(theme: ThemePreference, t: Translator): string {
  if (theme === "light") {
    return t("themeLight");
  }
  if (theme === "dark") {
    return t("themeDark");
  }
  return t("themeSystem");
}

function effectiveThemeLabel(theme: "light" | "dark", t: Translator): string {
  return theme === "dark" ? t("themeDark") : t("themeLight");
}

function SettingsPage({
  settings,
  t,
  message,
  isMigrating,
  busyAction,
  onSetTheme,
  onSetLanguage,
  onSaveAiSettings,
  onClearAiKey,
  onTestAiConnection,
  onOpenDataDirectory,
  onMigrateDataDirectory,
  onReloadDataDirectory
}: {
  settings: SettingsInfo;
  t: Translator;
  message: Toast | null;
  isMigrating: boolean;
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
  onMigrateDataDirectory: () => void;
  onReloadDataDirectory: () => void;
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

  useEffect(() => {
    setAiForm({
      enabled: settings.ai.enabled,
      provider: settings.ai.provider,
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      apiKey: ""
    });
  }, [settings.ai.enabled, settings.ai.provider, settings.ai.baseUrl, settings.ai.model]);

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
  const aiKeyStatus = settings.ai.apiKeyConfigured
    ? `${t("aiApiKeyConfigured")} ${settings.ai.apiKeyPreview}`
    : t("aiApiKeyNotConfigured");

  return (
    <section className="page settings-page">
      <PageHeader title={t("settingsTitle")} description={t("settingsSubtitle")} />

      <div className="settings-stack">
        <section className="settings-card" id="settings-appearance-language">
          <header className="settings-card-header">
            <div className="settings-icon">
              <Monitor size={20} />
            </div>
            <div>
              <h2>{t("appearanceLanguageTitle")}</h2>
              <p>{t("appearanceLanguageDescription")}</p>
            </div>
          </header>
          <div className="settings-preference-grid">
            <section className="settings-preference-group">
              <div>
                <h3>{t("appearanceTitle")}</h3>
                <p>{t("appearanceDescription")}</p>
              </div>
              <div className="segmented-control" role="radiogroup" aria-label={t("chooseAppearanceAria")}>
                {themeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={settings.theme === option.value ? "selected" : ""}
                    type="button"
                    role="radio"
                    aria-checked={settings.theme === option.value}
                    onClick={() => onSetTheme(option.value)}
                  >
                    <option.icon size={17} />
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="settings-note compact">
                {t("settingsCurrentSelection")}：{themeLabel(settings.theme, t)} · {t("settingsCurrentUse")}：
                {effectiveThemeLabel(settings.effectiveTheme, t)}
              </p>
            </section>

            <section className="settings-preference-group">
              <div>
                <h3>{t("languageTitle")}</h3>
                <p>{t("languageDescription")}</p>
              </div>
              <div className="segmented-control" role="radiogroup" aria-label={t("chooseLanguageAria")}>
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
            </section>
          </div>
        </section>

        <section className="settings-card ai-settings-card" id="settings-ai">
          <header className="settings-card-header">
            <div className="settings-icon">
              <Bot size={20} />
            </div>
            <div>
              <h2>{t("aiSettingsTitle")}</h2>
              <p>{t("aiSettingsDescription")}</p>
            </div>
          </header>

          <div className="ai-settings-topline">
            <div className="ai-service-card">
              <Bot size={18} />
              <div>
                <strong>{t("aiProviderOpenAICompatible")}</strong>
                <span>{t("aiProviderDescription")}</span>
              </div>
            </div>
            <div className="segmented-control compact" role="radiogroup" aria-label={t("aiEnabled")}>
              <button
                className={!aiForm.enabled ? "selected" : ""}
                type="button"
                role="radio"
                aria-checked={!aiForm.enabled}
                onClick={() => setAiForm((current) => ({ ...current, enabled: false }))}
              >
                {t("aiDisabled")}
              </button>
              <button
                className={aiForm.enabled ? "selected" : ""}
                type="button"
                role="radio"
                aria-checked={aiForm.enabled}
                onClick={() => setAiForm((current) => ({ ...current, enabled: true }))}
              >
                {t("aiEnabledOption")}
              </button>
            </div>
          </div>

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
                placeholder="https://your-provider.example.com/v1"
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
            <button className="ghost-button danger-ghost" type="button" onClick={clearAiKey} disabled={aiBusy !== null || !settings.ai.apiKeyConfigured}>
              <X size={17} />
              {t("aiClearApiKey")}
            </button>
            <button className="primary-button" type="button" onClick={saveAi} disabled={aiBusy !== null}>
              <Save size={17} />
              {aiBusy === "save" ? t("saving") : t("aiSaveSettings")}
            </button>
          </div>
        </section>

        <section className="settings-card" id="settings-storage">
          <header className="settings-card-header">
            <div className="settings-icon">
              <HardDrive size={20} />
            </div>
            <div>
              <h2>{t("dataStorageTitle")}</h2>
              <p>{t("dataStorageDescription")}</p>
            </div>
          </header>

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

          <div className="settings-data-grid">
            <InfoRow label={t("currentDataDirectory")} value={settings.dataDirectory} />
            <InfoRow label={t("currentDatabaseFile")} value={settings.databasePath} />
            <InfoRow label={t("databaseSize")} value={formatBytes(settings.databaseSize)} />
            <InfoRow label={t("configFile")} value={settings.configPath} />
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
          </div>

          <p className="settings-note compact">{t("dataStorageNote")}</p>

          <div className="copy-guidance">
            <strong>{t("copyGuidanceTitle")}</strong>
            <p>{t("copyGuidanceSummary")}</p>
            <p>{t("copyGuidanceParagraphTwo")}</p>
            <p>{t("copyGuidanceWarning")}</p>
          </div>

          {message && <div className={`inline-message ${message.kind}`}>{message.message}</div>}

          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={onOpenDataDirectory}>
              <FolderCog size={17} />
              {t("openDataDirectory")}
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={onMigrateDataDirectory}
              disabled={isMigrating || busyAction !== null}
            >
              <HardDrive size={17} />
              {isMigrating ? t("migrating") : t("migrateDataDirectory")}
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
        </section>
      </div>
    </section>
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function ToastMessage({ toast }: { toast: Toast }) {
  const Icon = toast.kind === "success" ? Check : toast.kind === "error" ? X : toast.kind === "warning" ? AlertTriangle : FileText;
  return (
    <div className={`toast ${toast.kind}`} role="status" aria-live={toast.kind === "error" ? "assertive" : "polite"}>
      <span className="toast-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span>{toast.message}</span>
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
  onCancel,
  t
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
  t: Translator;
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
        className={`form-modal confirm-modal ${tone}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {objectName && <p className="modal-object-name">{objectName}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label={t("close")}>
            <X size={18} />
          </button>
        </header>
        <p className="confirm-body">{body}</p>
        {(calloutTitle || calloutBody) && (
          <div className={`confirm-callout ${tone}`.trim()}>
            {tone === "info" ? <FileText size={17} /> : <AlertTriangle size={17} />}
            <div>
              {calloutTitle && <strong>{calloutTitle}</strong>}
              {calloutBody && <span>{calloutBody}</span>}
            </div>
          </div>
        )}
        {children}
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

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      trapModalFocus(event, modalRef.current);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      const firstField = getFocusableElements(modalRef.current).find((element) => !element.classList.contains("icon-button"));
      firstField?.focus();
    });
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
