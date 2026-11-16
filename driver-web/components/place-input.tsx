'use client';
import { useEffect, useRef, useState } from 'react';
import { LocateFixed, MapPin, LoaderCircle, X } from 'lucide-react';
import type { Place } from '@/lib/goome-types';
export default function PlaceInput({kind, value, onChange, onLocate, onMap}: {kind: 'pickup' | 'dropoff'; value: Place | null; onChange: (p: Place | null) => void; onLocate?: () => void; onMap: () => void;}) {
  const [text, setText] = useState(value?.label || '');
  const [places, setPlaces] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const editing = useRef(false);
  useEffect(() => { if (editing.current) {editing.current = false; return;} setText(value?.label || ''); }, [value]);
  useEffect(() => {
    if (!open || text.trim().length < 3 || value?.label === text) { setPlaces([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError('');
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(text)}`, {signal: controller.signal});
        const result = await response.json() as {places: Place[]; error?: string};
        if (!response.ok) throw new Error(result.error);
        setPlaces(result.places);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Recherche indisponible.'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text, open, value]);
  useEffect(() => { const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close); }, []);
  return <div className={`place-field place-field-${kind} ${open ? 'focused' : ''}`} ref={root}>
    <span className={`place-symbol ${kind}`} />
    <div className="place-field-main"><label htmlFor={`place-${kind}`}>{kind === 'pickup' ? 'DÉPART' : 'DESTINATION'}</label><input id={`place-${kind}`} aria-label={kind === 'pickup' ? 'DÉPART' : 'DESTINATION'} value={text} placeholder={kind === 'pickup' ? 'D’où partez-vous ?' : 'Où allez-vous ?'} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`results-${kind}`} onFocus={() => setOpen(true)} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }} onChange={e => { const v=e.target.value; editing.current = value !== null; onChange(null); setText(v); setOpen(true); }} /></div>
    {busy ? <LoaderCircle size={17} className="spin muted" /> : text ? <button className="icon-button small" aria-label={`Effacer ${kind === 'pickup' ? 'le départ' : 'la destination'}`} onClick={() => {setText(''); onChange(null);}}><X size={16}/></button> : onLocate ? <button className="icon-button small" title="Utiliser ma position" aria-label="Utiliser ma position" onClick={onLocate}><LocateFixed size={19}/></button> : <button className="icon-button small" title="Choisir sur la carte" aria-label="Choisir la destination sur la carte" onClick={onMap}><MapPin size={19}/></button>}
    {open && <div className="place-results" id={`results-${kind}`} role="listbox">
      {onLocate && <button onClick={() => {onLocate(); setOpen(false);}}><LocateFixed size={17}/><span>Utiliser ma position actuelle</span></button>}
      <button onClick={() => {onMap(); setOpen(false);}}><MapPin size={17}/><span>Choisir sur la carte</span></button>
      {places.map((p, i) => <button key={`${p.latitude}-${p.longitude}-${i}`} role="option" aria-selected={false} onClick={() => {onChange(p); setText(p.label); setOpen(false);}}><MapPin size={17}/><span>{p.label}</span></button>)}
      {error && <p>{error}</p>}
      {!busy && !error && text.length >= 3 && !places.length && value?.label !== text && <p>Recherchez une adresse en Île-de-France.</p>}
    </div>}
  </div>;
}
