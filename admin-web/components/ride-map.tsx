'use client';
import {useEffect,useRef,useState} from 'react';
import type * as Leaflet from 'leaflet';
import type {PMTiles} from 'pmtiles';
import {Minus,Plus,LocateFixed,MapPin,Compass} from 'lucide-react';
import {mapTheme} from '@/lib/map-theme';
import {createMapTileSource} from '@/lib/map-tile-source';
import assets from '@/lib/figma-assets.json';
import type {Place,Trip} from '@/lib/goome-types';

interface Props {pickup:Place|null;dropoff:Place|null;position:Place|null;coordinates:[number,number][];trip:Trip|null;picking:'pickup'|'dropoff'|null;selectable:boolean;onPick:(p:Place)=>void;onLocate:()=>void;}
const initial:[number,number]=[48.8706,2.3322];
function padding(){return window.innerWidth>768?{paddingTopLeft:[window.innerWidth>1199?440:395,60] as [number,number],paddingBottomRight:[60,60] as [number,number]}:{paddingTopLeft:[32,100] as [number,number],paddingBottomRight:[32,Math.min(window.innerHeight*.62,540)] as [number,number]};}
const vehicle='<img src="/figma/car.svg" width="24" height="24" alt=""/>';

export default function RideMap({pickup,dropoff,position,coordinates,trip,picking,selectable,onPick,onLocate}:Props){
 const container=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),layers=useRef<Leaflet.LayerGroup|null>(null),leaflet=useRef<typeof Leaflet|null>(null);
 const tileLayer=useRef<{redraw:()=>void}|null>(null),source=useRef<ReturnType<typeof createMapTileSource>|null>(null);
 const callbacks=useRef({picking,selectable,onPick});callbacks.current={picking,selectable,onPick};
 const routeRef=useRef(coordinates);routeRef.current=coordinates;
 const [ready,setReady]=useState(false),[message,setMessage]=useState('');const fitted=useRef('');
 useEffect(()=>{
  let disposed=false;let observer:ResizeObserver|undefined;
  (async()=>{
   const L=await import('leaflet');if(disposed||!container.current)return;
   (window as unknown as {L:typeof Leaflet}).L=L;leaflet.current=L;
   const P=await import('protomaps-leaflet');if(disposed||!container.current)return;
   const m=L.map(container.current,{zoomControl:false,attributionControl:true,scrollWheelZoom:true,minZoom:8,maxZoom:19,zoomSnap:.5,zoomDelta:1,preferCanvas:true,maxBounds:[[48.1,1.4],[49.25,3.6]],maxBoundsViscosity:1}).setView(initial,15.5);
   map.current=m;if(window.innerWidth>768)m.panBy([-200,0],{animate:false});else m.panBy([0,180],{animate:false});
   const data=createMapTileSource(status=>{if(!disposed)setMessage(status);},()=>{if(container.current)container.current.dataset.mapData='ready';});source.current=data;
   const tiles=P.leafletLayer({url:data as unknown as PMTiles,paintRules:P.paintRules(mapTheme),labelRules:P.labelRules(mapTheme,'fr'),backgroundColor:mapTheme.background,lang:'fr',maxDataZoom:14,maxZoom:19,noWrap:true,keepBuffer:2,updateWhenIdle:true,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Protomaps'});
   tileLayer.current={redraw:()=>tiles.redraw()};tiles.addTo(m);layers.current=L.layerGroup().addTo(m);
   m.on('click',e=>{if(callbacks.current.picking||callbacks.current.selectable)callbacks.current.onPick({latitude:e.latlng.lat,longitude:e.latlng.lng,label:'Point choisi sur la carte'});});
   observer=new ResizeObserver(()=>{m.invalidateSize({pan:false});if(routeRef.current.length>1)m.fitBounds(L.latLngBounds(routeRef.current.map(([lng,lat])=>[lat,lng])),{...padding(),maxZoom:16,animate:false});});observer.observe(container.current);setReady(true);
  })().catch(()=>{if(!disposed)setMessage('La carte ne s’est pas chargée. Réessayez dans un instant.');});
  return()=>{disposed=true;observer?.disconnect();map.current?.remove();map.current=null;};
 },[]);
 useEffect(()=>{
  const L=leaflet.current,m=map.current,group=layers.current;if(!L||!m||!group)return;group.clearLayers();
  function marker(p:Place,kind:string,html:string,permanent=false){
   const text=document.createElement('span');text.textContent=p.label;
   return L!.marker([p.latitude,p.longitude],{icon:L!.divIcon({className:'map-marker-container',html:`<div class="${kind}">${html}</div>`,iconSize:[0,0]}),interactive:true,keyboard:true,title:p.label,alt:p.label}).addTo(group!).bindTooltip(text,{permanent,direction:'top',offset:[0,-15],className:'reference-map-tooltip'});
  }
  if(pickup&&trip?.status==='requested')marker(pickup,'searching-marker',(['search-wave-1','search-wave-2','search-wave-3'] as const).map(key=>{const a=assets[key];return `<img src="${a.src}" width="${a.width}" height="${a.height}" alt=""/>`;}).join(''));
  if(pickup)marker(pickup,'pickup-marker','<img src="/figma/circle.svg" width="24" height="24" alt=""/>');
  if(dropoff)marker(dropoff,'destination-marker','<img src="/figma/pinpoint.svg" width="22" height="22" alt=""/>');
  if(position)marker(position,'user-location','');
  const fresh=trip?.driver_location_at&&Date.now()-new Date(trip.driver_location_at).getTime()<60_000;
  if(fresh&&trip?.driver_latitude!=null&&trip.driver_longitude!=null)marker({latitude:trip.driver_latitude,longitude:trip.driver_longitude,label:'Votre chauffeur'},'vehicle-marker trip-vehicle',vehicle);
  if(coordinates.length>1){
   const points=coordinates.map(([lng,lat])=>[lat,lng] as [number,number]);L.polyline(points,{color:'#fff',weight:9,interactive:false}).addTo(group);
   const line=L.polyline(points,{color:'#983f2b',weight:5,interactive:false}).addTo(group);
   const key=`${coordinates[0]}-${coordinates.at(-1)}`;if(fitted.current!==key){m.fitBounds(line.getBounds(),{...padding(),maxZoom:16,animate:false});fitted.current=key;}
  }else if(pickup){m.setView([pickup.latitude,pickup.longitude],16,{animate:false});if(window.innerWidth>700)m.panBy([-205,0],{animate:false});}
  else if(position){m.setView([position.latitude,position.longitude],16,{animate:false});if(window.innerWidth>700)m.panBy([-205,0],{animate:false});}
 },[ready,pickup,dropoff,position,coordinates,trip]);
 const recenter=()=>{const L=leaflet.current,m=map.current;if(!L||!m)return;if(coordinates.length>1)m.fitBounds(L.latLngBounds(coordinates.map(([lng,lat])=>[lat,lng])),{...padding(),maxZoom:16,animate:false});else{const p=position||pickup;m.setView(p?[p.latitude,p.longitude]:initial,16,{animate:false});if(window.innerWidth>700)m.panBy([-205,0],{animate:false});}};
 return <section className={`map-stage ${picking?'is-picking':''}`} aria-label="Carte interactive de l’Île-de-France">
  <div className="map-canvas" ref={container}/>
  <div className="map-key"><span/>Carte Île-de-France</div>
  <div className="map-region"><span className="live-dot"/>Île-de-France, France<span className="city-time">GOÖME</span></div>
  {picking&&<div className="map-pick-hint"><MapPin size={15}/>Touchez la carte pour choisir {picking==='pickup'?'votre départ':'votre destination'}.</div>}
  {message&&<div className="map-load-note" role="status"><p>{message}</p><button onClick={()=>{source.current?.reset();setMessage('Chargement de la carte…');tileLayer.current?.redraw();}}>Réessayer</button></div>}
  <div className="map-controls"><button onClick={()=>map.current?.zoomIn()} aria-label="Zoomer"><Plus size={19}/></button><button onClick={()=>map.current?.zoomOut()} aria-label="Dézoomer"><Minus size={19}/></button><button onClick={onLocate} aria-label="Me localiser"><LocateFixed size={19}/></button><button onClick={recenter} aria-label="Recentrer la carte"><Compass size={19}/></button></div>
 </section>;
}
