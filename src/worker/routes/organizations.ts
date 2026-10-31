import { Hono } from 'hono'
import type { AppBindings } from '../env'
import { ApiError } from '../lib/errors'
import { newId } from '../lib/id'
import { readJson } from '../lib/request'
import { requireAuth } from '../middleware/auth'

export const organizationRoutes = new Hono<AppBindings>()
organizationRoutes.use('*', requireAuth)

let schemaReady: Promise<void> | null = null
async function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaReady) schemaReady = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS organization_members (organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')), joined_at INTEGER NOT NULL, PRIMARY KEY(organization_id,user_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS organization_invitations (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invitee TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')), token_hash TEXT NOT NULL UNIQUE, invited_by TEXT NOT NULL, expires_at INTEGER NOT NULL, accepted_at INTEGER, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id,organization_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_org_invites_org ON organization_invitations(organization_id,created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS organization_workspaces (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS organization_documents (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, folder_id TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS organization_folders (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_org_docs_workspace ON organization_documents(organization_id,workspace_id,deleted_at,updated_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_org_folders_parent ON organization_folders(organization_id,workspace_id,parent_id,name)`),
  ]).then(()=>undefined)
  try {
    await schemaReady
    const columns = await db.prepare('PRAGMA table_info(organization_documents)').all<{name:string}>()
    if (!columns.results.some(column => column.name === 'folder_id')) {
      await db.prepare('ALTER TABLE organization_documents ADD COLUMN folder_id TEXT').run()
    }
  } catch (error) { schemaReady = null; throw error }
}

const roles = new Set(['admin','editor','viewer'])
const normalize = (value: unknown, max = 80) => typeof value === 'string' ? value.trim().slice(0,max) : ''
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((b)=>b.toString(16).padStart(2,'0')).join('')
}
function token(): string {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
async function membership(db:D1Database, orgId:string, userId:string) {
  return db.prepare(`SELECT o.id,o.name,o.slug,o.owner_id,m.role FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE o.id=?1 AND m.user_id=?2`)
    .bind(orgId,userId).first<{id:string;name:string;slug:string;owner_id:string;role:'owner'|'admin'|'editor'|'viewer'}>()
}
function canWrite(role:string) { return role==='owner'||role==='admin'||role==='editor' }
function canManage(role:string) { return role==='owner'||role==='admin' }

organizationRoutes.use('*', async (c,next)=>{ await ensureSchema(c.env.DB); await next() })

organizationRoutes.get('/', async c=>{
  const rows=await c.env.DB.prepare(`SELECT o.id,o.name,o.slug,o.created_at,m.role,(SELECT COUNT(*) FROM organization_members x WHERE x.organization_id=o.id) member_count FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE m.user_id=?1 ORDER BY o.created_at DESC`)
    .bind(c.get('userId')).all()
  return c.json({organizations:rows.results})
})

organizationRoutes.post('/', async c=>{
  const body=await readJson<{name?:string}>(c,4096)
  const name=normalize(body.name,64)
  if(name.length<2) throw ApiError.badRequest('Organization name must be at least 2 characters')
  const id=newId(), now=Date.now()
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)+'-'+id.slice(-5)
  const userId=c.get('userId')
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO organizations(id,name,slug,owner_id,created_at) VALUES(?1,?2,?3,?4,?5)`).bind(id,name,slug,userId,now),
    c.env.DB.prepare(`INSERT INTO organization_members(organization_id,user_id,role,joined_at) VALUES(?1,?2,'owner',?3)`).bind(id,userId,now),
    c.env.DB.prepare(`INSERT INTO organization_workspaces(id,organization_id,name,created_by,created_at) VALUES(?1,?2,'General',?3,?4)`).bind(newId(),id,userId,now),
  ])
  return c.json({id,name,slug,role:'owner'},201)
})

