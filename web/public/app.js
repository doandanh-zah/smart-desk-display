"use strict";

const byId = (id) => document.getElementById(id);
const modeNames = {
  github: "Đóng góp GitHub", clock: "Đồng hồ + Lịch", countdown: "Đếm ngược", codex: "Quota Codex", claude: "Quota Claude", stats: "Thống kê GitHub",
  pomodoro: "Pomodoro", message: "Tin nhắn",
};
const githubNames = {
  demo: "Dữ liệu mẫu", loading: "Đang đồng bộ", live: "Dữ liệu GitHub",
  stale: "Dữ liệu lưu gần nhất", error: "Lỗi đồng bộ",
};
const githubErrors = {
  rate_limited: "GitHub hoặc proxy đang giới hạn lượt truy cập.",
  user_not_found: "Không tìm thấy tài khoản GitHub.",
  proxy_unconfigured: "Proxy chưa được cấu hình.",
  upstream_timeout: "Hết thời gian chờ GitHub.",
  waiting_for_time: "Đang chờ đồng hồ thiết bị đồng bộ.",
  wifi_offline: "Thiết bị mất kết nối Wi-Fi.",
  invalid_proxy_url: "Kiểm tra URL proxy GitHub.",
  invalid_username: "Kiểm tra tên tài khoản GitHub.",
  tls_verification_failed: "Không xác minh được chứng chỉ HTTPS của proxy GitHub.",
};
const timerNames = { idle: "Sẵn sàng", running: "Đang chạy", paused: "Đã tạm dừng", completed: "Hoàn tất" };
const modes = [...document.querySelectorAll("[data-mode]")];
const timerButtons = [...document.querySelectorAll("[data-timer]")];
const settingsForm = byId("settings-form");
const messageForm = byId("message-form");
const messageText = byId("message-text");
const rotationModes = [...settingsForm.querySelectorAll('[name="rotationMode"]')];
const restartDialog = byId("restart-dialog");
const previewCanvas = byId("preview");
const petMotionButton = byId("pet-motion");
const draw = window.createDeskPreview(previewCanvas);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const dateFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short",
});
const numberFormat = new Intl.NumberFormat("vi-VN");
const emptyGithub = { state: "loading", levels: "" };

let status;
let config;
let github;
let clockAt = 0;
let timerAt = 0;
let online = false;
let fixture = byId("fixture-banner").dataset.fixture === "true";
let busy = false;
let pollRead;
let settingsDirty = false;
let messageDirty = false;
let revision = 0;
let restartUntil = 0;
let lastConfigRead = -Infinity;
let githubKey = null;
let renderedCalendarLevels = null;
let fetchingGithub = false;
let pollTimer;
let previewMode;
const modeTools = {
  clock: byId("calendar-tools"), countdown: byId("countdown-tools"),
  pomodoro: byId("pomodoro-tools"), message: byId("message-tools"),
};
let integrations;
let integrationAt = -Infinity;
let integrationRead;
let calendarBusy = false;
let quotaRenderKey;
let countdownAt = 0;
let countdownDraft = false;
const providers = ["codex", "claude"];
const sourceStates = { live: "Đã cập nhật", stale: "Dữ liệu đã cũ", unavailable: "Chưa kết nối", unsupported: "Không hỗ trợ", error: "Lỗi đồng bộ" };
const countdownStates = { ...timerNames, waiting_for_time: "Đang chờ đồng bộ NTP" };
let selectedMonth;
let monthKey;

function revealLinkedPanel() {
  if (location.hash === "#settings" || location.hash === "#calendar-tools") {
    const panel = byId(location.hash.slice(1));
    panel.open = true;
    if (location.hash === "#calendar-tools") panel.scrollIntoView();
  }
}

window.addEventListener("hashchange", revealLinkedPanel);
document.querySelector('.nav a[href="#settings"]').addEventListener("click", () => {
  byId("settings").open = true;
});
revealLinkedPanel();
let previewVisible = false;
let petClock = null;
let petPaused = false;

function label(id, text) {
  const element = byId(id);
  if (element.textContent !== text) element.textContent = text;
}

function feedback(id, text = "", tone = "") {
  label(id, text);
  byId(id).dataset.tone = tone;
}

const transport = window.deskTransport;
const { request } = transport;
const remote = transport.kind === "remote";
let signedIn = !remote;
let remoteConnection = "offline";
let lastSeenAt;
let remoteCommand;

function localDate(iso) {
  const date = new Date(iso);
  return iso && Number.isFinite(date.getTime()) ? dateFormat.format(date) : "—";
}

