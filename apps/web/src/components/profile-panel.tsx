'use client';
import type { Profile } from '@nourish/contracts';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { Field, PageHeading, Notice } from './ui';
export function ProfilePanel({ profile: p, refresh, message }: { profile: Profile; refresh: () => Promise<void>; message: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, data: Record<string, unknown> = Object.fromEntries(new FormData(form));
    for (const n of ['age', 'height', 'weight', 'goalWeight', 'activity', 'deficit', 'proteinRate', 'wheyGrams', 'trainingDays']) data[n] = Number(data[n]);
    data.needsReview = (form.elements.namedItem('needsReview') as HTMLInputElement).checked;
    const favorites = Number(data.wheyGrams) > 0 ? [...new Set([...p.favorites, 'whey'])] : p.favorites;
    setBusy(true); try { await api('profile', { ...data, id: p.id, favorites, excluded: p.excluded }); await refresh(); message('Profile saved. Regenerate your food plan when ready.'); } catch (e) { message((e as Error).message); } finally { setBusy(false); }
  }
  return <><PageHeading eyebrow="START WITH YOU" title={`Make it personal, ${p.name}.`} description="Your measurements, goals, and daily activity set the starting point."/><div className="two-columns"><form key={p.id} className="panel form-panel" onSubmit={save}><h2>The basics</h2><div className="form-grid">
    <Field label="Name"><input name="name" defaultValue={p.name} required maxLength={60}/></Field>
    <Select label="Sex coefficient · energy equation" name="sex" value={p.sex} options={[["male", "Male"], ["female", "Female"]]}/>
    {([['age', 'Age · years', 18, 80], ['height', 'Height · cm', 120, 230], ['weight', 'Current weight · kg', 35, 250], ['goalWeight', 'Goal weight · kg', 35, 250]] as const).map(([name, label, min, max]) => <Field key={name} label={label}><input type="number" name={name} defaultValue={p[name]} min={min} max={max} step={name === 'age' ? 1 : .1} required/></Field>)}
    <Select label="Overall activity · includes workouts" name="activity" value={p.activity} options={[[1.2, 'Mostly seated'], [1.375, 'Light / 1–3 sessions'], [1.55, 'Moderate / 3–5 sessions'], [1.725, 'Very active'], [1.9, 'Physical job + hard training']]}/>
    <Select label="Calorie deficit" name="deficit" value={p.deficit} options={[[0, 'Maintenance'], [10, 'Gentle · 10%'], [15, 'Moderate · 15%'], [20, 'Higher · 20%']]}/>
    </div><h2>Nutrition & training</h2><div className="form-grid">
    <Select label="Protein · g per kg body weight" name="proteinRate" value={p.proteinRate} options={[1.4, 1.6, 1.8, 2].map(n => [n, `${n} g/kg`])}/>
    <Select label="Whey powder · grams per day" name="wheyGrams" value={p.wheyGrams} options={[0, 15, 30, 45, 60].map(n => [n, n ? `${n} g powder` : 'None'])}/>
    <Select label="Strength sessions / week" name="trainingDays" value={p.trainingDays} options={[2, 3, 4].map(n => [n, `${n} days`])}/>
    <Select label="Experience" name="experience" value={p.experience} options={[["beginner", "Beginner / returning"], ["intermediate", "Intermediate"]]}/>
    <Select label="Equipment" name="equipment" value={p.equipment} options={[["gym", "Gym"], ["home", "Home + bands / dumbbells"]]}/>
    </div><label className="check"><input type="checkbox" name="needsReview" defaultChecked={p.needsReview}/>Pregnancy, breastfeeding, or a condition needing personalized guidance (pauses automatic plans).</label><div className="form-actions"><small>Saving clears this person’s previous food plan.</small><button disabled={busy}>Save profile ↗</button></div></form><aside className="panel form-panel"><span className="eyebrow">HOW IT WORKS</span><h2>Estimates, with clarity.</h2><ol className="explanation"><li><strong>Resting energy</strong><p>Mifflin–St Jeor uses weight, height, age, and a sex coefficient.</p></li><li><strong>Everyday energy</strong><p>An activity multiplier estimates maintenance. Training is already included.</p></li><li><strong>A measured deficit</strong><p>Your selected deficit is applied with conservative app calorie floors. Actual needs vary.</p></li></ol><Notice>These plans are for adults aged 18–80. Watch energy, recovery, and weight trends over several weeks. No calculation guarantees fat loss or strength gain.</Notice></aside></div></>;
}
function Select({ label, name, value, options }: { label: string; name: string; value: string | number; options: (string | number)[][] }) { return <Field label={label}><select name={name} defaultValue={value}>{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></Field>; }
