interface Pack {bytes: ArrayBuffer; start: number; index: ([number,number] | null)[];}

// Same vector data and rendering rules as the reference. Tile packs replace its
// machine-local server, so this map also works after publication.
export function createMapTileSource(onStatus: (message:string)=>void,onData:()=>void){
 const cache=new Map<string,Pack>(),pending=new Map<string,Promise<Pack|null>>();
 let bytes=0;
 async function load(key:string):Promise<Pack|null>{
  const cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);return cached;}
  const inFlight=pending.get(key);if(inFlight)return inFlight;
  const request=(async()=>{
   const response=await fetch(`/maps/idf-v1/${key}.bin`,{signal:AbortSignal.timeout(20_000)});
   if(response.status===404)return null;
   if(!response.ok)throw new Error('Map tile pack unavailable');
   const data=await response.arrayBuffer(),view=new DataView(data);
   if(data.byteLength<8||new TextDecoder().decode(data.slice(0,4))!=='GMP1')throw new Error('Invalid map tile pack');
   const start=8+view.getUint32(4,true);if(start>data.byteLength)throw new Error('Incomplete map tile pack');
   const pack:Pack={bytes:data,start,index:JSON.parse(new TextDecoder().decode(data.slice(8,start)))};
   cache.set(key,pack);bytes+=data.byteLength;
   while(bytes>24*1024*1024&&cache.size>1){const oldest=cache.keys().next().value!;bytes-=cache.get(oldest)!.bytes.byteLength;cache.delete(oldest);}
   return pack;
  })();
  pending.set(key,request);try{return await request;}finally{pending.delete(key);}
 }
 return{
  async getZxy(z:number,x:number,y:number,signal?:AbortSignal){
   if(signal?.aborted)throw new DOMException('Aborted','AbortError');
   try{
    const pack=await load(`${z}-${Math.floor(x/8)}-${Math.floor(y/8)}`),entry=pack?.index[(y%8)*8+x%8];
    if(!pack||!entry)return undefined;
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const compressed=pack.bytes.slice(pack.start+entry[0],pack.start+entry[0]+entry[1]);
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const data=await new Response(stream).arrayBuffer();onData();onStatus('');return{data};
   }catch(error){if(!signal?.aborted)onStatus('La carte ne s’est pas chargée. Vérifiez votre connexion, puis réessayez.');throw error;}
  },
  reset(){cache.clear();bytes=0;}
 };
}
