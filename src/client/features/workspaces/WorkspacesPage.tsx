import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Building2, Code2, FilePlus2, FolderLock, Link2, LogOut, Plus, Save, ShieldCheck, Trash2, Users } from 'lucide-react'
import { CLIENT_HEADER } from '@shared/constants'
import { useSession } from '../../store/session'

type Workspace = { id: string; name: string; kind: 'global' | 'development' | 'organization'; role: 'owner' | 'admin' | 'editor' | 'viewer' }
type NoteSummary = { id: string; title: string; excerpt: string; revision: number; updatedAt: number }
type Note = { id: string; title: string; content: string; revision: number }
type Member = { userId: string; username: string; name: string; role: string }
type ApiErrorBody = { error?: { message?: string } }

async function callApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { [CLIENT_HEADER]: '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({})) as T & ApiErrorBody
  if (!response.ok) throw new Error(data.error?.message || 'The request could not be completed')
  return data
}

export function WorkspacesPage() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState('')
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [newOrgName, setNewOrgName] = useState('')
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer' | 'admin'>('editor')
  const [inviteUrl, setInviteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useMemo(() => workspaces.find((w) => w.id === activeId) ?? null, [workspaces, activeId])
  const canWrite = active?.role !== 'viewer'
  const canManage = active?.role === 'owner' || active?.role === 'admin'

  const refreshWorkspaces = useCallback(async () => {
    const result = await callApi<{ workspaces: Workspace[] }>('/api/workspaces')
    setWorkspaces(result.workspaces)
    setActiveId((current) => result.workspaces.some((w) => w.id === current) ? current : result.workspaces[0]?.id ?? '')
  }, [])

  const refreshWorkspace = useCallback(async (id: string, keepSelection = false) => {
    if (!id) return
    const [noteResult, memberResult] = await Promise.all([
      callApi<{ notes: NoteSummary[] }>(`/api/workspaces/${id}/notes`),
      callApi<{ members: Member[] }>(`/api/workspaces/${id}/members`),
    ])
    setNotes(noteResult.notes)
    setMembers(memberResult.members)
    if (!keepSelection) {
      setActiveNote(null)
      setTitle('')
      setContent('')
    }
    setInviteUrl('')
  }, [])

  useEffect(() => { void refreshWorkspaces().catch((e) => setError(e.message)) }, [refreshWorkspaces])
  useEffect(() => { if (activeId) void refreshWorkspace(activeId).catch((e) => setError(e.message)) }, [activeId, refreshWorkspace])

  useEffect(() => {
    const token = new URLSearchParams(location.search).get('invite')
    if (!token) return
    setBusy(true)
    callApi<{ accepted: boolean; workspaceId: string }>('/api/workspaces/invites/accept', 'POST', { token })
      .then(async (result) => {
        history.replaceState(null, '', '/workspaces')
        await refreshWorkspaces()
        setActiveId(result.workspaceId)
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }, [refreshWorkspaces])

  async function run(task: () => Promise<void>) {
    setBusy(true); setError('')
    try { await task() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') }
    finally { setBusy(false) }
  }

  async function createOrganization() {
    if (!newOrgName.trim()) return
    await run(async () => {
      const result = await callApi<{ workspace: Workspace }>('/api/workspaces', 'POST', { name: newOrgName, kind: 'organization' })
      setNewOrgName('')
      await refreshWorkspaces()
      setActiveId(result.workspace.id)
    })
  }

  async function createNote() {
    if (!active) return
    await run(async () => {
      const result = await callApi<{ note: Note }>(`/api/workspaces/${active.id}/notes`, 'POST', { title: 'Untitled note', content: '' })
      await refreshWorkspace(active.id)
      setActiveNote(result.note); setTitle(result.note.title); setContent(result.note.content)
    })
  }

  async function openNote(id: string) {
    if (!active) return
    await run(async () => {
      const result = await callApi<{ note: Note }>(`/api/workspaces/${active.id}/notes/${id}`)
      setActiveNote(result.note); setTitle(result.note.title); setContent(result.note.content)
    })
  }

  async function saveNote() {
    if (!active || !activeNote) return
    await run(async () => {
      const result = await callApi<{ saved: boolean; revision: number }>(`/api/workspaces/${active.id}/notes/${activeNote.id}`, 'PATCH', {
        title, content, revision: activeNote.revision,
      })
      setActiveNote({ ...activeNote, title, content, revision: result.revision })
      await refreshWorkspace(active.id, true)
    })
  }

  async function createInvite() {
    if (!active) return
    await run(async () => {
      const result = await callApi<{ invite: { token: string } }>(`/api/workspaces/${active.id}/invites`, 'POST', { role: inviteRole, expiresInDays: 7, maxUses: 1 })
      const url = new URL('/workspaces', location.origin)
      url.searchParams.set('invite', result.invite.token)
      setInviteUrl(url.toString())
      await navigator.clipboard?.writeText(url.toString()).catch(() => {})
    })
  }

  async function removeMember(memberId: string) {
    if (!active) return
    await run(async () => {
      await callApi<void>(`/api/workspaces/${active.id}/members/${memberId}`, 'DELETE')
      await refreshWorkspace(active.id)
    })
  }

  async function deleteOrganization() {
    if (!active || !window.confirm(`Delete "${active.name}" and all its shared notes?`)) return
    await run(async () => {
      await callApi<void>(`/api/workspaces/${active.id}`, 'DELETE')
      setActiveId('')
      await refreshWorkspaces()
    })
  }

  const Icon = active?.kind === 'global' ? FolderLock : active?.kind === 'development' ? Code2 : Building2
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 md:px-7">
        <div className="flex items-center gap-3">
          <a href="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ArrowLeft size={16}/> Back to notes</a>
          <span className="hidden h-5 w-px bg-[var(--border-subtle)] sm:block"/>
          <span className="font-serif text-base font-semibold">Inkstone Workspaces</span>
        </div>
        <button onClick={() => void logout()} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><LogOut size={14}/> Sign out</button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-sunken)] max-sm:w-16">
          <div className="p-3">
            <div className="mb-3 flex items-center justify-between px-1"><span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-quaternary)] max-sm:hidden">Your spaces</span><span className="text-[10px] text-[var(--text-quaternary)]">{workspaces.length}</span></div>
            <div className="space-y-1">
              {workspaces.map((w) => {
                const WIcon = w.kind === 'global' ? FolderLock : w.kind === 'development' ? Code2 : Building2
                return <button key={w.id} onClick={() => setActiveId(w.id)} title={w.name} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${activeId === w.id ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}><WIcon size={15}/><span className="min-w-0 flex-1 truncate max-sm:hidden">{w.name}</span>{w.kind === 'organization' && <Users size={12} className="text-[var(--text-quaternary)] max-sm:hidden"/>}</button>
              })}
            </div>
          </div>
          <div className="mt-auto border-t border-[var(--border-subtle)] p-3 max-sm:hidden">
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-[var(--text-quaternary)]">New organization</label>
            <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createOrganization() }} placeholder="Organization name" className="mb-2 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2 text-xs outline-none focus:border-[var(--accent)]"/>
            <button disabled={busy || !newOrgName.trim()} onClick={() => void createOrganization()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Plus size={14}/> Create workspace</button>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {error && <div role="alert" className="m-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">{error}<button className="float-right" onClick={() => setError('')}>Dismiss</button></div>}
          {!active ? <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-tertiary)]">Loading workspaces…</div> : <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4 md:px-8">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--accent-soft)] p-2.5 text-[var(--accent)]"><Icon size={20}/></span><div><h1 className="text-lg font-semibold">{active.name}</h1><p className="text-[11px] text-[var(--text-tertiary)]">{active.kind === 'global' ? 'Private to your account' : active.kind === 'development' ? 'Invite-only technical workspace' : 'Invite-only organization'} · {active.role}</p></div></div>
              {canWrite && <button disabled={busy} onClick={() => void createNote()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3.5 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><FilePlus2 size={14}/> New note</button>}
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,260px)_minmax(0,1fr)] max-md:grid-cols-1">
              <section className="min-h-0 overflow-y-auto border-r border-[var(--border-subtle)] max-md:max-h-44 max-md:border-b max-md:border-r-0">
                <div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-quaternary)]">Shared notes · {notes.length}</div>
                {notes.map((n) => <button key={n.id} onClick={() => void openNote(n.id)} className={`block w-full border-t border-[var(--border-subtle)] px-4 py-3 text-left hover:bg-[var(--bg-hover)] ${activeNote?.id === n.id ? 'bg-[var(--accent-soft)]' : ''}`}><span className="block truncate text-xs font-medium">{n.title || 'Untitled note'}</span><span className="mt-1 block truncate text-[10px] text-[var(--text-quaternary)]">{n.excerpt || 'No preview yet'}</span></button>)}
                {!notes.length && <p className="px-4 py-6 text-center text-xs text-[var(--text-quaternary)]">No shared notes yet.</p>}
              </section>
              <section className="flex min-h-0 min-w-0 flex-col">
                {activeNote ? <>
                  <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3"><input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canWrite} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" placeholder="Note title"/>{canWrite && <button disabled={busy} onClick={() => void saveNote()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs hover:bg-[var(--bg-hover)] disabled:opacity-40"><Save size={13}/> Save</button>}</div>
                  <textarea value={content} onChange={(e) => setContent(e.target.value)} readOnly={!canWrite} placeholder="Write shared Markdown notes here…" className="min-h-0 flex-1 resize-none bg-transparent p-5 font-mono text-xs leading-6 outline-none md:p-8"/>
                </> : <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-xs text-[var(--text-quaternary)]"><ShieldCheck size={28}/><p>Select a shared note or create one.</p><p>Workspace notes are separate from your personal vault.</p></div>}
              </section>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-3 md:px-8">
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-quaternary)]"><Users size={13}/>{members.length} member{members.length === 1 ? '' : 's'} · Invite-only</div>
              {canManage && active.kind !== 'global' && <div className="flex flex-wrap items-center gap-2">
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-2 text-[11px]"><option value="editor">Editor</option><option value="viewer">Viewer</option>{active.role === 'owner' && <option value="admin">Admin</option>}</select>
                <button disabled={busy} onClick={() => void createInvite()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px] hover:bg-[var(--bg-hover)]"><Link2 size={13}/> Create invite</button>
                {active.kind === 'organization' && active.role === 'owner' && <button disabled={busy} onClick={() => void deleteOrganization()} title="Delete organization" className="rounded-lg p-2 text-[var(--danger)] hover:bg-[var(--danger-soft)]"><Trash2 size={14}/></button>}
              </div>}
            </footer>
            {inviteUrl && <div className="border-t border-[var(--border-subtle)] px-5 py-2 text-[11px] text-[var(--text-secondary)]">Invite link created and copied: <a href={inviteUrl} className="break-all text-[var(--accent)] underline">{inviteUrl}</a></div>}
            {canManage && <div className="max-h-32 overflow-y-auto border-t border-[var(--border-subtle)] px-5 py-2"><div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-[var(--text-quaternary)]">Members</div><div className="flex flex-wrap gap-2">{members.map((m) => <span key={m.userId} className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-sunken)] px-2.5 py-1 text-[10px]">{m.name || m.username} · {m.role}{m.role !== 'owner' && <button onClick={() => void removeMember(m.userId)} title="Remove member" className="text-[var(--danger)]">×</button>}</span>)}</div></div>}
          </>}
          <div className="sr-only" aria-live="polite">{busy ? 'Working' : 'Ready'}</div>
        </main>
      </div>
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-4 text-[9px] text-[var(--text-quaternary)]"><span>Inkstone · Private by default</span><span>{user?.username ? `Signed in as @${user.username}` : ''}</span></div>
    </div>
  )
}