function clockText(seconds) {
  return [Math.floor(seconds / 60), seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

function uptimeText(seconds) {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ngày ${Math.floor(seconds % 86400 / 3600)} giờ`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} giờ ${Math.floor(seconds % 3600 / 60)} phút`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} phút ${seconds % 60} giây`;
  return `${seconds} giây`;
}

function currentTimer() {
  const timer = status?.pomodoro;
  if (!timer) return null;
  const elapsed = online && timer.state === "running" ? Math.floor((performance.now() - timerAt) / 1000) : 0;
  return { ...timer, remainingSeconds: Math.max(0, timer.remainingSeconds - elapsed) };
}

function describeGithub(data, includeState = true) {
  const parts = includeState ? [githubNames[data.state] || "Chưa có dữ liệu"] : [];
  if (data.username) parts.push(`@${data.username}`);
  if (data.totalContributions != null) parts.push(`${numberFormat.format(data.totalContributions)} đóng góp`);
  if (data.currentStreak != null) parts.push(`chuỗi ${numberFormat.format(data.currentStreak)} ngày`);
  if (status?.mode === "stats") parts.push(data.repositoryCount == null ? "Chưa có số kho công khai" : `${numberFormat.format(data.repositoryCount)} kho công khai`);
  if (data.lastSync) parts.push(localDate(data.lastSync));
  if (data.error) parts.push(githubErrors[data.error] || data.error);
  return parts.join(" · ");
}

function deviceLocalEpoch(showSeconds) {
  const time = status.time;
  if (!time.synced || !Number.isFinite(time.epochSeconds)) return null;
  const elapsed = online ? Math.floor((performance.now() - clockAt) / 1000) : 0;
  const epoch = time.epochSeconds + time.utcOffsetMinutes * 60 + elapsed;
  return showSeconds ? epoch : epoch - epoch % 60;
}

function renderPreview(timer) {
  const mode = status?.mode;
  const frame = {
    mode, theme: config?.theme, deviceName: status?.deviceName,
    wifi: status?.wifi,
  };
  let caption = online ? "Đang đọc dữ liệu từ thiết bị" : "Đang chờ kết nối";
  if (mode === "github" || mode === "stats") {
    frame.github = github || emptyGithub;
    caption = describeGithub(frame.github);
    if (mode === "github") {
      frame.githubUsername = config?.githubUsername || "";
      frame.localEpoch = deviceLocalEpoch(false);
      if (frame.localEpoch == null) {
        caption += " · Chưa đồng bộ NTP";
      } else {
        const date = new Date(frame.localEpoch * 1000);
        const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
        caption += ` · ${clockText(minutes)} ICT`;
      }
    }
  } else if (mode === "clock") {
    frame.showSeconds = config?.clockShowSeconds ?? true;
    if (status.countdown) frame.calendar = integrations?.calendar ?? { state: "unavailable" };
    frame.localEpoch = deviceLocalEpoch(frame.showSeconds);
    caption = frame.localEpoch == null ? "Đang chờ đồng bộ NTP · UTC+7" : "Đồng hồ thiết bị · UTC+7";
    if (frame.localEpoch != null) {
      const date = new Date(frame.localEpoch * 1000);
      const timeParts = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
      caption += ` · ${timeParts.slice(0, frame.showSeconds ? 3 : 2).map((part) => String(part).padStart(2, "0")).join(":")}`;
    }
  } else if (mode === "countdown") {
    frame.countdown = currentCountdown();
    caption = frame.countdown ? `${countdownStates[frame.countdown.state]} · ${countdownTime(frame.countdown.remainingSeconds)}` : "Chưa có trạng thái đếm ngược";
  } else if (providers.includes(mode)) {
    frame.quota = quotaSnapshot(mode);
    caption = `${modeNames[mode]} · ${sourceStates[frame.quota?.state] || sourceStates.unavailable}`;
  } else if (mode === "pomodoro" && timer) {
    frame.timer = timer;
    caption = `${timer.phase === "break" ? "Nghỉ ngắn" : "Tập trung"} · ${timerNames[timer.state]} · ${clockText(timer.remainingSeconds)}`;
  } else if (mode === "message") {
    frame.message = config?.message;
    caption = frame.message ? frame.message.text.trim() || "Tin nhắn trống" : "Đang tải tin nhắn";
    if (!frame.message) frame.mode = null;
  }

  draw(frame);
  label("active-mode", modeNames[mode] || "—");
  label("preview-description", `${fixture ? "Giả lập · " : ""}${!online && status ? "Trạng thái gần nhất · " : ""}${caption}`);
  if (previewMode !== mode) {
    previewMode = mode;
    byId("screen").classList.toggle("github-screen", mode === "github");
    if (modeTools[mode]) {
      if (mode === "pomodoro" || mode === "message") byId("legacy-tools").open = true;
      modeTools[mode].open = true;
    }
    syncPetMotion();
    if (mode && !reducedMotion.matches) {
      previewCanvas.getAnimations().forEach((animation) => animation.cancel());
      previewCanvas.animate(
        [{ opacity: .78, transform: "translateY(2px)" }, { opacity: 1, transform: "none" }],
        { duration: 210, easing: "ease-out" },
      );
    }
  }
}

function syncPetMotion() {
  const hasPet = previewMode === "github" || providers.includes(previewMode);
  const motionAvailable = hasPet && !reducedMotion.matches;
  if (!motionAvailable && document.activeElement === petMotionButton) {
    modes.find((button) => button.dataset.mode === previewMode)?.focus();
  }
  petMotionButton.hidden = !motionAvailable;
  label("pet-motion", petPaused ? "Phát chuyển động pet" : "Tạm dừng chuyển động pet");
  const shouldAnimate = motionAvailable && !petPaused && previewVisible && !document.hidden;
  if (!shouldAnimate) {
    if (petClock !== null) {
      clearInterval(petClock);
      petClock = null;
    }
    draw.pet(reducedMotion.matches || !hasPet ? 0 : undefined);
    return;
  }
  if (petClock !== null) return;
  let previous = performance.now();
  petClock = setInterval(() => {
    const now = performance.now();
    draw.petStep(now - previous);
    previous = now;
  }, 40);
}

function renderCalendar() {
  byId("calendar").classList.toggle("github-light", config?.theme === "light");
  const data = github || emptyGithub;
  const unavailable = !online && !!byId("offline-message").textContent;
  label("calendar-state", !github && unavailable ? "Chưa có dữ liệu" : githubNames[data.state] || "Chưa có dữ liệu");
  byId("calendar-state").dataset.state = { demo: "fixture", live: "online", stale: "offline", error: "offline" }[data.state] || "";
  const summary = github ? (describeGithub(data, false) || "Chưa có dữ liệu đóng góp.") :
    unavailable ? "Chưa nhận được lịch GitHub." : "Đang tải dữ liệu GitHub…";
  label("calendar-summary", !online && github ? `Trạng thái gần nhất · ${summary}` : summary);
  const levels = /^[0-4]{364}$/.test(data.levels || "") ? data.levels : null;
  const scroll = byId("calendar-scroll");
  scroll.hidden = !levels;
  byId("calendar-key").hidden = !levels;
  if (levels === renderedCalendarLevels) return;
  const firstRender = renderedCalendarLevels === null;
  renderedCalendarLevels = levels;
  const grid = byId("calendar-grid");
  if (!levels) {
    grid.replaceChildren();
    return;
  }
  const cells = Array.from(levels, (level, index) => {
    const cell = document.createElement("span");
    cell.dataset.level = level;
    cell.title = `Tuần ${Math.floor(index / 7) + 1} · ${["CN", "T2", "T3", "T4", "T5", "T6", "T7"][index % 7]} · Mức ${level}/4`;
    return cell;
  });
  grid.replaceChildren(...cells);
  if (firstRender) scroll.scrollLeft = scroll.scrollWidth;
}

function countdownTime(seconds) {
  if (seconds == null) return "--:--";
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ngày ${clockText(Math.floor(seconds % 86400 / 60))}`;
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60];
  return parts.slice(seconds >= 3600 ? 0 : 1).map((part) => String(part).padStart(2, "0")).join(":");
}

function currentCountdown() {
  const sample = status?.countdown;
  if (!sample) return null;
  const elapsed = online && sample.state === "running" ? Math.max(0, Math.floor((performance.now() - countdownAt) / 1000)) : 0;
  const remainingSeconds = sample.remainingSeconds == null ? null : Math.max(0, sample.remainingSeconds - elapsed);
  return { ...sample, remainingSeconds };
}

function countdownFields() {
  const target = byId("countdown-kind").value === "target";
  byId("countdown-duration-label").hidden = target;
  byId("countdown-duration").disabled = target;
  byId("countdown-target-label").hidden = !target;
  byId("countdown-target").disabled = !target;
  byId("countdown-target").required = target;
  byId("countdown-form").querySelector('[type="submit"]').textContent = target ? "Lưu và kích hoạt mốc" : "Lưu thời lượng";
}

