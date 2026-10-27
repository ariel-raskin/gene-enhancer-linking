import { expect, test } from "@playwright/test";

test("synthetic BigWig fixture runs through local worker and exports results", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3000") externalRequests.push(request.url());
    expect(request.method()).not.toBe("POST");
  });

  await page.goto("/workspace");
  await page.getByRole("button", { name: "Load synthetic BigWig example" }).click();
  await expect(page.getByRole("button", { name: /Control plus BigWig Required ctrl_A_plus\.bw/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Gene annotation Required genes\.tsv/ })).toBeVisible();

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
  await expect(page.getByRole("button", { name: /known_gene\/gb_change\.txt Required gb_change\.txt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /known_gene\/normalized_pp_gb\.txt Required normalized_pp_gb\.txt/ })).toBeVisible();

  await page.getByRole("button", { name: /Validate inputs and analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Candidate enhancer evidence" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/3 all-pairs rows from 1 genes and 3 enhancer features/)).toBeVisible();
  expect(externalRequests).toEqual([]);
});
