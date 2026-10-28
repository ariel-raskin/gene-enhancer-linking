import {test,expect,chromium} from "@playwright/test";
import {readFile,writeFile,mkdir,statfs,mkdtemp} from "node:fs/promises";
import ts from "typescript";
import JSZip from "jszip";
import {createWriteStream} from "node:fs";
import {createGzip} from "node:zlib";
import {once} from "node:events";
const storeScript=async()=>ts.transpileModule(await readFile("src/lib/result-store.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;

test("saved runs survive reload, pages and filters preserve rows; direct-file ZIP stream has valid CRCs",async({page})=>{
 await page.goto("/workspace");await page.getByLabel("Choose processed-analysis folder").setInputFiles("../../examples/synthetic_chunks");await page.getByRole("button",{name:"Organize as experiment"}).click();await page.getByRole("button",{name:"Apply experiment metadata"}).click();await page.getByRole("button",{name:"Confirm reviewed contrast metadata"}).click();await page.getByRole("button",{name:"Analyze ready contrasts"}).click();await expect(page.getByRole("status")).toContainText("1 successful, 0 failed");
 const id=await page.getByLabel("Saved run",{exact:true}).inputValue();await page.reload();await page.getByLabel("Saved run",{exact:true}).selectOption(id);await expect(page.getByText(/matching contrast-specific candidate rows/)).toBeVisible();
 const before=await page.getByText(/matching contrast-specific candidate rows/).textContent();await page.getByLabel("Experiment evidence filter").selectOption("discordant");await page.getByLabel("Experiment evidence filter").selectOption("all");await expect(page.getByText(/matching contrast-specific candidate rows/)).toHaveText(before!);
 // An actual browser filesystem handle exercises the same structured-clone/writable-stream path as the save picker.
 // Automated test supplies OPFS; native picker UX is not asserted.
 await page.evaluate(()=>{(window as unknown as {showSaveFilePicker:()=>Promise<FileSystemFileHandle>}).showSaveFilePicker=async()=>{const dir=await navigator.storage.getDirectory();return dir.getFileHandle("gel-direct-export-test.zip",{create:true});};});
 await page.getByRole("button",{name:"Save ZIP directly to disk",exact:true}).click();await expect(page.getByText(/bytes written · direct filesystem stream/)).toBeVisible({timeout:30000});
 const array=await page.evaluate(async()=>{const dir=await navigator.storage.getDirectory(),handle=await dir.getFileHandle("gel-direct-export-test.zip"),file=await handle.getFile(),bytes=Array.from(new Uint8Array(await file.arrayBuffer()));await dir.removeEntry("gel-direct-export-test.zip");return bytes;});
 const zip=await JSZip.loadAsync(new Uint8Array(array),{checkCRC32:true});const validation=JSON.parse(await zip.file("validation_report.json")!.async("string"));expect(validation.state).toBe("complete");expect(validation.complete).toBe(true);expect(validation.resources.persistent).toBe(true);expect(validation.resources.retainedRows).toBeGreaterThan(0);expect(zip.file("gel_experiment_links.bedpe")).not.toBeNull();
 await page.getByLabel("Additional saved export").selectOption("analysis_parameters.json");const metadataDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Download selected file (64 MiB maximum)",exact:true}).click();expect((await metadataDownload).suggestedFilename()).toBe("analysis_parameters.json");
 const source=await storeScript();const remaining=await page.evaluate(async({source,id})=>{const api=await import(URL.createObjectURL(new Blob([source],{type:"text/javascript"})));const store=await api.ResultStore.open();await store.delete(id);const run=await store.get(id);const q=await api.queryResults(store.db,{run:id,layer:"primary"});store.close();return {run,total:q.total};},{source,id});expect(remaining.run).toBeUndefined();expect(remaining.total).toBe(0);
});

test("optional private dense HEL default-distance persistence and streaming capacity",async({browser})=>{
 const folder=process.env.GEL_PRIVATE_DATA,output=process.env.GEL_PRIVATE_OUTPUT;test.skip(!folder||!output,"Private tracks and outputs are never committed.");test.setTimeout(90*60*1000);await mkdir(output!,{recursive:true});
 const profilePath=await mkdtemp(output+"/browser-profile-");
 const heapMiB=Number(process.env.GEL_PRIVATE_JS_HEAP_MIB??2048);
 const context=await chromium.launchPersistentContext(profilePath,{headless:true,acceptDownloads:true,args:[`--js-flags=--max-old-space-size=${heapMiB}`],baseURL:process.env.GEL_BASE_URL??"http://127.0.0.1:3000"});const page=await context.newPage();page.setDefaultTimeout(30000);
 const names=["0hr.plus.avg.bw","0hr.minus.avg.bw","dTAG_1hr.plus.avg.bw","dTAG_1hr.minus.avg.bw","genes.tsv","experiment_manifest.json"];
 const bad:string[]=[];page.on("request",r=>{if(r.method()==="POST"||new URL(r.url()).origin!==new URL(process.env.GEL_BASE_URL??"http://127.0.0.1:3000").origin)bad.push(r.url());});
 const selected=names.filter(n=>n!=="experiment_manifest.json").map(n=>folder+"/"+n);selected.push(process.env.GEL_PRIVATE_MANIFEST??folder+"/experiment_manifest.json");if(process.env.GEL_PRIVATE_AGB_FOLDER)selected.push(...["AGB1_1hr.plus.avg.bw","AGB1_1hr.minus.avg.bw"].map(n=>process.env.GEL_PRIVATE_AGB_FOLDER+"/"+n));
 await page.goto("/workspace");await page.getByLabel("Choose experiment files").setInputFiles(selected);const organize=page.getByRole("button",{name:"Organize as experiment"});await expect(organize.or(page.getByRole("heading",{name:"Review your experiment"})).first()).toBeVisible({timeout:30000});if(await organize.isVisible())await organize.click();await page.getByRole("button",{name:"Apply experiment metadata"}).click();await page.getByRole("button",{name:"Confirm reviewed contrast metadata"}).click();
 await page.getByLabel("Maximum TSS distance (bp)",{exact:true}).fill("100000");await page.getByLabel("Chunk bases").fill("1000000");await page.getByLabel("Local result budget GiB").fill(process.env.GEL_PRIVATE_BUDGET??"2");
 await page.getByLabel("Storage write batch rows").fill(process.env.GEL_PRIVATE_BATCH??"500");
 const source=await storeScript(),profiles:Record<string,unknown>[]=[];
 const cases=process.env.GEL_PRIVATE_CASES?.split(",")??["chromosome","genome","lower-signal"];
 for(const name of cases){await page.getByLabel("Genomic scope",{exact:true}).selectOption(name.startsWith("chromosome")?"chromosomes":"genome");await page.getByLabel("Selected chromosomes").fill(name==="chromosome-1"?"chr1":"chr21");await page.getByLabel("Minimum mean signal",{exact:true}).fill(name==="lower-signal"||name==="chromosome-low"?"0.04":name==="chromosome-lower"?"0.02":"0.08");
  await page.evaluate(()=>{const w=window as unknown as {ticks:number;timer:number;heap:number};w.ticks=0;w.heap=0;w.timer=window.setInterval(()=>{w.ticks++;w.heap=Math.max(w.heap,(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??0);},100);});
  let protectiveCancel=false;
  const watchdog=setInterval(()=>{void (async()=>{await writeFile(output+"/live-progress.txt",await page.getByRole("status").textContent()??"no status").catch(()=>{});const fs=await statfs("C:/").catch(()=>null);if(fs&&Number(fs.bavail)*Number(fs.bsize)<3*1024**3){protectiveCancel=true;await page.getByRole("button",{name:"Cancel experiment",exact:true}).click().catch(()=>{});}})();},10000);
  const previous=await page.getByLabel("Saved run",{exact:true}).inputValue().catch(()=>"");const start=Date.now();await page.getByRole("button",{name:"Analyze ready contrasts"}).click();await expect.poll(async()=>page.getByLabel("Saved run",{exact:true}).inputValue()).not.toBe(previous);let timedOut=false;try{await expect(page.getByRole("status")).toContainText(/Experiment finished|Cancelled/,{timeout:45*60*1000});}catch{timedOut=true;await page.getByRole("button",{name:"Cancel experiment",exact:true}).click();await expect(page.getByRole("status")).toContainText("Cancelled");}clearInterval(watchdog);const id=await page.getByLabel("Saved run",{exact:true}).inputValue();
  const profile=await page.evaluate(async({source,id})=>{const api=await import(URL.createObjectURL(new Blob([source],{type:"text/javascript"}))),s=await api.ResultStore.open(),r=await s.get(id);s.close();const w=window as unknown as {ticks:number;timer:number;heap:number};clearInterval(w.timer);return {id,state:r.state,rows:r.rows,estimatedBytes:r.bytes,batches:r.batches,writeMs:r.writeMs,resources:r.resources,validations:r.outcomes.map((o:{status:string;findings:string[];result?:{validation:unknown}})=>({status:o.status,findings:o.findings,validation:o.result?.validation})),storage:await navigator.storage.estimate(),mainHeapPeak:w.heap,ticks:w.ticks};},{source,id});
  const elapsedMs=Date.now()-start;profiles.push({case:name,timedOut,jsHeapFlagMiB:heapMiB,hostDiskProtectiveCancellation:protectiveCancel,browser:browser.version(),elapsedMs,profileMode:"dedicated normal persistent browser profile",profilePath,...profile});await writeFile(output+"/dense-browser-performance.json",JSON.stringify(profiles,null,2));
  // Stream an individual complete TSV to a real browser OPFS handle; never buffer it as a Blob.
  if(profile.state==="complete"){
   await page.evaluate(()=>{(window as unknown as {showSaveFilePicker:()=>Promise<FileSystemFileHandle>}).showSaveFilePicker=async()=>{const dir=await navigator.storage.getDirectory();return dir.getFileHandle("gel-private-stream-test.tsv",{create:true});};});
   const exported=Date.now();await page.getByRole("button",{name:"Save gel_experiment_links.tsv directly to disk",exact:true}).click();await expect(page.getByText(/bytes written · direct filesystem stream/)).toBeVisible({timeout:30*60*1000});
   const fileStats=await page.evaluate(async()=>{const dir=await navigator.storage.getDirectory(),file=await (await dir.getFileHandle("gel-private-stream-test.tsv")).getFile();let lines=0;const reader=file.stream().getReader();while(true){const {value,done}=await reader.read();if(done)break;for(const b of value)if(b===10)lines++;}const result={bytes:file.size,dataRows:lines};await dir.removeEntry("gel-private-stream-test.tsv");return result;});
   Object.assign(profiles.at(-1)!,{exportMs:Date.now()-exported,fileStats});expect(fileStats.dataRows).toBe(profile.rows);await writeFile(output+"/dense-browser-performance.json",JSON.stringify(profiles,null,2));
  }
  // Private numerical parity artifacts are bounded to chromosome case; large tables remain in the local store only during this test.
  if(name==="chromosome"){
   const d=page.waitForEvent("download");await page.getByRole("button",{name:"gel_experiment_links.tsv",exact:true}).click();await (await d).saveAs(output+"/chromosome-links.tsv");
  }
  if(process.env.GEL_PRIVATE_SAVE_RECORDS==="1"){
   // Development-only local IPC bridge: bounded readback to a private compressed parity artifact, never an application backend.
   for(const kind of ["links","gene","enhancer"]){const binding=`gelPrivateParity_${name.replace(/\W/g,"_")}_${kind}`;const destination=createWriteStream(`${output}/${name}-${kind}.jsonl.gz`),gzip=createGzip();gzip.pipe(destination);let count=0;
    await page.exposeFunction(binding,async(rows:unknown[])=>{count+=rows.length;if(!gzip.write(rows.map(r=>JSON.stringify(r)).join("\n")+"\n"))await once(gzip,"drain");});
    await page.evaluate(async({source,id,kind,binding})=>{const api=await import(URL.createObjectURL(new Blob([source],{type:"text/javascript"}))),s=await api.ResultStore.open();let batch:unknown[]=[];const send=async()=>{await (window as unknown as Record<string,(rows:unknown[])=>Promise<void>>)[binding](batch);batch=[];};
     try{if(kind==="links"){for await(const v of s.rows(id,"primary")){batch.push(v.row);if(batch.length===500)await send();}}else for await(const f of s.features(id,"primary",kind,undefined,true)){batch.push(f);if(batch.length===500)await send();}if(batch.length)await send();}finally{s.close();}
    },{source,id,kind,binding});gzip.end();await once(destination,"close");await writeFile(`${output}/${name}-${kind}-count.json`,JSON.stringify({count}));
   }
  }
  if(process.env.GEL_PRIVATE_KEEP_RUNS==="1"){
   await page.reload();await page.getByLabel("Saved run",{exact:true}).selectOption(id);await expect(page.getByText(`${profile.rows} matching contrast-specific candidate rows`,{exact:false})).toBeVisible({timeout:60000});
  }else await page.evaluate(async({source,id})=>{const api=await import(URL.createObjectURL(new Blob([source],{type:"text/javascript"}))),s=await api.ResultStore.open();await s.delete(id);s.close();},{source,id});
 }
 await writeFile(output+"/privacy.json",JSON.stringify({unexpectedRequests:bad}));expect(bad).toEqual([]);await context.close();
});
