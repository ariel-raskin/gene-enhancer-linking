import { expect, test } from "@playwright/test";

test("synthetic BigWig fixture runs through local worker and exports results", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3000") externalRequests.push(request.url());
    expect(request.method()).not.toBe("POST");
  });

  await page.goto("/workspace");
  await page.getByRole("button", { name: "Load synthetic BigWig example" }).click();
  await expect(page.getByText(/ctrl_A_plus\.bw/)).toBeVisible();
  await expect(page.getByText(/genes\.tsv/)).toBeVisible();
  await expect(page.getByText(/Possible workflows: BigWig-only descriptive/)).toBeVisible();

  await page.getByRole("button", { name: /Validate inputs and analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Candidate enhancer evidence" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/6 all-pairs rows/)).toBeVisible();
  await expect(page.getByText("SEPARATE DESCRIPTIVE TRACK LAYER")).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete result ZIP" }).click();
  expect((await download).suggestedFilename()).toBe("gel-analysis.zip");
  expect(externalRequests).toEqual([]);
});

test("synthetic eNRSA tables run through the same local worker", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3000") externalRequests.push(request.url());
    expect(request.method()).not.toBe("POST");
  });

  await page.goto("/workspace");
  await page.getByRole("button", { name: "Load synthetic eNRSA-table example" }).click();
  await expect(page.getByText(/gb_change\.txt/)).toBeVisible();
  await expect(page.getByText(/normalized_pp_gb\.txt/)).toBeVisible();
  await expect(page.getByText(/Possible workflows: eNRSA differential/)).toBeVisible();

  await page.getByRole("button", { name: /Validate inputs and analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Candidate enhancer evidence" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/3 all-pairs rows from 1 genes and 3 enhancer features/)).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("universal multi-file selection detects a complete eNRSA workflow locally", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3000") externalRequests.push(request.url());
    expect(request.method()).not.toBe("POST");
  });
  await page.goto("/workspace");
  await page.getByLabel("Choose experiment files").setInputFiles([
    "public/demo/enrsa/gb_change.txt", "public/demo/enrsa/normalized_pp_gb.txt", "public/demo/enrsa/Enhancer_change.txt",
  ]);
  await expect(page.getByText(/Possible workflows: eNRSA differential/)).toBeVisible();
  await expect(page.getByLabel("Role for gb_change.txt")).toHaveValue("gbChange");
  await expect(page.getByLabel("Role for normalized_pp_gb.txt")).toHaveValue("normalizedPpGb");
  await page.getByLabel("Genome assembly").fill("synthetic-demo-v1");
  await page.getByLabel("Control condition").fill("control");
  await page.getByLabel("Treatment condition").fill("perturbation");
  await page.getByLabel("Time point").fill("1h");
  await page.getByLabel("Statistical model / normalization provenance").fill("Synthetic eNRSA-schema fixture");
  await page.getByRole("button", { name: /Validate inputs and analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Candidate enhancer evidence" })).toBeVisible({ timeout: 10_000 });
  expect(externalRequests).toEqual([]);
});

test("folder picker preserves relative paths for a processed-analysis directory", async ({ page }) => {
  await page.goto("/workspace");
  const folder = page.getByLabel("Choose processed-analysis folder");
  await expect.poll(() => folder.evaluate((input) => input.hasAttribute("webkitdirectory"))).toBe(true);
  await folder.setInputFiles("public/demo/enrsa");
  await expect(page.getByText(/enrsa\/gb_change\.txt/)).toBeVisible();
  await expect(page.getByText(/enrsa\/normalized_pp_gb\.txt/)).toBeVisible();
  await expect(page.getByText(/Possible workflows: eNRSA differential/)).toBeVisible();
});