organizationRoutes.post('/invitations/accept',async c=>{
  const body=await readJson<{token?:string}>(c,4096)
  const raw=normalize(body.token,160)
  if(raw.length<30) throw ApiError.badRequest('Invalid invitation token')
  const invite=await c.env.DB.prepare(`SELECT id,organization_id,invitee,role,expires_at,accepted_at FROM organization_invitations WHERE token_hash=?1`)
    .bind(await digest(raw)).first<{id:string;organization_id:string;invitee:string;role:string;expires_at:number;accepted_at:number|null}>()
  if(!invite||invite.accepted_at||invite.expires_at<Date.now()) throw ApiError.notFound('Invitation is invalid or expired')
  if(invite.invitee.toLowerCase()!==c.get('user').login.toLowerCase()) throw ApiError.forbidden('This invitation was issued to a different account')
  const userId=c.get('userId'), now=Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR IGNORE INTO organization_members(organization_id,user_id,role,joined_at) VALUES(?1,?2,?3,?4)`).bind(invite.organization_id,userId,invite.role,now),
    c.env.DB.prepare(`UPDATE organization_invitations SET accepted_at=?1 WHERE id=?2 AND accepted_at IS NULL`).bind(now,invite.id),
  ])
  return c.json({ok:true,organizationId:invite.organization_id})
})

organizationRoutes.post('/:orgId/invitations',async c=>{
  const userId=c.get('userId'), orgId=c.req.param('orgId')
  const member=await membership(c.env.DB,orgId,userId)
  if(!member||!canManage(member.role)) throw ApiError.forbidden('Only organization owners and admins can invite members')
  const body=await readJson<{invitee?:string;role?:string}>(c,4096)
  const invitee=normalize(body.invitee,160).toLowerCase(), role=normalize(body.role,16)
  if(!invitee||!roles.has(role)) throw ApiError.badRequest('Enter an account login and a valid role')
  if(role==='admin'&&member.role!=='owner') throw ApiError.forbidden('Only the organization owner can invite admins')
  const raw=token(), id=newId(), now=Date.now(), expires=now+7*24*60*60*1000
  await c.env.DB.prepare(`INSERT INTO organization_invitations(id,organization_id,invitee,role,token_hash,invited_by,expires_at,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
    .bind(id,orgId,invitee,role,await digest(raw),userId,expires,now).run()
  return c.json({id,invitee,role,expiresAt:expires,token:raw,acceptPath:'/settings?section=organizations&invite='+raw},201)
})

organizationRoutes.get('/:orgId/workspaces',async c=>{
  const userId=c.get('userId'), orgId=c.req.param('orgId')
  const member=await membership(c.env.DB,orgId,userId)
  if(!member) throw ApiError.forbidden('You are not a member of this organization')
  const rows=await c.env.DB.prepare(`SELECT w.id,w.name,w.created_at,(SELECT COUNT(*) FROM organization_documents d WHERE d.workspace_id=w.id AND d.deleted_at IS NULL) document_count FROM organization_workspaces w WHERE w.organization_id=?1 ORDER BY w.created_at`)
    .bind(orgId).all()
  return c.json({workspaces:rows.results,role:member.role})
})

organizationRoutes.post('/:orgId/workspaces',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),member=await membership(c.env.DB,orgId,userId)
  if(!member||!canManage(member.role)) throw ApiError.forbidden('Only owners and admins can create workspaces')
  const body=await readJson<{name?:string}>(c,4096),name=normalize(body.name,64)
  if(name.length<2) throw ApiError.badRequest('Workspace name must be at least 2 characters')
  const id=newId(),now=Date.now()
  await c.env.DB.prepare(`INSERT INTO organization_workspaces(id,organization_id,name,created_by,created_at) VALUES(?1,?2,?3,?4,?5)`).bind(id,orgId,name,userId,now).run()
  return c.json({id,name,createdAt:now},201)
})


organizationRoutes.get('/:orgId/workspaces/:workspaceId/tree',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),workspaceId=c.req.param('workspaceId')
  const member=await membership(c.env.DB,orgId,userId)
  if(!member) throw ApiError.forbidden('You are not a member of this organization')
  const workspace=await c.env.DB.prepare('SELECT id FROM organization_workspaces WHERE id=?1 AND organization_id=?2').bind(workspaceId,orgId).first()
  if(!workspace) throw ApiError.notFound('Workspace not found')
  const parentId=c.req.query('parentId')||null
  if(parentId&&!await c.env.DB.prepare('SELECT id FROM organization_folders WHERE id=?1 AND organization_id=?2 AND workspace_id=?3').bind(parentId,orgId,workspaceId).first()) throw ApiError.notFound('Folder not found')
  const [folders,documents]=await Promise.all([
    c.env.DB.prepare('SELECT id,name,parent_id parentId,created_at createdAt,updated_at updatedAt FROM organization_folders WHERE organization_id=?1 AND workspace_id=?2 AND parent_id IS ?3 ORDER BY name COLLATE NOCASE').bind(orgId,workspaceId,parentId).all(),
    c.env.DB.prepare('SELECT id,title,substr(content,1,240) excerpt,updated_at updatedAt,folder_id folderId FROM organization_documents WHERE organization_id=?1 AND workspace_id=?2 AND folder_id IS ?3 AND deleted_at IS NULL ORDER BY title COLLATE NOCASE').bind(orgId,workspaceId,parentId).all()
  ])
  return c.json({folders:folders.results,documents:documents.results,role:member.role})
})

