import { useEffect, useState } from 'react'
import { Building2, ChevronRight, FilePlus2, FileText, FolderClosed, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { SectionLabel } from '../../components/primitives'

type Org = { id:string; name:string; slug:string; role:string; member_count:number }
type Workspace = { id:string; name:string; document_count:number }
type Folder = { id:string; name:string; parentId:string|null }
type Doc = { id:string; title:string; excerpt:string; updatedAt:number }

function openDocument(orgId:string,workspaceId:string,documentId:string) {
  location.href = '/org-doc/'+orgId+'/'+workspaceId+'/'+documentId
}

function FolderBranch({orgId,workspaceId,folder,role,depth=0}:{orgId:string;workspaceId:string;folder:Folder;role:string;depth?:number}) {
  const [open,setOpen]=useState(false)
  const [loaded,setLoaded]=useState(false)
  const [folders,setFolders]=useState<Folder[]>([])
  const [docs,setDocs]=useState<Doc[]>([])
  const [error,setError]=useState('')
  const canWrite=role!=='viewer'
  const canManage=role==='owner'||role==='admin'
  async function refresh() {
    const result=await api.organizations.folderContents(orgId,workspaceId,folder.id)
    setFolders(result.folders);setDocs(result.documents);setLoaded(true)
  }
  async function toggle() {
    if(!open&&!loaded){try{await refresh()}catch(e){setError(e instanceof Error?e.message:'Could not load folder')}}
    setOpen(v=>!v)
  }
  async function addFolder() {
    const name=prompt('New folder name')
    if(!name?.trim())return
    try{await api.organizations.createFolder(orgId,workspaceId,name,folder.id);await refresh();setOpen(true)}catch(e){setError(e instanceof Error?e.message:'Could not create folder')}
  }
  async function addDocument() {
    const title=prompt('Document name','Untitled document')
    if(!title?.trim())return
    try{const doc=await api.organizations.createDocument(orgId,workspaceId,title.trim(),' ',folder.id);openDocument(orgId,workspaceId,doc.id)}catch(e){setError(e instanceof Error?e.message:'Could not create document')}
  }
  async function rename() {
    const name=prompt('Rename folder',folder.name)
    if(!name?.trim()||name.trim()===folder.name)return
    try{await api.organizations.renameFolder(orgId,workspaceId,folder.id,name.trim());setLoaded(false)}catch(e){setError(e instanceof Error?e.message:'Could not rename folder')}
  }
  async function remove() {
    if(!confirm('Delete this empty folder?'))return
    try{await api.organizations.deleteFolder(orgId,workspaceId,folder.id);location.reload()}catch(e){setError(e instanceof Error?e.message:'Could not delete folder')}
  }
  return <div>
    <div className="group flex min-h-8 items-center gap-1 rounded px-1.5 text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" style={{paddingLeft:8+depth*12}}>
      <button type="button" onClick={()=>void toggle()} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <ChevronRight size={11} className={cn('shrink-0 text-[var(--text-quaternary)] transition-transform',open&&'rotate-90')}/>
        <FolderClosed size={13} className="shrink-0 text-[var(--text-tertiary)]"/>
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="text-[10px] text-[var(--text-quaternary)]">{loaded?folders.length+docs.length:''}</span>
      </button>
      {canWrite&&<button type="button" title="New document in folder" onClick={()=>void addDocument()} className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-quaternary)] opacity-60 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] group-hover:opacity-100"><FilePlus2 size={12}/></button>}
      {canWrite&&<button type="button" title="New subfolder" onClick={()=>void addFolder()} className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-quaternary)] opacity-0 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] group-hover:opacity-100"><FolderPlus size={12}/></button>}
      {canManage&&<button type="button" title="Rename folder" onClick={()=>void rename()} className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-quaternary)] opacity-0 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] group-hover:opacity-100"><Pencil size={11}/></button>}
      {canManage&&<button type="button" title="Delete empty folder" onClick={()=>void remove()} className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-quaternary)] opacity-0 hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] group-hover:opacity-100"><Trash2 size={11}/></button>}
    </div>
    {error&&<p className="px-3 py-1 text-[10px] text-[var(--danger)]">{error}</p>}
    {open&&<div className="ml-3 border-l border-[var(--border-subtle)] pl-1">
      {folders.map(child=><FolderBranch key={child.id} orgId={orgId} workspaceId={workspaceId} folder={child} role={role} depth={depth+1}/>)}
      {docs.map(doc=><button key={doc.id} type="button" title={doc.title} onClick={()=>openDocument(orgId,workspaceId,doc.id)} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" style={{paddingLeft:12+depth*12}}>
        <FileText size={12} className="shrink-0"/><span className="min-w-0 flex-1 truncate">{doc.title||'Untitled document'}</span>
      </button>)}
      {!folders.length&&!docs.length&&<p className="px-3 py-2 text-[10.5px] text-[var(--text-quaternary)]">This folder is empty</p>}
    </div>}
  </div>
}

