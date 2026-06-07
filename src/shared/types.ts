export type ProjectStatus = "active" | "archived";
export type WorkItemStatus = "active" | "done" | "archived";
export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";
export type LanguagePreference = "zh-CN" | "zh-TW" | "en";
export type DailyJournalStatus = "draft" | "closed";
export type DailyWorkItemStatus = "in_progress" | "done_today" | "paused";
export type PeriodReportType = "weekly" | "monthly";
export type AiProvider = "openai-compatible";
export type AiRefinementMode = "standard";

export interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKeyEncrypted: string;
  apiKeyPreview: string;
}

export interface AiSettingsInfo {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
  canSecurelyStoreApiKey: boolean;
}

export interface AiSaveSettingsInput {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface AiOperationResult {
  success: boolean;
  error?: string;
}

export interface AiRefineReportInput {
  reportId: string;
  reportType: PeriodReportType;
  sourceMarkdown: string;
  refinementMode?: AiRefinementMode;
}

export interface AiRefineReportResult {
  success: boolean;
  refinedMarkdown?: string;
  generatedAt?: string;
  error?: string;
}

export interface AppConfig {
  theme: ThemePreference;
  dataDirectory: string | null;
  language: LanguagePreference;
  ai: AiConfig;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface WorkItem {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: WorkItemStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
}

export interface ProgressEntry {
  id: string;
  project_id: string;
  work_item_id: string | null;
  entry_date: string;
  content: string;
  next_step: string | null;
  blocker: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyJournal {
  id: string;
  journal_date: string;
  status: DailyJournalStatus;
  report_markdown: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface DailyWorkItemEntry {
  id: string;
  journal_date: string;
  project_id: string;
  work_item_id: string;
  today_progress: string | null;
  next_step: string | null;
  blocker: string | null;
  status_for_today: DailyWorkItemStatus;
  created_at: string;
  updated_at: string;
}

export interface WorkItemNote {
  id: string;
  work_item_id: string;
  content_markdown: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkItemNoteSnapshot {
  id: string;
  work_item_id: string;
  snapshot_date: string;
  content_markdown: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkItemHistoryRecoverySource =
  | "work_item_note_snapshots"
  | "daily_work_item_entries"
  | "progress_entries"
  | "daily_journals";

export interface WorkItemHistoryRecoveryPreview {
  source: WorkItemHistoryRecoverySource;
  recordCount: number;
  latestDate: string | null;
  populatedFields: string[];
  contentLength: number;
  preview: string;
}

export interface WorkItemHistoryRecovery extends WorkItemHistoryRecoveryPreview {
  contentMarkdown: string;
}

export interface ProjectMemo {
  id: string;
  project_id: string;
  content_markdown: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoAttachment {
  id: string;
  project_id: string;
  memo_id: string | null;
  file_name: string;
  relative_path: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
}

export interface DailyEntryAttachment {
  id: string;
  project_id: string;
  work_item_id: string;
  journal_date: string;
  file_name: string;
  relative_path: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
}

export interface WorkItemNoteAttachment {
  id: string;
  project_id: string;
  work_item_id: string;
  file_name: string;
  relative_path: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
}

export interface WorkItemWithLatest extends WorkItem {
  latest_content: string | null;
  latest_next_step: string | null;
  latest_blocker: string | null;
  latest_created_at: string | null;
}

export interface ProjectWorkItem extends WorkItemWithLatest {
  workItemNote: WorkItemNote;
  previousNoteSnapshot: WorkItemNoteSnapshot | null;
}

export interface TodayProjectGroup {
  project: Project;
  activeCount: number;
  items: WorkItemWithLatest[];
}

export interface TodayStats {
  activeProjects: number;
  activeWorkItems: number;
  todayEntries: number;
}

export interface TodayOverview {
  today: string;
  stats: TodayStats;
  groups: TodayProjectGroup[];
  projects: Project[];
}

export interface DailyWorkItemBlock {
  project: Project;
  workItem: WorkItemWithLatest;
  entry: DailyWorkItemEntry | null;
  previousEntry: DailyWorkItemEntry | null;
  previousWorkDate: string | null;
  workItemNote: WorkItemNote;
  previousNoteSnapshot: WorkItemNoteSnapshot | null;
  recoverableHistory: WorkItemHistoryRecoveryPreview | null;
}

export interface DailyProjectGroup {
  project: Project;
  projectMemo: ProjectMemo;
  activeCount: number;
  items: DailyWorkItemBlock[];
}

export interface DailyJournalStats {
  activeProjects: number;
  workItems: number;
  filledEntries: number;
  completedToday: number;
}

export interface DailyJournalView {
  journalDate: string;
  previousWorkDate: string | null;
  journal: DailyJournal;
  stats: DailyJournalStats;
  groups: DailyProjectGroup[];
  projects: Project[];
}

export interface ProjectListItem extends Project {
  active_item_count: number;
}

export interface ProjectDetail {
  project: Project;
  activeItems: ProjectWorkItem[];
  completedItems: ProjectWorkItem[];
  timeline: TimelineEntry[];
}

export interface TimelineEntry {
  id: string;
  source: "daily" | "legacy";
  project_id: string;
  work_item_id: string | null;
  entry_date: string;
  content: string;
  today_progress: string | null;
  next_step: string | null;
  blocker: string | null;
  status_for_today: DailyWorkItemStatus | null;
  created_at: string;
  updated_at: string;
  project_name: string;
  work_item_title: string | null;
}

export interface SearchResult {
  id: string;
  type: "project" | "work_item" | "daily_entry" | "daily_report" | "progress" | "project_memo" | "work_item_note";
  title: string;
  projectId: string | null;
  projectName: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
  snippet: string;
  matchedField: string;
  createdAt: string;
  entryDate?: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  id: string;
  name: string;
  description?: string;
}

export interface CreateWorkItemInput {
  projectId: string;
  title: string;
  description?: string;
}

export interface CreateProgressInput {
  projectId: string;
  workItemId: string;
  content: string;
  nextStep?: string;
  blocker?: string;
}

export interface UpsertDailyWorkItemEntryInput {
  journalDate: string;
  projectId: string;
  workItemId: string;
  todayProgress?: string;
  nextStep?: string;
  blocker?: string;
  statusForToday: DailyWorkItemStatus;
  workItemNoteContentMarkdown?: string;
}

export interface SaveDailyWorkItemResult {
  entry: DailyWorkItemEntry | null;
  workItemNote: WorkItemNote;
}

export interface RestoreWorkItemHistoryResult {
  restored: boolean;
  workItemNote: WorkItemNote;
  recovery: WorkItemHistoryRecovery | null;
  skippedReason?: "note_not_empty" | "no_recoverable_content";
}

export interface SaveWorkItemNoteAttachmentInput {
  projectId: string;
  workItemId: string;
  mimeType: string;
  data: ArrayBuffer;
}

export interface SaveWorkItemNoteAttachmentResult {
  attachment: WorkItemNoteAttachment;
  markdownUrl: string;
}

export interface AiDraftDailyChangeInput {
  projectName: string;
  workItemTitle: string;
  localDraft: string;
}

export interface AiDraftDailyChangeResult {
  success: boolean;
  draft: string;
  error?: string;
}

export interface MarkdownPayload {
  date: string;
  markdown: string;
  fileName?: string;
  reportSyncError?: string;
}

export type DailyAutoReportEvent =
  | ({ success: true } & MarkdownPayload)
  | {
      success: false;
      date: string;
      error: string;
    };

export interface ExportMarkdownInput {
  date: string;
  markdown: string;
  fileName?: string;
}

export interface ExportMarkdownResult {
  canceled: boolean;
  filePath?: string;
}

export interface SettingsInfo {
  theme: ThemePreference;
  effectiveTheme: EffectiveTheme;
  language: LanguagePreference;
  ai: AiSettingsInfo;
  configPath: string;
  defaultDataDirectory: string;
  configuredDataDirectory: string | null;
  dataDirectory: string;
  databasePath: string;
  databaseSize: number;
  isCustomDataDirectory: boolean;
  isFallbackDataDirectory: boolean;
  fallbackReason: string | null;
}

export interface MigrationResult {
  canceled: boolean;
  settings?: SettingsInfo;
  message?: string;
  operation?: "migrated" | "switched" | "unchanged" | "reloaded";
}

export type AppUpdateStatusKind =
  | "idle"
  | "checking"
  | "update-available"
  | "update-not-available"
  | "download-progress"
  | "update-downloaded"
  | "error"
  | "development";

export type AppUpdateErrorCode =
  | "no-release"
  | "no-update-metadata"
  | "no-compatible-artifact"
  | "network"
  | "signature"
  | "development"
  | "unknown";

export interface AppUpdateProgress {
  percent: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
}

export interface AppUpdateStatus {
  status: AppUpdateStatusKind;
  currentVersion: string;
  latestVersion?: string;
  releaseDate?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  progress?: AppUpdateProgress;
  errorCode?: AppUpdateErrorCode;
  errorMessage?: string;
}

export type AppUpdateCheckResult = AppUpdateStatus;

export interface PrepareCopyResult {
  dataDirectory: string;
  databasePath: string;
  settings: SettingsInfo;
}

export interface ProjectDeleteSummary {
  workItemCount: number;
  dailyEntryCount: number;
  legacyProgressCount: number;
  memoAttachmentCount: number;
}

export interface WorkItemDeleteSummary {
  dailyEntryCount: number;
  legacyProgressCount: number;
}

export interface SaveProjectMemoInput {
  projectId: string;
  contentMarkdown: string;
}

export interface SaveMemoAttachmentInput {
  projectId: string;
  mimeType: string;
  data: ArrayBuffer;
}

export interface SaveMemoAttachmentResult {
  attachment: MemoAttachment;
  markdownUrl: string;
}

export interface SaveDailyEntryAttachmentInput {
  projectId: string;
  workItemId: string;
  journalDate: string;
  mimeType: string;
  data: ArrayBuffer;
}

export interface SaveDailyEntryAttachmentResult {
  attachment: DailyEntryAttachment;
  markdownUrl: string;
}

export interface DailyReportListItem {
  id: string;
  date: string;
  status: DailyJournalStatus;
  markdown: string;
  closed_at: string | null;
  updated_at: string;
}

export interface PeriodReportListItem {
  id: string;
  report_type: PeriodReportType;
  period_start: string;
  period_end: string;
  title: string;
  markdown: string;
  generated_at: string;
  updated_at: string;
  aiRefinedMarkdown: string | null;
  aiRefinedAt: string | null;
  aiProvider: AiProvider | null;
  aiModel: string | null;
  aiIsStale: boolean;
}

export interface HeatmapDay {
  date: string;
  day: number;
  activityScore: number;
  level: 0 | 1 | 2 | 3 | 4;
  totalTextLength: number;
  entryCount: number;
  textEntryCount: number;
  projectCount: number;
  doneCount: number;
  pausedCount: number;
  hasClosedJournal: boolean;
  hasReport: boolean;
  reportMarkdown: string | null;
  closedAt: string | null;
  legacyEntryCount: number;
}

export interface HeatmapSummary {
  activeDays: number;
  closedJournalDays: number;
  doneCount: number;
  totalTextLength: number;
  highActivityDays: number;
  longestStreak: number;
}

export interface HeatmapMonth {
  year: number;
  month: number;
  days: HeatmapDay[];
  summary: HeatmapSummary;
}

export interface WorkJournalApi {
  appInfo: {
    getVersion: () => Promise<string>;
    checkForUpdates: () => Promise<AppUpdateCheckResult>;
    openReleasesPage: () => Promise<void>;
  };
  updates: {
    getStatus: () => Promise<AppUpdateStatus>;
    checkForUpdates: () => Promise<AppUpdateStatus>;
    downloadUpdate: () => Promise<AppUpdateStatus>;
    quitAndInstall: () => Promise<AppUpdateStatus>;
    openReleasePage: () => Promise<void>;
    onStatus: (callback: (status: AppUpdateStatus) => void) => () => void;
    removeStatusListener: (callback: (status: AppUpdateStatus) => void) => void;
  };
  projects: {
    listActive: () => Promise<ProjectListItem[]>;
    create: (input: CreateProjectInput) => Promise<Project>;
    update: (input: UpdateProjectInput) => Promise<Project>;
    archive: (id: string) => Promise<Project>;
    getDetail: (id: string) => Promise<ProjectDetail>;
    getDeleteSummary: (id: string) => Promise<ProjectDeleteSummary>;
    delete: (id: string) => Promise<void>;
  };
  workItems: {
    create: (input: CreateWorkItemInput) => Promise<WorkItem>;
    complete: (id: string) => Promise<WorkItem>;
    getDeleteSummary: (id: string) => Promise<WorkItemDeleteSummary>;
    delete: (id: string) => Promise<void>;
  };
  progress: {
    create: (input: CreateProgressInput) => Promise<ProgressEntry>;
    listToday: () => Promise<TimelineEntry[]>;
  };
  today: {
    getOverview: () => Promise<TodayOverview>;
  };
  daily: {
    getTodayJournal: () => Promise<DailyJournalView>;
    getJournal: (date: string) => Promise<DailyJournalView>;
    upsertWorkItemEntry: (input: UpsertDailyWorkItemEntryInput) => Promise<SaveDailyWorkItemResult>;
    getWorkItemHistoryRecovery: (workItemId: string) => Promise<WorkItemHistoryRecovery | null>;
    restoreWorkItemHistory: (workItemId: string) => Promise<RestoreWorkItemHistoryResult>;
    saveAttachment: (input: SaveDailyEntryAttachmentInput) => Promise<SaveDailyEntryAttachmentResult>;
    saveWorkItemNoteAttachment: (input: SaveWorkItemNoteAttachmentInput) => Promise<SaveWorkItemNoteAttachmentResult>;
    closeToday: () => Promise<MarkdownPayload>;
    generateReport: (date: string) => Promise<MarkdownPayload>;
    reopenJournal: (date: string) => Promise<DailyJournal>;
    getPreviousWorkDate: (date: string) => Promise<string | null>;
    onAutoReportGenerated: (callback: (event: DailyAutoReportEvent) => void) => () => void;
  };
  search: {
    query: (term: string) => Promise<SearchResult[]>;
  };
  markdown: {
    generateToday: () => Promise<MarkdownPayload>;
    exportToday: (input: ExportMarkdownInput) => Promise<ExportMarkdownResult>;
  };
  memos: {
    getProjectMemo: (projectId: string) => Promise<ProjectMemo>;
    saveProjectMemo: (input: SaveProjectMemoInput) => Promise<ProjectMemo>;
    saveAttachment: (input: SaveMemoAttachmentInput) => Promise<SaveMemoAttachmentResult>;
  };
  reports: {
    listDaily: () => Promise<DailyReportListItem[]>;
    listPeriod: (type: PeriodReportType) => Promise<PeriodReportListItem[]>;
  };
  heatmap: {
    getMonthlyHeatmap: (year: number, month: number) => Promise<HeatmapMonth>;
  };
  settings: {
    get: () => Promise<SettingsInfo>;
    setTheme: (theme: ThemePreference) => Promise<SettingsInfo>;
    setLanguage: (language: LanguagePreference) => Promise<SettingsInfo>;
    openDataDirectory: () => Promise<void>;
    prepareDataDirectoryForCopy: () => Promise<PrepareCopyResult>;
    chooseAndMigrateDataDirectory: () => Promise<MigrationResult>;
    useExistingDataDirectory: () => Promise<MigrationResult>;
    reloadDataDirectory: () => Promise<MigrationResult>;
    onChanged: (callback: (settings: SettingsInfo) => void) => () => void;
  };
  ai: {
    getSettings: () => Promise<AiSettingsInfo>;
    saveSettings: (input: AiSaveSettingsInput) => Promise<AiSettingsInfo>;
    clearApiKey: () => Promise<AiSettingsInfo>;
    testConnection: () => Promise<AiOperationResult>;
    refineReport: (input: AiRefineReportInput) => Promise<AiRefineReportResult>;
    draftDailyChange: (input: AiDraftDailyChangeInput) => Promise<AiDraftDailyChangeResult>;
  };
}