organizationRoutes.post('/:orgId/workspaces/:workspaceId/folders',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),workspaceId=c.req.param('workspaceId')
  const member=await membership(c.env.DB,orgId,userId)
  if(!member||!canWrite(member.role)) throw ApiError.forbidden('Your role is read-only')
  const body=await readJson<{name?:string;parentId?:string|null}>(c,4096),name=normalize(body.name,80),parentId=body.parentId||null
  if(!name) throw ApiError.badRequest('Folder name is required')
  if(!await c.env.DB.prepare('SELECT id FROM organization_workspaces WHERE id=?1 AND organization_id=?2').bind(workspaceId,orgId).first()) throw ApiError.notFound('Workspace not found')
  if(parentId&&!await c.env.DB.prepare('SELECT id FROM organization_folders WHERE id=?1 AND organization_id=?2 AND workspace_id=?3').bind(parentId,orgId,workspaceId).first()) throw ApiError.notFound('Parent folder not found')
  const id=newId(),now=Date.now()
  await c.env.DB.prepare('INSERT INTO organization_folders(id,organization_id,workspace_id,parent_id,name,created_by,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)').bind(id,orgId,workspaceId,parentId,name,userId,now).run()
  return c.json({id,name,parentId,createdAt:now},201)
})

organizationRoutes.patch('/:orgId/workspaces/:workspaceId/folders/:folderId',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),workspaceId=c.req.param('workspaceId'),folderId=c.req.param('folderId')
  const member=await membership(c.env.DB,orgId,userId)
  if(!member||!canWrite(member.role)) throw ApiError.forbidden('Your role is read-only')
  const body=await readJson<{name?:string;parentId?:string|null}>(c,4096)
  const current=await c.env.DB.prepare('SELECT id FROM organization_folders WHERE id=?1 AND organization_id=?2 AND workspace_id=?3').bind(folderId,orgId,workspaceId).first()
  if(!current) throw ApiError.notFound('Folder not found')
  if(body.name!==undefined){const name=normalize(body.name,80);if(!name)throw ApiError.badRequest('Folder name is required');await c.env.DB.prepare('UPDATE organization_folders SET name=?1,updated_at=?2 WHERE id=?3').bind(name,Date.now(),folderId).run()}
  if(body.parentId!==undefined){
    const parentId=body.parentId||null
    if(parentId===folderId)throw ApiError.badRequest('A folder cannot contain itself')
    if(parentId&&!await c.env.DB.prepare('SELECT id FROM organization_folders WHERE id=?1 AND organization_id=?2 AND workspace_id=?3').bind(parentId,orgId,workspaceId).first())throw ApiError.notFound('Destination folder not found')
    let cursor=parentId,depth=0
    while(cursor&&depth++<100){if(cursor===folderId)throw ApiError.badRequest('Moving this folder would create a folder loop');const row=await c.env.DB.prepare('SELECT parent_id FROM organization_folders WHERE id=?1').bind(cursor).first<{parent_id:string|null}>();cursor=row?.parent_id||null}
    await c.env.DB.prepare('UPDATE organization_folders SET parent_id=?1,updated_at=?2 WHERE id=?3').bind(parentId,Date.now(),folderId).run()
  }
  return c.json({ok:true})
})

organizationRoutes.delete('/:orgId/workspaces/:workspaceId/folders/:folderId',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),workspaceId=c.req.param('workspaceId'),folderId=c.req.param('folderId')
  const member=await membership(c.env.DB,orgId,userId)
  if(!member||!canManage(member.role))throw ApiError.forbidden('Only owners and admins can delete folders')
  const folder=await c.env.DB.prepare('SELECT id FROM organization_folders WHERE id=?1 AND organization_id=?2 AND workspace_id=?3').bind(folderId,orgId,workspaceId).first()
  if(!folder)throw ApiError.notFound('Folder not found')
  const [children,docs]=await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) count FROM organization_folders WHERE parent_id=?1').bind(folderId).first<{count:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) count FROM organization_documents WHERE folder_id=?1 AND deleted_at IS NULL').bind(folderId).first<{count:number}>()
  ])
  if((children?.count||0)>0||(docs?.count||0)>0)throw ApiError.badRequest('Move or delete the folder contents before deleting this folder')
  await c.env.DB.prepare('DELETE FROM organization_folders WHERE id=?1').bind(folderId).run()
  return c.json({ok:true})
})

organizationRoutes.get('/:orgId/workspaces/:workspaceId/documents',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),workspaceId=c.req.param('workspaceId')
  const member=await membership(c.env.DB,orgId,userId)
  if(!member) throw ApiError.forbidden('You are not a member of this organization')
  const workspace=await c.env.DB.prepare(`SELECT id FROM organization_workspaces WHERE id=?1 AND organization_id=?2`).bind(workspaceId,orgId).first()
  if(!workspace) throw ApiError.notFound('Workspace not found')
  const rows=await c.env.DB.prepare(`SELECT id,title,substr(content,1,240) excerpt,created_by,updated_by,created_at,updated_at FROM organization_documents WHERE organization_id=?1 AND workspace_id=?2 AND deleted_at IS NULL ORDER BY updated_at DESC`).bind(orgId,workspaceId).all()
  return c.json({documents:rows.results,role:member.role})
})

