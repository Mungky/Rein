/** Bentuk respons API yang dipakai halaman (cermin dari apps/server/src/routes). */
import type {
  LogbookCategory,
  MaterialInput,
  ProjectStatus,
  WoCategory,
  WoStatus,
} from '@rein/shared';

export interface Person {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface ProjectListItem {
  logoUrl: string | null;
  id: string;
  name: string;
  rpoNumber: string;
  clientName: string;
  status: ProjectStatus;
  onHoldReason: string | null;
  startDate: string;
  endDate: string;
  progress: number;
  activeCategories: WoCategory[];
  urgentCount: number;
  memberCount: number;
  team: Person[];
}

export interface CategorySummary {
  category: WoCategory;
  total: number;
  done: number;
  progress: number;
  share: number;
}

export interface Member {
  userId: string;
  fullName: string;
  username: string;
  avatarUrl: string | null;
  roleName: string;
  projectRole: string;
  isProjectManager: boolean;
}

export interface ProjectDetail {
  logoUrl: string | null;
  bannerUrl: string | null;
  id: string;
  name: string;
  rpoNumber: string;
  client: { id: string | null; name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  description: string | null;
  status: ProjectStatus;
  onHoldReason: string | null;
  updatedAt: string;
  progress: number;
  categories: CategorySummary[];
  woCount: number;
  members: Member[];
  can: Record<string, boolean>;
}

export interface WoType {
  id: string;
  name: string;
  code: string;
  category: WoCategory;
  isPunchList: boolean;
  active?: boolean;
}

export interface WoRow {
  id: string;
  seq: number;
  numberLabel: string;
  title: string;
  status: WoStatus;
  urgent: boolean;
  plannedStart: string;
  deadline: string;
  progress: number;
  weight: number | null;
  createdBy: string;
  updatedAt: string;
  projectId: string;
  type: WoType;
  assignee: Person;
  helpOpen: boolean;
  hasLogbook: boolean;
  overdue: boolean;
}

export interface FileItem {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  hasThumb: boolean;
}

export interface WoDetail extends WoRow {
  statusHint: string | null;
  detail: string;
  canceledReason: string | null;
  completedAt: string | null;
  createdAt: string;
  project: { id: string; name: string; rpoNumber: string; status: ProjectStatus };
  creator: { id: string; fullName: string };
  watchers: Person[];
  isWatching: boolean;
  references: Array<{
    id: string;
    kind: 'wo' | 'attachment' | 'url';
    label?: string;
    url?: string;
  }>;
  attachments: FileItem[];
  help: { id: string; requestedBy: string; createdAt: string } | null;
  can: {
    editAny: boolean;
    editDetail: boolean;
    editWeight: boolean;
    delete: boolean;
    writeLogbook: boolean;
    updateProgress: boolean;
    upload: boolean;
    requestHelp: boolean;
    resolveHelp: boolean;
    statusTargets: WoStatus[];
  };
}

export interface LogEntry {
  category: LogbookCategory | null;
  id: string;
  kind: 'note' | 'comment' | 'system' | 'help_request' | 'help_resolved';
  body: string;
  progressFrom: number | null;
  progressTo: number | null;
  statusFrom: WoStatus | null;
  statusTo: WoStatus | null;
  createdAt: string;
  editedAt: string | null;
  author: Person;
  attachments: FileItem[];
}

export interface MaterialRow extends MaterialInput {
  id: string;
  updatedAt: string;
}

export interface HomeData {
  stats: { myTasks: number; urgent: number; dueSoon: number; help: number };
  help: Array<{
    woId: string;
    numberLabel: string;
    title: string;
    projectId: string;
    projectName: string;
    requestedBy: string;
    createdAt: string;
    excerpt: string | null;
  }>;
  tasks: WoRow[];
  nextOffset: number | null;
}

export interface NotificationItem {
  id: string;
  event: string;
  title: string;
  body: string;
  url: string;
  entityType: string;
  entityId: string;
  projectId: string | null;
  projectName: string | null;
  readAt: string | null;
  createdAt: string;
}
