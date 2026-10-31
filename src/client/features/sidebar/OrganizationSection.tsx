import { useEffect, useState } from 'react'
import { Building2, ChevronRight, FileText, FolderClosed, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { SectionLabel } from '../../components/primitives'

type Org = { id: string; name: string; slug: string; role: string; member_count: number }
type Workspace = { id: string; name: string; document_count: number }
type Doc = { id: string; title: string; excerpt: string; updated_at: number }

export function OrganizationSection() {
  const [organizations, setOrganizations] = useState<Org[]>([])
  const [expandedOrgs, setExpandedOrgs] = useState<string[]>([])
  const [workspaces, setWorkspaces] = useState<Record<string, Workspace[]>>({})
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<string[]>([])
  const [documents, setDocuments] = useState<Record<string, Doc[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    api.organizations.list()
      .then(result => { if (active) setOrganizations(result.organizations) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load organizations') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function toggleOrganization(org: Org) {
    const isOpen = expandedOrgs.includes(org.id)
    setExpandedOrgs(current => isOpen ? current.filter(id => id !== org.id) : [...current, org.id])
    if (!isOpen && !workspaces[org.id]) {
      try {
        const result = await api.organizations.workspaces(org.id)
        setWorkspaces(current => ({ ...current, [org.id]: result.workspaces }))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not load organization folders')
      }
    }
  }

  async function toggleWorkspace(orgId: string, workspace: Workspace) {
    const key = workspace.id
    const isOpen = expandedWorkspaces.includes(key)
    setExpandedWorkspaces(current => isOpen ? current.filter(id => id !== key) : [...current, key])
    if (!isOpen && !documents[key]) {
      try {
        const result = await api.organizations.documents(orgId, key)
        setDocuments(current => ({ ...current, [key]: result.documents }))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not load shared documents')
      }
    }
  }

  return <section className="mt-4">
    <div className="group/head flex items-center justify-between pr-1">
      <SectionLabel>Organizations</SectionLabel>
      <button type="button" title="Manage organizations" aria-label="Manage organizations" onClick={() => { location.href = '/?section=organizations' }} className="flex size-6 items-center justify-center rounded text-[var(--text-quaternary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
        <Plus size={13}/>
      </button>
    </div>
    <div className="mt-1 space-y-px">
      {loading && organizations.length === 0 && <p className="px-2 py-2 text-[11px] text-[var(--text-quaternary)]">Loading organizations…</p>}
      {!loading && organizations.length === 0 && !error && <button type="button" onClick={() => { location.href = '/?section=organizations' }} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-[var(--text-quaternary)] hover:bg-[var(--bg-hover)]"> <Building2 size={13}/> Create or join an organization</button>}
      {organizations.map(org => {
        const orgOpen = expandedOrgs.includes(org.id)
        return <div key={org.id}>
          <button type="button" aria-expanded={orgOpen} onClick={() => void toggleOrganization(org)} className="group flex min-h-8 w-full items-center gap-1 rounded-[var(--r-md)] px-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <ChevronRight size={12} className={cn('shrink-0 text-[var(--text-quaternary)] transition-transform', orgOpen && 'rotate-90')}/>
            <Building2 size={13} className="shrink-0 text-[var(--text-tertiary)]"/>
            <span className="min-w-0 flex-1 truncate font-medium">{org.name}</span>
            <span className="text-[10px] text-[var(--text-quaternary)]">{org.member_count}</span>
          </button>
          {orgOpen && <div className="ml-3 border-l border-[var(--border-subtle)] pl-1">
            {(workspaces[org.id] ?? []).map(workspace => {
              const workspaceOpen = expandedWorkspaces.includes(workspace.id)
              return <div key={workspace.id}>
                <button type="button" aria-expanded={workspaceOpen} onClick={() => void toggleWorkspace(org.id, workspace)} className="flex min-h-8 w-full items-center gap-1 rounded px-1.5 text-left text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <ChevronRight size={11} className={cn('shrink-0 text-[var(--text-quaternary)] transition-transform', workspaceOpen && 'rotate-90')}/>
                  <FolderClosed size={13} className="shrink-0 text-[var(--text-tertiary)]"/>
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  <span className="text-[10px] text-[var(--text-quaternary)]">{workspace.document_count || ''}</span>
                </button>
                {workspaceOpen && <div className="ml-4 border-l border-[var(--border-subtle)] pl-1">
                  {(documents[workspace.id] ?? []).map(doc => <button key={doc.id} type="button" title={doc.title} onClick={() => { location.href = '/org-doc/' + org.id + '/' + workspace.id + '/' + doc.id }} className="flex min-h-8 w-full items-center gap-2 rounded px-1.5 text-left text-[11.5px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                    <FileText size={12} className="shrink-0"/>
                    <span className="min-w-0 flex-1 truncate">{doc.title || 'Untitled document'}</span>
                  </button>)}
                  {documents[workspace.id]?.length === 0 && <p className="px-2 py-1.5 text-[10.5px] text-[var(--text-quaternary)]">No documents yet</p>}
                </div>}
              </div>
            })}
            {workspaces[org.id]?.length === 0 && <p className="px-2 py-1.5 text-[10.5px] text-[var(--text-quaternary)]">No folders yet</p>}
          </div>}
        </div>
      })}
      {error && <p role="status" className="px-2 py-1 text-[10px] text-[var(--danger)]">{error}</p>}
    </div>
  </section>
}
