import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";

test("chromosome scope executes local negative-minus tracks, inspects contigs, exports complete arcs and recovers after cancel",async({page},testInfo)=>{
 const requests:{url:string;method:string}[]=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 await page.goto('/workspace');await page.getByLabel('Choose processed-analysis folder').setInputFiles('../../examples/synthetic_chunks');await page.getByRole('button',{name:'Organize as experiment'}).click();
 await page.getByRole('button',{name:'Apply experiment metadata'}).click();await page.getByRole('button',{name:'Confirm reviewed contrast metadata'}).click();
 await page.getByRole('button',{name:'Inspect BigWig scope and estimates'}).click();await expect(page.getByRole('status')).toContainText('Scope inspection finished',{timeout:30000});await expect(page.getByText('Inspected scope / resource plan',{exact:false})).toBeVisible();
 await page.getByLabel('Genomic scope',{exact:true}).selectOption('chromosomes');await page.getByLabel('Selected chromosomes').fill('chrA,chrB,chrEmpty');
 await page.getByLabel('Maximum TSS distance (bp)',{exact:true}).fill('1500');
 await page.evaluate(()=>{const w=window as unknown as {ticks:number;timer:number};w.ticks=0;w.timer=window.setInterval(()=>w.ticks++,10);});const started=Date.now();
 await page.getByRole('button',{name:'Analyze ready contrasts'}).click();await expect(page.getByRole('status')).toContainText('1 successful, 0 failed',{timeout:30000});
 const ticks=await page.evaluate(()=>{const w=window as unknown as {ticks:number;timer:number};clearInterval(w.timer);return w.ticks;});expect(ticks).toBeGreaterThan(0);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download experiment ZIP'}).click();const zip=await JSZip.loadAsync(await readFile((await (await pending).path())!));
 const manifest=JSON.parse(await zip.file('experiment_manifest.json')!.async('string'));expect(manifest.genomicScope.chromosomes).toEqual(['chrA','chrB','chrEmpty']);
 const report=JSON.parse(await zip.file('validation_report.json')!.async('string'));const validation=report.outcomes[0].validation;expect(validation.complete).toBe(true);expect(validation.truncated).toBe(false);expect(validation.execution.completedChunks).toBe(validation.execution.totalChunks);expect(validation.execution.peakInFlightSignalBytes).toBeLessThanOrEqual(64*1024*1024);
 const links=await zip.file('gel_experiment_links.tsv')!.async('string');expect(links).toContain('chrA:2700-4300');expect(links).toContain('chrA:10000-10103');expect(links).toContain('chrB');
 const bedpe=await zip.file('gel_experiment_links.bedpe')!.async('string');expect(bedpe.split('\n').every(l=>l.split('\t').length===12)).toBe(true);await testInfo.attach('chunk-browser-profile.json',{body:JSON.stringify({elapsedMs:Date.now()-started,ticks,validation},null,2),contentType:'application/json'});
 expect(requests.filter(r=>r.method==='POST'||new URL(r.url).origin!==new URL(process.env.GEL_BASE_URL??'http://127.0.0.1:3000').origin)).toEqual([]);
 await page.getByLabel('Chunk bases').fill('100');await page.getByRole('button',{name:'Analyze ready contrasts'}).click();await expect(page.getByRole('status')).toContainText('chunk',{timeout:10000});await page.getByRole('button',{name:'Cancel experiment'}).click();await expect(page.getByRole('status')).toContainText('Cancelled');await page.getByLabel('Chunk bases').fill('1000');await page.getByRole('button',{name:'Analyze ready contrasts'}).click();await expect(page.getByRole('status')).toContainText('1 successful, 0 failed',{timeout:30000});
});

