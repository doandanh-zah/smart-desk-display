import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SMART_DESK_PLAYWRIGHT || "playwright");
const fixturePath = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
const browser = await chromium.launch({ args: ["--disable-gpu"] });
const viewport = { width: 375, height: 850 };

async function withFixture(scenario, test, { prepare, ...options } = {}) {
  if (process.env.SMART_DESK_REMOTE_ONLY === "1" && !prepare) return;
  const child = spawn(process.execPath, [fixturePath], {
    env: { ...process.env, PORT: "0", FIXTURE_SCENARIO: scenario },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let page;
  try {
    const origin = await new Promise((resolve, reject) => {
      child.stdout.once("data", (output) => {
        const match = String(output).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
        else reject(new Error(String(output)));
      });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Fixture exited (${code})`)));
    });
    page = await browser.newPage({ viewport, ...options });
    page.setDefaultTimeout(8000);
    const errors = [];
    const external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith(origin + "/") && !(prepare && request.url() === "https://accounts.google.com/o/oauth2/v2/auth")) external.push(request.url());
    });
    await prepare?.(page, origin);
    await page.goto(origin);
    if (!prepare) await page.locator("#fixture-banner").waitFor();
    await test(page, origin);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`PASS ${scenario}`);
  } finally {
    if (page) await page.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
}

const expectText = (page, selector, match) =>
  page.locator(selector).getByText(match).waitFor();
const api = (origin, path) => fetch(`${origin}/api/${path}`).then((response) => response.json());
const mode = (page, name) => page.getByRole("group", { name: "Chọn chế độ" }).getByRole("button", { name: name === "Đồng hồ" ? "Đồng hồ + Lịch" : name, exact: true });
async function legacyMode(page, name) {
  const group = page.locator("#legacy-tools");
  if (!(await group.evaluate((el) => el.open))) await group.locator(":scope > summary").click();
  await group.locator(".legacy-modes").getByRole("button", { name, exact: true }).click();
}
const button = (page, name) => page.getByRole("button", { name, exact: true });
const pixel = (page) => page.locator("#preview").evaluate((canvas) => [
  canvas.width, canvas.height, ...canvas.getContext("2d").getImageData(0, 0, 1, 1).data,
]);

try {
  await withFixture("demo", async (page, origin) => {
    await expectText(page, "#preview-description", /Dữ liệu mẫu/);
    assert.equal(await page.locator("#diagnostics").evaluate((el) => el.open), false);
    await page.locator("#diagnostics > summary").click();
    await expectText(page, "#wifi-ip", "127.0.0.1");
    await expectText(page, "#wifi-hostname", "smart-desk-fixture.local");
    await page.locator("#diagnostics > summary").click();
    assert.deepEqual(await pixel(page), [320, 240, 16, 20, 25, 255]);
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const bounds = await mode(page, "Đồng hồ").boundingBox();
      assert.ok(bounds.height >= 44);
    }
    await page.setViewportSize(viewport);
    await page.reload();
    await expectText(page, "#connection", "Thiết bị giả lập");
    const focusOrder = ["Đến nội dung chính", "Điều khiển", "Lịch GitHub", "Cài đặt", "Ví Solana", "Tạm dừng chuyển động"];
    for (const name of focusOrder) {
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").textContent(), name);
    }
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("data-mode"), "github");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("data-mode"), "clock");
    assert.equal(await page.locator(":focus").evaluate((el) => getComputedStyle(el).outlineWidth), "2px");
    await page.evaluate(() => {
      window.observedPreviewAnimation = new Promise((resolve) => {
        const canvas = document.querySelector("#preview");
        const animate = canvas.animate.bind(canvas);
        canvas.animate = (...args) => {
          const animation = animate(...args);
          resolve(animation.effect.getTiming().duration);
          return animation;
        };
      });
    });
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.observedPreviewAnimation), 210);
    await expectText(page, "#preview-description", /Đồng hồ thiết bị/);
    assert.equal((await api(origin, "config")).startupMode, "clock");
    await legacyMode(page, "Thống kê GitHub");
    await expectText(page, "#preview-description", /Chưa có số kho công khai/);
    assert.equal(await page.locator("#pomodoro-tools").evaluate((el) => el.open), false);
    await legacyMode(page, "Pomodoro");
    await button(page, "Bắt đầu").click();
    await expectText(page, "#timer-state", /Đang chạy/);
    await page.waitForFunction(() => document.querySelector("#timer-remaining").textContent !== "25:00");
    await page.reload();
    await expectText(page, "#timer-state", /Đang chạy/);
    await button(page, "Tạm dừng").click();
    await expectText(page, "#timer-state", /Đã tạm dừng/);
    const paused = (await api(origin, "status")).pomodoro.remainingSeconds;
    assert.ok(paused < 1500);
    await button(page, "Tiếp tục").click();
    await expectText(page, "#timer-state", /Đang chạy/);
    await button(page, "Đặt lại").click();
    await expectText(page, "#timer-remaining", "25:00");

    await legacyMode(page, "Tin nhắn");
    const message = page.getByLabel("Nội dung trên TFT");
    await message.fill("Không dấu?");
    await button(page, "Lưu tin nhắn").click();
    await expectText(page, "#message-feedback", /chỉ nhận ký tự ASCII/);
    await message.fill("Hello SSD\nSecond line");
    await page.getByLabel("Căn chữ").selectOption("right");
    await page.getByLabel("Cỡ chữ").selectOption("4");
    await page.getByLabel("Màu chữ").fill("#112233");
    await button(page, "Lưu tin nhắn").click();
    await expectText(page, "#preview-description", /Second line/);
    assert.deepEqual((await api(origin, "config")).message, {
      text: "Hello SSD\nSecond line", alignment: "right", color: "#112233", size: 4,
    });
    await message.fill("A".repeat(160));
    await button(page, "Lưu tin nhắn").click();
    await expectText(page, "#message-feedback", /Đã lưu tin nhắn/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);

    assert.equal(await page.locator("#settings").evaluate((el) => el.open), false);
    await page.getByRole("link", { name: "Cài đặt" }).click();
    await page.getByLabel("Tên thiết bị").fill("SSD Desk 01");
    await page.getByLabel("Giao diện TFT").selectOption("light");
    await page.getByLabel("Chế độ khi khởi động").selectOption("clock");
    await page.getByLabel("Hiện giây trên đồng hồ").uncheck();
    await page.getByLabel("Bật tự động luân phiên").check();
    const rotation = page.getByRole("group", { name: "Luân phiên chế độ" });
    for (const name of ["Đóng góp GitHub", "Thống kê GitHub", "Pomodoro", "Tin nhắn"]) {
      await rotation.getByLabel(name, { exact: true }).uncheck();
    }
    await button(page, "Lưu cài đặt").click();
    await expectText(page, "#settings-feedback", /Chọn ít nhất 2 chế độ/);
    await rotation.getByLabel("Tin nhắn", { exact: true }).check();
    await page.getByLabel("Khoảng thời gian (giây)").fill("30");
    await button(page, "Lưu cài đặt").click();
    await expectText(page, "#settings-feedback", /Đã lưu cài đặt/);
    await expectText(page, "#device-name", "SSD Desk 01");
    assert.deepEqual((await api(origin, "config")).rotation, { enabled: true, intervalSeconds: 30, modes: ["clock", "message"] });
    assert.deepEqual(await pixel(page), [320, 240, 255, 255, 255, 255]);

    const restart = button(page, "Khởi động lại thiết bị");
    await restart.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await page.locator(":focus").textContent(), "Hủy");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await restart.evaluate((el) => el === document.activeElement), true);
    await restart.click();
    await button(page, "Xác nhận khởi động lại").click();
    await expectText(page, "#restart-feedback", /Đã kết nối lại/);
    await expectText(page, "#active-mode", "Đồng hồ + Lịch");
    assert.equal((await api(origin, "config")).message.text.length, 160);
    await expectText(page, "#preview-description", /\d{2}:\d{2}$/);

    await page.waitForFunction(() => document.querySelector("#active-mode").textContent === "Tin nhắn", null, { timeout: 37000 });
    assert.equal((await api(origin, "config")).startupMode, "clock");
  });

  await withFixture("demo", async (page) => {
    const canvas = page.locator("#preview");
    await canvas.scrollIntoViewIfNeeded();
    await expectText(page, "#preview-description", /Dữ liệu mẫu/);
    const pause = button(page, "Tạm dừng chuyển động");
    const avatar = page.locator(".identity-avatar img");
    const avatarAnimation = () => avatar.evaluate((img) => getComputedStyle(img).animationName);
    const sample = () => canvas.evaluate((el) => {
      const ctx = el.getContext("2d");
      return [
        [...ctx.getImageData(19, 20, 54, 66).data],
        [...ctx.getImageData(29, 113, 264, 54).data],
      ];
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#pet-motion").waitFor({ state: "hidden" });
    const idle = await sample();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction((before) => {
      const ctx = document.querySelector("#preview").getContext("2d");
      return ctx.getImageData(19, 20, 54, 66).data.some((channel, index) => channel !== before[index]);
    }, idle[0]);
    assert.deepEqual((await sample())[1], idle[1]);
    const expressions = await page.evaluate(() => {
      const sprite = document.createElement("canvas");
      const render = window.createDeskPreview(sprite);
      render({ mode: "github", github: {}, localEpoch: null });
      const ctx = sprite.getContext("2d");
      const pixelAt = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      const eye = pixelAt(45, 44);
      const mouth = pixelAt(53, 56);
      render.pet(1000);
      const closedEye = pixelAt(45, 42);
      render.pet(2300);
      const smile = pixelAt(53, 53);
      const sparkle = pixelAt(22, 26);
      return { eye, closedEye, mouth, smile, sparkle };
    });
    assert.notDeepEqual(expressions.closedEye, expressions.eye);
    assert.notDeepEqual(expressions.smile, expressions.mouth);
    assert.deepEqual(expressions.sparkle, [255, 246, 203, 255]);
    await pause.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".identity-avatar img")).animationName === "avatar-float");
    await pause.click();
    await button(page, "Bật chuyển động").waitFor();
    assert.equal(await avatarAnimation(), "none");
    const frozen = await sample();
    await page.waitForTimeout(800);
    assert.deepEqual(await sample(), frozen);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#pet-motion").waitFor({ state: "hidden" });
    assert.equal(await avatarAnimation(), "none");
    assert.deepEqual(await sample(), idle);
    console.log("PASS GitHub pet poses, sparkle, dashboard pause and reduced motion");
  });

  await withFixture("modes-v2", async (page, origin) => {
    const address = "FzcnaZMYcoAYpLgr7Wym2b8hrKYk3VXsRxWSLuvZKLJm";
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("link", { name: "Ví Solana" }).click();
    assert.equal(new URL(page.url()).hash, "#solana");
    assert.equal(await page.locator(":focus").textContent(), "Địa chỉ nhận Solana");
    assert.equal(await page.locator("#screen").isVisible(), false);
    await page.waitForFunction(() => document.querySelector(".wallet-qr").naturalWidth > 0);
    assert.equal(await page.getByLabel("Public key").inputValue(), address);
    await button(page, "Sao chép địa chỉ").click();
    await expectText(page, "#wallet-feedback", "Đã sao chép địa chỉ.");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), address);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined });
    });
    await button(page, "Sao chép địa chỉ").click();
    await expectText(page, "#wallet-feedback", "Đã sao chép địa chỉ.");
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
    await page.getByRole("link", { name: "Về điều khiển" }).click();
    await page.locator("#screen").waitFor();
    await page.goto(origin + "/#solana");
    await page.getByRole("heading", { name: "Địa chỉ nhận Solana" }).waitFor();
    console.log("PASS Solana wallet navigation, QR and clipboard");
  });

  await withFixture("unsynced", async (page) => {
    await mode(page, "Đồng hồ").click();
    await expectText(page, "#preview-description", /chờ đồng bộ NTP/);
    assert.equal(await page.locator("#preview").evaluate((canvas) => canvas.getAnimations().length), 0);
    await page.getByRole("link", { name: "Cài đặt" }).click();
    assert.equal(await button(page, "Đồng bộ giờ NTP").evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
    await button(page, "Đồng bộ giờ NTP").click();
    await page.locator("#diagnostics > summary").click();
    await expectText(page, "#time-status", "Đã đồng bộ");
  }, { reducedMotion: "reduce" });

  await withFixture("live", async (page, origin) => {
    await expectText(page, "#preview-description", /Giả lập · Dữ liệu GitHub · @fixture/);
    await page.locator("#diagnostics > summary").click();
    await expectText(page, "#github-sync", /10:20/);
    const data = await api(origin, "github");
    assert.match(data.levels, /^[0-4]{364}$/);
    const painted = await page.locator("#preview").evaluate((canvas) => {
      const ctx = canvas.getContext("2d");
      return Array.from({ length: 168 }, (_, index) => {
        const x = 33 + Math.floor(index / 7) * 11;
        const y = 115 + index % 7 * 8;
        return [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
      });
    });
    const levels = [[48, 58, 70], [18, 86, 56], [33, 132, 90], [66, 185, 120], [140, 242, 172]];
    assert.deepEqual(painted, [...data.levels.slice(196)].map((level) => levels[level]));
    assert.equal(await page.locator("#calendar-grid span").count(), 364);
    const surfaces = () => page.evaluate(() => {
      const ctx = document.querySelector("#preview").getContext("2d");
      const readColor = (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor;
      return {
        canvas: [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3),
        panel: [...ctx.getImageData(20, 100, 1, 1).data].slice(0, 3),
        calendar: readColor("#calendar"),
        grid: readColor("#calendar-grid"),
        key: readColor('#calendar-key [data-level="4"]'),
      };
    });
    assert.deepEqual(await surfaces(), {
      canvas: [16, 20, 25], panel: [27, 33, 42],
      calendar: "rgb(16, 20, 25)", grid: "rgb(27, 33, 42)", key: "rgb(140, 242, 172)",
    });
    await page.getByRole("link", { name: "Cài đặt" }).click();
    await page.getByLabel("Giao diện TFT").selectOption("light");
    await button(page, "Lưu cài đặt").click();
    await expectText(page, "#settings-feedback", "Đã lưu cài đặt.");
    assert.deepEqual(await surfaces(), {
      canvas: [245, 246, 248], panel: [255, 255, 255],
      calendar: "rgb(245, 246, 248)", grid: "rgb(255, 255, 255)", key: "rgb(25, 92, 55)",
    });
    assert.equal(await page.locator("#calendar-grid").evaluate((grid) => [...grid.children].map((cell) => cell.dataset.level).join("")), data.levels);
    assert.equal(await page.locator(".identity img").evaluate((image) => image.naturalWidth), 144);
    await legacyMode(page, "Thống kê GitHub");
    await expectText(page, "#preview-description", /12 kho công khai/);
  });

  await withFixture("stale", async (page) => {
    await expectText(page, "#preview-description", /Dữ liệu lưu gần nhất/);
    await expectText(page, "#preview-description", /Hết thời gian chờ GitHub/);
    await legacyMode(page, "Thống kê GitHub");
    await expectText(page, "#preview-description", /12 kho công khai/);
  });

  await withFixture("error", async (page) => {
    await expectText(page, "#preview-description", /Không xác minh được chứng chỉ HTTPS/);
    await mode(page, "Đồng hồ").click();
    await expectText(page, "#preview-description", /Đồng hồ thiết bị/);
  });

  await withFixture("loading", async (page) => {
    await expectText(page, "#preview-description", /Đang đồng bộ/);
    await legacyMode(page, "Tin nhắn");
    await expectText(page, "#preview-description", /Hello, developer!/);
  });

  await withFixture("reject", async (page, origin) => {
    await mode(page, "Đồng hồ").click();
    await expectText(page, "#mode-feedback", /Fixture từ chối/);
    assert.equal(await mode(page, "Đóng góp GitHub").getAttribute("aria-pressed"), "true");
    await page.locator("#legacy-tools > summary").click();
    await page.locator("#message-tools > summary").click();
    await page.getByLabel("Nội dung trên TFT").fill("Unsaved draft");
    await button(page, "Lưu tin nhắn").click();
    await expectText(page, "#message-feedback", /Fixture từ chối/);
    assert.equal(await page.getByLabel("Nội dung trên TFT").inputValue(), "Unsaved draft");
    assert.equal((await api(origin, "config")).message.text, "Hello, developer!");
  });

  await withFixture("demo", async (page) => {
    let networkFields;
    await page.route("**/api/status", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      delete data.wifi.ip;
      delete data.wifi.hostname;
      Object.assign(data.wifi, networkFields);
      await route.fulfill({ response, json: data });
    });
    for (const [fields, ip, hostname] of [
      [{}, "—", ""],
      [{ ip: null, hostname: null }, "—", ""],
      [{ ip: null, hostname: "esp32-display.local" }, "", "esp32-display.local"],
      [{ ip: "192.168.88.192", hostname: null }, "192.168.88.192", ""],
      [{ ip: "192.168.88.192", hostname: "esp32-display.local" }, "192.168.88.192", "esp32-display.local"],
    ]) {
      networkFields = fields;
      await page.reload();
      await expectText(page, "#connection", "Thiết bị giả lập");
      await page.locator("#diagnostics > summary").click();
      if (ip) await expectText(page, "#wifi-ip", ip);
      else assert.equal(await page.locator("#wifi-ip").isVisible(), false);
      if (hostname) await expectText(page, "#wifi-hostname", hostname);
      else assert.equal(await page.locator("#wifi-hostname").isVisible(), false);
    }
    console.log("PASS Wi-Fi status with omitted, null and populated addresses");
  });

  await withFixture("offline", async (page) => {
    await expectText(page, "#offline-message", /Fixture tạm thời mất kết nối/);
    assert.equal(await mode(page, "Đồng hồ").isDisabled(), true);
    const request = page.waitForRequest((entry) => entry.url().endsWith("/api/status"));
    await button(page, "Kết nối lại").click();
    await request;
  });
  await withFixture("modes-v2", async (page, origin) => {
    await expectText(page, "#active-mode", "Đóng góp GitHub");
    await mode(page, "Đồng hồ").click();
    await expectText(page, "#active-mode", "Đồng hồ + Lịch");
    await expectText(page, "#month-events", /Sự kiện kiểm thử/);
    assert.equal(await page.locator("#month-days td[aria-current=date]").count(), 1);
    const month = await page.locator("#month-heading").textContent();
    const event = (await api(origin, "calendar")).events[0];
    const eventDay = new Date((event.start + 7 * 3600) * 1000);
    const deviceDay = new Date(Date.now() + 7 * 3600 * 1000);
    if (eventDay.getUTCMonth() === deviceDay.getUTCMonth()) {
      const eventCell = page.locator(`#month-days td[aria-label="Ngày ${eventDay.getUTCDate()}, 1 sự kiện"]`);
      await eventCell.locator(".month-event-dot").waitFor();
    }
    await button(page, "Tháng sau").click();
    assert.notEqual(await page.locator("#month-heading").textContent(), month);
    assert.equal(await page.locator("#month-days").evaluate((tbody) => tbody.getAnimations().length), 1);
    assert.equal(await page.locator("#month-next").evaluate((el) => el === document.activeElement), true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await button(page, "Tháng hiện tại").click();
    assert.equal(await page.locator("#month-days").evaluate((tbody) => tbody.getAnimations().length), 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expectText(page, "#month-heading", month);

    await mode(page, "Đếm ngược").click();
    await expectText(page, "#active-mode", "Đếm ngược");
    const countdown = page.locator("#countdown-form");
    await countdown.getByLabel("Thời lượng (giây)").fill("123");
    await countdown.getByRole("button", { name: "Lưu thời lượng" }).click();
    await expectText(page, "#countdown-remaining", "02:03");
    await countdown.getByRole("button", { name: "Bắt đầu", exact: true }).click();
    await expectText(page, "#countdown-state", "Đang chạy");
    await countdown.getByRole("button", { name: "Tạm dừng" }).click();
    await expectText(page, "#countdown-state", "Đã tạm dừng");
    await countdown.getByLabel("Kiểu đếm ngược").selectOption("target");
    await countdown.getByLabel(/Mốc giờ ICT/).fill("2090-11-13T20:45");
    await countdown.getByRole("button", { name: "Lưu và kích hoạt mốc" }).click();
    await expectText(page, "#countdown-state", "Đang chạy");
    assert.equal((await api(origin, "countdown")).targetEpochSeconds, Date.parse("2090-11-13T20:45:00+07:00") / 1000);
    assert.equal(await countdown.getByRole("button", { name: "Tạm dừng" }).isDisabled(), true);
    await countdown.getByRole("button", { name: "Đặt lại" }).click();
    await expectText(page, "#countdown-state", "Sẵn sàng");

    const oldRequests = [];
    page.on("request", (request) => {
      if (/\/api\/(quota|integrations)/.test(new URL(request.url()).pathname)) oldRequests.push(request.url());
    });
    await page.goto(origin + "/#quota");
    await expectText(page, "#active-mode", "Đếm ngược");
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(await page.locator('#mode-list button').count(), 3);
    assert.equal(await page.getByRole("link", { name: "Quota", exact: true }).count(), 0);
    await page.getByRole("link", { name: "Cài đặt" }).click();
    assert.deepEqual(await page.getByLabel("Chế độ khi khởi động").evaluate((el) =>
      [...el.options].filter((option) => !option.hidden).map((option) => option.value)
    ), ["github", "clock", "countdown"]);
    const rotation = page.getByRole("group", { name: "Luân phiên chế độ" });
    assert.deepEqual(await rotation.locator('input[name="rotationMode"]:visible').evaluateAll((items) =>
      items.map((item) => item.value)
    ), ["github", "clock", "countdown"]);
    assert.deepEqual(oldRequests, []);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
  });

  await withFixture("modes-v2", async (page, origin) => {
    await page.route("**/api/status", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, mode: "codex" } });
    });
    await page.route("**/api/config", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: {
        ...data, startupMode: "claude",
        rotation: { ...data.rotation, enabled: true, modes: ["codex", "claude"] },
      } });
    });
    const writes = [];
    page.on("request", (request) => {
      if (request.method() === "POST") writes.push(request.url());
    });
    await page.goto(origin + "/?legacy=1#quota");
    await expectText(page, "#active-mode", "Chế độ cũ");
    assert.equal(page.url(), origin + "/?legacy=1");
    assert.equal(await mode(page, "Đóng góp GitHub").isEnabled(), true);
    await page.getByRole("link", { name: "Cài đặt" }).click();
    assert.equal(await page.getByLabel("Chế độ khi khởi động").inputValue(), "github");
    assert.equal(await page.getByLabel("Bật tự động luân phiên").isChecked(), false);
    assert.deepEqual(writes, []);
  });

  const session = { authenticated: true, csrfToken: "fixture-csrf", expiresAt: 2000000000 };
  const bad = (code) => ({ ok: false, error: { code } });
  let auth = false;
  let setupRequired = false;
  let connection = "offline";
  let command = null;
  let commandAccepted = false;
  let rejectCommand = false;
  let expireSession = false;
  let calendarConnected = false;
  let snapshot;
  const writes = [];
  const fixturePassword = crypto.randomUUID();

  async function installRemote(page, origin) {
    const [status, config, github] = await Promise.all(["status", "config", "github"].map((path) => api(origin, path)));
    snapshot = { status, config, github };
    config.rotation.modes = ["github", "clock", "countdown"];
    status.countdown = { kind: "duration", state: "idle", durationSeconds: 1500, targetEpochSeconds: null, remainingSeconds: 1500 };
    status.wifi.ip = status.wifi.hostname = null;
    delete config.githubProxyUrl;
    await page.route((url) => url.origin === origin && url.pathname === "/", async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace('<html lang="vi">', '<html lang="vi" data-transport="remote">');
      await route.fulfill({ response, body: html });
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const json = (body, status = 200) => route.fulfill({ status, json: body });
      if (path === "/api/auth/session") return setupRequired ? json(bad("setup_required"), 503) : json(auth ? session : { authenticated: false });
      if (path === "/api/auth/login") {
        if (request.postDataJSON().password !== fixturePassword) return json(bad("invalid_credentials"), 401);
        auth = true;
        return json(session);
      }
      if (!auth || expireSession) return json(bad("unauthenticated"), 401);
      if (request.method() === "POST") assert.equal(request.headers()["x-csrf-token"], session.csrfToken);
      if (path === "/api/auth/logout") {
        auth = false;
        return json({ ok: true });
      }
      if (path === "/api/admin/integrations") return json({
        v: 1, calendar: { state: "unavailable", events: [], canConnect: true, connected: calendarConnected },
      });
      if (path === "/api/admin/calendar/connect") {
        calendarConnected = true;
        return json({ ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth" });
      }
      if (path === "/api/admin/calendar/disconnect") {
        calendarConnected = false;
        return json({ ok: true });
      }
      if (path === "/api/admin/state") {
        assert.equal(request.headers()["x-desk-interactive"], "1");
        return json({
        connection, command,
        lastSeenAt: connection === "offline" ? null : Math.floor(Date.now() / 1000),
        status: connection === "offline" ? null : snapshot.status,
        config: connection === "offline" ? null : snapshot.config,
        github: connection === "offline" ? null : snapshot.github,
      });
      }
      if (path === "/api/admin/commands") {
        const { id, type, payload } = request.postDataJSON();
        assert.match(id, /^[0-9a-f]{32}$/);
        writes.push({ type, payload });
        command = { id, type, payload, expiresAt: Math.floor(Date.now() / 1000) + 90, state: "queued", ack: null };
        return json({ ok: true, command }, 202);
      }
      if (path === `/api/admin/commands/${command?.id}`) {
        if (commandAccepted && command.state === "queued") {
          const result = rejectCommand ? "rejected" : "applied";
          command = { ...command, state: result, ack: { id: command.id, result, code: rejectCommand ? "invalid_field" : null } };
          if (!rejectCommand && command.type === "display") snapshot.status.mode = command.payload.mode;
          if (!rejectCommand && command.type === "countdown") {
            snapshot.status.countdown = { ...snapshot.status.countdown, durationSeconds: command.payload.durationSeconds, remainingSeconds: command.payload.durationSeconds };
          }
        }
        return json({ ok: true, command });
      }
      return json(bad("not_found"), 404);
    });
  }

  await withFixture("live", async (page, origin) => {
    await page.goto(origin + "/#calendar-tools");
    const password = page.getByLabel("PIN hoặc mật khẩu", { exact: true });
    await expectText(page, "#auth-title", "Đăng nhập");
    assert.equal(await page.locator("#main").isVisible(), false);
    await password.fill("incorrect");
    await button(page, "Đăng nhập").click();
    await expectText(page, "#auth-feedback", "Mật khẩu không đúng.");
    assert.equal(await password.inputValue(), "");
    await password.fill(fixturePassword);
    await button(page, "Đăng nhập").click();
    await expectText(page, "#offline-message", "Chưa nhận được kết nối từ ESP32.");
    await button(page, "Kết nối Google Calendar").waitFor();
    assert.equal(await mode(page, "Đồng hồ").isDisabled(), true);
    connection = "stale";
    await button(page, "Kết nối lại").click();
    await expectText(page, "#connection", "Dữ liệu đã cũ");
    connection = "online";
    await button(page, "Kết nối lại").click();
    await expectText(page, "#connection", "Thiết bị giả lập");
    assert.equal(await page.getByLabel("URL proxy GitHub").isVisible(), false);
    assert.equal(await button(page, "Khởi động lại thiết bị").isVisible(), false);
    const queuedAt = page.waitForResponse((response) => response.url().endsWith("/api/admin/commands") && response.status() === 202).then(() => performance.now());
    const ackRead = page.waitForRequest((request) => /\/api\/admin\/commands\/[0-9a-f]+$/.test(request.url())).then(() => performance.now());
    await mode(page, "Đồng hồ").click();
    await expectText(page, "#remote-feedback", /Đang chờ ESP32/);
    const ackDelay = (await ackRead) - (await queuedAt);
    assert.ok(ackDelay < 500, `First ACK read took ${ackDelay} ms`);
    console.log(`First ACK read after HTTP 202: ${Math.round(ackDelay)} ms (fixture)`);
    assert.equal(await page.locator("#mode-feedback").getAttribute("data-tone"), "pending");
    assert.equal(await mode(page, "Đóng góp GitHub").getAttribute("aria-pressed"), "true");
    assert.equal(await mode(page, "Đồng hồ").isDisabled(), true);
    commandAccepted = true;
    await expectText(page, "#mode-feedback", "ESP32 đã áp dụng lệnh.");
    await expectText(page, "#active-mode", "Đồng hồ + Lịch");
    await page.route("https://accounts.google.com/**", (route) => route.fulfill({ status: 204 }));
    const oauth = page.waitForResponse((res) => res.url().startsWith("https://accounts.google.com/"));
    await button(page, "Kết nối Google Calendar").click();
    assert.equal((await oauth).status(), 204);
    await page.goto(page.url().split(/[?#]/)[0] + "?calendar=connected#calendar");
    await expectText(page, "#calendar-feedback", "Đã kết nối Google Calendar.");
    await button(page, "Ngắt kết nối Google Calendar").click();
    await expectText(page, "#calendar-feedback", "Đã ngắt kết nối Google Calendar.");
    await page.locator("#countdown-tools > summary").click();
    await page.getByLabel("Thời lượng (giây)").fill("90");
    await button(page, "Lưu thời lượng").click();
    await expectText(page, "#countdown-feedback", "ESP32 đã áp dụng lệnh.");
    await expectText(page, "#countdown-remaining", "01:30");
    rejectCommand = true;
    await page.getByRole("link", { name: "Cài đặt" }).click();
    await page.getByLabel("Giao diện TFT").selectOption("light");
    await button(page, "Lưu cài đặt").click();
    await expectText(page, "#settings-feedback", "ESP32 từ chối lệnh.");
    assert.deepEqual(writes, [
      { type: "display", payload: { mode: "clock" } },
      { type: "countdown", payload: { action: "configure", kind: "duration", durationSeconds: 90 } },
      { type: "config", payload: { theme: "light", clockShowSeconds: true, rotation: snapshot.config.rotation } },
    ]);
    assert.equal(await page.getByLabel("Giao diện TFT").inputValue(), "light");
    await page.reload();
    await expectText(page, "#active-mode", "Đồng hồ + Lịch");
    await button(page, "Đăng xuất").click();
    await expectText(page, "#auth-feedback", "Đã đăng xuất.");
    assert.equal(await page.locator("#main").isVisible(), false);
    await password.fill(fixturePassword);
    await button(page, "Đăng nhập").click();
    await expectText(page, "#active-mode", "Đồng hồ + Lịch");
    expireSession = true;
    await expectText(page, "#auth-feedback", /Phiên đã hết hạn/);
    assert.equal(await page.locator("#main").isVisible(), false);
    console.log("PASS remote session, offline, stale, pending, applied, rejected, logout and expiry");
  }, { prepare: installRemote });

  setupRequired = true;
  await withFixture("live", async (page) => {
    await expectText(page, "#auth-feedback", "Dịch vụ quản trị từ xa chưa được thiết lập.");
    assert.equal(await page.getByLabel("PIN hoặc mật khẩu", { exact: true }).isVisible(), false);
    assert.equal(await page.locator("#main").isVisible(), false);
    console.log("PASS remote setup_required");
  }, { prepare: installRemote });
} finally {
  await browser.close();
}