function renderCountdown() {
  const data = currentCountdown();
  label("countdown-state", data ? countdownStates[data.state] || "—" : "Phiên bản thiết bị chưa báo trạng thái đếm ngược");
  label("countdown-summary", data ? countdownStates[data.state] || "" : "");
  label("countdown-remaining", countdownTime(data?.remainingSeconds));
  byId("countdown-start").disabled = !data || ["running", "waiting_for_time"].includes(data.state);
  byId("countdown-pause").disabled = data?.kind !== "duration" || data.state !== "running";
  if (data && !countdownDraft) {
    byId("countdown-kind").value = data.kind;
    byId("countdown-duration").value = data.durationSeconds;
    const epoch = data.targetEpochSeconds;
    byId("countdown-target").value = epoch ? new Date((epoch + 7 * 3600) * 1000).toISOString().slice(0, 16) : "";
  }
  countdownFields();
}

function countdownMatchesDraft(payload) {
  return byId("countdown-kind").value === payload.kind && (payload.kind === "duration"
    ? Number(byId("countdown-duration").value) === payload.durationSeconds
    : Date.parse(byId("countdown-target").value + "+07:00") / 1000 === payload.targetEpochSeconds);
}

function runCountdown(payload) {
  command("countdown", payload, "countdown-feedback", "Đã cập nhật đếm ngược.", (data) => {
    status.countdown = data.countdown;
    countdownAt = performance.now();
    if (payload.action === "configure" && countdownMatchesDraft(payload)) countdownDraft = false;
  });
}

byId("countdown-form").addEventListener("input", () => {
  countdownDraft = true;
  countdownFields();
});
byId("countdown-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const kind = byId("countdown-kind").value;
  if (kind === "duration") {
    runCountdown({ action: "configure", kind, durationSeconds: Number(byId("countdown-duration").value) });
    return;
  }
  const value = byId("countdown-target").value;
  const epoch = Date.parse(value + "+07:00") / 1000;
  if (!Number.isSafeInteger(epoch) || epoch < 1704067200 || epoch >= 4102444800) {
    feedback("countdown-feedback", "Chọn mốc trong khoảng năm 2024 đến 2099.", "error");
    byId("countdown-target").focus();
    return;
  }
  runCountdown({ action: "configure", kind, targetEpochSeconds: epoch });
});
for (const action of ["start", "pause", "reset"]) {
  byId(`countdown-${action}`).addEventListener("click", () => runCountdown({ action }));
}

function localToday() {
  const epoch = status?.time ? deviceLocalEpoch(false) : null;
  return epoch == null ? null : new Date(epoch * 1000);
}

function renderMonth() {
  const today = localToday();
  const epoch = today?.getTime();
  const calendar = integrations?.calendar;
  const view = selectedMonth ?? epoch;
  const date = view == null ? null : new Date(view);
  const key = JSON.stringify([date?.getUTCFullYear(), date?.getUTCMonth(), today?.getUTCDate(), today?.getUTCMonth(), calendar]);
  if (key === monthKey) return;
  monthKey = key;
  label("month-heading", date ? `Tháng ${date.getUTCMonth() + 1} / ${date.getUTCFullYear()}` : "Chưa có ngày thiết bị");
  ["month-prev", "month-next"].forEach((id) => { byId(id).disabled = !date; });
  byId("month-today").disabled = !today;
  const rows = [];
  if (date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const offset = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let cell = 0; cell < 42; cell += 7) {
      const row = document.createElement("tr");
      for (let column = 0; column < 7; column += 1) {
        const day = cell + column - offset + 1;
        const element = row.insertCell();
        if (day < 1 || day > days) continue;
        element.textContent = day;
        if (today?.getUTCFullYear() === year && today.getUTCMonth() === month && today.getUTCDate() === day) {
          element.setAttribute("aria-current", "date");
        }
      }
      rows.push(row);
    }
  }
  byId("month-days").replaceChildren(...rows);
  label("month-source", `Google Calendar · ${sourceStates[calendar?.state] || sourceStates.unavailable}`);
  byId("calendar-connect-actions").hidden = !remote || !(calendar?.canConnect || calendar?.connected);
  byId("calendar-connect").hidden = !calendar?.canConnect || !!calendar?.connected;
  byId("calendar-disconnect").hidden = !calendar?.connected;
  const events = ["live", "stale"].includes(calendar?.state) ? calendar.events || [] : [];
  const list = byId("month-events");
  list.hidden = !events.length;
  list.replaceChildren(...events.slice(0, 3).map((event) => {
    const item = document.createElement("li");
    const day = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" });
    item.textContent = `${event.title} · ${event.allDay ? day.format(event.start * 1000) + " · Cả ngày" : localDate(event.start * 1000) + " ICT"}`;
    return item;
  }));
}

async function changeCalendarConnection(action) {
  if (!remote || !signedIn || calendarBusy) return;
  calendarBusy = true;
  const buttons = byId("calendar-connect-actions").querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  feedback("calendar-feedback", "Đang xử lý…", "pending");
  try {
    const result = await transport.calendar(action);
    if (action === "connect") {
      const destination = new URL(result.authorizationUrl);
      if (destination.origin !== "https://accounts.google.com") throw new Error("Địa chỉ xác thực Google không hợp lệ.");
      location.assign(destination);
    } else {
      integrationAt = -Infinity;
      if (integrations) integrations = { ...integrations, calendar: { ...integrations.calendar, connected: false, state: "unavailable", events: [] } };
      renderMonth();
      feedback("calendar-feedback", "Đã ngắt kết nối Google Calendar.", "success");
      void readIntegrations(true);
    }
  } catch (error) {
    remoteFailure(error, "calendar-feedback");
  } finally {
    calendarBusy = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}
byId("calendar-connect").addEventListener("click", () => changeCalendarConnection("connect"));
byId("calendar-disconnect").addEventListener("click", () => changeCalendarConnection("disconnect"));

function changeMonth(delta) {
  const date = selectedMonth == null ? localToday() : new Date(selectedMonth);
  if (!date) return;
  selectedMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1);
  renderMonth();
}
byId("month-prev").addEventListener("click", () => changeMonth(-1));
byId("month-next").addEventListener("click", () => changeMonth(1));
byId("month-today").addEventListener("click", () => { selectedMonth = undefined; renderMonth(); });

function quotaSnapshot(provider) {
  const quota = integrations?.quotas?.[provider];
  if (!quota || !["live", "stale"].includes(quota.state)) return quota;
  const now = Date.now() / 1000;
  if (quota.observedAt && now - quota.observedAt > 86400) return { state: "unavailable", windows: [] };
  if (quota.state === "live" && ((quota.observedAt != null && now - quota.observedAt > 900) || quota.windows?.some((window) => window.resetsAt != null && window.resetsAt <= now))) {
    return { ...quota, state: "stale" };
  }
  return quota;
}

