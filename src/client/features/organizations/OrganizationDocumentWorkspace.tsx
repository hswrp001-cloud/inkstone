import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { Copy, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { DeferredCodeEditor } from '../../editor/CodeEditor'
import { Preview } from '../preview/Preview'
import { EditorToolbar } from '../workspace/EditorToolbar'
import { useSession } from '../../store/session'
import { Button } from '../../components/primitives'

export function OrganizationDocumentWorkspace({ organizationId, workspaceId, documentId }: { organizationId:string; workspaceId:string; documentId:string }) {
  const settings = useSession(s => s.settings)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [role, setRole] = useState('viewer')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastSaved, setLastSaved] = useState<number | null>(null)
  const [saveMode, setSaveMode] = useState<'manual'|'auto'>('auto')
  const [actionBusy, setActionBusy] = useState(false)
  const currentDraft = useRef({ title, content })
  currentDraft.current = { title, content }
  const [error, setError] = useState('')
  const [view, setView] = useState<EditorView|null>(null)
  const [layout, setLayout] = useState<'edit'|'split'|'preview'>('split')
  const sources = useMemo(() => ({ notes: () => [], tags: () => [] }), [])
  const handlers = useMemo(() => ({ uploadFile: async () => null }), [])

  useEffect(() => {
    let active = true
    Promise.all([
      api.organizations.getDocument(organizationId, workspaceId, documentId),
      api.organizations.workspaces(organizationId),
    ]).then(([doc, workspace]) => {
      if (!active) return
      setTitle(doc.title)
      setContent(doc.content)
      setRole(workspace.role)
      setLoaded(true)
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [organizationId, workspaceId, documentId])

  useEffect(() => {
    if (!loaded || !dirty || role === 'viewer' || !title.trim() || busy || saveMode !== 'auto') return
    const timer = window.setTimeout(async () => {
      const snapshot = { title, content }
      setBusy(true)
      setError('')
      try {
        await api.organizations.saveDocument(organizationId, workspaceId, documentId, snapshot.title, snapshot.content)
        if (currentDraft.current.title === snapshot.title && currentDraft.current.content === snapshot.content) setDirty(false)
        setLastSaved(Date.now())
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        setSaveMode('manual')
      } finally {
        setBusy(false)
      }
    }, 1100)
    return () => window.clearTimeout(timer)
  }, [loaded, dirty, role, title, content, busy, saveMode, organizationId, workspaceId, documentId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  async function save() {
    if (role === 'viewer' || !title.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const snapshot = { title, content }
      await api.organizations.saveDocument(organizationId, workspaceId, documentId, snapshot.title, snapshot.content)
      if (currentDraft.current.title === snapshot.title && currentDraft.current.content === snapshot.content) setDirty(false)
      setLastSaved(Date.now())
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function duplicateDocument() {
    if (role === 'viewer' || actionBusy) return
    setActionBusy(true)
    try {
      const copy = await api.organizations.createDocument(organizationId, workspaceId, title.trim() + ' (copy)', content)
      location.href = '/org-doc/' + organizationId + '/' + workspaceId + '/' + copy.id
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setActionBusy(false)
    }
  }

  async function deleteDocument() {
    if (role !== 'owner' && role !== 'admin') return
    if (!window.confirm('Move this shared document to the organization trash?')) return
    setActionBusy(true)
    try {
      await api.organizations.deleteDocument(organizationId, workspaceId, documentId)
      location.href = '/'
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setActionBusy(false)
    }
  }

  if (!loaded) return <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[var(--bg-editor)] text-sm text-[var(--text-secondary)]">{error || 'Loading shared document…'}</div>
  return <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-editor)]">
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
      <button type="button" onClick={() => { location.href = '/' }} className="shrink-0 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">← Back to files</button>
      <input aria-label="Document title" className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none" value={title} disabled={role === 'viewer'} onChange={e => { setTitle(e.target.value); setDirty(true) }}/>
      <span className="hidden text-[11px] text-[var(--text-tertiary)] sm:block">{busy ? 'Saving…' : dirty ? 'Changes pending' : lastSaved ? 'Saved just now' : 'Saved'} · {role}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant={layout === 'edit' ? 'primary' : 'secondary'} onClick={() => setLayout('edit')}>Edit</Button>
        <Button size="sm" variant={layout === 'split' ? 'primary' : 'secondary'} onClick={() => setLayout('split')}>Split</Button>
        <Button size="sm" variant={layout === 'preview' ? 'primary' : 'secondary'} onClick={() => setLayout('preview')}>Preview</Button>
        {role !== 'viewer' && <><Button size="sm" variant="secondary" disabled={actionBusy || dirty} onClick={() => void duplicateDocument()}><Copy size={13}/> Duplicate</Button><Button size="sm" variant="secondary" onClick={() => setSaveMode(mode => mode === 'auto' ? 'manual' : 'auto')}>{saveMode === 'auto' ? 'Auto-save on' : 'Auto-save off'}</Button><Button size="sm" disabled={!dirty || busy || !title.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button></>}{(role === 'owner' || role === 'admin') && <Button size="sm" variant="secondary" disabled={actionBusy} onClick={() => void deleteDocument()}><Trash2 size={13}/> Delete</Button>}
      </div>
    </header>
    {error && <div role="alert" className="border-b border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2 text-xs">{error}</div>}
    {role !== 'viewer' && layout !== 'preview' && <EditorToolbar view={view} runCommand={command => { if (view) { command(view); view.focus() } }} onPickImage={() => {}}/>}
    <div className="flex min-h-0 flex-1">
      {role !== 'viewer' && layout !== 'preview' && <div className={`min-h-0 min-w-0 flex-1 overflow-auto ${layout === 'split' ? 'border-r border-[var(--border-subtle)]' : ''}`}>
        {role === 'viewer'
          ? <Preview content={content} noteId={documentId} noteTitle={title} className="h-full"/>
          : <DeferredCodeEditor visible value={content} onChange={value => { setContent(value); setDirty(true) }} settings={settings.editor} sources={sources} handlers={handlers} onReady={setView} placeholder="Write your shared Markdown document…" className="h-full"/>}
      </div>}
      {(role === 'viewer' || layout !== 'edit') && <div className="min-h-0 min-w-0 flex-1 overflow-auto"><Preview content={content} noteTitle={title} className="h-full"/></div>}
    </div>
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-3 text-[10px] text-[var(--text-tertiary)]"><span>Organization document · {saveMode === 'auto' ? 'Auto-save enabled' : 'Manual save'} · Ctrl/⌘ + S to save</span><span>{content.trim() ? content.trim().split(/\s+/).length : 0} words</span></footer>
  </section>
}
