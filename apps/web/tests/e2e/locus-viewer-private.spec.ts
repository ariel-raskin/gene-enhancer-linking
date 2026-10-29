import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test('optional private owner-approved locus viewer',async({page})=>{
 const folder=process.env.GEL_PRIVATE_DATA,out=process.env.GEL_V07_IGV_DIR;test.skip(!folder||!out,'Private validation requires locally staged files.');test.setTimeout(180000);
 const locus=JSON.parse(await readFile(out!+'/hel-locus.json','utf8'));
 const bad:string[]=[];page.on('request',r=>{if(r.method()!=='GET'||new URL(r.url()).origin!==new URL(process.env.GEL_BASE_URL??'http://127.0.0.1:3000').origin)bad.push(r.url());});
 await page.goto('/workspace');await page.getByLabel('Choose experiment files').setInputFiles(['0hr.plus.avg.bw','0hr.minus.avg.bw','dTAG_1hr.plus.avg.bw','dTAG_1hr.minus.avg.bw','genes.tsv','experiment_manifest.json'].map(n=>folder+'/'+n));
 await page.getByRole('button',{name:'Organize as experiment'}).click();await page.getByRole('button',{name:'Apply experiment metadata'}).click();await page.getByRole('button',{name:'Confirm reviewed contrast metadata'}).click();
 await page.getByLabel('Genomic scope',{exact:true}).selectOption('interval');await page.getByLabel('Experiment scan chromosome',{exact:true}).fill(locus.chrom);await page.getByLabel('Experiment start (0-based)',{exact:true}).fill(String(Math.max(0,locus.start-100000)));await page.getByLabel('Experiment end (exclusive)',{exact:true}).fill(String(locus.end+100000));
 await page.getByRole('button',{name:'Analyze ready contrasts'}).click();await expect(page.getByRole('status')).toContainText('1 successful, 0 failed',{timeout:120000});
 await page.getByLabel('Search experiment gene').fill(locus.gene);await expect(page.getByText(/matching contrast-specific candidate rows/)).toBeVisible();
 const row=page.locator('.experiment-results table').last().locator('tbody tr').first();await expect(row).toBeVisible();await row.locator('button').first().click();const viewer=page.getByRole('region',{name:'Genomic locus viewer'});await expect(viewer.getByRole('img',{name:'Control + signal'})).toBeVisible({timeout:30000});await viewer.screenshot({path:out+'/hel-viewer.png'});expect(bad).toEqual([]);
});