function windowLabel(window) {
  if (window.windowMinutes && window.windowMinutes % 1440 === 0) return `Cửa sổ ${window.windowMinutes / 1440} ngày`;
  if (window.windowMinutes && window.windowMinutes % 60 === 0) return `Cửa sổ ${window.windowMinutes / 60} giờ`;
  if (window.windowMinutes) return `Cửa sổ ${window.windowMinutes} phút`;
  return { primary: "Hạn mức chính", secondary: "Hạn mức phụ", five_hour: "Cửa sổ 5 giờ", seven_day: "Cửa sổ 7 ngày" }[window.id] || "Hạn mức";
}

function remainingLabel(reset) {
  if (reset <= Date.now() / 1000) return "Đã đến giờ đặt lại";
  const minutes = Math.max(1, Math.ceil((reset - Date.now() / 1000) / 60));
  const parts = [];
  if (minutes >= 1440) parts.push(`${Math.floor(minutes / 1440)} ngày`);
  if (minutes >= 60) parts.push(`${Math.floor(minutes % 1440 / 60)} giờ`);
  if (minutes < 1440) parts.push(`${minutes % 60} phút`);
  return `Còn ${parts.join(" ")}`;
}

function quotaDetail(text) {
  const element = document.createElement("small");
  element.className = "meta quota-detail";
  element.textContent = text;
  return element;
}

function renderQuotas() {
  const snapshots = providers.map(quotaSnapshot);
  const key = JSON.stringify([snapshots, Math.floor(Date.now() / 60000)]);
  if (key === quotaRenderKey) return;
  quotaRenderKey = key;
  providers.forEach((provider, index) => {
    const quota = snapshots[index];
    const state = quota?.state;
    const hasSample = ["live", "stale"].includes(state);
    label(`quota-${provider}-state`, sourceStates[state] || sourceStates.unavailable);
    byId(`quota-${provider}-state`).dataset.state = state === "live" ? "online" : state === "stale" ? "offline" : "";
    label(`quota-${provider}-updated`, quota?.observedAt ? `Đồng bộ gần nhất · ${localDate(quota.observedAt * 1000)} ICT` : "");
    const windows = hasSample ? quota.windows || [] : [];
    const expected = [[300, "five_hour"], [10080, "seven_day"]];
    const entries = expected.map(([minutes, id]) => windows.find((window) => window.windowMinutes === minutes ||
      (window.windowMinutes == null && window.id === id)) || { windowMinutes: minutes });
    entries.push(...windows.filter((window) => !entries.includes(window)));
    const rows = entries.map((window) => {
      const item = document.createElement("div");
      item.className = "quota-window";
      const row = document.createElement("p");
      const name = document.createElement("strong");
      name.textContent = windowLabel(window);
      const value = document.createElement("span");
      const used = window.usedPercent;
      const measured = Number.isFinite(used) && used >= 0 && used <= 100;
      const remaining = measured ? 100 - used : null;
      value.textContent = measured ? `Còn ${numberFormat.format(remaining)}%` : "Chưa có tỷ lệ sử dụng";
      row.append(name, value);
      item.append(row);
      if (measured) {
        const meter = document.createElement("meter");
        meter.min = 0;
        meter.max = 100;
        meter.value = remaining;
        meter.setAttribute("aria-label", name.textContent + " còn lại");
        item.append(meter);
      }
      if (window.resetsAt) item.append(quotaDetail(`Đặt lại ${localDate(window.resetsAt * 1000)} ICT · ${remainingLabel(window.resetsAt)}`));
      return item;
    });
    const credit = hasSample && provider === "codex" ? quota.credit : null;
    const creditBalance = typeof credit?.balance === "string" && /^\d+(?:\.\d+)?$/.test(credit.balance) && credit.unit === "credits";
    const creditText = credit?.unlimited === true ? "Không giới hạn" : creditBalance ? `${credit.balance} credits` :
      credit?.hasCredits === false ? "Không có credit" : credit?.hasCredits === true ? "Có credit · chưa có số dư" : "Nguồn chưa cung cấp số dư";
    rows.push(quotaDetail(`${provider === "codex" ? "Credit subscription · Codex App Server" : "Credit subscription · Claude Code"} · ${creditText}`));
    if (credit?.resetsAt) rows.push(quotaDetail(`Credit đặt lại ${localDate(credit.resetsAt * 1000)} ICT`));
    const resetCredits = hasSample && provider === "codex" ? quota.resetCredits : null;
    if (Number.isInteger(resetCredits?.availableCount) && resetCredits.availableCount >= 0) {
      const expiry = resetCredits.expiresAt ? ` · Hết hạn ${localDate(resetCredits.expiresAt * 1000)} ICT` : "";
      rows.push(quotaDetail(`Lượt đặt lại được cấp · ${resetCredits.availableCount}${expiry}`));
    }
    byId(`quota-${provider}-windows`).replaceChildren(...rows);
  });
}

async function readIntegrations(force = false) {
  if (!signedIn || (!remote && !status?.countdown) || integrationRead || (!force && performance.now() - integrationAt < 30000)) return;
  const expected = revision;
  integrationAt = performance.now();
  integrationRead = true;
  try {
    const next = remote ? await transport.integrations() : (await request("integrations")).data;
    if (expected !== revision) return;
    if (next.v !== 1 || !next.calendar || !next.quotas) throw new Error("Chưa có dữ liệu tích hợp hợp lệ.");
    integrations = next;
    if (byId("quota-feedback").dataset.tone === "source") feedback("quota-feedback");
  } catch (error) {
    if (expected !== revision) return;
    if (remote && error.status === 401) remoteFailure(error, "quota-feedback");
    else {
      if (integrations) {
        const markStale = (entry) => entry?.state === "live" ? { ...entry, state: "stale" } : entry;
        integrations = {
          ...integrations, calendar: markStale(integrations.calendar),
          quotas: Object.fromEntries(providers.map((id) => [id, markStale(integrations.quotas[id])])),
        };
      }
      feedback("quota-feedback", error.status === 404 ? "Nguồn tích hợp chưa khả dụng." : "Không đọc được dữ liệu hạn mức.", "source");
    }
  } finally {
    integrationRead = false;
    if (expected === revision) { renderQuotas(); renderTick(); }
  }
}

const quotaPets = providers.map((provider) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 48;
  document.querySelector(`.${provider}-mascot`).replaceChildren(canvas);
  return [provider, canvas.getContext("2d")];
});
let quotaPetClock;
function syncQuotaMotion() {
  clearInterval(quotaPetClock);
  quotaPets.forEach(([provider, ctx]) => window.paintDeskQuotaPet(ctx, provider, 0));
  if (location.hash !== "#quota" || document.hidden || reducedMotion.matches || !signedIn) return;
  const start = performance.now();
  let previous;
  quotaPetClock = setInterval(() => {
    const elapsed = performance.now() - start;
    const phase = elapsed % 3600;
    const pose = phase >= 1600 && phase < 1900;
    if (pose === previous) return;
    previous = pose;
    quotaPets.forEach(([provider, ctx]) => window.paintDeskQuotaPet(ctx, provider, elapsed));
  }, 50);
}

