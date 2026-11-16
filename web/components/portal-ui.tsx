'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import assets from '@/lib/figma-assets.json';
import type {IconName} from '@/lib/portal-pages';

export function FIcon({name,size,className=''}:{name:IconName;size?:number;className?:string}){
 const a=assets[name],scale=size?size/Math.max(a.width,a.height):1;
 return <span className={`figma-icon ${className}`} style={{width:a.width*scale,height:a.height*scale}} aria-hidden="true"><img src={a.src} alt="" width={a.width} height={a.height} style={scale===1?undefined:{transform:`scale(${scale})`}}/></span>;
}
export function Logo({compact=false,onClick}:{compact?:boolean;onClick:()=>void}){return <button className={`brand ${compact?'compact':''}`} onClick={onClick} aria-label="Goöme accueil"><FIcon name="logo" size={compact?87:124}/></button>;}
export function Avatar({name='G',large=false}:{name?:string;large?:boolean}){const initials=name.trim().split(/\s+/).map(s=>s[0]).slice(0,2).join('').toLocaleUpperCase('fr-FR')||'G';return <span className={`avatar ${large?'large':''}`}>{initials}</span>;}
export function Row({icon,title,subtitle,action,children,accent=false}:{icon?:IconName;title:string;subtitle?:string;action?:()=>void;children?:ReactNode;accent?:boolean}){const content=<>{icon&&<span className={`row-icon ${accent?'accent':''}`}><FIcon name={icon} size={22}/></span>}<span className="row-copy"><strong>{title}</strong>{subtitle&&<small>{subtitle}</small>}</span>{children||action&&<FIcon name="angle-right"/>}</>;return action?<button className={`list-row ${accent?'accent':''}`} onClick={action}>{content}</button>:<div className={`list-row ${accent?'accent':''}`}>{content}</div>;}
export function Switch({checked,onChange,label,disabled=false}:{checked:boolean;onChange:()=>void;label:string;disabled?:boolean}){return <button className={`toggle ${checked?'on':''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange} disabled={disabled}><span/></button>;}
export function EmptyState({icon='clock',title,children,action,label}:{icon?:IconName;title:string;children?:ReactNode;action?:()=>void;label?:string}){return <div className="empty-state"><span className="empty-icon"><FIcon name={icon} size={32}/></span><h2>{title}</h2>{children&&<p>{children}</p>}{action&&<button className="primary-button" onClick={action}>{label||'Continuer'}</button>}</div>;}
export function PageHeading({title,onBack}:{title:string;onBack?:()=>void}){return <div className="page-heading">{onBack&&<button className="icon-button back-button" aria-label="Retour" onClick={onBack}><FIcon name="arrow-left"/></button>}<h1>{title}</h1></div>;}
export function Stats({items}:{items:{value:string;label:string}[]}){return <div className="stats">{items.map(i=><div key={i.label}><strong>{i.value}</strong><small>{i.label}</small></div>)}</div>;}
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const box=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const timer=setTimeout(()=>box.current?.querySelector<HTMLElement>('input,button')?.focus(),0);const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const items=box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,textarea,a[href]');if(!items?.length)return;if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items[items.length-1].focus();}else if(!e.shiftKey&&document.activeElement===items[items.length-1]){e.preventDefault();items[0].focus();}}};document.addEventListener('keydown',onKey);return()=>{clearTimeout(timer);document.removeEventListener('keydown',onKey);previous?.focus();};},[onClose]);
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal" ref={box} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fermer" onClick={onClose}><FIcon name="times" size={22}/></button></div>{children}</div></div>;
}
