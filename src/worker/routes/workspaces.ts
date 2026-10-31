import { Hono, type Context } from 'hono'
import type { AppBindings } from '../env'
import { ApiError } from '../lib/errors'
import { newId } from '../lib/id'
import { readJson } from '../lib/request'
import { requireAuth } from '../middleware/auth'

type WorkspaceKind = 'global' | 'development' | 'organization'
type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'
type WorkspaceRow = {
  id: string; name: string; kind: WorkspaceKind; owner_id: string
  role: WorkspaceRole; created_at: number; updated_at: number
}
type MemberRow = { user_id: string; username: string; name: string; role: WorkspaceRole; joined_at: number }

export const workspaceRoutes = new Hono<AppBindings>()
workspaceRoutes.use('*', requireAuth)

const now = () => Date.now()
const cleanName = (value: unknown) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 80) : ''

async function tokenHash(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function canManage(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin'
}
function canWrite(role: WorkspaceRole): boolean {
  return role !== 'viewer'
}
async function membership(c: Context<AppBindings>, workspaceId: string) {
  const userId = c.get('userId') as string
  const row = await c.env.DB.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2',
  ).bind(workspaceId, userId).first<{ role: WorkspaceRole }>()
  if (!row) throw ApiError.notFound('Workspace not found')
  return row.role
}
async function requireManager(c: Context<AppBindings>, workspaceId: string) {
  const role = await membership(c, workspaceId)
  if (!canManage(role)) throw ApiError.forbidden('Workspace administrator permission required')
  return role
}
function workspaceDto(row: WorkspaceRow) {
  return { id: row.id, name: row.name, kind: row.kind, ownerId: row.owner_id,
    role: row.role, createdAt: row.created_at, updatedAt: row.updated_at }
}

workspaceRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const db = c.env.DB
  const stamp = now()
  // Every account receives its own private Global space and a private Development
  // space. The latter can be shared later by explicit invitations.
  for (const [kind, name] of [['global', 'Global'], ['development', 'Development']] as const) {
    const id = newId()
    await db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, kind, owner_id, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?5
       WHERE NOT EXISTS (
         SELECT 1 FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
         WHERE w.kind = ?3 AND w.owner_id = ?4 AND m.user_id = ?4
       )`,
    ).bind(id, name, kind, userId, stamp).run()
    await db.prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
       SELECT id, ?1, 'owner', ?2 FROM workspaces
       WHERE kind = ?3 AND owner_id = ?1`,
    ).bind(userId, stamp, kind).run()
  }
  const rows = await db.prepare(
    `SELECT w.id, w.name, w.kind, w.owner_id, m.role, w.created_at, w.updated_at
     FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = ?1 ORDER BY CASE w.kind WHEN 'global' THEN 0 WHEN 'development' THEN 1 ELSE 2 END, w.name COLLATE NOCASE`,
  ).bind(userId).all<WorkspaceRow>()
  return c.json({ workspaces: (rows.results ?? []).map(workspaceDto) })
})

workspaceRoutes.post('/', async (c) => {
  const body = await readJson<{ name?: string; kind?: string }>(c, 4096)
  const name = cleanName(body.name)
  const kind = body.kind
  if (!name) throw new ApiError(400, 'bad_request', 'Enter a workspace name')
  if (kind !== 'organization') throw new ApiError(400, 'bad_request', 'Only organization workspaces can be created here')
  const userId = c.get('userId')
  const stamp = now()
  const id = newId()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO workspaces (id, name, kind, owner_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)')
      .bind(id, name, kind, userId, stamp),
    c.env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?1, ?2, 'owner', ?3)")
      .bind(id, userId, stamp),
  ])
  return c.json({ workspace: { id, name, kind, ownerId: userId, role: 'owner', createdAt: stamp, updatedAt: stamp } }, 201)
})

workspaceRoutes.get('/:workspaceId/members', async (c) => {
  const id = c.req.param('workspaceId')
  await membership(c, id)
  const rows = await c.env.DB.prepare(
    `SELECT m.user_id, u.username, u.name, m.role, m.joined_at
     FROM workspace_members m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ?1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.username COLLATE NOCASE`,
  ).bind(id).all<MemberRow>()
  return c.json({ members: (rows.results ?? []).map((m) => ({
    userId: m.user_id, username: m.username, name: m.name, role: m.role, joinedAt: m.joined_at,
  })) })
})