function showView() {
  const quota = location.hash === "#quota";
  const leavingQuota = !quota && !byId("quota-view").hidden;
  byId("dashboard-view").hidden = quota;
  byId("quota-view").hidden = !quota;
  if (quota) byId("quota-link").setAttribute("aria-current", "page");
  else byId("quota-link").removeAttribute("aria-current");
  syncQuotaMotion();
  if (quota) {
    byId("quota-title").focus();
    renderQuotas();
    void readIntegrations();
  } else if (leavingQuota) {
    byId("quota-link").focus();
  }
}
window.addEventListener("hashchange", showView);
byId("quota-refresh").addEventListener("click", () => { void readIntegrations(true); });

function renderTick() {
  const timer = currentTimer();
  if (timer) {
    label("timer-remaining", clockText(timer.remainingSeconds));
    label("timer-state", `${timer.phase === "break" ? "Nghỉ ngắn" : "Tập trung"} · ${timerNames[timer.state] || "—"}`);
    label("timer-durations", `${timer.focusMinutes} phút tập trung / ${timer.breakMinutes} phút nghỉ`);
  }
  renderPreview(timer);
  renderCalendar();
  if (location.hash === "#quota") renderQuotas();
  renderMonth();
  renderCountdown();
}

function renderControls() {
  const ready = online && !!status;
  const working = busy || remoteCommand?.state === "queued";
  modes.forEach((button) => {
    const unavailable = !ready || (["countdown", ...providers].includes(button.dataset.mode) && !status?.countdown);
    button.disabled = unavailable;
    button.setAttribute("aria-disabled", String(unavailable || working));
    const active = status?.mode === button.dataset.mode;
    button.setAttribute("aria-pressed", String(active));
    const indicator = button.querySelector(".mode-state");
    if (indicator) indicator.textContent = active ? "Đang chiếu" : "";
  });
  byId("quota-link").classList.toggle("quota-active", providers.includes(status?.mode));
  byId("quota-link").querySelector(".mode-state").textContent = providers.includes(status?.mode) ? "Đang chiếu" : "";
  byId("countdown-fields").disabled = !ready || working || !status?.countdown;
  byId("timer-actions").disabled = !ready || !status?.pomodoro;
  timerButtons.forEach((button) => {
    const action = button.dataset.timer;
    const running = status?.pomodoro?.state === "running";
    const unavailable = action === "pause" ? !running : action === "start" && running;
    button.setAttribute("aria-disabled", String(!ready || working || unavailable));
  });
  const start = timerButtons[0];
  const timer = status?.pomodoro;
  start.textContent = timer?.state === "paused" ? "Tiếp tục" :
    timer?.state === "completed" ? (timer.phase === "focus" ? "Bắt đầu nghỉ" : "Bắt đầu tập trung") : "Bắt đầu";
  byId("settings-fields").disabled = !ready || !config;
  byId("message-fields").disabled = !ready || !config;
  byId("sync-time").disabled = !status?.wifi.connected;
  byId("restart").disabled = !ready;
  byId("show-message").disabled = status?.mode === "message";
  document.querySelectorAll("#settings-form button, #message-form button, #restart").forEach((button) => {
    button.setAttribute("aria-disabled", String(working || button.matches(":disabled")));
  });
}

function renderStatus() {
  byId("fixture-banner").hidden = !fixture;
  byId("offline-banner").hidden = online || !byId("offline-message").textContent;
  byId("connection").title = remote && lastSeenAt ? `Lần thấy gần nhất ${localDate(lastSeenAt * 1000)}` : "";
  if (remote) {
    const messages = {
      queued: "Đang chờ ESP32 xác nhận lệnh…",
      applied: "ESP32 đã áp dụng lệnh gần nhất.",
      rejected: "ESP32 từ chối lệnh gần nhất.",
      expired: "Lệnh gần nhất đã hết hạn.",
    };
    const state = remoteCommand?.state === "applied" && !hasAppliedAck(remoteCommand) ? undefined : remoteCommand?.state;
    byId("remote-feedback").hidden = !messages[state];
    feedback("remote-feedback", messages[state] || "", { queued: "pending", applied: "success", rejected: "error", expired: "error" }[state]);
  }
  const badge = byId("connection");
  badge.dataset.state = online ? (fixture ? "fixture" : "online") : restartUntil ? "fixture" : "offline";
  label("connection", online ? (fixture ? "Thiết bị giả lập" : "Đã kết nối") : restartUntil ? "Đang khởi động lại" : remoteConnection === "stale" ? "Dữ liệu đã cũ" : "Mất kết nối");

  if (status) {
    label("device-name", status.deviceName || "Bảng điều khiển");
    label("wifi-status", status.wifi.connected ? "Đã kết nối" : "Mất kết nối");
    const { ip, hostname } = status.wifi;
    label("wifi-ip", ip || "—");
    label("wifi-hostname", hostname || "");
    byId("wifi-ip").hidden = !ip && !!hostname;
    byId("wifi-hostname").hidden = !hostname;
    label("firmware", status.firmwareVersion);
    label("uptime", uptimeText(status.uptimeSeconds));
    label("time-status", status.time.synced ? "Đã đồng bộ" : "Chưa đồng bộ");
    const git = status.github;
    label("github-sync", git.lastSync
      ? `${localDate(git.lastSync)}${git.state === "stale" ? " · Dữ liệu cũ" : ""}`
      : githubNames[git.state] || "—");
  } else {
    label("device-name", "Bảng điều khiển");
  }
  renderControls();
  renderTick();
}

function messageCount() {
  label("message-count", `${messageText.value.length} / 160`);
}

function fillConfig(next) {
  const currentModes = !!status?.countdown;
  const startup = settingsForm.elements.startupMode;
  [...startup.options].forEach((option) => {
    option.hidden = option.hasAttribute("data-current-mode") && !currentModes ||
      option.hasAttribute("data-legacy-mode") && currentModes && option.value !== next.startupMode;
    option.disabled = option.hidden;
  });
  rotationModes.forEach((box) => {
    const item = box.closest("label");
    item.hidden = item.hasAttribute("data-current-mode") && !currentModes ||
      item.hasAttribute("data-legacy-mode") && currentModes && !next.rotation.modes.includes(box.value);
    box.disabled = item.hidden;
  });
  const fields = settingsForm.elements;
  if (!settingsDirty) {
    ["deviceName", "githubUsername", "githubProxyUrl", "theme", "startupMode"].forEach((key) => {
      fields[key].value = next[key] ?? "";
    });
    fields.clockShowSeconds.checked = next.clockShowSeconds;
    fields.rotationEnabled.checked = next.rotation.enabled;
    fields.rotationInterval.value = next.rotation.intervalSeconds;
    rotationModes.forEach((box) => { box.checked = next.rotation.modes.includes(box.value); });
  }
  if (!messageDirty && next.message) {
    const message = messageForm.elements;
    message.text.value = next.message.text;
    message.alignment.value = next.message.alignment;
    message.color.value = next.message.color.toLowerCase();
    message.size.value = next.message.size;
    messageCount();
  }
  config = next;
}

