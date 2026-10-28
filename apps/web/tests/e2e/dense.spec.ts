import {test,expect,chromium} from "@playwright/test";
import {readFile,writeFile,mkdir,mkdtemp} from "node:fs/promises";
import ts from "typescript";

test("240,000 scientific candidate rows persist, page and stream beyond the legacy retained cap",async({},info)=>{
 test.setTimeout(900000);
 const root=info.outputPath("dense_synthetic"),folder=root+"/drug_1h_vs_control";await mkdir(folder+"/known_gene",{recursive:true});await mkdir(folder+"/eRNA",{recursive:true});
 let gb="Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\n",coords="Transcript\tGene\tchr\tstart\tend\tstrand\tgbc_control\tgbc_treatment\n",enh="Enhancer_ID\tchr\tstart\tend\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\n";
 for(let i=0;i<1200;i++){gb+=`TX${i}\tG${i}\t100\t.9\t.2\t4\t.001\t.01\n`;coords+=`TX${i}\tG${i}\tchrDense\t${50001+i}\t${50200+i}\t+\t100\t190\n`;}
 for(let i=0;i<200;i++)enh+=`E${i}\tchrDense\t${5000+i*100}\t${5050+i*100}\t20\t${i%2?-.9:.9}\t.2\t4\t.001\t.01\n`;
 for(const [name,text] of [["known_gene/gb_change.txt",gb],["known_gene/normalized_pp_gb.txt",coords],["eRNA/Enhancer_change.txt",enh]])await writeFile(folder+"/"+name,text);
 const profile=await mkdtemp(info.outputPath("browser-profile-")),context=await chromium.launchPersistentContext(profile,{headless:true,acceptDownloads:true,baseURL:process.env.GEL_BASE_URL??"http://127.0.0.1:3000"});const page=await context.newPage();
 try{
  await page.goto("/workspace");await page.getByLabel("Choose processed-analysis folder").setInputFiles(root);await page.getByRole("button",{name:"Organize as experiment"}).click();await page.getByLabel("Experiment assembly").fill("synthetic-dense-v1");await page.getByLabel("Default statistical model / normalization").fill("Illustrative independent synthetic source estimates; no fitted biology");await page.getByRole("button",{name:"Confirm reviewed contrast metadata"}).click();
  const started=Date.now();await page.getByRole("button",{name:"Analyze ready contrasts"}).click();await expect(page.getByRole("status")).toContainText("1 successful, 0 failed",{timeout:600000});const elapsedMs=Date.now()-started;await expect(page.getByText(/240000 matching contrast-specific candidate rows/)).toBeVisible({timeout:30000});
  await page.getByRole("button",{name:"Next candidates",exact:true}).click();await expect(page.getByText("Page 2 / 2400",{exact:true})).toBeVisible();await page.getByLabel("Search experiment gene").fill("G500");await expect(page.getByText(/200 matching contrast-specific candidate rows/)).toBeVisible({timeout:30000});await page.getByLabel("Experiment evidence filter").selectOption("discordant");await expect(page.getByText(/100 matching contrast-specific candidate rows/)).toBeVisible();
  const id=await page.getByLabel("Saved run",{exact:true}).inputValue();const script=ts.transpileModule(await readFile("src/lib/result-store.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const stats=await page.evaluate(async({script,id})=>{const api=await import(URL.createObjectURL(new Blob([script],{type:"text/javascript"}))),s=await api.ResultStore.open(),r=await s.get(id);s.close();return {rows:r.rows,bytes:r.bytes,batches:r.batches,writeMs:r.writeMs,state:r.state,storage:await navigator.storage.estimate(),mainHeap:(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??null};},{script,id});
  await page.evaluate(()=>{(window as unknown as {showSaveFilePicker:()=>Promise<FileSystemFileHandle>}).showSaveFilePicker=async()=>{const dir=await navigator.storage.getDirectory();return dir.getFileHandle("gel-dense-test.tsv",{create:true});};});
  const startExport=Date.now();await page.getByRole("button",{name:"Save gel_experiment_links.tsv directly to disk",exact:true}).click();await expect(page.getByText(/bytes written · direct filesystem stream/)).toBeVisible({timeout:180000});
  const file=await page.evaluate(async()=>{const root=await navigator.storage.getDirectory(),file=await(await root.getFileHandle("gel-dense-test.tsv")).getFile(),reader=file.stream().getReader();let lines=0;while(true){const r=await reader.read();if(r.done)break;for(const b of r.value)if(b===10)lines++;}await root.removeEntry("gel-dense-test.tsv");return {bytes:file.size,rows:lines};});expect(file.rows).toBe(240000);
  await info.attach("dense-synthetic-profile.json",{body:JSON.stringify({elapsedMs,exportMs:Date.now()-startExport,file,...stats},null,2),contentType:"application/json"});console.log("DENSE_SYNTHETIC_PROFILE",JSON.stringify({elapsedMs,exportMs:Date.now()-startExport,file,...stats}));
  await page.evaluate(async({script,id})=>{const api=await import(URL.createObjectURL(new Blob([script],{type:"text/javascript"}))),s=await api.ResultStore.open();await s.delete(id);s.close();},{script,id});
 }finally{await context.close();}
});
