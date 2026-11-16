import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {PMTiles} from 'pmtiles';
import {createMapTileSource} from '../lib/map-tile-source.ts';
const [filename,origin='http://localhost:5173']=process.argv.slice(2);
if(!filename)throw new Error('Supply the original reference archive to compare its tiles.');
const handle=await open(filename,'r');
const reference=new PMTiles({getKey:()=>filename,async getBytes(offset,length){const bytes=Buffer.alloc(length);let read=0;while(read<length){const next=await handle.read(bytes,read,length-read,offset+read);if(!next.bytesRead)throw new Error('Incomplete source archive');read+=next.bytesRead;}return{data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}});
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>originalFetch(typeof input==='string'&&input.startsWith('/')?origin+input:input,options);
const messages=[];let loaded=0;
const source=createMapTileSource(s=>messages.push(s),()=>loaded++);
const points=[['Opéra',2.3322,48.8706],['CDG',2.5711,49.0042],['Versailles',2.1204,48.8049],['Gare de Lyon',2.3735,48.8449],['La Défense',2.238,48.8918]];
try{
 for(const [name,lng,lat]of points)for(const z of [10,12,14]){
  const x=Math.floor((lng+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
  const [expected,actual]=await Promise.all([reference.getZxy(z,x,y),source.getZxy(z,x,y)]);
  assert.ok(expected?.data&&actual?.data,`${name} at z${z} has vector data`);
  assert.deepEqual(Buffer.from(actual.data),Buffer.from(expected.data),`${name} at z${z} matches the original map exactly`);
 }
 const controller=new AbortController();controller.abort();await assert.rejects(source.getZxy(14,0,0,controller.signal),{name:'AbortError'});
 assert.equal(loaded,15);assert.equal(messages.filter(Boolean).length,0);
 console.log('PASS: all 15 location/zoom samples match the reference vector tiles byte for byte; cancellation is handled.');
}finally{globalThis.fetch=originalFetch;await handle.close();}