function githubRequestKey() {
  const { state, lastSync, error } = status.github;
  return JSON.stringify([state, lastSync, error, config?.githubUsername, config?.githubProxyUrl]);
}

async function refreshGithub(expectedRevision) {
  const { state, lastSync } = status.github;
  const key = githubRequestKey();
  if (key === githubKey || fetchingGithub) return;
  fetchingGithub = true;
  const current = () => expectedRevision === revision && key === githubRequestKey();
  try {
    const { data } = await request("github");
    if (!current()) return;
    github = data;
    if (data.state === state && data.lastSync === lastSync) githubKey = key;
  } catch (error) {
    if (!current()) return;
    github = github && ["live", "stale"].includes(github.state) ? { ...github, state: "stale", error: error.message } :
      { ...emptyGithub, state: "error", error: error.message };
  } finally {
    fetchingGithub = false;
  }
  renderTick();
}

function cancelStatusRead() {
  clearTimeout(pollTimer);
  pollRead?.abort();
}

function schedulePoll(delay) {
  clearTimeout(pollTimer);
  if (!document.hidden && signedIn) pollTimer = setTimeout(poll, delay);
}

async function poll() {
  if (busy || pollRead || document.hidden || !signedIn) return;
  if (remote) return pollRemote();
  if (Date.now() < restartUntil) {
    schedulePoll(restartUntil - Date.now());
    return;
  }
  const read = pollRead = new AbortController();
  const expectedRevision = revision;
  try {
    const response = await request("status", undefined, read.signal);
    if (expectedRevision !== revision) return;
    const next = response.data;
    if (!modeNames[next.mode] || !next.wifi || !next.time || !next.github) {
      throw new Error("Phản hồi trạng thái thiếu dữ liệu cần thiết.");
    }
    const rebooted = restartUntil !== 0 || next.uptimeSeconds < (status?.uptimeSeconds ?? 0);
    if (rebooted) {
      githubKey = null;
      github = null;
      if (restartUntil) feedback("restart-feedback", "Đã kết nối lại với thiết bị.", "success");
    }
    const shouldReadConfig = !online || !config || rebooted || performance.now() - lastConfigRead >= 30000;
    restartUntil = 0;
    fixture ||= response.fixture;
    status = next;
    clockAt = timerAt = countdownAt = performance.now();
    online = true;
    renderStatus();

    if (shouldReadConfig) {
      try {
        const { data } = await request("config", undefined, read.signal);
        if (expectedRevision !== revision) return;
        if (config && (config.githubUsername !== data.githubUsername || config.githubProxyUrl !== data.githubProxyUrl)) {
          github = null;
          githubKey = null;
        }
        fillConfig(data);
        lastConfigRead = performance.now();
        if (byId("settings-feedback").dataset.tone === "load") feedback("settings-feedback");
        if (byId("message-feedback").dataset.tone === "load") feedback("message-feedback");
        renderStatus();
      } catch (error) {
        if (expectedRevision !== revision) return;
        const notice = `Không tải được cấu hình. ${error.message}`;
        feedback("settings-feedback", notice, "load");
        feedback("message-feedback", notice, "load");
      }
    }
    void refreshGithub(expectedRevision);
    void readIntegrations();
  } catch (error) {
    if (expectedRevision !== revision) return;
    online = false;
    if (restartUntil) restartUntil = 0;
    label("offline-message", `Không đọc được trạng thái ESP32. ${error.message} Trang sẽ tự thử lại.`);
    renderStatus();
  } finally {
    if (pollRead === read) pollRead = undefined;
    schedulePoll(expectedRevision === revision ? (online && (status.pomodoro?.state === "running" || status.countdown?.state === "running") ? 2000 : 4000) : 0);
  }
}

const remoteErrors = {
  setup_required: "Dịch vụ quản trị từ xa chưa được thiết lập.",
  invalid_credentials: "Mật khẩu không đúng.",
  rate_limited: "Quá nhiều lần thử. Hãy thử lại sau.",
  device_offline: "Thiết bị đang ngoại tuyến.",
  command_pending: "Thiết bị đang chờ xử lý một lệnh khác.",
  id_conflict: "Không thể xác nhận mã lệnh. Hãy kiểm tra trạng thái trước khi thử lại.",
};

function setSignedIn(value) {
  signedIn = value;
  syncQuotaMotion();
  byId("auth").hidden = value;
  byId("main").hidden = !value;
  byId("logout").hidden = !value;
  document.querySelector(".nav").hidden = !value;
  document.querySelector(".skip-link").hidden = !value;
  if (!value) {
    cancelStatusRead();
    transport.clearSession();
    online = false;
    status = config = github = remoteCommand = undefined;
    renderCalendar();
    remoteConnection = "offline";
    integrations = undefined;
    integrationAt = -Infinity;
    countdownDraft = false;
    selectedMonth = undefined;
    renderQuotas();
    label("offline-message", "");
    for (const id of ["device-name", "wifi-status", "wifi-ip", "wifi-hostname", "active-mode", "firmware", "uptime", "time-status", "github-sync"]) label(id, "—");
    label("timer-remaining", "--:--");
    label("timer-state", "—");
    label("timer-durations", "");
    messageForm.reset();
    settingsForm.reset();
    byId("wifi-hostname").hidden = true;
    byId("wifi-ip").hidden = false;
    for (const id of ["mode-feedback", "timer-feedback", "message-feedback", "settings-feedback", "calendar-feedback", "quota-feedback", "countdown-feedback"]) feedback(id);
    renderStatus();
    lastSeenAt = undefined;
    messageDirty = settingsDirty = false;
    revision += 1;
    byId("auth-title").focus();
  }
}

function remoteFailure(error, target) {
  if (error.status === 401 && signedIn) {
    setSignedIn(false);
    feedback("auth-feedback", "Phiên đã hết hạn. Đăng nhập lại để tiếp tục.", "error");
  } else {
    feedback(target, remoteErrors[error.code] || (error.status ? "Máy chủ từ chối yêu cầu." : error.message), "error");
  }
}

