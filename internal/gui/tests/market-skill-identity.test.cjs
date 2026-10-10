// #1420: only the installed source is Added. A same-named skill from
// elsewhere, or one whose local source is unknown, says Name in use.
// The real page, isolated API replies, both engines and every language.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = process.env.MAGPIE_SKILL_MARKET_ASSETS || path.resolve(__dirname, "../assets");
const HOME = "/Users/tester";
const own = "tt-a1i/archify/archify", other = "xgent-ai/skills/archify";
const words = {
  en: "Name in use", zh: "名称已占用", "zh-TW": "名稱已佔用", ja: "名前が使用中", de: "Name bereits vergeben",
};
const skill = (source) => ({ name: "archify", kind: "github", source, description: "Architecture diagrams", agents: [] });

function fixture() {
  return {
    skills: [skill("https://github.com/tt-a1i/archify/tree/HEAD/skills/archify"),
      { name: "grill-me", kind: "folder", source: `${HOME}/skills/grill-me`, agents: [] }],
    items: [
      { id: own, source: "tt-a1i/archify", skillId: "archify", name: "archify", have: "archify" },
      { id: other, source: "xgent-ai/skills", skillId: "archify", name: "archify", conflict: "archify" },
      { id: "mattpocock/skills/grill-me", source: "mattpocock/skills", skillId: "grill-me", name: "Grill Me", conflict: "grill-me" },
    ].map((x) => ({ ...x, description: "A skill from this repository", installs: 10 })),
    writes: [], hold: null,
  };
}

function serve(lang, state) {
  return async (route) => {
    const req = route.request(), url = new URL(req.url());
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:${JSON.stringify(lang)},theme:"light",web:true};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings: { lang, theme: "light" } });
    if (url.pathname === "/api/library") return json({
      dir: `${HOME}/.magpie/library`, home: HOME, backups: `${HOME}/.magpie/backups`, agents: [{ id: "claude", name: "Claude Code", icon: "claudecode-color", skills: `${HOME}/.claude/skills` }],
      instructions: { agents: [], sets: [] }, servers: [], foundServers: [], projects: [], foundSkills: [], skills: state.skills, problems: [],
    });
    if (url.pathname === "/api/library/market/skills") {
      if (state.hold) await state.hold;
      return json({ items: state.items });
    }
    if (url.pathname === "/api/groups") return json({ groups: [] });
    if (url.pathname === "/api/providers") return json({ providers: [], gateway: { running: true } });
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname.startsWith("/api/")) {
      if (req.method() === "POST") state.writes.push(url.pathname);
      return json({});
    }
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(file)];
    const body = await fs.readFile(file).catch(() => null);
    return body ? route.fulfill({ body, contentType }) : route.fulfill({ status: 404, body: "" });
  };
}

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of ["en", "zh", "zh-TW", "ja", "de"]) {
    for (const width of (lang === "zh" ? [520, 1317] : [520])) {
      test(`${engine} ${lang} ${width}: skill source and name conflicts stay distinct`, async (t) => {
        const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
        t.after(() => browser.close());
        const page = await browser.newPage({ viewport: { width, height: 760 }, reducedMotion: "reduce" });
        page.setDefaultTimeout(5000);
        const state = fixture(), errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/*", serve(lang, state));
        await page.addInitScript(() => { localStorage.setItem("magpie.libTab", "skills"); });
        await page.goto("http://magpie.test/?view=library");
        const card = (id) => page.locator(`.mk[data-market="skills"] .mk-card[data-id="${id}"]`);
        await card(own).waitFor().catch(async (e) => { throw new Error(e.message + "\nPage errors: " + JSON.stringify(errors) + "\n" + await page.locator("body").innerText()); });
        await card(other).waitFor();
        assert.equal(await card(own).locator(".mk-have").count(), 1, "the installed repository keeps Added");
        for (const id of [other, "mattpocock/skills/grill-me"]) {
          const c = card(id);
          assert.equal(await c.locator(".mk-have").count(), 0, "a name alone cannot prove this listing is installed");
          assert.equal(await c.locator(".mk-add").count(), 0, "a collision must not offer an install that cannot succeed");
          assert.equal(await c.locator(".mk-conflict").textContent(), words[lang]);
          assert.equal(await c.evaluate((e) => e.classList.contains("have")), false);
          assert(await c.locator(".mk-conflict").evaluate((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right <= e.closest(".mk-card").getBoundingClientRect().right + 1), "conflict label fits");
        }
        // Reach the card with a reader's scroll, not WebKit's auto-scroll
        // that the app deliberately undoes.
        await page.mouse.move(width / 2, 400);
        for (let i = 0; i < 12 && (await card(other).boundingBox()).y > 500; i++) {
          await page.mouse.wheel(0, 240);
          await page.waitForTimeout(100);
        }
        if (process.env.MAGPIE_SKILL_MARKET_SCREENSHOTS) {
          await fs.mkdir(process.env.MAGPIE_SKILL_MARKET_SCREENSHOTS, { recursive: true });
          await page.screenshot({ path: path.join(process.env.MAGPIE_SKILL_MARKET_SCREENSHOTS, `${engine}-${lang}-${width}.png`), fullPage: true });
        }
        const y = await page.evaluate(() => document.scrollingElement.scrollTop);
        await card(other).locator(".mk-title").click();
        const sheet = page.locator(".mk-sheet");
        await sheet.waitFor();
        assert.equal(await sheet.locator("button.primary").count(), 0, "the detail sheet cannot overwrite a name collision");
        assert.match(await sheet.locator(".mk-conflict").textContent(), /archify/);
        assert(await sheet.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), "the conflict explanation overflows the sheet");
        if (process.env.MAGPIE_SKILL_MARKET_SCREENSHOTS) {
          await page.waitForFunction(() => getComputedStyle(document.querySelector("#modal")).opacity === "1" && getComputedStyle(document.querySelector("#modal").firstElementChild).opacity === "1");
          await page.screenshot({ path: path.join(process.env.MAGPIE_SKILL_MARKET_SCREENSHOTS, `${engine}-${lang}-${width}-detail.png`) });
        }
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), y, "opening the card moved the page");
        await page.keyboard.press("Escape");
        await sheet.waitFor({ state: "detached" });

        // Another window replaces the skill without changing its name.
        state.skills[0] = skill("https://github.com/xgent-ai/skills/tree/HEAD/archify");
        delete state.items[0].have; state.items[0].conflict = "archify";
        delete state.items[1].conflict; state.items[1].have = "archify";
        await page.evaluate(() => window.loadLibrary(true));
        await card(other).locator(".mk-have").waitFor();
        assert.equal(await card(own).locator(".mk-have").count(), 0);
        assert.equal(await card(own).locator(".mk-conflict").count(), 1);

        // Removal clears both marks immediately, even while a market read waits.
        let release;
        state.hold = new Promise((resolve) => { release = resolve; });
        try {
          state.skills = [];
          state.items = state.items.map(({ have, conflict, ...x }) => x);
          await page.evaluate(() => window.loadLibrary(true));
          assert.equal(await page.locator('.mk[data-market="skills"] .mk-add').count(), 3);
          assert.equal(await page.locator('.mk[data-market="skills"] .mk-conflict, .mk[data-market="skills"] .mk-have').count(), 0);
        } finally { release(); }
        assert.deepEqual(state.writes, [], "opening and refreshing the market must not install anything");
        assert.deepEqual(errors, []);
      });
    }
  }
}
