import { test } from "@playwright/test";
import { openSpreadsheet, clickCell, modClickCell, press, value, enter, selection } from "./lib/univerGrid.js";
test("inspect", async ({ page }) => {
  await openSpreadsheet(page, "scratch-insp");
  await clickCell(page, 0, 0); await modClickCell(page, 2, 2, "Control"); await modClickCell(page, 4, 4, "Control");
  await page.keyboard.type("7", { delay: 8 }); await press(page, "Control+Enter");
  console.log("CE", JSON.stringify([await value(page,0,0), await value(page,2,2), await value(page,4,4)]), JSON.stringify((await selection(page)).map(s=>s.a1)));
  await clickCell(page, 6, 0); await modClickCell(page, 8, 2, "Control"); 
  await press(page, "Control+c");
  console.log("TEXT", (await page.evaluate(() => document.body.innerText)).split("\n").filter(l=>/select|cannot|multiple/i.test(l)));
  await clickCell(page, 12, 0); 
  console.log("sel", JSON.stringify((await selection(page)).map(s=>s.a1)));
});
