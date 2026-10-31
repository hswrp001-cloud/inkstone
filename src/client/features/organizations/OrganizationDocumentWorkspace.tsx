import { useEffect, useMemo, useState } from 'react'
import type { EditorView } from '@codemirror/view'
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

  async function save() {
    if (role === 'viewer' || !title.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api.organizations.saveDocument(organizationId, workspaceId, documentId, title, content)
      setDirty(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[var(--bg-editor)] text-sm text-[var(--text-secondary)]">{error || 'Loading shared document…'}</div>
  return <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-editor)]">
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
      <button type="button" onClick={() => { location.href = '/?section=organizations' }} className="shrink-0 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">← Organizations</button>
      <input aria-label="Document title" className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none" value={title} disabled={role === 'viewer'} onChange={e => { setTitle(e.target.value); setDirty(true) }}/>
      <span className="hidden text-[11px] text-[var(--text-tertiary)] sm:block">{dirty ? 'Unsaved changes' : 'Saved'} · {role}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant={layout === 'edit' ? 'primary' : 'secondary'} onClick={() => setLayout('edit')}>Edit</Button>
        <Button size="sm" variant={layout === 'split' ? 'primary' : 'secondary'} onClick={() => setLayout('split')}>Split</Button>
        <Button size="sm" variant={layout === 'preview' ? 'primary' : 'secondary'} onClick={() => setLayout('preview')}>Preview</Button>
        {role !== 'viewer' && <Button size="sm" disabled={!dirty || busy || !title.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>}
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
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-3 text-[10px] text-[var(--text-tertiary)]"><span>Organization shared document</span><span>{content.trim() ? content.trim().split(/\s+/).length : 0} words</span></footer>
  </section>
}