workspaceRoutes.post('/:workspaceId/invites', async (c) => {
  const id = c.req.param('workspaceId')
  const actorRole = await requireManager(c, id)
  const workspace = await c.env.DB.prepare('SELECT kind FROM workspaces WHERE id = ?1').bind(id).first<{ kind: WorkspaceKind }>()
  if (!workspace || workspace.kind === 'global') throw ApiError.forbidden('Global notes are private and cannot be invited to')
  const body = await readJson<{ role?: string; expiresInDays?: number; maxUses?: number }>(c, 4096)
  const role = body.role
  if (role !== 'admin' && role !== 'editor' && role !== 'viewer') {
    throw new ApiError(400, 'bad_request', 'Choose admin, editor, or viewer')
  }
  if (actorRole !== 'owner' && role === 'admin') {
    throw ApiError.forbidden('Only the workspace owner can invite administrators')
  }
  const days = Number.isInteger(body.expiresInDays) ? Math.min(30, Math.max(1, body.expiresInDays!)) : 7
  const maxUses = Number.isInteger(body.maxUses) ? Math.min(25, Math.max(1, body.maxUses!)) : 1
  const token = newInviteToken()
  const inviteId = newId()
  const stamp = now()
  const expiresAt = stamp + days * 24 * 60 * 60 * 1000
  await c.env.DB.prepare(
    'INSERT INTO workspace_invites (id, workspace_id, token_hash, role, created_by, expires_at, max_uses, uses, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)',
  ).bind(inviteId, id, await tokenHash(token), role, c.get('userId'), expiresAt, maxUses, stamp).run()
  return c.json({ invite: { id: inviteId, token, role, expiresAt, maxUses } }, 201)
})

workspaceRoutes.post('/invites/accept', async (c) => {
  const body = await readJson<{ token?: string }>(c, 4096)
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, 'bad_request', 'Invitation link is invalid or expired')
  const hash = await tokenHash(token)
  const stamp = now()
  const invite = await c.env.DB.prepare(
    `SELECT id, workspace_id, role, expires_at, max_uses, uses
     FROM workspace_invites WHERE token_hash = ?1 AND revoked_at IS NULL`,
  ).bind(hash).first<{ id: string; workspace_id: string; role: WorkspaceRole; expires_at: number; max_uses: number; uses: number }>()
  if (!invite || invite.expires_at <= stamp || invite.uses >= invite.max_uses) {
    throw new ApiError(409, 'conflict', 'Invitation link is invalid, expired, or already used')
  }
  const userId = c.get('userId')
  const exists = await c.env.DB.prepare(
    'SELECT 1 AS present FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2',
  ).bind(invite.workspace_id, userId).first()
  if (exists) return c.json({ accepted: true, workspaceId: invite.workspace_id, alreadyMember: true })
  const result = await c.env.DB.prepare(
    `UPDATE workspace_invites SET uses = uses + 1
     WHERE id = ?1 AND revoked_at IS NULL AND expires_at > ?2 AND uses < max_uses`,
  ).bind(invite.id, stamp).run()
  if (!result.meta.changes) throw new ApiError(409, 'conflict', 'Invitation link is no longer available')
  await c.env.DB.prepare(
    'INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?1, ?2, ?3, ?4)',
  ).bind(invite.workspace_id, userId, invite.role, stamp).run()
  return c.json({ accepted: true, workspaceId: invite.workspace_id })
})

workspaceRoutes.patch('/:workspaceId/members/:memberId', async (c) => {
  const id = c.req.param('workspaceId')
  const actorRole = await requireManager(c, id)
  if (actorRole !== 'owner') throw ApiError.forbidden('Only the workspace owner can change member roles')
  const memberId = c.req.param('memberId')
  const body = await readJson<{ role?: string }>(c, 4096)
  if (body.role !== 'admin' && body.role !== 'editor' && body.role !== 'viewer') {
    throw new ApiError(400, 'bad_request', 'Choose admin, editor, or viewer')
  }
  const target = await c.env.DB.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2',
  ).bind(id, memberId).first<{ role: WorkspaceRole }>()
  if (!target || target.role === 'owner') throw ApiError.notFound('Member not found')
  await c.env.DB.prepare(
    'UPDATE workspace_members SET role = ?1 WHERE workspace_id = ?2 AND user_id = ?3',
  ).bind(body.role, id, memberId).run()
  return c.json({ updated: true, role: body.role })
})

workspaceRoutes.delete('/:workspaceId/members/:memberId', async (c) => {
  const id = c.req.param('workspaceId')
  const memberId = c.req.param('memberId')
  const actorRole = await requireManager(c, id)
  const target = await c.env.DB.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2',
  ).bind(id, memberId).first<{ role: WorkspaceRole }>()
  if (!target) throw ApiError.notFound('Member not found')
  if (target.role === 'owner') throw ApiError.forbidden('The workspace owner cannot be removed')
  if (actorRole !== 'owner' && target.role === 'admin') throw ApiError.forbidden('Only the owner can remove an administrator')
  await c.env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2')
    .bind(id, memberId).run()
  return c.body(null, 204)
})