function WorkspaceTree({orgId,workspace,role}:{orgId:string;workspace:Workspace;role:string}) {
  const [open,setOpen]=useState(false)
  const [loaded,setLoaded]=useState(false)
  const [folders,setFolders]=useState<Folder[]>([])
  const [docs,setDocs]=useState<Doc[]>([])
  const [error,setError]=useState('')
  const canWrite=role!=='viewer'
  async function refresh() {
    const result=await api.organizations.folderContents(orgId,workspace.id)
    setFolders(result.folders);setDocs(result.documents);setLoaded(true)
  }
  async function toggle() {
    if(!open&&!loaded){try{await refresh()}catch(e){setError(e instanceof Error?e.message:'Could not load workspace')}}
    setOpen(v=>!v)
  }
  async function addFolder() {
    const name=prompt('New folder name')
    if(!name?.trim())return
    try{await api.organizations.createFolder(orgId,workspace.id,name);await refresh();setOpen(true)}catch(e){setError(e instanceof Error?e.message:'Could not create folder')}
  }
  async function addDocument() {
    const title=prompt('Document name','Untitled document')
    if(!title?.trim())return
    try{const doc=await api.organizations.createDocument(orgId,workspace.id,title.trim(),'');openDocument(orgId,workspace.id,doc.id)}catch(e){setError(e instanceof Error?e.message:'Could not create document')}
  }
  return <div>
    <div className="group flex min-h-8 items-center gap-1 rounded px-1.5 text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
      <button type="button" onClick={()=>void toggle()} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <ChevronRight size={11} className={cn('shrink-0 text-[var(--text-quaternary)] transition-transform',open&&'rotate-90')}/>
        <FolderClosed size={13} className="shrink-0 text-[var(--text-tertiary)]"/>
        <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
        <span className="text-[10px] text-[var(--text-quaternary)]">{workspace.document_count||''}</span>
      </button>
      {canWrite&&<button type="button" title="New document" onClick={()=>void addDocument()} className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-quaternary)] opacity-0 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] group-hover:opacity-100"><FilePlus2 size={12}/></button>}
      {canWrite&&<button type="button" title="New folder" onClick={()=>void addFolder()} className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-quaternary)] opacity-0 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] group-hover:opacity-100"><FolderPlus size={12}/></button>}
    </div>
    {error&&<p className="px-3 py-1 text-[10px] text-[var(--danger)]">{error}</p>}
    {open&&<div className="ml-3 border-l border-[var(--border-subtle)] pl-1">
      {folders.map(folder=><FolderBranch key={folder.id} orgId={orgId} workspaceId={workspace.id} folder={folder} role={role}/>)}
      {docs.map(doc=><button key={doc.id} type="button" title={doc.title} onClick={()=>openDocument(orgId,workspace.id,doc.id)} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
        <FileText size={12} className="shrink-0"/><span className="min-w-0 flex-1 truncate">{doc.title||'Untitled document'}</span>
      </button>)}
      {!folders.length&&!docs.length&&<p className="px-3 py-2 text-[10.5px] text-[var(--text-quaternary)]">No files yet — use + to add one</p>}
    </div>}
  </div>
}

