import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { DeferredCodeEditor } from '../../editor/CodeEditor'
import { Preview } from '../preview/Preview'
import { useSession } from '../../store/session'
import { Button } from '../../components/primitives'

export function OrganizationDocumentWorkspace({ organizationId, workspaceId, documentId }: { organizationId:string; workspaceId:string; documentId:string }) {
 const settings=useSession(s=>s.settings)
 const [title,setTitle]=useState('')
 const [content,setContent]=useState('')
 const [role,setRole]=useState('viewer')
 const [loaded,setLoaded]=useState(false)
 const [dirty,setDirty]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 useEffect(()=>{let active=true;Promise.all([api.organizations.getDocument(organizationId,workspaceId,documentId),api.organizations.workspaces(organizationId)]).then(([d,w])=>{if(!active)return;setTitle(d.title);setContent(d.content);setRole(w.role);setLoaded(true)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[organizationId,workspaceId,documentId])
 const save=async()=>{setBusy(true);setError('');try{await api.organizations.saveDocument(organizationId,workspaceId,documentId,title,content);setDirty(false)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 if(!loaded)return <div className="flex h-full flex-1 items-center justify-center">{error||'Loading shared document…'}</div>
 return <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-editor)]"><header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4"><button onClick={()=>{location.href='/?section=organizations'}}>← Organizations</button><input className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none" value={title} disabled={role==='viewer'} onChange={e=>{setTitle(e.target.value);setDirty(true)}}/><span className="text-xs text-[var(--text-tertiary)]">{dirty?'Unsaved changes':'Saved'}</span>{role!=='viewer'&&<Button size="sm" disabled={!dirty||busy||!title.trim()} onClick={()=>void save()}>Save</Button>}</header>{error&&<div role="alert" className="p-2 text-sm text-[var(--danger)]">{error}</div>}<div className="flex min-h-0 flex-1"><div className="min-w-0 flex-1 overflow-auto"><DeferredCodeEditor visible value={content} onChange={v=>{setContent(v);setDirty(true)}} settings={settings.editor} sources={{notes:()=>[],tags:()=>[]}} handlers={{uploadFile:async()=>null}} placeholder="Write your shared Markdown document…" className="h-full"/></div><div className="min-w-0 flex-1 overflow-auto border-l border-[var(--border-subtle)]"><Preview content={content} noteTitle={title} className="h-full"/></div></div></section>
}
