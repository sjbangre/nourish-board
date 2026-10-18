'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Users, UserRound, Heart } from 'lucide-react';
import type { AppState, Couple, Family, Profile } from '@nourish/contracts';
import { api } from '@/lib/api';
import { Field, PageHeading, Notice } from './ui';

type Props = { state: AppState; familyId: string; admin: boolean; refresh: () => Promise<void>; message: (s: string) => void; chooseFamily: (id: string) => void; chooseProfile: (id: string) => void };
type Save = (event: FormEvent<HTMLFormElement>, endpoint: string, done?: () => void) => Promise<void>;
type DeletedFamily = Family & { deletedAt: string };

export function FamilyPanel({ state, familyId, admin, refresh, message, chooseFamily, chooseProfile }: Props) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(familyId);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Family | null>(null);
  const [deleted, setDeleted] = useState<DeletedFamily[]>([]);

  useEffect(() => { setExpanded(familyId); }, [familyId]);
  useEffect(() => {
    let cancelled = false;
    if (admin) api<DeletedFamily[]>('family/deleted').then(items => { if (!cancelled) setDeleted(items); }).catch(e => message(e.message));
    return () => { cancelled = true; };
  }, [admin, state.families, message]);

  const save: Save = async (event, endpoint, done) => {
    event.preventDefault();
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    setBusy(true);
    try {
      const result = await api<Family & Profile>(endpoint, data);
      await refresh();
      if (endpoint === 'family') { chooseFamily(result.id); setExpanded(result.id); }
      if (endpoint === 'member' || endpoint === 'couple') form.reset();
      done?.();
      message(endpoint === 'member' ? 'Member added. Use Edit profile to add their measurements.' : 'Changes saved.');
    } catch (error) { message((error as Error).message); }
    finally { setBusy(false); }
  };

  async function remove(confirmationName: string) {
    if (!deleteTarget) return;
    await api('family/delete', { id: deleteTarget.id, confirmationName });
    await refresh();
    chooseFamily(state.families.find(f => f.id !== deleteTarget.id)?.id || '');
    setDeleteTarget(null);
    message('Family deleted. You can restore it from Deleted families.');
  }
  async function restore(id: string) {
    setBusy(true);
    try { await api('family/restore', { id }); await refresh(); chooseFamily(id); message('Family restored with its profiles, history, and approved access.'); }
    catch (error) { message((error as Error).message); }
    finally { setBusy(false); }
  }
  const targetMembers = state.profiles.filter(p => p.familyId === deleteTarget?.id);

  return <>
    <PageHeading eyebrow="YOUR PEOPLE, SIMPLY ORGANIZED" title="Family management" description="Expand a family, then a couple or the Individuals group. Manage each person in place." actions={admin && <button onClick={() => setCreateOpen(!createOpen)} aria-expanded={createOpen} aria-controls="create-family"><Plus size={15}/>Add family</button>}/>
    {admin && (createOpen || !state.families.length) && <form id="create-family" className="panel inline-family-form" onSubmit={e => save(e, 'family', () => setCreateOpen(false))}><h2>Add a family</h2><Field label="Family name"><input autoFocus name="name" required maxLength={60} placeholder="e.g. Suhas & Family"/></Field><div className="inline-actions"><button disabled={busy}>Create family</button><button className="secondary" type="button" onClick={() => setCreateOpen(false)}>Cancel</button></div></form>}
    {!state.families.length && !admin && <Notice>No active families are shared with your account. Contact the administrator to review your access.</Notice>}
    <div className="family-tree">{state.families.map(family => {
      const people = state.profiles.filter(p => p.familyId === family.id);
      const couples = state.couples.filter(c => c.familyId === family.id);
      const open = expanded === family.id;
      return <section className={`family-accordion ${open ? 'expanded' : ''}`} key={family.id}>
        <h2 className="family-accordion-title"><button className="family-accordion-toggle" aria-expanded={open} aria-controls={`family-body-${family.id}`} onClick={() => { setExpanded(open ? '' : family.id); if (!open) chooseFamily(family.id); }}>
          <span className="family-tree-icon"><Users size={21}/></span>
          <span className="family-title-text"><strong>{family.name}</strong><small>{people.length} member{people.length === 1 ? '' : 's'} · {couples.length} couple{couples.length === 1 ? '' : 's'} · {people.filter(p => !p.coupleId).length} individuals</small></span>
          <span className="family-toggle-hint">{open ? 'Collapse' : 'Manage family'}</span>{open ? <ChevronDown size={19}/> : <ChevronRight size={19}/>}
        </button></h2>
        {open && <div id={`family-body-${family.id}`} className="family-accordion-body"><FamilyContents family={family} people={people} couples={couples} state={state} admin={admin} busy={busy} save={save} chooseProfile={chooseProfile} askDelete={() => setDeleteTarget(family)}/></div>}
      </section>;
    })}</div>
    {admin && deleted.length > 0 && <details className="deleted-families panel"><summary>Deleted families <span>{deleted.length}</span></summary><p className="muted">Restore brings back profiles, history, and previously approved access.</p>{deleted.map(f => <div key={f.id}><span><strong>{f.name}</strong><small>Deleted {new Date(f.deletedAt).toLocaleString()}</small></span><button className="secondary small" disabled={busy} onClick={() => restore(f.id)}>Restore family</button></div>)}</details>}
    <p className="family-help">Family → Couple or Individual → Personal profile. Each person keeps their own food preferences, targets, and progress. Access is managed separately under Invites & access.</p>
    {deleteTarget && <DeleteFamilyDialog family={deleteTarget} memberCount={targetMembers.length} coupleCount={state.couples.filter(c => c.familyId === deleteTarget.id).length} planCount={state.plans.filter(p => targetMembers.some(m => m.id === p.profileId)).length} logCount={state.logs.filter(l => targetMembers.some(m => m.id === l.profile_id)).length} close={() => setDeleteTarget(null)} remove={remove}/>}
  </>;
}

