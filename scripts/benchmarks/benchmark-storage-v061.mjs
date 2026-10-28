import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile,mkdtemp,readdir,stat,rm} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(resolve('apps/web/package.json'));
const {chromium}=require('@playwright/test'),ts=require('typescript');
const output=resolve(process.env.GEL_BENCH_OUTPUT??'.git/storage-benchmarks-v061');await mkdir(output,{recursive:true});
async function directoryBytes(path){let bytes=0;for(const entry of await readdir(path,{withFileTypes:true}).catch(()=>[])){const child=resolve(path,entry.name);bytes+=entry.isDirectory()?await directoryBytes(child):(await stat(child)).size;}return bytes;}
const baseline=execFileSync('git',['show','945f75d60f99e19bcc7aabdf4da6dbb3f7c8ac19:apps/web/src/lib/result-store.ts'],{encoding:'utf8'});
const actual=await readFile('apps/web/src/lib/result-store.ts','utf8');
const replace=(s,a,b)=>{if(!s.includes(a))throw Error('Benchmark instrumentation anchor missing: '+a.slice(0,90));return s.replace(a,b);};
function variant(source,name){
 if(['parallel','lean','compact'].includes(name))source=replace(source,'for(const [id,countsAdded] of counts){const key=[run,layer,contrast,"gene",id];const f=await req(fs.get(key)) as StoredFeature|undefined;if(!f)throw new Error(`Missing persisted gene feature: ${id}`);for(const [tier,n] of Object.entries(countsAdded))f.counts[tier]=(f.counts[tier]??0)+n;fs.put(f);}', 'const updates=await Promise.all([...counts].map(async([id,delta])=>({id,delta,f:await req(fs.get([run,layer,contrast,"gene",id])) as StoredFeature|undefined})));for(const {id,delta,f} of updates){if(!f)throw new Error(`Missing persisted gene feature: ${id}`);for(const [tier,n]of Object.entries(delta))f.counts[tier]=(f.counts[tier]??0)+n;fs.put(f);}');
 if(['lean','compact'].includes(name)){
  source=replace(source,'rows.createIndex("chrom",["run","layer","row.chrom","row.enhancer_start","contrast","id"]);','');
  source=source.replaceAll('store.index(name)','store.index(name==="chrom"?"order":name)').replaceAll('store.index(index)','store.index(index==="chrom"?"order":index)');
 }
 if(name==='compact'){
  source=replace(source,'const rows=db.createObjectStore("rows",{keyPath:["run","layer","contrast","id"]});','const rows=db.createObjectStore("rows",{keyPath:["r","ordinal"]});rows.createIndex("identity",["r","layer","contrast","id"],{unique:true});');
  const a=source.indexOf('rows.createIndex("order"'),b=source.indexOf('db.createObjectStore("batches"',a);source=source.slice(0,a)+source.slice(a,b).replaceAll('["run","layer"','["r","layer"')+source.slice(b);
  source=replace(source,'t.objectStore("rows").add(record);','t.objectStore("rows").add({...record,r:1,ordinal:r.rows+position});');
  source=replace(source,'prefix:IDBValidKey[]=[q.run,q.layer]','prefix:IDBValidKey[]=[1,q.layer]');
  source=replace(source,'countPrefix=[run,layer,','countPrefix=[1,layer,');
  source=replace(source,'t.objectStore(name).delete(IDBKeyRange.bound([id],[id,[]]))','t.objectStore(name).delete(IDBKeyRange.bound(name==="rows"?[1]:[id],name==="rows"?[1,[]]:[id,[]]))');
 }
 return source;
}
function instrument(source,name){
 source=replace(source,'"gel-results-v1"',JSON.stringify('gel-benchmark-'+name));
 source+='\nexport const storageProfile:Record<string,number>={};\n';
 source=replace(source,'const writeStarted=performance.now();','const writeStarted=performance.now();let stamp=writeStarted;const mark=(key:string)=>{const now=performance.now();storageProfile[key]=(storageProfile[key]??0)+now-stamp;stamp=now;};storageProfile.calls=(storageProfile.calls??0)+1;');
 source=replace(source,'if(rows.length>WRITE_BATCH','mark("quotaWallMs");if(rows.length>WRITE_BATCH');
 source=replace(source,'const rowBytes=new TextEncoder()','mark("validationSerializationMs");const rowBytes=new TextEncoder()');
 source=replace(source,'const codec=typeof CompressionStream','mark("rowEncodingHashMs");const codec=typeof CompressionStream');
 source=replace(source,'const digest=await crypto.subtle.digest','mark("compressionWallMs");storageProfile.payloadBytes=(storageProfile.payloadBytes??0)+payload.byteLength;storageProfile.encodedBytes=(storageProfile.encodedBytes??0)+rowBytes.byteLength;storageProfile.peakBuffersEstimate=Math.max(storageProfile.peakBuffersEstimate??0,serialized.length*2+rowBytes.byteLength+payload.byteLength);const digest=await crypto.subtle.digest');
 source=replace(source,'const t=this.db.transaction(["runs","rows","features","batches"]','mark("checkpointHashMs");const t=this.db.transaction(["runs","rows","features","batches"]');
 source=replace(source,'const marker=[run,layer','mark("transactionCreateMs");storageProfile.transactions=(storageProfile.transactions??0)+1;const marker=[run,layer');
 source=replace(source,'const fs=t.objectStore("features");','mark("checkpointRunReadWaitMs");const fs=t.objectStore("features");');
 source=replace(source,'const counts=new Map<string,Record<string,number>>();','mark("featureEnqueueMs");const counts=new Map<string,Record<string,number>>();let enqueueEnd=0;');
 const needle=name==='compact'?'t.objectStore("rows").add({...record,r:1,ordinal:r.rows+position});':'t.objectStore("rows").add(record);';
 source=replace(source,needle,'const pending='+needle+'if(position===rows.length-1)pending.onsuccess=()=>{storageProfile.rowDrainNestedMs=(storageProfile.rowDrainNestedMs??0)+performance.now()-enqueueEnd;};');
 const summary=name==='base'?'for(const [id,countsAdded] of counts)':'const updates=await Promise.all';
 source=replace(source,summary,'enqueueEnd=performance.now();mark("projectionEnqueueMs");storageProfile.rows=(storageProfile.rows??0)+rows.length;storageProfile.indexEntries=(storageProfile.indexEntries??0)+rows.length*t.objectStore("rows").indexNames.length;storageProfile.summaryReads=(storageProfile.summaryReads??0)+counts.size;'+summary);
 source=replace(source,'t.objectStore("batches").add','mark("queuedRowsAndSummaryWaitMs");t.objectStore("batches").add');
 source=replace(source,'await complete;return true;','mark("metadataEnqueueMs");await complete;mark("commitWaitMs");storageProfile.commitWallMs=(storageProfile.commitWallMs??0)+performance.now()-writeStarted;return true;');
 return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
}
const analysis=ts.transpileModule(await readFile('apps/web/src/lib/analysis.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const graph={};async function collect(file){file=resolve(file);if(graph[file])return file;const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText,dependencies={};graph[file]={code,dependencies};for(const match of code.matchAll(/from\s+["']([^"']+)["']/g)){const spec=match[1];if(!spec.startsWith('.'))throw Error('Unexpected benchmark dependency '+spec);dependencies[spec]=await collect(resolve(dirname(file),spec+'.ts'));}return file;}
const exportsRoot=await collect('apps/web/src/lib/persistent-exports.ts'),zipRoot=await collect('apps/web/src/lib/streaming-zip.ts'),experimentRoot=await collect('apps/web/src/lib/experiment.ts');
const variants=(process.env.GEL_BENCH_VARIANTS??'raw,actual').split(','),counts=(process.env.GEL_BENCH_ROWS??'20000').split(',').map(Number),repeats=Number(process.env.GEL_BENCH_REPEATS??2),reports=[];
for(const count of counts)for(let repeat=0;repeat<repeats;repeat++)for(const name of variants){
 const profile=await mkdtemp(output+'/profile-'),context=await chromium.launchPersistentContext(profile,{headless:true}),page=await context.newPage();
 try{await page.goto(process.env.GEL_BASE_URL??'http://127.0.0.1:3000/workspace');await page.exposeFunction('gelBenchmarkDiskBytes',()=>directoryBytes(resolve(profile,'Default/IndexedDB')));
 const js=['actual','raw'].includes(name)?ts.transpileModule((name==='actual'?actual:baseline).replace('"gel-results-v1"',JSON.stringify('gel-benchmark-'+name)),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText:instrument(variant(baseline,name),name);
 const report=await page.evaluate(async({js,analysis,count,graph,exportsRoot,zipRoot,experimentRoot,doExport})=>{
  const module=async(s)=>import(URL.createObjectURL(new Blob([s],{type:'text/javascript'}))),api=await module(js),sci=await module(analysis),s=await api.ResultStore.open();
  const urls={};const load=async(key)=>{if(urls[key])return urls[key];let code=graph[key].code;for(const [specifier,child]of Object.entries(graph[key].dependencies))code=code.replaceAll('"'+specifier+'"','"'+await load(child)+'"');return urls[key]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));};
  const ex=await import(await load(exportsRoot)),zip=await import(await load(zipRoot)),expApi=await import(await load(experimentRoot));
  const genesCount=count===240000?1200:100,enhCount=200;let gb='Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\n',coords='Transcript\tGene\tchr\tstart\tend\tstrand\tgbc_control\tgbc_treatment\n',enh='Enhancer_ID\tchr\tstart\tend\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\n';
  for(let i=0;i<genesCount;i++){gb+=`TX${i}\tG${i}\t100\t.9\t.2\t4\t.001\t.01\n`;coords+=`TX${i}\tG${i}\tchrDense\t${50001+i}\t${50200+i}\t+\t100\t190\n`;}
  for(let i=0;i<enhCount;i++)enh+=`E${i}\tchrDense\t${5000+i*100}\t${5050+i*100}\t20\t${i%2?-.9:.9}\t.2\t4\t.001\t.01\n`;
  const g=sci.importEnrsaGenes(gb,coords),es=sci.importEnrsaEnhancers(enh),c={...expApi.blankContrast('c'),label:'drug vs control',control:'control',treatment:'drug',confirmed:true,assembly:'synthetic-dense-v1',timePoint:'1h',perturbation:'synthetic'},experiment={schema_version:2,product:'GEL Web',experimentId:'benchmark',assembly:'synthetic-dense-v1',annotationProvenance:'synthetic-dense-v1',normalization:'synthetic',model:'illustrative source estimates',scope:{chrom:'chrDense',start:0,end:100000},files:[],contrasts:[c],samples:[],conditions:[]},r=await s.create(experiment,sci.DEFAULT_PARAMETERS,2*1024**3,500);
  let generationMs=0,generated=0;const source=sci.iterateLinks(g.genes,g.stats,es,sci.DEFAULT_PARAMETERS,{contrast:'drug vs control',compatibility:{status:'Compatibility unverified',checks:[]},source:'differential'});
  const rows={*[Symbol.iterator](){while(true){const t=performance.now(),next=source.next();generationMs+=performance.now()-t;if(next.done)return;generated++;yield next.value;}}};
  const t=performance.now();await s.sink(r.id,'primary','c').partition('chrDense',{genes:g.genes,geneStats:g.stats,enhancers:es},rows);const writeWallMs=performance.now()-t;await s.update(r.id,{state:'complete',outcomes:[{contrastId:'c',status:'successful',findings:[]}]});const saved=await s.get(r.id);if(saved.rows!==count||generated!==count)throw Error('Incomplete benchmark');
  const queries=[];for(const q of [{},{sort:'distance'},{sort:'magnitude'},{gene:'G50'},{enhancer:es[0].featureId},{contrast:'c'},{chrom:'chrDense',start:5000,end:10000,morphology:'catalog_transcribed_region'}]){const t=performance.now(),result=await api.queryResults(s.db,{run:r.id,layer:'primary',...q});queries.push({query:q,ms:performance.now()-t,total:result.total,ids:result.rows.map(v=>v.id)});}
  const beforeDelete=await navigator.storage.estimate(),liveIndexedDbFileLengths=await window.gelBenchmarkDiskBytes(),exports=[];
  if(doExport){const dir=await navigator.storage.getDirectory();for(const format of count<=20000?['tsv','zip']:['tsv']){const fileName='bench.'+format,handle=await dir.getFileHandle(fileName,{create:true}),file=await handle.createWritable(),at=performance.now();let bytes=0;const sink={write:async(b)=>{await file.write(b);bytes+=b.length;},close:()=>file.close(),abort:e=>file.abort(e)};
    if(format==='zip')await zip.streamZip(ex.persistentArtifacts(s,saved),sink);else{for await(const item of ex.persistentArtifacts(s,saved))if(item.name==='gel_experiment_links.tsv'){for await(const part of item.data)await sink.write(part);break;}await sink.close();}
    const elapsedMs=performance.now()-at,stored=await handle.getFile();let checksum=2166136261,lines=0;const reader=stored.stream().getReader();while(true){const part=await reader.read();if(part.done)break;for(const b of part.value){checksum=Math.imul(checksum^b,16777619)>>>0;if(b===10)lines++;}}exports.push({format,bytes,elapsedMs,checksum,dataRows:format==='tsv'?lines:null});if(format==='tsv'&&lines!==count)throw Error('Truncated TSV');await dir.removeEntry(fileName);
  }}
  const d=performance.now();await s.delete(r.id);const deleteMs=performance.now()-d;s.close();
  return {generated,generationMs,writeWallMs,saved:{rows:saved.rows,bytes:saved.bytes,batches:saved.batches},profile:api.storageProfile??s.profile,queries,exports,origin:beforeDelete,liveIndexedDbFileLengths,deleteMs,userAgent:navigator.userAgent};
 },{js,analysis,count,graph,exportsRoot,zipRoot,experimentRoot,doExport:process.env.GEL_BENCH_EXPORT==='1'});
 const expected=reports.find(r=>r.count===count);if(expected&&JSON.stringify(expected.queries.map(q=>[q.total,q.ids]))!==JSON.stringify(report.queries.map(q=>[q.total,q.ids])))throw Error('Query parity failed');
 const expectedTsv=expected?.exports?.find(x=>x.format==='tsv'),tsv=report.exports?.find(x=>x.format==='tsv');if(expectedTsv&&tsv&&(expectedTsv.checksum!==tsv.checksum||expectedTsv.bytes!==tsv.bytes))throw Error('TSV parity failed');
 reports.push({variant:name,count,repeat,compiledModuleSha256:createHash('sha256').update(js).digest('hex'),profilePath:profile,...report});await context.close();reports.at(-1).closedProfileFileLengths=await directoryBytes(resolve(profile,'Default/IndexedDB'));await writeFile(output+'/benchmarks.json',JSON.stringify(reports,null,2));console.log(JSON.stringify({variant:name,count,repeat,writeWallMs:report.writeWallMs,profile:report.profile,origin:report.origin,deleteMs:report.deleteMs,exports:report.exports}));
 if(process.env.GEL_BENCH_KEEP_PROFILES!=='1'){if(!resolve(profile).startsWith(output+sep)||!resolve(profile).slice(output.length+1).startsWith('profile-'))throw Error('Refusing cleanup outside the newly created benchmark profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
 }finally{await context.close();}
}
