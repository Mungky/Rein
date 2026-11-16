import { api } from '$lib/api';
import type { ProjectListItem } from '$lib/types';

export async function load({ depends }) {
  depends('app:projects');
  return api<{ projects: ProjectListItem[]; can: { create: boolean } }>('/api/projects');
}
