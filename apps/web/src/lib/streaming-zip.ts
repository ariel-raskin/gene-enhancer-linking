/** ZIP64 STORE writer: bounded entry metadata, incremental CRC, awaited writes. No Blob/JSZip. */
export interface ByteSink {write(data:Uint8Array):Promise<unknown>;close():Promise<unknown>;abort(reason?:unknown):Promise<unknown>}
export type Artifact={name:string;data:AsyncIterable<Uint8Array>};
const table=Uint32Array.from({length:256},(_,i)=>{let v=i;for(let j=0;j<8;j++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function crcUpdate(crc:number,bytes:Uint8Array){for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return crc>>>0;}
function record(size:number){const bytes=new Uint8Array(size),v=new DataView(bytes.buffer);return {bytes,u16:(at:number,n:number)=>v.setUint16(at,n,true),u32:(at:number,n:number)=>v.setUint32(at,n,true),u64:(at:number,n:number)=>v.setBigUint64(at,BigInt(n),true)};}
const encoder=new TextEncoder();
export async function streamZip(artifacts:AsyncIterable<Artifact>,sink:ByteSink,progress:(n:number,name:string)=>void=()=>{},maxBytes=16*1024**3){
  const central:{name:Uint8Array;offset:number;size:number;crc:number}[]=[];let offset=0;
  const write=async(b:Uint8Array)=>{if(offset+b.length>maxBytes)throw new Error("ZIP exceeds the explicit 16 GiB streaming archive ceiling. Export individual tables instead.");await sink.write(b);offset+=b.length;};
  try{
    for await(const file of artifacts){
      const name=encoder.encode(file.name);if(name.length>65535||central.length>=4096)throw new Error("ZIP entry metadata budget exceeded.");
      const start=offset,h=record(30);h.u32(0,0x04034b50);h.u16(4,45);h.u16(6,0x808);h.u32(18,0xffffffff);h.u32(22,0xffffffff);h.u16(26,name.length);h.u16(28,20);
      const extra=record(20);extra.u16(0,1);extra.u16(2,16);
      await write(h.bytes);await write(name);await write(extra.bytes);
      let crc=0xffffffff,size=0;
      for await(const bytes of file.data){crc=crcUpdate(crc,bytes);size+=bytes.length;await write(bytes);}
      crc=(crc^0xffffffff)>>>0;const descriptor=record(24);descriptor.u32(0,0x08074b50);descriptor.u32(4,crc);descriptor.u64(8,size);descriptor.u64(16,size);await write(descriptor.bytes);
      central.push({name,offset:start,size,crc});progress(offset,file.name);
    }
    const cdStart=offset;
    for(const e of central){const h=record(46);h.u32(0,0x02014b50);h.u16(4,45);h.u16(6,45);h.u16(8,0x808);h.u32(16,e.crc);h.u32(20,0xffffffff);h.u32(24,0xffffffff);h.u16(28,e.name.length);h.u16(30,28);h.u32(42,0xffffffff);const extra=record(28);extra.u16(0,1);extra.u16(2,24);extra.u64(4,e.size);extra.u64(12,e.size);extra.u64(20,e.offset);await write(h.bytes);await write(e.name);await write(extra.bytes);}
    const cdSize=offset-cdStart,zip64Start=offset,end=record(56);end.u32(0,0x06064b50);end.u64(4,44);end.u16(12,45);end.u16(14,45);end.u64(24,central.length);end.u64(32,central.length);end.u64(40,cdSize);end.u64(48,cdStart);await write(end.bytes);
    const locator=record(20);locator.u32(0,0x07064b50);locator.u64(8,zip64Start);locator.u32(16,1);await write(locator.bytes);
    const classic=record(22);classic.u32(0,0x06054b50);classic.u16(8,0xffff);classic.u16(10,0xffff);classic.u32(12,0xffffffff);classic.u32(16,0xffffffff);await write(classic.bytes);await sink.close();return offset;
  }catch(e){await sink.abort(e).catch(()=>{});throw e;}
}