workspaceRoutes.get('/:workspaceId/notes', async (c) => {
  const id = c.req.param('workspaceId')
  await membership(c, id)
  const rows = await c.env.DB.prepare(
    `SELECT id, title, substr(content, 1, 240) AS excerpt, revision, created_by, created_at, updated_at
     FROM workspace_notes WHERE workspace_id = ?1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500`,
  ).bind(id).all<any>()
  return c.json({ notes: (rows.results ?? []).map((n) => ({
    id: n.id, title: n.title, excerpt: n.excerpt, revision: n.revision,
    createdBy: n.created_by, createdAt: n.created_at, updatedAt: n.updated_at,
  })) })
})

workspaceRoutes.post('/:workspaceId/notes', async (c) => {
  const id = c.req.param('workspaceId')
  const role = await membership(c, id)
  if (!canWrite(role)) throw ApiError.forbidden('This workspace is read-only for your account')
  const body = await readJson<{ title?: string; content?: string }>(c, 256 * 1024)
  const title = cleanName(body.title)
  const content = typeof body.content === 'string' ? body.content.slice(0, 200_000) : ''
  const stamp = now()
  const noteId = newId()
  await c.env.DB.prepare(
    'INSERT INTO workspace_notes (id, workspace_id, created_by, title, content, revision, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)',
  ).bind(noteId, id, c.get('userId'), title, content, stamp).run()
  return c.json({ note: { id: noteId, title, content, revision: 1, createdAt: stamp, updatedAt: stamp } }, 201)
})

workspaceRoutes.get('/:workspaceId/notes/:noteId', async (c) => {
  const id = c.req.param('workspaceId')
  await membership(c, id)
  const note = await c.env.DB.prepare(
    'SELECT id, title, content, revision, created_by, created_at, updated_at FROM workspace_notes WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL',
  ).bind(c.req.param('noteId'), id).first<any>()
  if (!note) throw ApiError.notFound('Note not found')
  return c.json({ note: { id: note.id, title: note.title, content: note.content, revision: note.revision, createdBy: note.created_by, createdAt: note.created_at, updatedAt: note.updated_at } })
})

workspaceRoutes.patch('/:workspaceId/notes/:noteId', async (c) => {
  const id = c.req.param('workspaceId')
  const role = await membership(c, id)
  if (!canWrite(role)) throw ApiError.forbidden('This workspace is read-only for your account')
  const body = await readJson<{ title?: string; content?: string; revision?: number }>(c, 256 * 1024)
  if (!Number.isInteger(body.revision) || body.revision! < 1) throw new ApiError(400, 'bad_request', 'A note revision is required')
  const title = body.title === undefined ? undefined : cleanName(body.title)
  const content = body.content === undefined ? undefined : typeof body.content === 'string' ? body.content.slice(0, 200_000) : ''
  if (title === undefined && content === undefined) throw new ApiError(400, 'bad_request', 'No note changes were provided')
  const stamp = now()
  const result = await c.env.DB.prepare(
    `UPDATE workspace_notes SET title = COALESCE(?1, title), content = COALESCE(?2, content),
      revision = revision + 1, updated_at = ?3
     WHERE id = ?4 AND workspace_id = ?5 AND deleted_at IS NULL AND revision = ?6`,
  ).bind(title ?? null, content ?? null, stamp, c.req.param('noteId'), id, body.revision).run()
  if (!result.meta.changes) throw new ApiError(409, 'conflict', 'This note changed elsewhere. Reload it before saving')
  return c.json({ saved: true, revision: body.revision! + 1, updatedAt: stamp })
})

workspaceRoutes.delete('/:workspaceId/notes/:noteId', async (c) => {
  const id = c.req.param('workspaceId')
  const role = await membership(c, id)
  if (!canWrite(role)) throw ApiError.forbidden('This workspace is read-only for your account')
  await c.env.DB.prepare(
    'UPDATE workspace_notes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND workspace_id = ?3 AND deleted_at IS NULL',
  ).bind(now(), c.req.param('noteId'), id).run()
  return c.body(null, 204)
})

workspaceRoutes.patch('/:workspaceId', async (c) => {
  const id = c.req.param('workspaceId')
  await requireManager(c, id)
  const body = await readJson<{ name?: string }>(c, 4096)
  const name = cleanName(body.name)
  if (!name) throw new ApiError(400, 'bad_request', 'Enter a workspace name')
  const stamp = now()
  await c.env.DB.prepare('UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3')
    .bind(name, stamp, id).run()
  return c.json({ updated: true, name })
})

workspaceRoutes.delete('/:workspaceId', async (c) => {
  const id = c.req.param('workspaceId')
  const role = await membership(c, id)
  if (role !== 'owner') throw ApiError.forbidden('Only the workspace owner can delete it')
  const row = await c.env.DB.prepare('SELECT kind FROM workspaces WHERE id = ?1').bind(id).first<{ kind: WorkspaceKind }>()
  if (!row || row.kind !== 'organization') throw ApiError.forbidden('Personal and Development workspaces cannot be deleted')
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM workspace_invites WHERE workspace_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM workspace_notes WHERE workspace_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM workspaces WHERE id = ?1').bind(id),
  ])
  return c.body(null, 204)
})
