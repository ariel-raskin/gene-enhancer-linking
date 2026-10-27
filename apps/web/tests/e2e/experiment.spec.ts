import { expect, test } from "@playwright/test";
import { readFile, cp, writeFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";

test("a complete local folder runs valid contrasts and exports independent evidence with shared controls",async({page},testInfo)=>{
 const requests:{url:string;method:string}[]=[];page.on("request",r=>requests.push({url:r.url(),method:r.method()}));
 await page.goto("/workspace");await page.getByLabel("Choose processed-analysis folder").setInputFiles("../../examples/synthetic_experiment");
 await expect(page.getByRole("heading",{name:"Review your experiment"})).toBeVisible();
 await page.getByRole("button",{name:"Apply experiment metadata"}).click();
 await page.getByRole("button",{name:"Confirm reviewed contrast metadata"}).click();
 await expect(page.getByText(/8 proposed contrasts · 6 ready/)).toBeVisible();
 const invalid=page.locator(".contrast-details").filter({has:page.getByLabel("Exclude DrugB_8h_vs_control")});await invalid.locator(":scope > summary").click();await page.getByLabel("Exclude DrugB_8h_vs_control").check();
 await page.evaluate(()=>{const state=window as unknown as {gelPerf:{start:number;ticks:number;peakMainHeap:number};gelTimer:number};state.gelPerf={start:performance.now(),ticks:0,peakMainHeap:0};state.gelTimer=window.setInterval(()=>{state.gelPerf.ticks++;const perf=performance as Performance&{memory?:{usedJSHeapSize:number}};state.gelPerf.peakMainHeap=Math.max(state.gelPerf.peakMainHeap,perf.memory?.usedJSHeapSize??0);},10);});
 await page.getByRole("button",{name:"Analyze ready contrasts"}).click();
 await expect(page.getByRole("status")).toContainText("6 successful, 0 failed",{timeout:30000});
 await expect(page.getByText(/18 matching contrast-specific candidate rows/)).toBeVisible();
 await expect(page.locator(".contrast-outcomes")).toContainText("DrugA_8h_vs_control: incomplete");await expect(page.locator(".contrast-outcomes")).toContainText("DrugB_8h_vs_control: excluded");
 const performanceResult=await page.evaluate(()=>{const s=window as unknown as {gelPerf:{start:number;ticks:number;peakMainHeap:number};gelTimer:number};clearInterval(s.gelTimer);return {...s.gelPerf,elapsedMs:performance.now()-s.gelPerf.start};});expect(performanceResult.ticks).toBeGreaterThan(0);
 await page.getByLabel("Search experiment gene").fill("GENE_CONC");await page.getByLabel("Experiment contrast filter").selectOption("synthetic_experiment/DrugB_1h_vs_control");await expect(page.getByText(/3 matching contrast-specific candidate rows/)).toBeVisible();
 await page.getByLabel("Experiment evidence filter").selectOption("discordant");await expect(page.getByText(/1 matching contrast-specific candidate rows/)).toBeVisible();
 const pending=page.waitForEvent("download");await page.getByRole("button",{name:"Download experiment ZIP"}).click();const d=await pending;expect(d.suggestedFilename()).toBe("gel-experiment.zip");const path=await d.path();const zip=await JSZip.loadAsync(await readFile(path!));
 const table=await zip.file("gel_experiment_links.tsv")!.async("string");expect(table.trim().split("\n")).toHaveLength(19);const bedpe=await zip.file("gel_experiment_links.bedpe")!.async("string");expect(bedpe.trim().split("\n").every(l=>l.split("\t").length===12)).toBe(true);
 const manifest=JSON.parse(await zip.file("experiment_manifest.json")!.async("string"));expect(manifest.samples.filter((s:{condition:string})=>s.condition==="control")).toHaveLength(2);expect(manifest.contrasts).toHaveLength(8);expect(manifest.contrasts.filter((c:{controlSampleIds:string[]})=>c.controlSampleIds.includes("control_A"))).toHaveLength(8);
 const validation=JSON.parse(await zip.file("validation_report.json")!.async("string"));expect(validation.resources.cacheHits).toBeGreaterThan(0);expect(validation.resources.retainedRows).toBe(36);expect(validation.privacy.selected_file_contents_uploaded).toBe(false);
 console.log("EXPERIMENT_BROWSER_PROFILE",JSON.stringify({...performanceResult,resources:validation.resources,inputFiles:manifest.files.length,inputBytes:manifest.files.reduce((s:number,f:{size:number})=>s+f.size,0)}));
 await testInfo.attach("regional-experiment-profile.json",{body:JSON.stringify({performanceResult,resources:validation.resources},null,2),contentType:"application/json"});
 expect(requests.filter(r=>r.method==="POST")).toEqual([]);expect(requests.filter(r=>new URL(r.url).origin!==new URL(process.env.GEL_BASE_URL ?? "http://127.0.0.1:3000").origin)).toEqual([]);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("one corrupt contrast fails visibly while other contrasts complete",async({page},testInfo)=>{
 const dir=testInfo.outputPath("synthetic_experiment");await cp("../../examples/synthetic_experiment",dir,{recursive:true});const path=dir+"/DrugA_2h_vs_control/known_gene/normalized_pp_gb.txt";await writeFile(path,(await readFile(path,"utf8")).replace("\t+\t","\t?\t"));
 await page.goto("/workspace");await page.getByLabel("Choose processed-analysis folder").setInputFiles(dir);await page.getByRole("button",{name:"Apply experiment metadata"}).click();await page.getByRole("button",{name:"Confirm reviewed contrast metadata"}).click();await page.getByRole("button",{name:"Analyze ready contrasts"}).click();await expect(page.getByRole("status")).toContainText("5 successful, 1 failed",{timeout:30000});await expect(page.locator(".contrast-outcomes")).toContainText("DrugA_2h_vs_control: failed");await expect(page.getByText(/15 matching contrast-specific candidate rows/)).toBeVisible();
});

test("cancellation terminates the experiment worker and labels unfinished contrasts",async({page})=>{
 await page.addInitScript(()=>{const Native=window.Worker;window.Worker=class extends Native{postMessage(message:unknown,options?:StructuredSerializeOptions|Transferable[]){const data=message as {experiment?:unknown};const send=()=>{if(Array.isArray(options))super.postMessage(message,options);else super.postMessage(message,options);};if(data.experiment)setTimeout(send,500);else send();}};});
 await page.goto("/workspace");await page.getByRole("button",{name:"Load synthetic multi-contrast experiment"}).click();await page.getByRole("button",{name:"Apply experiment metadata"}).click();await page.getByRole("button",{name:"Confirm reviewed contrast metadata"}).click();await page.getByRole("button",{name:"Analyze ready contrasts"}).click();await page.getByRole("button",{name:"Cancel experiment"}).click();await expect(page.getByRole("status")).toContainText("Cancelled");await expect(page.locator(".contrast-outcomes")).toContainText("cancelled");await page.waitForTimeout(650);await expect(page.getByText(/0 matching contrast-specific candidate rows/)).toBeVisible();
});

test("a larger processed regional collection remains responsive and respects the retained-result budget",async({page},testInfo)=>{
 const directory=testInfo.outputPath("synthetic_scale");let inputBytes=0;
 for(let t=1;t<=6;t++){
   const folder=`${directory}/drug_${t}h_vs_control`;await mkdir(folder+"/known_gene",{recursive:true});await mkdir(folder+"/eRNA",{recursive:true});
   let gb="Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\n",coords="Transcript\tGene\tchr\tstart\tend\tstrand\tgbc_control\tgbc_treatment\n",enh="Enhancer_ID\tchr\tstart\tend\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\n";
   for(let i=0;i<1000;i++){const start=10000+i*1000;gb+=`TX${i}\tG${i}\t100\t.9\t.2\t4\t.001\t.01\n`;coords+=`TX${i}\tG${i}\tchrScale\t${start+1}\t${start+200}\t+\t100\t190\n`;enh+=`E${i}\tchrScale\t${start-500}\t${start-400}\t20\t.9\t.2\t4\t.001\t.01\n`;}
   for(const [name,text] of [["known_gene/gb_change.txt",gb],["known_gene/normalized_pp_gb.txt",coords],["eRNA/Enhancer_change.txt",enh]]){await writeFile(folder+"/"+name,text);inputBytes+=Buffer.byteLength(text);}
 }
 await page.goto("/workspace");await page.getByLabel("Choose processed-analysis folder").setInputFiles(directory);await page.getByLabel("Experiment assembly").fill("synthetic-scale-v1");await page.getByLabel("Default statistical model / normalization").fill("Synthetic scale fixture, illustrative source statistics");await page.getByLabel("Maximum TSS distance (bp)",{exact:true}).fill("1000");await page.getByRole("button",{name:"Confirm reviewed contrast metadata"}).click();
 const started=Date.now();await page.getByRole("button",{name:"Analyze ready contrasts"}).click();await expect(page.getByRole("status")).toContainText("6 successful, 0 failed",{timeout:30000});const elapsedMs=Date.now()-started;await expect(page.getByText(/11994 matching contrast-specific candidate rows/)).toBeVisible();
 await page.getByLabel("Search experiment gene").fill("G500");await expect(page.getByText(/12 matching contrast-specific candidate rows/)).toBeVisible();
 const d=page.waitForEvent("download");await page.getByRole("button",{name:"Download experiment ZIP"}).click();const zip=await JSZip.loadAsync(await readFile((await (await d).path())!));const report=JSON.parse(await zip.file("validation_report.json")!.async("string"));expect(report.resources.retainedRows).toBe(11994);expect(report.resources.retainedResultBytesEstimate).toBeLessThan(128*1024*1024);
 const perf=await page.evaluate(()=>{const p=performance as Performance&{memory?:{usedJSHeapSize:number}};return p.memory?.usedJSHeapSize??null;});console.log("SCALE_BROWSER_PROFILE",JSON.stringify({elapsedMs,inputBytes,mainHeapAfterExport:perf,resources:report.resources}));await testInfo.attach("processed-region-scale-profile.json",{body:JSON.stringify({elapsedMs,inputBytes,mainHeapAfterExport:perf,resources:report.resources},null,2),contentType:"application/json"});
});
