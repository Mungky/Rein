/**
 * Schema database M0 (PRD §4.1–4.2): auth, role & izin, audit, lampiran.
 * Konvensi: PK uuid v7 (dibuat aplikasi), created_at/updated_at timestamptz (UTC).
 * Larangan: tidak ada kolom uang (lihat schema.test.ts).
 */
import { sql } from 'drizzle-orm';
import {
  ATTACHMENT_CATEGORIES,
  ATTACHMENT_OWNER_TYPES,
  CONTACT_KINDS,
  PROJECT_STATUSES,
  SCOPES,
  USER_STATUSES,
  VERIFICATION_PURPOSES,
  WO_CATEGORIES,
  WO_STATUSES,
} from '@rein/shared';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const userStatus = pgEnum('user_status', USER_STATUSES);
export const contactKind = pgEnum('contact_kind', CONTACT_KINDS);
export const verificationPurpose = pgEnum('verification_purpose', VERIFICATION_PURPOSES);
export const permissionScope = pgEnum('permission_scope', SCOPES);
export const attachmentOwnerType = pgEnum('attachment_owner_type', ATTACHMENT_OWNER_TYPES);
export const attachmentCategory = pgEnum('attachment_category', ATTACHMENT_CATEGORIES);

export const roles = pgTable('roles', {
  id: id(),
  name: text('name').notNull().unique(),
  divisionLabel: text('division_label').notNull().default(''),
  isSystem: boolean('is_system').notNull().default(false),
  /** Kunci role bawaan seed (manager, admin, …); null untuk role buatan Admin. */
  systemKey: text('system_key').unique(),
  ...timestamps,
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
    scope: permissionScope('scope').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    username: citext('username').notNull().unique(),
    fullName: text('full_name').notNull(),
    nickname: text('nickname'),
    onboardingCompletedAt: tz('onboarding_completed_at'),
    pinSetupSkippedAt: tz('pin_setup_skipped_at'),
    avatarAttachmentId: uuid('avatar_attachment_id').references((): AnyPgColumn => attachments.id, {
      onDelete: 'set null',
    }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    googleSub: text('google_sub').unique(),
    status: userStatus('status').notNull().default('invited'),
    /** null sampai user mengaktifkan akun dari undangan. */
    passwordHash: text('password_hash'),
    passwordChangedAt: tz('password_changed_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    /** Awal jendela 15 menit untuk menghitung kegagalan login (FR-001 AC3). */
    failedLoginWindowStart: tz('failed_login_window_start'),
    lockedUntil: tz('locked_until'),
    lastActiveAt: tz('last_active_at'),
    ...timestamps,
  },
  (t) => [index('users_role_idx').on(t.roleId)],
);

export const userContacts = pgTable(
  'user_contacts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: contactKind('kind').notNull(),
    /** email lowercased / nomor E.164 */
    value: text('value').notNull(),
    verifiedAt: tz('verified_at'),
    isPrimary: boolean('is_primary').notNull().default(false),
    pending: boolean('pending').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_contacts_verified_unique')
      .on(t.kind, t.value)
      .where(sql`${t.verifiedAt} is not null`),
    index('user_contacts_user_idx').on(t.userId),
    index('user_contacts_value_idx').on(t.kind, t.value),
  ],
);

export const verificationCodes = pgTable(
  'verification_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => userContacts.id, { onDelete: 'cascade' }),
    purpose: verificationPurpose('purpose').notNull(),
    /** hash kode 6 digit (null untuk tautan saja, mis. aktivasi) */
    codeHash: text('code_hash'),
    /** hash token tautan (magic link / aktivasi) */
    tokenHash: text('token_hash').unique(),
    expiresAt: tz('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: tz('consumed_at'),
    ...timestamps,
  },
  (t) => [index('verification_codes_user_idx').on(t.userId, t.purpose)],
);

export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 128-bit acak dari klien (crypto.randomUUID) */
    deviceId: text('device_id').notNull(),
    label: text('label').notNull().default(''),
    pinHash: text('pin_hash'),
    pinFailedCount: integer('pin_failed_count').notNull().default(0),
    pinDisabledAt: tz('pin_disabled_at'),
    trustedUntil: tz('trusted_until'),
    lastSeenAt: tz('last_seen_at'),
    revokedAt: tz('revoked_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('devices_user_device_unique').on(t.userId, t.deviceId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    /** SHA-256 dari token cookie; token asli tidak pernah disimpan. */
    tokenHash: text('token_hash').notNull().unique(),
    /** true = perangkat trusted → masa berlaku 30 hari sliding; false = 12 jam. */
    trusted: boolean('trusted').notNull().default(false),
    lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    locked: boolean('locked').notNull().default(false),
    revokedAt: tz('revoked_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Append-only: UPDATE/DELETE ditolak trigger (lihat migrasi audit_append_only). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    diffJson: jsonb('diff_json').$type<Record<string, unknown>>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorId, t.createdAt),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    ownerType: attachmentOwnerType('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    category: attachmentCategory('category').notNull().default('general'),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    width: integer('width'),
    height: integer('height'),
    thumbKey: text('thumb_key'),
    displayKey: text('display_key'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    deletedAt: tz('deleted_at'),
    ...timestamps,
  },
  (t) => [
    index('attachments_owner_idx').on(t.ownerType, t.ownerId),
    index('attachments_sha_idx').on(t.ownerType, t.ownerId, t.sha256),
  ],
);

export type User = typeof users.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;

/* ─────────────── M1: project, WO, logbook, bantuan, notifikasi (PRD §4.2) ─────────────── */

export const projectStatus = pgEnum('project_status', PROJECT_STATUSES);
export const woStatus = pgEnum('wo_status', WO_STATUSES);
export const woCategory = pgEnum('wo_category', WO_CATEGORIES);
export const logbookKind = pgEnum('logbook_kind', [
  'note',
  'comment',
  'system',
  'help_request',
  'help_resolved',
]);
export const helpStatus = pgEnum('help_status', ['open', 'resolved']);
export const referenceKind = pgEnum('wo_reference_kind', ['wo', 'attachment', 'url']);
export const notificationChannel = pgEnum('notification_channel', ['email', 'whatsapp']);
export const deliveryStatus = pgEnum('delivery_status', ['queued', 'sent', 'failed', 'skipped']);
export const themePref = pgEnum('theme_pref', ['system', 'light', 'dark']);

export const clients = pgTable('clients', {
  id: id(),
  name: citext('name').notNull().unique(),
  logoAttachmentId: uuid('logo_attachment_id'),
  ...timestamps,
});

export const projects = pgTable(
  'projects',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    rpoNumber: citext('rpo_number').notNull().unique(),
    name: text('name').notNull(),
    location: text('location'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    description: text('description'),
    logoAttachmentId: uuid('logo_attachment_id'),
    bannerAttachmentId: uuid('banner_attachment_id'),
    status: projectStatus('status').notNull().default('active'),
    onHoldReason: text('on_hold_reason'),
    handoverDate: date('handover_date'),
    doneAt: tz('done_at'),
    archivedAt: tz('archived_at'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    /** Nomor WO berikutnya; dikunci FOR UPDATE saat membuat WO, tidak pernah dipakai ulang. */
    nextWoSeq: integer('next_wo_seq').notNull().default(1),
    deletedAt: tz('deleted_at'),
    ...timestamps,
  },
  (t) => [
    check('projects_dates_check', sql`${t.endDate} >= ${t.startDate}`),
    check('projects_description_len', sql`char_length(${t.description}) <= 500`),
    index('projects_status_idx').on(t.status),
    index('projects_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    projectRole: text('project_role').notNull().default('Anggota'),
    isProjectManager: boolean('is_project_manager').notNull().default(false),
    addedBy: uuid('added_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_members_user_idx').on(t.userId),
  ],
);

export const projectStatusHistory = pgTable(
  'project_status_history',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromStatus: projectStatus('from_status'),
    toStatus: projectStatus('to_status').notNull(),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id),
    note: text('note'),
    changedAt: tz('changed_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index('project_status_history_project_idx').on(t.projectId, t.changedAt)],
);

export const woTypes = pgTable('wo_types', {
  id: id(),
  name: text('name').notNull().unique(),
  code: text('code').notNull().unique(),
  category: woCategory('category').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  isPunchList: boolean('is_punch_list').notNull().default(false),
  ...timestamps,
});

export interface WoDetail {
  /** Teks polos; rich text AST terbatas menyusul (PRD §9.3). */
  text: string;
}

export const workOrders = pgTable(
  'work_orders',
  {
    /** = clientId dari klien → pembuatan idempoten (pelajaran REIN v1). */
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    seq: integer('seq').notNull(),
    numberLabel: text('number_label').generatedAlwaysAs(sql`'WO ' || lpad(seq::text, 2, '0')`),
    title: text('title').notNull(),
    typeId: uuid('type_id')
      .notNull()
      .references(() => woTypes.id),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => users.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    status: woStatus('status').notNull().default('todo'),
    urgent: boolean('urgent').notNull().default(false),
    plannedStart: date('planned_start').notNull(),
    deadline: date('deadline').notNull(),
    weight: numeric('weight', { precision: 5, scale: 2, mode: 'number' }),
    progress: smallint('progress').notNull().default(0),
    detailJson: jsonb('detail_json').$type<WoDetail>(),
    completedAt: tz('completed_at'),
    canceledReason: text('canceled_reason'),
    /** SHA-256 isi permintaan pembuatan — id sama + isi beda → 409. */
    creationHash: text('creation_hash'),
    deletedAt: tz('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('work_orders_project_seq_unique').on(t.projectId, t.seq),
    index('work_orders_project_status_idx').on(t.projectId, t.status),
    index('work_orders_assignee_idx').on(t.assigneeId, t.status, t.deadline),
    index('work_orders_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
    check('work_orders_dates_check', sql`${t.deadline} >= ${t.plannedStart}`),
    check('work_orders_progress_check', sql`${t.progress} between 0 and 100`),
    check('work_orders_weight_check', sql`${t.weight} is null or ${t.weight} between 0 and 100`),
  ],
);

export const woReferences = pgTable(
  'wo_references',
  {
    id: id(),
    woId: uuid('wo_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    kind: referenceKind('kind').notNull(),
    targetWoId: uuid('target_wo_id').references(() => workOrders.id),
    attachmentId: uuid('attachment_id').references(() => attachments.id),
    url: text('url'),
    label: text('label'),
    ...timestamps,
  },
  (t) => [index('wo_references_wo_idx').on(t.woId)],
);

export const woWatchers = pgTable(
  'wo_watchers',
  {
    woId: uuid('wo_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.woId, t.userId] }), index('wo_watchers_user_idx').on(t.userId)],
);

export const logbookEntries = pgTable(
  'logbook_entries',
  {
    id: id(),
    woId: uuid('wo_id')
      .notNull()
      .references(() => workOrders.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    kind: logbookKind('kind').notNull().default('note'),
    body: text('body').notNull().default(''),
    progressFrom: smallint('progress_from'),
    progressTo: smallint('progress_to'),
    statusFrom: woStatus('status_from'),
    statusTo: woStatus('status_to'),
    clientCreatedAt: tz('client_created_at'),
    /** Idempotensi offline: unik per penulis (PRD §4.2). */
    clientUuid: uuid('client_uuid'),
    requestHash: text('request_hash'),
    editedAt: tz('edited_at'),
    deletedAt: tz('deleted_at'),
    ...timestamps,
  },
  (t) => [
    index('logbook_wo_created_idx').on(t.woId, t.createdAt.desc()),
    uniqueIndex('logbook_author_client_uuid_unique').on(t.authorId, t.clientUuid),
    check('logbook_body_len', sql`char_length(${t.body}) <= 5000`),
  ],
);

export const progressEvents = pgTable(
  'progress_events',
  {
    id: id(),
    woId: uuid('wo_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    progress: smallint('progress').notNull(),
    status: woStatus('status').notNull(),
    recordedAt: tz('recorded_at').notNull().defaultNow(),
    sourceEntryId: uuid('source_entry_id').references(() => logbookEntries.id),
    ...timestamps,
  },
  (t) => [index('progress_events_wo_idx').on(t.woId, t.recordedAt)],
);

export const helpRequests = pgTable(
  'help_requests',
  {
    id: id(),
    woId: uuid('wo_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    status: helpStatus('status').notNull().default('open'),
    showFlag: boolean('show_flag').notNull().default(true),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: tz('resolved_at'),
    ...timestamps,
  },
  (t) => [
    /** FR-050 AC4: hanya satu permintaan `open` per WO. */
    uniqueIndex('help_requests_one_open')
      .on(t.woId)
      .where(sql`${t.status} = 'open'`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    eventKey: text('event_key').notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    url: text('url').notNull(),
    readAt: tz('read_at'),
    ...timestamps,
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt.desc())],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: id(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull(),
    status: deliveryStatus('status').notNull().default('queued'),
    /** Isi khusus kanal, mis. teks WhatsApp (PRD §6.3) — beda dari judul/isi in-app. */
    payload: jsonb('payload').$type<{ text: string }>(),
    providerMessageId: text('provider_message_id'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    scheduledFor: tz('scheduled_for').notNull().defaultNow(),
    sentAt: tz('sent_at'),
    ...timestamps,
  },
  (t) => [
    /** PRD §6.2 butir 6: satu notifikasi tidak terkirim dua kali per kanal. */
    uniqueIndex('notification_deliveries_unique').on(t.notificationId, t.channel),
    index('notification_deliveries_status_idx').on(t.status, t.scheduledFor),
  ],
);

export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
    scope: permissionScope('scope').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.permissionKey] })],
);

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  quietStart: time('quiet_start').notNull().default('21:00'),
  notifyEmail: boolean('notify_email').notNull().default(true),
  notifyWhatsapp: boolean('notify_whatsapp').notNull().default(true),
  quietEnd: time('quiet_end').notNull().default('07:00'),
  quietEnabled: boolean('quiet_enabled').notNull().default(true),
  batchingEnabled: boolean('batching_enabled').notNull().default(true),
  dailyDigest: boolean('daily_digest').notNull().default(true),
  theme: themePref('theme').notNull().default('system'),
  ...timestamps,
});

/** Status integrasi (mis. sesi OpenWA) — key/value kecil yang bertahan antar restart. */
export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

export type Project = typeof projects.$inferSelect;
export type WorkOrder = typeof workOrders.$inferSelect;
export type WoType = typeof woTypes.$inferSelect;
export type LogbookEntry = typeof logbookEntries.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
