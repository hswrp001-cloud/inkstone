import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { Button, Input, Select } from '../../../components/primitives'

type Org = { id:string; name:string; slug:string; role:string; member_count:number }
type Workspace = { id:string; name:string; document_count:number }
type Doc = { id:string; title:string; excerpt:string; updated_at:number }

export function OrganizationsSettings() {
  const [orgs,setOrgs]=useState<Org[]>([])
  const [orgId,setOrgId]=useState('')
  const [workspaces,setWorkspaces]=useState<Workspace[]>([])
  const [workspaceId,setWorkspaceId]=useState('')
  const [docs,setDocs]=useState<Doc[]>([])
  const [docId,setDocId]=useState('')
  const [title,setTitle]=useState('')
  const [content,setContent]=useState('')
  const [orgName,setOrgName]=useState('')
  const [workspaceName,setWorkspaceName]=useState('')
  const [invitee,setInvitee]=useState('')
  const [inviteRole,setInviteRole]=useState<'admin'|'editor'|'viewer'>('editor')
  const [inviteUrl,setInviteUrl]=useState('')
  const [members,setMembers]=useState<Array<{userId:string;login:string;name:string;role:string}>>([])
  const [role,setRole]=useState('viewer')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')

  const loadOrgs=useCallback(async()=>{
    const result=await api.organizations.list()
    setOrgs(result.organizations)
    setOrgId(current=>result.organizations.some(o=>o.id===current)?current:(result.organizations[0]?.id??''))
  },[])
  const loadWorkspaces=useCallback(async(id:string)=>{
    if(!id){setWorkspaces([]);setWorkspaceId('');return}
    const [w,m]=await Promise.all([api.organizations.workspaces(id),api.organizations.members(id)])
    setWorkspaces(w.workspaces);setRole(w.role);setMembers(m.members)
    setWorkspaceId(current=>w.workspaces.some(x=>x.id===current)?current:(w.workspaces[0]?.id??''))
  },[])
  const loadDocs=useCallback(async(org:string,ws:string)=>{
    if(!org||!ws){setDocs([]);return}
    const result=await api.organizations.documents(org,ws)
    setDocs(result.documents)
  },[])

  useEffect(()=>{void loadOrgs().catch(e=>setError(e.message))},[loadOrgs])
  useEffect(()=>{if(orgId)void loadWorkspaces(orgId).catch(e=>setError(e.message))},[orgId,loadWorkspaces])
  useEffect(()=>{if(orgId&&workspaceId)void loadDocs(orgId,workspaceId).catch(e=>setError(e.message))},[orgId,workspaceId,loadDocs])
  useEffect(()=>{
    const invite=new URLSearchParams(location.search).get('invite')
    if(!invite)return
    setBusy(true)
    void api.organizations.accept(invite).then(async()=>{
      setNotice('Invitation accepted. The organization is now available.')
      history.replaceState(null,'',location.pathname)
      await loadOrgs()
    }).catch(e=>setError(e.message)).finally(()=>setBusy(false))
  },[loadOrgs])

  async function run(action:()=>Promise<void>){
    setBusy(true);setError('');setNotice('')
    try{await action()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  async function createOrg(){
    await run(async()=>{await api.organizations.create(orgName);setOrgName('');await loadOrgs();setNotice('Organization created with a General workspace.')})
  }
  async function createWorkspace(){
    if(!orgId)return
    await run(async()=>{await api.organizations.createWorkspace(orgId,workspaceName);setWorkspaceName('');await loadWorkspaces(orgId);setNotice('Workspace created.')})
  }
  async function invite(){
    if(!orgId)return
    await run(async()=>{
      const result=await api.organizations.invite(orgId,invitee,inviteRole)
      const url=new URL(result.acceptPath,location.origin).toString()
      setInviteUrl(url);setInvitee('')
      await navigator.clipboard?.writeText(url).catch(()=>{})
      setNotice('Invitation created. The link was copied when clipboard access was available.')
    })
  }
  async function openDoc(id:string){
    if(!orgId||!workspaceId)return
    await run(async()=>{const d=await api.organizations.getDocument(orgId,workspaceId,id);setDocId(id);setTitle(d.title);setContent(d.content)})
  }
  async function createDoc(){
    if(!orgId||!workspaceId)return
    await run(async()=>{const d=await api.organizations.createDocument(orgId,workspaceId,'Untitled document','');setDocId(d.id);setTitle(d.title);setContent('');await loadDocs(orgId,workspaceId)})
  }
  async function saveDoc(){
    if(!orgId||!workspaceId||!docId)return
    await run(async()=>{await api.organizations.saveDocument(orgId,workspaceId,docId,title,content);await loadDocs(orgId,workspaceId);setNotice('Shared document saved.')})
  }
  async function deleteDoc(){
    if(!orgId||!workspaceId||!docId||!confirm('Move this shared document to the organization trash?'))return
    await run(async()=>{await api.organizations.deleteDocument(orgId,workspaceId,docId);setDocId('');setTitle('');setContent('');await loadDocs(orgId,workspaceId)})
  }

  const selected=orgs.find(o=>o.id===orgId)
  return <div className="space-y-5 text-[13px] text-[var(--text-primary)]">
    <div><h3 className="text-[14px] font-semibold">Organizations & shared workspaces</h3><p className="mt-1 text-[12px] text-[var(--text-secondary)]">Private team spaces with invitation-only membership, role-based access, and shared Markdown documents. Personal notes remain private.</p></div>
    {error&&<div role="alert" className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-[12px]">{error}</div>}
    {notice&&<div role="status" className="rounded-md border border-[var(--border-default)] bg-[var(--bg-sunken)] p-3 text-[12px]">{notice}</div>}
    <section className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
      <label className="block text-[12px] font-medium">Your organizations</label>
      <select value={orgId} onChange={e=>{setOrgId(e.target.value);setWorkspaceId('');setDocId('')}} className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2">
        <option value="">Select organization</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}
      </select>
      {selected&&<div className="text-[11px] text-[var(--text-tertiary)]">{selected.member_count} members · your role: {role}</div>}
      <div className="flex gap-2"><input value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="New organization name" className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2"/><Button size="sm" disabled={busy||orgName.trim().length<2} onClick={()=>void createOrg()}>Create</Button></div>
    </section>
    {selected&&<>
      <section className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
        <div className="font-medium">Workspaces</div>
        <select value={workspaceId} onChange={e=>{setWorkspaceId(e.target.value);setDocId('')}} className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2">
          <option value="">Select workspace</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name} · {w.document_count} docs</option>)}
        </select>
        {(role==='owner'||role==='admin')&&<div className="flex gap-2"><input value={workspaceName} onChange={e=>setWorkspaceName(e.target.value)} placeholder="New workspace" className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2"/><Button size="sm" disabled={busy||workspaceName.trim().length<2} onClick={()=>void createWorkspace()}>Add</Button></div>}
      </section>
      {workspaceId&&<section className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-3">
        <div className="flex items-center justify-between"><div className="font-medium">Shared documents</div><Button size="sm" disabled={busy||role==='viewer'} onClick={()=>void createDoc()}>New document</Button></div>
        <div className="grid gap-3 md:grid-cols-[minmax(140px,0.8fr)_minmax(0,1.5fr)]">
          <div className="space-y-1">{docs.map(d=><button key={d.id} onClick={()=>void openDoc(d.id)} className={'block w-full rounded-md px-2 py-2 text-left hover:bg-[var(--bg-hover)] '+(docId===d.id?'bg-[var(--accent-soft)]':'')}><span className="block truncate text-[12px] font-medium">{d.title}</span><span className="text-[10px] text-[var(--text-tertiary)]">{new Date(d.updated_at).toLocaleDateString()}</span></button>)}{!docs.length&&<p className="text-[11px] text-[var(--text-tertiary)]">No shared documents yet.</p>}</div>
          <div className="space-y-2">
            {docId?<><input value={title} onChange={e=>setTitle(e.target.value)} disabled={role==='viewer'} className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 font-medium"/><textarea value={content} onChange={e=>setContent(e.target.value)} disabled={role==='viewer'} rows={12} placeholder="Write shared Markdown here…" className="w-full resize-y rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] p-2 font-mono text-[12px]"/><div className="flex gap-2">{role!=='viewer'&&<Button size="sm" disabled={busy||!title.trim()} onClick={()=>void saveDoc()}>Save changes</Button>}{(role==='owner'||role==='admin')&&<Button size="sm" color="danger" variant="ghost" disabled={busy} onClick={()=>void deleteDoc()}>Delete</Button>}</div></>:<p className="py-8 text-center text-[11px] text-[var(--text-tertiary)]">Select a document or create one.</p>}
          </div>
        </div>
      </section>}
      <section className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
        <div className="font-medium">Members & invitations</div>
        <div className="space-y-1">{members.map(m=><div key={m.userId} className="flex justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5"><span>{m.name||m.login}</span><span className="text-[11px] text-[var(--text-tertiary)]">{m.role}</span></div>)}</div>
        { (role==='owner'||role==='admin')&&<><div className="flex flex-wrap gap-2"><input value={invitee} onChange={e=>setInvitee(e.target.value)} placeholder="Existing account login" className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2"/><select value={inviteRole} onChange={e=>setInviteRole(e.target.value as typeof inviteRole)} className="h-9 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2"><option value="editor">Editor</option><option value="viewer">Viewer</option>{role==='owner'&&<option value="admin">Admin</option>}</select><Button size="sm" disabled={busy||!invitee.trim()} onClick={()=>void invite()}>Create invite</Button></div>{inviteUrl&&<div className="break-all rounded bg-[var(--bg-sunken)] p-2 text-[11px]"><a className="text-[var(--accent)] underline" href={inviteUrl}>{inviteUrl}</a><button className="ml-2 underline" onClick={()=>void navigator.clipboard?.writeText(inviteUrl)}>Copy</button></div>}<p className="text-[10px] text-[var(--text-tertiary)]">Invitations are bearer links valid for 7 days. Send the link directly to the intended account holder.</p></>}
      </section>
    </>}
    {!orgs.length&&<p className="text-[12px] text-[var(--text-secondary)]">Create your first organization to start collaborating. Your existing personal notes are not moved or exposed.</p>}
    {busy&&<p className="text-[11px] text-[var(--text-tertiary)]">Working…</p>}
  </div>
}
