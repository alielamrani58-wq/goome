import {open,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {PMTiles} from 'pmtiles';

// Repackage the existing reference archive as small, independently cached tile
// packs. The browser never needs the original multi-gigabyte France archive.
const [input,output]=process.argv.slice(2);
if(!input||!output) throw new Error('Usage: node scripts/build-idf-map.mjs SOURCE.pmtiles OUTPUT_DIRECTORY');
class DiskSource {
  constructor(file){this.file=resolve(file);}
  getKey(){return this.file;}
  async getBytes(offset,length){this.handle??=await open(this.file,'r');const data=Buffer.alloc(length);let read=0;while(read<length){const r=await this.handle.read(data,read,length-read,offset+read);if(!r.bytesRead)throw new Error('Incomplete map archive');read+=r.bytesRead;}return{data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};}
  async close(){await this.handle?.close();}
}
const source=new DiskSource(input),archive=new PMTiles(source);
const france=[-5.3,41.3,9.7,51.2],idf=[1.4,48.1,3.6,49.25];
const xy=(lng,lat,z)=>[Math.floor((lng+180)/360*2**z),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z)];
await mkdir(output,{recursive:true});
let tileCount=0,packCount=0,totalBytes=0;
try{
 for(let z=0;z<=14;z++){
  const bounds=idf,a=xy(bounds[0],bounds[3],z),b=xy(bounds[2],bounds[1],z),max=2**z-1;
  const minX=Math.max(0,a[0]-1),maxX=Math.min(max,b[0]+1),minY=Math.max(0,a[1]-1),maxY=Math.min(max,b[1]+1);
  for(let gx=Math.floor(minX/8);gx<=Math.floor(maxX/8);gx++)for(let gy=Math.floor(minY/8);gy<=Math.floor(maxY/8);gy++){
   const index=Array(64).fill(null),parts=[];let offset=0;
   for(let dx=0;dx<8;dx++)for(let dy=0;dy<8;dy++){
    const x=gx*8+dx,y=gy*8+dy;if(x<minX||x>maxX||y<minY||y>maxY)continue;
    const tile=await archive.getZxy(z,x,y);if(!tile?.data?.byteLength)continue;
    const packed=gzipSync(Buffer.from(tile.data),{level:6});index[dy*8+dx]=[offset,packed.length];parts.push(packed);offset+=packed.length;tileCount++;
   }
   if(!parts.length)continue;
   const json=Buffer.from(JSON.stringify(index)),header=Buffer.alloc(8);header.write('GMP1',0);header.writeUInt32LE(json.length,4);
   const packed=Buffer.concat([header,json,...parts]);if(packed.length>24*1024*1024)throw new Error('Tile pack exceeds static asset size limit');
   await writeFile(join(output,`${z}-${gx}-${gy}.bin`),packed);packCount++;totalBytes+=packed.length;
  }
  console.log(JSON.stringify({zoom:z,tiles:tileCount,packs:packCount,megabytes:Math.round(totalBytes/1024/1024)}));
 }
 await writeFile(join(output,'manifest.json'),JSON.stringify({version:1,source:'Protomaps France extract, 2026-11-01',coverage:idf,nativeMaxZoom:14,displayMaxZoom:19,overviewCoverage:idf,tileCount,packCount,totalBytes,attribution:'© OpenStreetMap contributors · Protomaps',license:'ODbL produced work',licenseUrl:'https://www.openstreetmap.org/copyright'},null,2)+'\n');
}finally{await source.close();}