export function OrganizationSection() {
  const [organizations,setOrganizations]=useState<Org[]>([])
  const [expandedOrgs,setExpandedOrgs]=useState<string[]>([])
  const [workspaces,setWorkspaces]=useState<Record<string,Workspace[]>>({})
  const [roles,setRoles]=useState<Record<string,string>>({})
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true;setLoading(true)
    api.organizations.list().then(result=>{if(active)setOrganizations(result.organizations)})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load organizations')})
      .finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[])
  async function toggleOrganization(org:Org) {
    const isOpen=expandedOrgs.includes(org.id)
    setExpandedOrgs(current=>isOpen?current.filter(id=>id!==org.id):[...current,org.id])
    if(!isOpen&&!workspaces[org.id]){
      try{const result=await api.organizations.workspaces(org.id);setWorkspaces(current=>({...current,[org.id]:result.workspaces}));setRoles(current=>({...current,[org.id]:result.role}))}
      catch(e){setError(e instanceof Error?e.message:'Could not load organization folders')}
    }
  }
  async function addWorkspace(org:Org) {
    const name=prompt('New shared folder / workspace name')
    if(!name?.trim())return
    try{const result=await api.organizations.createWorkspace(org.id,name.trim());setWorkspaces(current=>({...current,[org.id]:[...(current[org.id]||[]),{...result,document_count:0}]}))}
    catch(e){setError(e instanceof Error?e.message:'Could not create shared folder')}
  }
  return <section className="mt-4">
    <div className="group/head flex items-center justify-between pr-1">
      <SectionLabel>Organizations</SectionLabel>
      <button type="button" title="Manage or create organizations" aria-label="Manage organizations" onClick={()=>{location.href='/?section=organizations'}} className="flex size-6 items-center justify-center rounded text-[var(--text-quaternary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><Plus size={13}/></button>
    </div>
    <div className="mt-1 space-y-px">
      {loading&&organizations.length===0&&<p className="px-2 py-2 text-[11px] text-[var(--text-quaternary)]">Loading organizations…</p>}
      {!loading&&organizations.length===0&&!error&&<button type="button" onClick={()=>{location.href='/?section=organizations'}} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-[var(--text-quaternary)] hover:bg-[var(--bg-hover)]"><Building2 size={13}/>Create or join an organization</button>}
      {organizations.map(org=>{
        const isOpen=expandedOrgs.includes(org.id),role=roles[org.id]||org.role
        return <div key={org.id}>
          <div className="group flex min-h-8 items-center gap-1 rounded px-1.5 hover:bg-[var(--bg-hover)]">
            <button type="button" aria-expanded={isOpen} onClick={()=>void toggleOrganization(org)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <ChevronRight size={12} className={cn('shrink-0 text-[var(--text-quaternary)] transition-transform',isOpen&&'rotate-90')}/>
              <Building2 size={13} className="shrink-0 text-[var(--text-tertiary)]"/>
              <span className="min-w-0 flex-1 truncate font-medium">{org.name}</span>
              <span className="text-[10px] text-[var(--text-quaternary)]">{org.member_count}</span>
            </button>
            {(role==='owner'||role==='admin')&&<button type="button" title="Add shared folder" onClick={()=>void addWorkspace(org)} className="flex size-6 items-center justify-center rounded text-[var(--text-quaternary)] opacity-0 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] group-hover:opacity-100"><FolderPlus size={12}/></button>}
          </div>
          {isOpen&&<div className="ml-3 border-l border-[var(--border-subtle)] pl-1">
            {(workspaces[org.id]||[]).map(workspace=><WorkspaceTree key={workspace.id} orgId={org.id} workspace={workspace} role={role}/>)}
            {!workspaces[org.id]?.length&&<p className="px-2 py-2 text-[10.5px] text-[var(--text-quaternary)]">No shared folders yet</p>}
          </div>}
        </div>
      })}
      {error&&<p role="status" className="px-2 py-1 text-[10px] text-[var(--danger)]">{error}</p>}
    </div>
  </section>
}