function FamilyContents({ family, people, couples, state, admin, busy, save, chooseProfile, askDelete }: { family: Family; people: Profile[]; couples: Couple[]; state: AppState; admin: boolean; busy: boolean; save: Save; chooseProfile: (id: string) => void; askDelete: () => void }) {
  const [action, setAction] = useState<'rename' | 'couple' | 'individual' | null>(null);
  const individuals = people.filter(p => !p.coupleId);
  const toggle = (next: typeof action) => setAction(action === next ? null : next);
  return <>
    <div className="family-context-actions">
      <div><button className="secondary small" onClick={() => toggle('couple')} aria-expanded={action === 'couple'}><Plus size={13}/>Add couple</button><button className="secondary small" onClick={() => toggle('individual')} aria-expanded={action === 'individual'}><Plus size={13}/>Add individual</button></div>
      {admin && <div><button className="text-button" onClick={() => toggle('rename')} aria-expanded={action === 'rename'}><Pencil size={13}/>Rename family</button><button className="text-button danger" onClick={askDelete}><Trash2 size={13}/>Delete family</button></div>}
    </div>
    {action === 'rename' && admin && <form className="context-form" onSubmit={e => save(e, 'family', () => setAction(null))}><h3>Rename {family.name}</h3><input type="hidden" name="id" value={family.id}/><Field label="Family name"><input autoFocus name="name" defaultValue={family.name} required maxLength={60}/></Field><div className="inline-actions"><button disabled={busy}>Save name</button><button className="secondary" type="button" onClick={() => setAction(null)}>Cancel</button></div></form>}
    {action === 'couple' && <form className="context-form" onSubmit={e => save(e, 'couple', () => setAction(null))}><h3>Add a couple to {family.name}</h3><input type="hidden" name="familyId" value={family.id}/><Field label="Couple name"><input autoFocus name="name" required maxLength={60} placeholder="e.g. Suhas & partner"/></Field><p className="fine-print">Create the couple, then expand it to add up to two people. Existing members can be moved into it using Move member.</p><div className="inline-actions"><button disabled={busy}>Create couple</button><button className="secondary" type="button" onClick={() => setAction(null)}>Cancel</button></div></form>}
    {action === 'individual' && <AddMember family={family} busy={busy} save={save} close={() => setAction(null)}/>}
    <div className="family-groups">{couples.map(couple => <CoupleGroup key={couple.id} couple={couple} family={family} people={people.filter(p => p.coupleId === couple.id)} state={state} busy={busy} save={save} chooseProfile={chooseProfile}/>)}</div>
    <details className="member-group individuals-group" open={individuals.length > 0 || couples.length === 0}>
      <summary><UserRound size={18}/><span><strong>Individuals</strong><small>Family members who aren’t assigned to a couple</small></span><span className="group-count">{individuals.length} members</span><ChevronDown className="group-chevron" size={17}/></summary>
      <div className="member-group-body">{individuals.length ? individuals.map(p => <MemberRow key={p.id} profile={p} state={state} busy={busy} save={save} chooseProfile={chooseProfile}/>) : <p className="group-empty">No individuals yet. Add a person or move an existing family member here.</p>}<button className="secondary small" onClick={() => setAction('individual')}><Plus size={13}/>Add individual</button></div>
    </details>
    {!people.length && !couples.length && <p className="group-empty">Start by adding a couple or an individual to this family.</p>}
  </>;
}