test('optional private HEL progressive processed-track validation',async({page,browser})=>{
 const folder=process.env.GEL_PRIVATE_DATA;const output=process.env.GEL_PRIVATE_OUTPUT??folder;test.skip(!folder,'Private HEL data are never distributed with public fixtures.');test.setTimeout(40*60*1000);
 await mkdir(output!,{recursive:true});
 const names=['0hr.plus.avg.bw','0hr.minus.avg.bw','dTAG_1hr.plus.avg.bw','dTAG_1hr.minus.avg.bw','genes.tsv','experiment_manifest.json'];
 const requests:{url:string;method:string}[]=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 await page.goto('/workspace');await page.getByLabel('Choose experiment files').setInputFiles(names.map(n=>n==='experiment_manifest.json'&&process.env.GEL_PRIVATE_MANIFEST?process.env.GEL_PRIVATE_MANIFEST:folder+'/'+n));await page.getByRole('button',{name:'Organize as experiment'}).click();await page.getByRole('button',{name:'Apply experiment metadata'}).click();await page.getByRole('button',{name:'Confirm reviewed contrast metadata'}).click();
 const report:Record<string,unknown>[]=[];
 const scopes=process.env.GEL_PRIVATE_LEGACY==='1'?[{name:'legacy-chromosome',mode:'interval',chrom:'chr21',start:0,end:46709983}]:[{name:'locus',mode:'interval',chrom:'chr5',start:52800000,end:53200000},{name:'subchromosome',mode:'interval',chrom:'chr21',start:0,end:10000000},{name:'chromosome',mode:'chromosomes',chrom:'chr21',start:0,end:1},{name:'chromosome-set',mode:'chromosomes',chrom:'chr21,chr22',start:0,end:1}];
 if(process.env.GEL_PRIVATE_GENOME==='1')scopes.push({name:'annotated-genome',mode:'genome',chrom:'',start:0,end:1});
 for(const s of scopes){
   if(s.name==='chromosome-set'){await page.getByLabel('Maximum TSS distance (bp)',{exact:true}).fill('10000');}
   if(s.name==='annotated-genome'){await page.getByLabel('Minimum mean signal',{exact:true}).fill(process.env.GEL_PRIVATE_SIGNAL??'10');await page.getByLabel('Chunk bases').fill('1000000');}
   if(process.env.GEL_PRIVATE_LEGACY!=='1')await page.getByLabel('Genomic scope',{exact:true}).selectOption(s.mode);await page.getByLabel('Selected chromosomes').fill(s.chrom||'chr21');
   if(s.mode==='interval'){await page.getByLabel('Experiment scan chromosome',{exact:true}).fill(s.chrom);await page.getByLabel('Experiment start (0-based)',{exact:true}).fill(String(s.start));await page.getByLabel('Experiment end (exclusive)',{exact:true}).fill(String(s.end));}
   await page.evaluate(()=>{const w=window as unknown as {ticks:number;timer:number};w.ticks=0;w.timer=window.setInterval(()=>w.ticks++,50);});
   const started=Date.now();await page.getByRole('button',{name:'Analyze ready contrasts'}).click();await expect(page.getByRole('status')).toContainText('Experiment finished',{timeout:30*60*1000});
   const browserPerf=await page.evaluate(()=>{const w=window as unknown as {ticks:number;timer:number};clearInterval(w.timer);return {ticks:w.ticks,mainHeap:(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??null};});
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download experiment ZIP'}).click();const zipFile=await download;const path=await zipFile.path();const archive=await JSZip.loadAsync(await readFile(path!));
   const validation=JSON.parse(await archive.file('validation_report.json')!.async('string'));report.push({scope:s.name,browser:browser.version(),elapsedMs:Date.now()-started,performance:browserPerf,validation});
   await zipFile.saveAs(output+'/'+s.name+'-results.zip');await writeFile(output+'/browser-performance.json',JSON.stringify(report,null,2));
 }
 await mkdir(folder!,{recursive:true});await writeFile(output+'/network-validation.json',JSON.stringify({requests:requests.filter(r=>r.method==='POST'||new URL(r.url).origin!==new URL(process.env.GEL_BASE_URL??'http://127.0.0.1:3000').origin),selectedDataUploaded:false},null,2));expect(requests.filter(r=>r.method==='POST')).toEqual([]);
});
