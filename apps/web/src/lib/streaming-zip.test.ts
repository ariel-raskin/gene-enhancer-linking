import {expect,it} from "vitest";
import JSZip from "jszip";
import {streamZip,type ByteSink} from "./streaming-zip";
it("streams valid ZIP64 entries and CRCs with awaited writes",async()=>{
 const parts:Uint8Array[]=[],encoder=new TextEncoder();let active=0,maxActive=0,closed=false;
 const sink:ByteSink={write:async(bytes)=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();parts.push(bytes.slice());active--;},close:async()=>{closed=true;},abort:async()=>{throw new Error("Unexpected abort");}};
 const artifacts=async function*(){for(const [name,s] of [["a.tsv","x\ty\n1\t2"],["nested/unicode-α.csv","a,b\n3,4"],["empty",""]])yield {name,data:(async function*(){for(const c of s)yield encoder.encode(c);})()};};
 const count=await streamZip(artifacts(),sink);expect(new DataView(parts[0].buffer).getUint16(12,true)).toBe(0x21);const archive=await JSZip.loadAsync(Buffer.concat(parts),{checkCRC32:true});expect(await archive.file("a.tsv")!.async("string")).toBe("x\ty\n1\t2");expect(await archive.file("nested/unicode-α.csv")!.async("string")).toBe("a,b\n3,4");expect(count).toBe(parts.reduce((n,p)=>n+p.length,0));expect(closed).toBe(true);expect(maxActive).toBe(1);
});
it("aborts a failed destination without finalizing an archive",async()=>{let close=false,abort=false;const sink:ByteSink={write:async()=>{throw new DOMException("full","QuotaExceededError");},close:async()=>{close=true;},abort:async()=>{abort=true;}};await expect(streamZip((async function*(){yield {name:"a",data:(async function*(){yield new Uint8Array(3);})()};})(),sink)).rejects.toThrow("full");expect(close).toBe(false);expect(abort).toBe(true);});