organizationRoutes.post('/:orgId/workspaces/:workspaceId/documents',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),workspaceId=c.req.param('workspaceId')
  const member=await membership(c.env.DB,orgId,userId)
  if(!member||!canWrite(member.role)) throw ApiError.forbidden('Your role is read-only')
  const body=await readJson<{title?:string;content?:string;folderId?:string|null}>(c,262144)
  const title=normalize(body.title,160),content=typeof body.content==='string'?body.content:'',folderId=body.folderId||null
  if(!title) throw ApiError.badRequest('Document title is required')
  if(content.length>200000) throw ApiError.badRequest('Document content is too large')
  const workspace=await c.env.DB.prepare(`SELECT id FROM organization_workspaces WHERE id=?1 AND organization_id=?2`).bind(workspaceId,orgId).first()
  if(!workspace) throw ApiError.notFound('Workspace not found')
  if(folderId&&!await c.env.DB.prepare('SELECT id FROM organization_folders WHERE id=?1 AND organization_id=?2 AND workspace_id=?3').bind(folderId,orgId,workspaceId).first()) throw ApiError.notFound('Folder not found')
  const id=newId(),now=Date.now()
  await c.env.DB.prepare(`INSERT INTO organization_documents(id,organization_id,workspace_id,title,content,created_by,updated_by,created_at,updated_at,folder_id) VALUES(?1,?2,?3,?4,?5,?6,?6,?7,?7,?8)`).bind(id,orgId,workspaceId,title,content,userId,now,folderId).run()
  return c.json({id,title,content,createdAt:now,updatedAt:now},201)
})

organizationRoutes.get('/:orgId/workspaces/:workspaceId/documents/:documentId',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),member=await membership(c.env.DB,orgId,userId)
  if(!member) throw ApiError.forbidden('You are not a member of this organization')
  const doc=await c.env.DB.prepare(`SELECT id,title,content,created_at,updated_at FROM organization_documents WHERE id=?1 AND organization_id=?2 AND workspace_id=?3 AND deleted_at IS NULL`).bind(c.req.param('documentId'),orgId,c.req.param('workspaceId')).first()
  if(!doc) throw ApiError.notFound('Document not found')
  return c.json(doc)
})

organizationRoutes.put('/:orgId/workspaces/:workspaceId/documents/:documentId',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),member=await membership(c.env.DB,orgId,userId)
  if(!member||!canWrite(member.role)) throw ApiError.forbidden('Your role is read-only')
  const body=await readJson<{title?:string;content?:string}>(c,262144)
  const title=normalize(body.title,160),content=typeof body.content==='string'?body.content:''
  if(!title||content.length>200000) throw ApiError.badRequest('A title is required and content must be under 200 KB')
  const result=await c.env.DB.prepare(`UPDATE organization_documents SET title=?1,content=?2,updated_by=?3,updated_at=?4 WHERE id=?5 AND organization_id=?6 AND workspace_id=?7 AND deleted_at IS NULL`).bind(title,content,userId,Date.now(),c.req.param('documentId'),orgId,c.req.param('workspaceId')).run()
  if(!result.meta.changes) throw ApiError.notFound('Document not found')
  return c.json({ok:true})
})

organizationRoutes.delete('/:orgId/workspaces/:workspaceId/documents/:documentId',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId'),member=await membership(c.env.DB,orgId,userId)
  if(!member||!canManage(member.role)) throw ApiError.forbidden('Only owners and admins can delete shared documents')
  const result=await c.env.DB.prepare(`UPDATE organization_documents SET deleted_at=?1 WHERE id=?2 AND organization_id=?3 AND workspace_id=?4 AND deleted_at IS NULL`).bind(Date.now(),c.req.param('documentId'),orgId,c.req.param('workspaceId')).run()
  if(!result.meta.changes) throw ApiError.notFound('Document not found')
  return c.json({ok:true})
})

organizationRoutes.get('/:orgId/members',async c=>{
  const userId=c.get('userId'),orgId=c.req.param('orgId')
  if(!await membership(c.env.DB,orgId,userId)) throw ApiError.forbidden('You are not a member of this organization')
  const rows=await c.env.DB.prepare(`SELECT m.user_id userId,u.login,u.name,m.role,m.joined_at joinedAt FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=?1 ORDER BY m.joined_at`).bind(orgId).all()
  return c.json({members:rows.results})
})