async function pollRemote() {
  const read = pollRead = new AbortController();
  const expected = revision;
  try {
    const snapshot = await transport.state(read.signal);
    if (expected !== revision) return;
    remoteConnection = snapshot.connection;
    lastSeenAt = snapshot.lastSeenAt;
    remoteCommand = snapshot.command;
    const fresh = snapshot.connection === "online" && !!snapshot.status;
    if (!status || lastSeenAt !== status.lastSeenAt || snapshot.command?.state !== status.commandState) {
      status = snapshot.status ? { ...snapshot.status, lastSeenAt, commandState: snapshot.command?.state } : undefined;
      // The snapshot clock and timer are as of lastSeenAt, not the fetch time.
      const age = lastSeenAt ? Math.max(0, Date.now() - lastSeenAt * 1000) : 0;
      clockAt = timerAt = countdownAt = performance.now() - age;
    }
    if (snapshot.config) fillConfig(snapshot.config);
    else config = undefined;
    github = snapshot.github;
    online = fresh;
    const seen = lastSeenAt ? ` · Lần thấy gần nhất ${localDate(lastSeenAt * 1000)}` : "";
    label("offline-message", (remoteConnection === "stale"
      ? "ESP32 chưa cập nhật gần đây. Điều khiển tạm khóa."
      : "Chưa nhận được kết nối từ ESP32.") + seen);
    renderStatus();
    void readIntegrations();
  } catch (error) {
    if (expected !== revision) return;
    online = false;
    remoteConnection = "offline";
    if (error.status === 401) remoteFailure(error, "remote-feedback");
    else {
      label("offline-message", remoteErrors[error.code] || "Không đọc được trạng thái từ máy chủ.");
      renderStatus();
    }
  } finally {
    if (pollRead === read) pollRead = undefined;
    if (signedIn) schedulePoll(expected === revision ? (remoteCommand?.state === "queued" ? 1000 : 4500) : 0);
  }
}

function hasAppliedAck(command) {
  return command?.state === "applied" && command.ack?.result === "applied" && command.ack.id === command.id;
}

async function sendRemote(path, payload, target) {
  busy = true;
  const expected = ++revision;
  cancelStatusRead();
  renderControls();
  feedback(target, "Đang gửi lệnh…", "pending");
  let refreshed = false;
  try {
    const accepted = await transport.send(path, payload);
    if (expected !== revision) return;
    remoteCommand = accepted;
    renderStatus();
    feedback(target, target === "mode-feedback" ? "Đang chờ ESP32…" : "Đang chờ ESP32 xác nhận…", "pending");
    let attempt = 0;
    const checkingSince = performance.now();
    while (remoteCommand.state === "queued") {
      const delay = document.hidden ? 3200 : [0, 650, 950, 1400][attempt] ?? 2000;
      attempt += 1;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (expected !== revision) return;
      try {
        const result = await transport.result(remoteCommand.id);
        if (expected !== revision) return;
        remoteCommand = result;
      } catch (error) {
        if (error.status === 401 || error.status === 404) throw error;
        if (performance.now() - checkingSince > 100000) throw error;
      }
      if (remoteCommand.state === "queued" && performance.now() - checkingSince > 100000) {
        throw new Error("Chưa xác nhận được kết quả. Đang tải lại trạng thái thiết bị.");
      }
    }
    const applied = hasAppliedAck(remoteCommand);
    if (remoteCommand.state === "applied" && !applied) throw new Error("Chưa nhận được xác nhận hợp lệ từ ESP32.");
    if (applied && path === "countdown" && payload.action === "configure" && countdownMatchesDraft(payload)) countdownDraft = false;
    if (applied && path === "config") {
      const current = settingsPayload();
      settingsDirty = JSON.stringify(payload) !== JSON.stringify({ theme: current.theme, clockShowSeconds: current.clockShowSeconds, rotation: current.rotation });
    }
    if (applied && path === "message") {
      const fields = messageForm.elements;
      messageDirty = fields.text.value !== payload.text || fields.alignment.value !== payload.alignment ||
        fields.color.value.toUpperCase() !== payload.color || Number(fields.size.value) !== payload.size;
    }
    const outcome = applied ? "ESP32 đã áp dụng lệnh." :
      remoteCommand.state === "expired" ? "Lệnh đã hết hạn." : "ESP32 từ chối lệnh.";
    feedback(target, outcome, applied ? "success" : "error");
    renderStatus();
    if (applied) {
      // Keep dependent controls locked until the authoritative post-ACK snapshot is rendered.
      await pollRemote();
      refreshed = true;
    }
  } catch (error) {
    if (expected !== revision) return;
    if (error.status === 404) feedback(target, "Không còn kết quả lệnh. Đang tải lại trạng thái thiết bị.", "error");
    else remoteFailure(error, target);
  } finally {
    busy = false;
    renderControls();
    if (!refreshed) schedulePoll(0);
  }
}

async function initRemote() {
  const locationUrl = new URL(location.href);
  const calendarResult = locationUrl.searchParams.get("calendar");
  if (calendarResult === "connected" || calendarResult === "failed") {
    locationUrl.searchParams.delete("calendar");
    locationUrl.hash = "calendar-tools";
    history.replaceState(null, "", locationUrl);
  }
  label("connection-kind", "TRUY CẬP TỪ XA");
  byId("cloud-settings-note").hidden = false;
  byId("address-detail").hidden = true;
  document.querySelectorAll("[data-local-only]").forEach((element) => {
    (element.closest("label") || element).hidden = true;
    if (element.matches("input")) {
      element.required = false;
      element.disabled = true;
    }
  });
  settingsForm.elements.startupMode.closest("label").hidden = true;
  const form = byId("auth-form");
  const input = byId("auth-password");
  const submit = form.querySelector("button");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    feedback("auth-feedback", "Đang xác thực…", "pending");
    try {
      if (!(await transport.session(input.value))) throw new Error("Không xác thực được phiên.");
      feedback("auth-feedback");
      setSignedIn(true);
      byId("main").focus();
      revealLinkedPanel();
      schedulePoll(0);
    } catch (error) {
      remoteFailure(error, "auth-feedback");
      input.focus();
    } finally {
      input.value = "";
      submit.disabled = false;
    }
  });
  byId("logout").addEventListener("click", async () => {
    const button = byId("logout");
    button.disabled = true;
    try {
      await transport.logout();
      setSignedIn(false);
      feedback("auth-feedback", "Đã đăng xuất.", "success");
    } catch (error) {
      remoteFailure(error, "remote-feedback");
      if (signedIn) byId("remote-feedback").hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  setSignedIn(false);
  submit.disabled = true;
  try {
    if (await transport.session()) {
      setSignedIn(true);
      revealLinkedPanel();
      if (calendarResult === "connected" || calendarResult === "failed") {
        const connected = calendarResult === "connected";
        feedback("calendar-feedback", connected ? "Đã kết nối Google Calendar." : "Chưa kết nối được Google Calendar. Hãy thử lại.", connected ? "success" : "error");
        byId("calendar-tools").querySelector("summary").focus({ preventScroll: true });
      }
      schedulePoll(0);
    }
  } catch (error) {
    remoteFailure(error, "auth-feedback");
    if (error.code === "setup_required") form.hidden = true;
  } finally {
    submit.disabled = false;
  }
}

async function command(path, payload, target, success, apply) {
  if (busy || !online || remoteCommand?.state === "queued") return;
  if (remote) return sendRemote(path, payload, target);
  busy = true;
  revision += 1;
  cancelStatusRead();
  renderControls();
  feedback(target, "Đang gửi yêu cầu…", "pending");
  try {
    const { data } = await request(path, payload);
    apply?.(data);
    feedback(target, success, "success");
    renderStatus();
  } catch (error) {
    const fieldNames = { "rotation.intervalSeconds": "rotationInterval", "rotation.modes": "rotationEnabled", "rotation.enabled": "rotationEnabled" };
    const fields = path === "config" ? settingsForm.elements : path === "message" ? messageForm.elements : null;
    fields?.namedItem(fieldNames[error.field] || error.field || "")?.focus?.();
    feedback(target, error.message, "error");
  } finally {
    busy = false;
    renderControls();
    if (path === "config") lastConfigRead = -Infinity;
    schedulePoll(0);
  }
}

function selectMode(mode, target) {
  command("display", { mode }, target, `Đã chọn ${modeNames[mode]}.`, (data) => {
    status.mode = data.mode;
    if (config) {
      if (settingsForm.elements.startupMode.value === config.startupMode) settingsForm.elements.startupMode.value = data.mode;
      config.startupMode = data.mode;
    }
  });
}

modes.forEach((button) => button.addEventListener("click", () => {
  selectMode(button.dataset.mode, providers.includes(button.dataset.mode) ? "quota-feedback" : "mode-feedback");
}));
byId("show-message").addEventListener("click", () => selectMode("message", "message-feedback"));
timerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    command("pomodoro", { action: button.dataset.timer }, "timer-feedback", "Đã cập nhật Pomodoro.", (data) => {
      status.pomodoro = data.pomodoro;
      timerAt = performance.now();
    });
  });
});

