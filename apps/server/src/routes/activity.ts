import { PROJECT_STATUS_LABEL, WO_STATUS_LABEL, woNumberLabel } from '@rein/shared';
import { sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { authOf, requireVerified } from '../auth/middleware';
import { canDo } from '../auth/project-access';
import type { AppEnv } from '../context';
import { activityPeriod, activityPeriodQuery } from '../lib/activity-period';
import { validate } from '../lib/http';

const PAGE_SIZE = 20;
const summaries = {
  'project.created': 'membuat project',
  'project.updated': 'mengubah info project',
  'project.media_changed': 'mengubah foto atau banner project',
  'project.status_changed': 'mengubah status project',
  'project.member_added': 'menambahkan anggota project',
  'project.member_updated': 'mengubah peran anggota project',
  'project.member_removed': 'mengeluarkan anggota project',
  'wo.created': 'membuat WO',
  'wo.updated': 'memperbarui WO',
  'wo.status_changed': 'mengubah status WO',
  'wo.deleted': 'menghapus WO',
  'logbook.created': 'menambahkan Logbook',
  'logbook.updated': 'mengedit Logbook',
  'logbook.deleted': 'menghapus Logbook',
  'attachment.uploaded': 'menambahkan dokumen',
  'attachment.linked': 'menghubungkan dokumen ke WO',
  'material.created': 'menambahkan material',
  'material.updated': 'mengubah material',
  'material.deleted': 'menghapus material',
  'material.restored': 'memulihkan material',
  'material.linked': 'menghubungkan material ke WO',
  'material.unlinked': 'melepas material dari WO',
  help_request: 'meminta bantuan',
  help_resolved: 'menyelesaikan bantuan',
} as const;

type Action = keyof typeof summaries;
type Row = {
  id: string;
  happenedAt: string;
  actor: string | null;
  action: Action;
  projectId: string;
  projectName: string;
  woId: string | null;
  woSeq: number | null;
  woDeleted: boolean;
  noteId: string | null;
  subject: string | null;
  detail: string | null;
  before: string | null;
  after: string | null;
  createdCount: number | null;
  imported: boolean;
};

const actions = Object.keys(summaries).filter(
  (action) => action !== 'attachment.uploaded' && !action.startsWith('help_'),
);
const querySchema = activityPeriodQuery.extend({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  wo: z.uuid().optional(),
});

function activityId(value: SQL) {
  return sql`case when (${value}) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then (${value})::uuid end`;
}

function message(row: Row) {
  if (row.action === 'wo.updated' && row.detail === 'detail pekerjaan')
    return 'mengubah detail pekerjaan';
  if (row.action === 'material.created' && row.createdCount) {
    return row.imported || row.createdCount > 1
      ? `mengimpor ${row.createdCount} material`
      : 'menambahkan material';
  }
  const label: Readonly<Record<string, string>> =
    row.action === 'wo.status_changed' ? WO_STATUS_LABEL : PROJECT_STATUS_LABEL;
  if (
    (row.action === 'wo.status_changed' || row.action === 'project.status_changed') &&
    row.before &&
    row.after &&
    label[row.before] &&
    label[row.after]
  ) {
    return `${summaries[row.action]} dari ${label[row.before]} ke ${label[row.after]}`;
  }
  return summaries[row.action];
}

export const activityRoutes = new Hono<AppEnv>().use(requireVerified).get('/', async (c) => {
  const a = authOf(c);
  const { db } = c.var.deps;
  const query = validate(querySchema, c.req.query());
  const range = activityPeriod(query);
  const seeAll = canDo(a, 'project.view');
  if (!seeAll && !canDo(a, 'project.view', { project: { isMember: true, isManager: false } })) {
    return c.json({ items: [], hasNext: false });
  }
  const result = await db.execute<Row>(sql`
    with event as (
      select a.id, a.created_at as happened_at, a.actor_id, a.action,
        coalesce(w.project_id, p.id) as project_id, w.id as wo_id,
        case when n.deleted_at is null then n.id end as note_id,
        coalesce(f.file_name, m.description) as subject,
        case when a.action = 'wo.updated' then
          ${
            query.wo
              ? sql`(
            select string_agg(change.value, ' · ' order by change.position)
            from jsonb_array_elements_text(
              case when jsonb_typeof(a.diff_json -> 'changes') = 'array'
                then a.diff_json -> 'changes' else '[]'::jsonb end
            ) with ordinality as change(value, position)
          )`
              : sql`a.diff_json -> 'changes' ->> 0`
          }
          when a.action = 'wo.status_changed' and ${Boolean(query.wo)}
          then a.diff_json ->> 'reason'
        end as detail,
        a.diff_json ->> 'from' as before, a.diff_json ->> 'to' as after,
        case when a.action = 'material.created' and jsonb_typeof(a.diff_json -> 'materialIds') = 'array'
          then jsonb_array_length(a.diff_json -> 'materialIds') end as created_count,
        coalesce(a.diff_json ->> 'source' = 'excel', false) as imported
      from audit_logs a
      left join projects p on a.entity_type = 'project' and p.id = ${activityId(sql`a.entity_id`)}
      left join logbook_entries n on a.entity_type = 'logbook' and n.id = ${activityId(sql`a.entity_id`)}
      left join work_orders w on w.id = coalesce(
        case when a.entity_type = 'wo' then ${activityId(sql`a.entity_id`)} end,
        n.wo_id,
        case when a.action in ('attachment.linked', 'material.linked', 'material.unlinked')
          then ${activityId(sql`a.diff_json ->> 'woId'`)} end
      ) and (p.id is null or w.project_id = p.id)
      left join attachments f on a.action = 'attachment.linked' and f.id = ${activityId(sql`a.diff_json ->> 'attachmentId'`)}
      left join project_materials m on a.action like 'material.%' and m.project_id = p.id
        and m.id = ${activityId(sql`a.diff_json ->> 'materialId'`)}
      where a.action in (${sql.join(
        actions.map((value) => sql`${value}`),
        sql`, `,
      )})
      union all
      select f.id, f.created_at, f.uploaded_by, 'attachment.uploaded',
        coalesce(w.project_id, p.id), w.id, null, f.file_name, null, null, null, null, false
      from attachments f
      left join projects p on f.owner_type = 'project' and p.id = f.owner_id
      left join work_orders w on f.owner_type = 'wo' and w.id = f.owner_id
      where f.owner_type in ('project', 'wo')
        and f.id is distinct from p.logo_attachment_id
        and f.id is distinct from p.banner_attachment_id
        and not exists (
          select 1 from audit_logs media
          where media.entity_type = 'project' and media.entity_id = p.id::text
            and media.action in ('project.created', 'project.media_changed')
            and f.id::text in (
              media.diff_json ->> 'logoAttachmentId', media.diff_json ->> 'bannerAttachmentId',
              media.diff_json -> 'before' ->> 'logoAttachmentId', media.diff_json -> 'before' ->> 'bannerAttachmentId',
              media.diff_json -> 'after' ->> 'logoAttachmentId', media.diff_json -> 'after' ->> 'bannerAttachmentId'
            )
        )
      union all
      select n.id, n.created_at, n.author_id, n.kind::text, w.project_id, w.id,
        null, null, ${query.wo ? sql`n.body` : sql`null`}, null, null, null, false
      from logbook_entries n inner join work_orders w on w.id = n.wo_id
      where n.kind in ('help_request', 'help_resolved') and n.deleted_at is null
    )
    select e.id, to_char(e.happened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "happenedAt",
      u.full_name as actor, e.action,
      p.id as "projectId", p.name as "projectName", e.wo_id as "woId", w.seq as "woSeq",
      w.deleted_at is not null as "woDeleted", e.note_id as "noteId", e.subject, e.detail,
      e.before, e.after, e.created_count as "createdCount", e.imported
    from event e
    inner join projects p on p.id = e.project_id and p.deleted_at is null
    left join work_orders w on w.id = e.wo_id
    left join users u on u.id = e.actor_id
    where true
      ${
        seeAll
          ? sql``
          : sql`and exists (
        select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${a.user.id}
      )`
      }
      ${query.wo ? sql`and e.wo_id = ${query.wo} and w.deleted_at is null and e.action not like 'logbook.%'` : sql``}
      ${
        range
          ? sql`and e.happened_at >= ${range.from.toISOString()}::timestamptz
        and e.happened_at < ${range.to.toISOString()}::timestamptz`
          : sql``
      }
    order by e.happened_at desc, e.id desc
    limit ${PAGE_SIZE + 1} offset ${(query.page - 1) * PAGE_SIZE}
  `);
  return c.json({
    items: result.rows.slice(0, PAGE_SIZE).map((row) => ({
      id: row.id,
      happenedAt: row.happenedAt,
      actor: row.actor ?? 'Sistem',
      text: message(row),
      projectId: row.projectId,
      projectName: row.projectName,
      woId: row.woDeleted ? null : row.woId,
      woLabel: row.woSeq == null ? null : woNumberLabel(row.woSeq),
      noteId: row.noteId,
      subject: row.subject,
      detail:
        query.wo &&
        (row.action === 'help_request' ||
          row.action === 'wo.updated' ||
          row.action === 'wo.status_changed') &&
        row.detail !== 'detail pekerjaan'
          ? row.detail
          : null,
      target: row.action.startsWith('material.')
        ? 'materials'
        : row.action.startsWith('attachment.')
          ? 'files'
          : null,
    })),
    hasNext: result.rows.length > PAGE_SIZE,
  });
});