function CoupleGroup({ couple, family, people, state, busy, save, chooseProfile }: { couple: Couple; family: Family; people: Profile[]; state: AppState; busy: boolean; save: Save; chooseProfile: (id: string) => void }) {
  const [adding, setAdding] = useState(false), [renaming, setRenaming] = useState(false);
  return <details className="member-group couple-group"><summary><Heart size={18}/><span><strong>{couple.name}</strong><small>{people.map(p => p.name).join(' + ') || 'Add the people in this couple'}</small></span><span className="group-count">{people.length} / 2 members</span><ChevronDown className="group-chevron" size={17}/></summary><div className="member-group-body">
    {people.map(p => <MemberRow key={p.id} profile={p} state={state} busy={busy} save={save} chooseProfile={chooseProfile}/>)}
    {!people.length && <p className="group-empty">This couple has no members yet.</p>}
    <div className="group-actions">{people.length < 2 && <button className="secondary small" onClick={() => setAdding(!adding)}><Plus size={13}/>Add person to couple</button>}<button className="text-button" onClick={() => setRenaming(!renaming)}><Pencil size={12}/>Rename couple</button></div>
    {adding && people.length < 2 && <AddMember family={family} couple={couple} busy={busy} save={save} close={() => setAdding(false)}/>}
    {renaming && <form className="context-form" onSubmit={e => save(e, 'couple', () => setRenaming(false))}><input type="hidden" name="id" value={couple.id}/><input type="hidden" name="familyId" value={family.id}/><Field label="Couple name"><input autoFocus name="name" defaultValue={couple.name} required maxLength={60}/></Field><div className="inline-actions"><button disabled={busy}>Save name</button><button className="secondary" type="button" onClick={() => setRenaming(false)}>Cancel</button></div></form>}
  </div></details>;
}

function AddMember({ family, couple, busy, save, close }: { family: Family; couple?: Couple; busy: boolean; save: Save; close: () => void }) {
  return <form className="context-form" onSubmit={e => save(e, 'member', close)}><h3>{couple ? `Add a person to ${couple.name}` : `Add an individual to ${family.name}`}</h3><input type="hidden" name="familyId" value={family.id}/><input type="hidden" name="coupleId" value={couple?.id || ''}/><div className="form-grid"><Field label="Name"><input autoFocus name="name" required maxLength={60} placeholder="Person’s name"/></Field><Field label="Sex coefficient · energy equation"><select name="sex"><option value="male">Male</option><option value="female">Female</option></select></Field></div><div className="inline-actions"><button disabled={busy}>Add person</button><button className="secondary" type="button" onClick={close}>Cancel</button></div></form>;
}

function MemberRow({ profile: p, state, busy, save, chooseProfile }: { profile: Profile; state: AppState; busy: boolean; save: Save; chooseProfile: (id: string) => void }) {
  const [familyId, setFamilyId] = useState(p.familyId), [coupleId, setCoupleId] = useState(p.coupleId || '');
  const details = useRef<HTMLDetailsElement>(null);
  return <article className="tree-member"><div className="tree-member-heading"><span className="avatar">{p.name[0]}</span><div><h3>{p.name}</h3><small>{p.configured ? `${p.weight} kg · profile set up` : 'Measurements not added yet'}</small></div><button className="secondary small" onClick={() => chooseProfile(p.id)}>Edit profile ↗</button></div><details ref={details} className="move-member"><summary>Move member to another couple or family</summary><form onSubmit={e => save(e, 'membership', () => { if (details.current) details.current.open = false; })}><input type="hidden" name="profileId" value={p.id}/><div className="form-grid"><Field label="Family"><select name="familyId" value={familyId} onChange={e => { setFamilyId(e.target.value); setCoupleId(''); }}>{state.families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field><Field label="Couple or individual"><select name="coupleId" value={coupleId} onChange={e => setCoupleId(e.target.value)}><option value="">Individual</option>{state.couples.filter(c => c.familyId === familyId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div><button className="secondary small" disabled={busy}>Save membership</button></form></details></article>;
}

function DeleteFamilyDialog({ family, memberCount, coupleCount, planCount, logCount, close, remove }: { family: Family; memberCount: number; coupleCount: number; planCount: number; logCount: number; close: () => void; remove: (name: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await remove(confirmation); } catch (e) { setError((e as Error).message); setBusy(false); } }
  return <dialog ref={dialog} className="family-delete-dialog" aria-labelledby="family-delete-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}><h2 id="family-delete-title">Delete {family.name}?</h2><p>This removes the family from active dashboards, shopping lists, and approved users’ access.</p><ul><li>{memberCount} member profiles</li><li>{coupleCount} couples</li><li>{planCount} saved food plans</li><li>{logCount} weight entries</li></ul><p className="muted">Data is kept for recovery. Only the administrator can restore the family from Deleted families.</p>{error && <Notice warning>{error}</Notice>}<form onSubmit={submit}><Field label={`Type “${family.name}” to confirm`}><input autoFocus required value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" maxLength={60} disabled={busy}/></Field><div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button><button className="delete-button" disabled={busy || confirmation !== family.name}>{busy ? 'Deleting…' : 'Delete family'}</button></div></form></dialog>;
}