messageForm.addEventListener("input", () => {
  messageDirty = true;
  messageCount();
  messageText.removeAttribute("aria-invalid");
  feedback("message-feedback");
});
messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!config) return;
  const fields = messageForm.elements;
  if (/[^\x20-\x7e\n]/.test(fields.text.value)) {
    messageText.setAttribute("aria-invalid", "true");
    feedback("message-feedback", "Tin nhắn chỉ nhận ký tự ASCII và xuống dòng.", "error");
    messageText.focus();
    return;
  }
  const payload = { text: fields.text.value, alignment: fields.alignment.value, color: fields.color.value.toUpperCase(), size: Number(fields.size.value) };
  command("message", payload, "message-feedback", "Đã lưu tin nhắn.", (data) => {
    const editedWhileSaving = fields.text.value !== payload.text || fields.alignment.value !== payload.alignment ||
      fields.color.value.toUpperCase() !== payload.color || Number(fields.size.value) !== payload.size;
    messageDirty = editedWhileSaving;
    fillConfig({ ...config, message: data.message });
  });
});

settingsForm.addEventListener("input", () => {
  settingsDirty = true;
  feedback("settings-feedback");
});

function settingsPayload() {
  const fields = settingsForm.elements;
  const selected = rotationModes.filter((box) => box.checked && !box.disabled).map((box) => box.value);
  // Preserve device rotation order when a user only changes the interval or membership.
  const retained = config.rotation.modes.filter((mode) => selected.includes(mode));
  const ordered = [...retained, ...selected.filter((mode) => !retained.includes(mode))];
  return {
    deviceName: fields.deviceName.value,
    githubUsername: fields.githubUsername.value.trim(),
    githubProxyUrl: fields.githubProxyUrl.value.trim(),
    theme: fields.theme.value,
    startupMode: fields.startupMode.value,
    clockShowSeconds: fields.clockShowSeconds.checked,
    rotation: { enabled: fields.rotationEnabled.checked, intervalSeconds: Number(fields.rotationInterval.value), modes: ordered },
  };
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!config) return;
  const fields = settingsForm.elements;
  const payload = settingsPayload();
  const url = payload.githubProxyUrl;
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { /* The inline error below covers invalid URLs. */ }
    if (parsed?.protocol !== "https:" || parsed.username || parsed.password || /[?#]/.test(url) || url.endsWith("/")) {
      feedback("settings-feedback", "Dùng URL HTTPS đầy đủ, bỏ thông tin đăng nhập, tham số, đoạn # và dấu / cuối.", "error");
      fields.githubProxyUrl.focus();
      return;
    }
  }
  const minimum = payload.rotation.enabled ? 2 : 1;
  if (payload.rotation.modes.length < minimum) {
    feedback("settings-feedback", `Chọn ít nhất ${minimum} chế độ luân phiên.`, "error");
    rotationModes[0].focus();
    return;
  }
  if (remote) {
    const { theme, clockShowSeconds, rotation } = payload;
    command("config", { theme, clockShowSeconds, rotation }, "settings-feedback");
    return;
  }
  command("config", payload, "settings-feedback", "Đã lưu cài đặt.", (data) => {
    if (config.githubUsername !== data.config.githubUsername || config.githubProxyUrl !== data.config.githubProxyUrl) {
      githubKey = null;
      github = null;
    }
    settingsDirty = JSON.stringify(settingsPayload()) !== JSON.stringify(payload);
    fillConfig(data.config);
  });
});

byId("sync-time").addEventListener("click", () => {
  command("time/sync", {}, "settings-feedback", "Đã yêu cầu ESP32 đồng bộ giờ qua NTP.");
});
byId("restart").addEventListener("click", () => {
  if (busy || !online) return;
  restartDialog.returnValue = "";
  restartDialog.showModal();
});
restartDialog.addEventListener("close", () => {
  if (restartDialog.returnValue !== "restart") return;
  command("restart", { confirm: true }, "restart-feedback", "Thiết bị đang khởi động lại.", () => {
    online = false;
    restartUntil = Date.now() + 2500;
    label("offline-message", "Thiết bị đang khởi động lại. Trang sẽ tự kết nối lại.");
  });
});
byId("retry").addEventListener("click", () => schedulePoll(0));
reducedMotion.addEventListener("change", (event) => {
  if (event.matches) previewCanvas.getAnimations().forEach((animation) => animation.cancel());
  syncPetMotion();
  syncQuotaMotion();
});
petMotionButton.addEventListener("click", () => {
  petPaused = !petPaused;
  syncPetMotion();
});
new IntersectionObserver(([entry]) => {
  previewVisible = entry.isIntersecting;
  syncPetMotion();
}).observe(previewCanvas);
document.addEventListener("visibilitychange", () => {
  syncPetMotion();
  syncQuotaMotion();
  if (!document.hidden) schedulePoll(0);
});
setInterval(() => {
  if (!document.hidden && status) renderTick();
}, 500);
showView();
if (remote) initRemote();
else { byId("main").hidden = false; poll(); }