test("researcher can correct a role and replace the individual file", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByLabel("Choose experiment files").setInputFiles({ name: "mystery.txt", mimeType: "text/plain", buffer: Buffer.from("x,y\n1,2") });
  const role = page.getByLabel("Role for mystery.txt");
  await expect(role).toHaveValue("unknown");
  await role.selectOption("gbChange");
  await expect(page.getByText(/Role confirmed by researcher as eNRSA gene-body differential results/)).toBeVisible();
  await page.getByLabel("Replace mystery.txt").setInputFiles({ name: "replacement.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from("Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nTX\tG\t1\t1\t.1\t2\t.1\t.2") });
  await expect(page.getByText(/replacement\.tsv/)).toBeVisible();
  await expect(page.getByLabel("Role for replacement.tsv")).toHaveValue("gbChange");
});

test("R-DESeq2 branch requires coordinate confirmation and executes locally", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3000") externalRequests.push(request.url());
    expect(request.method()).not.toBe("POST");
  });
  await page.goto("/workspace");
  await page.getByLabel("Choose experiment files").setInputFiles([
    { name: "treat_results.csv", mimeType: "text/csv", buffer: Buffer.from("Chr,Start,End,Region_ID,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj\nchrDemo,4501,4550,E1,20,1.1,.2,5,.01,.02") },
    { name: "gene_effects.csv", mimeType: "text/csv", buffer: Buffer.from("Gene,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj\nGENE_CONC,100,1.0,.2,5,.01,.02") },
    { name: "genes.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from("gene_id\tsymbol\tchrom\tstart\tend\tstrand\nGENE_CONC\tDEMO1\tchrDemo\t6000\t7500\t+\nGENE_DIST\tDEMO2\tchrDemo\t4500\t5400\t-\n") },
  ]);
  await expect(page.getByText(/Possible workflows: R-DESeq2 differential/)).toBeVisible();
  await page.getByLabel("Genome assembly").fill("synthetic-demo-v1");
  await page.getByLabel("Control condition").fill("control"); await page.getByLabel("Treatment condition").fill("perturbation");
  await page.getByLabel("Time point").fill("1h"); await page.getByLabel("Statistical model / normalization provenance").fill("Synthetic R-DESeq2 schema");
  await page.getByRole("button", { name: /Validate inputs and analyze/ }).click();
  await expect(page.locator(".error-box")).toContainText("Confirm whether the R-DESeq2 enhancer Start/End fields");
  await page.getByLabel("Enhancer coordinate convention").selectOption("one_based_inclusive");
  await page.getByRole("button", { name: /Validate inputs and analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Candidate enhancer evidence" })).toBeVisible({ timeout: 10_000 });
  expect(externalRequests).toEqual([]);
});

test("combined mode blocks declared assembly conflicts and keeps evidence layers separate", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3000") externalRequests.push(request.url());
    expect(request.method()).not.toBe("POST");
  });
  await page.goto("/workspace");
  await page.getByLabel("Choose experiment files").setInputFiles([
    "public/demo/tracks/ctrl_A_plus.bw", "public/demo/tracks/ctrl_A_minus.bw", "public/demo/tracks/treat_A_plus.bw", "public/demo/tracks/treat_A_minus.bw",
    "public/demo/genes.tsv", "public/demo/enrsa/gb_change.txt", "public/demo/enrsa/normalized_pp_gb.txt", "public/demo/enrsa/Enhancer_change.txt",
  ]);
  await expect(page.getByLabel("Analysis workflow")).toHaveValue("combined");
  await page.getByLabel("Differential tables genome assembly").fill("GRCh37");
  await page.getByLabel("BigWig tracks genome assembly").fill("GRCh38");
  await page.getByLabel("Control condition").fill("control"); await page.getByLabel("Treatment condition").fill("perturbation");
  await page.getByLabel("Time point").fill("1h"); await page.getByLabel("Statistical model / normalization provenance").fill("Synthetic fixture");
  await page.getByLabel("Track normalization / averaging").fill("synthetic shared scale");
  await page.getByLabel("Scan chromosome").fill("chrDemo"); await page.getByLabel("End (exclusive)").fill("10000");
  await page.getByRole("button", { name: /Validate inputs and analyze/ }).click();
  await expect(page.locator(".error-box")).toContainText("Incompatible assemblies were declared");
  await page.getByLabel("BigWig tracks genome assembly").fill("GRCh37");
  await page.getByRole("button", { name: /Validate inputs and analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Candidate enhancer evidence" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("SEPARATE DESCRIPTIVE TRACK LAYER")).toBeVisible();
  await expect(page.getByText("Compatibility unverified", { exact: false })).toBeVisible();
  expect(externalRequests).toEqual([]);
});
