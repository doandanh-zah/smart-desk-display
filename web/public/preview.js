"use strict";

window.paintDeskQuotaPet = (() => {
  // Mirrors firmware/src/display/QuotaPets.h.
  const sprites = {
    codex: { s: "#8975eb", g: "#9beaff", d: "#302458", rows: [
      ".......g........",
      ".......s........",
      "......sss.......",
      "....ssssssss....",
      "...ssssssssss...",
      "..ssddddddddss..",
      ".sssddgddgddsss.",
      ".sssddgddgddsss.",
      "..ssddddddddss..",
      "...ssssssssss...",
      "....ssssssss....",
      ".....s...s......",
      "....sss.sss.....",
      "...ssss.ssss....",
      "................",
      "................",
    ] },
    claude: { s: "#df8054", g: "#ffe2ac", d: "#582c21", rows: [
      "...s...s....s...",
      "................",
      "s.....ssss.....s",
      "....ssssssss....",
      "...ssssssssss...",
      "...ssssssssss...",
      "..ssssssssssss..",
      "s.sssdssssds.s.s",
      "..ssggssssggss..",
      "..ssssddddssss..",
      "...ssssssssss...",
      "...ssssssssss...",
      "....ssssssss....",
      "s.....ssss.....s",
      "................",
      "...s...s....s...",
    ] },
  };
  return (ctx, provider, elapsed, ox = 0, oy = 0) => {
    const sprite = sprites[provider];
    const phase = elapsed % 3600;
    const motion = phase >= 1600 && phase < 1900;
    ctx.clearRect(ox, oy, 48, 48);
    sprite.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        let value = row[x];
        if (motion && provider === "codex") {
          if (y === 0 && (x === 6 || x === 8)) value = "g";
          if (y === 6 && (x === 6 || x === 9)) value = "d";
        }
        if (motion && provider === "claude") {
          if (y === 7 && (x === 5 || x === 10)) value = "s";
          if (y === 8 && (x === 5 || x === 10)) value = "d";
          if ((y === 1 || y === 14) && (x === 2 || x === 13)) value = "g";
        }
        if (value === ".") continue;
        ctx.fillStyle = sprite[value];
        ctx.fillRect(ox + x * 3, oy + y * 3, 3, 3);
      }
    });
  };
})();

window.createDeskPreview = function createDeskPreview(canvas) {
  const ctx = canvas.getContext("2d");
  const palettes = {
    dark: { bg: "#0d1117", surface: "#161b22", line: "#30363d", text: "#f0f6fc", muted: "#9da7b3", accent: "#39d353", warning: "#e3b341", error: "#ff7b72" },
    light: { bg: "#ffffff", surface: "#f6f8fa", line: "#d0d7de", text: "#1f2328", muted: "#57606a", accent: "#116329", warning: "#764500", error: "#a40e26" },
  };
  const githubPalettes = {
    dark: {
      bg: "#101419", surface: "#1b212a", line: "#39434f", text: "#eff8f2", muted: "#a5beb4",
      accent: "#8de1b5", warning: "#eac47d", error: "#ffaca5",
      levels: ["#303a46", "#125638", "#21845a", "#42b978", "#8cf2ac"],
    },
    light: {
      bg: "#f5f6f8", surface: "#ffffff", line: "#d3d9e1", text: "#142820", muted: "#4b645a",
      accent: "#216441", warning: "#784d14", error: "#a42f2a",
      levels: ["#cad9cf", "#a6cdae", "#6dae82", "#368050", "#195c37"],
    },
  };
  // Sprite and timing mirror firmware/src/display/GitHubPet.h.
  const petColors = { ".": "#f8db6a", "K": "#171913", "H": "#422d1b", "D": "#2f3736", "L": "#baae94", "S": "#fcc695", "T": "#e89d70", "W": "#efe4c9", "O": "#f89f31", "R": "#ba4713" };
  const petPixels = [
    "..........KKKKKKKK.......",
    ".......KKKHHHHHHHHK......",
    "......KHHHHHHKKKKKKK.....",
    ".....KHHHHHHKLLDDDDLK....",
    ".....KHHHKKKKLLLLLLLK....",
    ".....KHHKDDDKLLDDDDLK....",
    ".....KKKDDDDKDLLLLLLK....",
    "....KDDDDDDDKLLDDDDLK....",
    "....KKKKKKKKKKKKKKKKKKK..",
    ".....KHHHKTSSSSSSSSSK....",
    ".....KKKHKSSKKKSSSKKK....",
    ".....KSSKKSSSSKSSSKSK....",
    ".....KSTSKSSSSKSSSKSK....",
    ".....KTTSSSSSSSSSSSSK....",
    "......KTTSSSSSSSSTKSK....",
    ".......KKTSSSSSSSSSSK....",
    "........KTSSSSKKKKKSK....",
    "........KSTSSSSSSSSK.....",
    ".......KKSSKKSSSSSK......",
    "......KLKKSTKKKKKK.......",
    "......KLWKKKTTTKLLK......",
    ".....KKLWWWKKKKKLLLK.....",
    "....KLWSSWWWWKRKKWWKK....",
    "...KLWWWWWWWKKRDDWKWWK...",
    "..KLLWWWWWWKKDRDDKWWWWK..",
    "..KLWWWWWWWKOORKOKWWWWK..",
    ".KWLWWWWWWWKOORKOKWWWWWK.",
    ".KLWWWWWWWWKOORKOKLWWWWK.",
    ".KSWWWWLWWKOOORKOOKWWWWK.",
    "KLLWWWWLWWKOOORKOOKWWWWWK",
    "KLWWWWSLWWKOOORKOOKWWWWWK",
  ];
  const timerStates = { idle: "READY", running: "RUNNING", paused: "PAUSED", completed: "COMPLETE" };
  const number = new Intl.NumberFormat("en-US");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad = (value) => String(value).padStart(2, "0");
  const metric = (value) => value == null ? "--" : number.format(value);
  let color;
  let previousFrame = "";
  let previousMode;
  let petElapsed = 0;
  let previousPetPose;

  function box(x, y, width, height, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
  }

  function text(value, x, y, size, fill, align = "left") {
    ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = align;
    ctx.fillStyle = fill;
    ctx.fillText(value, x, y);
  }

  function frame(title, subtitle, footer, tone = color.muted) {
    text(title, 16, 14, 15, color.text);
    text(subtitle, 16, 35, 11, color.muted);
    box(16, 54, 288, 1, color.line);
    box(16, 206, 288, 1, color.line);
    text(footer, 16, 219, 10, tone);
  }

  function githubFooter(data) {
    if (data.state === "demo") return "DEMO DATA";
    if (data.state === "stale") return data.lastSync ? `CACHED  ${data.lastSync.slice(0, 16).replace("T", " ")}Z` : "CACHED DATA";
    if (data.state === "loading") return "WAITING FOR GITHUB";
    if (data.state === "error") return "GITHUB SYNC ERROR";
    return data.lastSync ? `SYNC  ${data.lastSync.slice(0, 16).replace("T", " ")}Z` : "GITHUB";
  }

  function stats(data, deviceName) {
    const tone = { demo: color.warning, stale: color.warning, error: color.error }[data.state] || color.muted;
    frame("DEVELOPER STATS", data.username ? `@${data.username}` : deviceName, githubFooter(data), tone);
    [
      [16, 66, 140, "CONTRIBUTIONS", metric(data.totalContributions)],
      [164, 66, 140, "STREAK / DAYS", metric(data.currentStreak)],
      [16, 136, 288, "PUBLIC REPOSITORIES", metric(data.repositoryCount)],
    ].forEach(([x, y, width, label, value]) => {
      box(x, y, width, 62, color.surface);
      text(label, x + 12, y + 11, 10, color.muted);
      text(value, x + 12, y + 28, 19, color.text);
    });
  }

  function roundedBox(x, y, width, height, radius, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  }

  function githubPetPose(elapsed) {
    const phase = elapsed % 4800;
    if (phase >= 1400 && phase < 1600) return "blink";
    if (phase >= 3000 && phase < 3460) return "smile";
    return "idle";
  }

  function githubPetPixel(pose, x, y) {
    if (pose === "blink" && y >= 10 && y <= 12 &&
        ((x >= 12 && x <= 14) || (x >= 18 && x <= 19))) {
      return y === 12 ? "K" : "S";
    }
    if (pose === "smile") {
      if (y === 16 && x >= 14 && x <= 18) return x === 14 || x === 18 ? "K" : "S";
      if (y === 17 && x >= 15 && x <= 17) return "K";
    }
    return petPixels[y][x];
  }

  function paintGithubPet(pose, previous) {
    petPixels.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const pixel = githubPetPixel(pose, x, y);
        const old = previous ? githubPetPixel(previous, x, y) : ".";
        if (old !== pixel) box(21 + x * 2, 24 + y * 2, 2, 2, petColors[pixel]);
      }
    });
  }

  function github(data, username, localEpoch, theme) {
    const palette = githubPalettes[theme] || githubPalettes.dark;
    box(0, 0, 320, 240, palette.bg);
    roundedBox(14, 14, 64, 72, 6, petColors["."]);

    const title = username || "GitHub";
    if (title.length > 36) {
      text(title.slice(0, 36), 89, 30, 10, palette.text);
      text(title.slice(36), 89, 40, 10, palette.text);
    } else {
      const [y, size] = title.length <= 12 ? [28, 30] : title.length <= 18 ? [32, 20] : [36, 10];
      text(title, 89, y, size, palette.text);
    }
    text("DUT SUPERTEAM UNIVERSITY CLUB", 89, 57, 10, palette.muted);
    text("SUPERTEAM VIETNAM", 89, 69, 10, palette.muted);

    roundedBox(12, 92, 296, 91, 4, palette.surface);
    const hasLevels = /^[0-4]{364}$/.test(data.levels || "");
    text(`${hasLevels ? (data.totalContributions ?? "--") : "--"} contrib. / 52w`, 24, 100, 10, palette.text);
    text("24 WEEKS", 296, 100, 10, palette.muted, "right");
    if (hasLevels) {
      for (let index = 0; index < 24 * 7; index += 1) {
        const level = data.levels[28 * 7 + index];
        roundedBox(29 + Math.floor(index / 7) * 11, 113 + index % 7 * 8, 9, 6, 1, palette.levels[level]);
      }
    } else {
      text("No contribution data", 160, 139, 10, palette.muted, "center");
    }

    text("Less", 108, 173, 9, palette.muted);
    palette.levels.forEach((fill, index) => roundedBox(138 + 10 * index, 174, 8, 6, 1, fill));
    text("More", 190, 173, 9, palette.muted);

    const time = localEpoch == null ? null : new Date(localEpoch * 1000);
    const hours = time ? `${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}` : "--:--";
    text("TIME / ICT", 16, 188, 10, palette.muted);
    text(hours, 16, 199, 20, palette.text);
    text("STREAK / DAYS", 304, 188, 10, palette.muted, "right");
    text(String(hasLevels ? (data.currentStreak ?? "--") : "--"), 304, 199, 20, palette.accent, "right");
    box(16, 218, 288, 1, palette.line);

    const sync = data.lastSync || "--";
    const status = {
      demo: "DEMO  /  Sample data", loading: "SYNCING  /  Waiting for GitHub",
      live: `SYNCED  /  ${sync}`, stale: `CACHED  /  ${sync}`, error: "GITHUB ERROR",
    }[data.state];
    const tone = { demo: palette.warning, stale: palette.warning, error: palette.error, live: palette.accent }[data.state] || palette.muted;
    const detail = {
      demo: "Set GitHub username and proxy in dashboard",
      loading: data.error,
      stale: data.error || "Refresh failed",
      error: data.error || "Check account, proxy or Wi-Fi",
    }[data.state];
    if (status) text(status, 16, 222, 10, tone);
    if (detail) text(detail.slice(0, 48), 16, 232, 8, palette.muted);
  }

  function ictStamp(epoch, year = false) {
    return epoch ? new Date((epoch + 7 * 3600) * 1000).toISOString().slice(year ? 0 : 5, 16).replace("T", " ") : "--";
  }

  function sourceStatus(data) {
    return { live: "LIVE", stale: "STALE", unsupported: "UNSUPPORTED", error: "ERROR" }[data?.state] || "NOT CONNECTED";
  }

  function clockCalendar(epoch, showSeconds, deviceName, calendar) {
    const date = epoch == null ? null : new Date(epoch * 1000);
    const hasCalendar = ["live", "stale"].includes(calendar.state);
    const event = hasCalendar ? calendar.events?.[0] : undefined;
    const start = event ? (event.allDay ? "ALL DAY" : ictStamp(event.start)) : (date ? "ICT" : "NTP PENDING");
    const title = event ? (event.title || "Calendar event") : (hasCalendar ? "No upcoming events" : sourceStatus(calendar));
    frame("CLOCK + CALENDAR", deviceName, "");
    text(start, 16, 220, 9, color.muted);
    text(Array.from(title).slice(0, 34).join(""), 304, 220, 9, color.text, "right");
    roundedBox(151, 68, 153, 126, 4, color.surface);
    text(date ? `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : "--:--", 16, 91, 36, color.text);
    if (!date) {
      text("Waiting for date", 228, 126, 10, color.muted, "center");
      text("--", 16, 154, 10, color.muted);
      return;
    }
    if (showSeconds) text(pad(date.getUTCSeconds()), 16, 128, 18, color.muted);
    text(new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(date).toUpperCase(), 16, 154, 10, color.muted);
    text(date.toISOString().slice(0, 10), 16, 171, 10, color.text);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const monthName = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date).toUpperCase();
    text(`${monthName} ${year}`, 161, 78, 10, color.text);
    ["S", "M", "T", "W", "T", "F", "S"].forEach((day, index) => text(day, 168 + index * 19, 95, 9, color.muted, "center"));
    for (let day = 1; day <= last; day += 1) {
      const index = day + first - 1;
      const x = 160 + index % 7 * 19;
      const y = 109 + Math.floor(index / 7) * 12;
      const today = day === date.getUTCDate();
      if (today) roundedBox(x, y - 1, 17, 10, 2, color === palettes.light ? "#368050" : "#42b978");
      text(String(day), x + 8, y, 9, today ? (color === palettes.light ? "#ffffff" : "#0d1117") : color.text, "center");
    }
  }

  function durationText(seconds) {
    return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(pad).join(":");
  }

  function countdown(data, deviceName) {
    const states = { idle: "READY", running: "RUNNING", paused: "PAUSED", completed: "COMPLETE", waiting_for_time: "WAITING FOR NTP" };
    frame("COUNTDOWN", deviceName, states[data?.state] || "NOT CONFIGURED");
    const target = data?.kind === "target";
    text(target ? "TARGET DATE" : "DURATION", 160, 72, 10, color.accent, "center");
    const seconds = data?.remainingSeconds;
    const hms = seconds == null ? "--:--:--" : seconds < 360000 ? durationText(seconds) :
      `${Math.floor(seconds / 86400)}d ${pad(Math.floor(seconds / 3600) % 24)}h`;
    text(hms, 160, 99, hms.length > 8 ? 38 : 49, color.text, "center");
    const when = target ? `${ictStamp(data.targetEpochSeconds, true)} ICT` :
      data?.durationSeconds ? `${durationText(data.durationSeconds)} duration` : "Set a duration in the dashboard";
    text(when, 160, 168, 10, color.muted, "center");
  }

  function quota(provider, data, theme) {
    const accent = provider === "codex"
      ? (theme === "light" ? "#5940a2" : "#b6a7ff")
      : (theme === "light" ? "#9c411d" : "#f9a977");
    const state = sourceStatus(data);
    text(provider.toUpperCase(), 85, 19, 30, color.text);
    text("SUBSCRIPTION USAGE", 85, 46, 10, accent);
    box(16, 68, 288, 1, color.line);
    box(16, 202, 288, 1, color.line);
    const windows = ["LIVE", "STALE"].includes(state) ? data.windows || [] : [];
    const remainingWindows = [300, 10080].map((minutes) => windows.find((entry) => entry.windowMinutes === minutes ||
      (entry.windowMinutes == null && entry.id === (minutes === 300 ? "five_hour" : "seven_day"))));
    for (let index = 0; index < 2; index += 1) {
      const window = remainingWindows[index];
      const y = 77 + 60 * index;
      text(index === 0 ? "5H USAGE" : "7D USAGE", 16, y, 10, color.muted);
      const used = window?.usedPercent;
      const known = Number.isFinite(used) && used >= 0 && used <= 100;
      text(known ? `${Math.round(used)}%` : "--", 304, y, 20, accent, "right");
      box(16, y + 20, 288, 6, color.surface);
      if (known) box(16, y + 20, Math.floor(288 * used / 100), 6, accent);
      text(window?.resetsAt ? `Reset ${ictStamp(window.resetsAt)} ICT` : "Reset --", 16, y + 34, 10, color.muted);
    }
    text(state, 16, 213, 10, state === "STALE" ? color.warning : state === "ERROR" ? color.error : color.muted);
    const credit = provider === "codex" && ["LIVE", "STALE"].includes(state) ? data.credit : null;
    const balance = credit?.unit === "credits" && typeof credit.balance === "string" && /^\d+(?:\.\d+)?$/.test(credit.balance) && credit.balance.length <= 20;
    text(credit?.unlimited ? "CREDIT UNLIMITED" : balance ? `CREDIT ${credit.balance}` : credit?.hasCredits === true ? "CREDIT AVAILABLE" : credit?.hasCredits === false ? "CREDIT NONE" : "CREDIT N/A", 304, 213, 10, color.muted, "right");
    if (["LIVE", "STALE"].includes(state)) {
      const details = [];
      if (data.observedAt) details.push(`Updated ${ictStamp(data.observedAt)} ICT`);
      const count = provider === "codex" ? data.resetCredits?.availableCount : null;
      if (Number.isInteger(count) && count >= 0) details.push(`R: ${count}`);
      if (details.length) text(details.join(" / "), 16, 226, 10, color.muted);
    }
  }

  function clock(localEpoch, showSeconds, deviceName, wifi) {
    frame("CLOCK", deviceName, localEpoch == null ? "ICT / UTC+7   NTP PENDING" : "ICT / UTC+7   NTP SYNCED");
    text(wifi?.connected ? wifi.ip || "" : "Wi-Fi disconnected", 16, 230, 9, color.muted);
    if (localEpoch == null) {
      text("--:--", 160, 92, 58, color.text, "center");
      text("Waiting for NTP", 160, 163, 16, color.muted, "center");
      return;
    }
    const time = new Date(localEpoch * 1000);
    const hours = `${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}`;
    text(hours, 160, 92, 58, color.text, "center");
    if (showSeconds) text(pad(time.getUTCSeconds()), 272, 126, 16, color.muted);
    const date = `${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}`;
    text(`${days[time.getUTCDay()].toUpperCase()}  /  ${date}`, 160, 163, 16, color.muted, "center");
  }

  function network(wifi) {
    return wifi?.connected ? `WI-FI CONNECTED  /  ${wifi.ip || ""}` : "WI-FI DISCONNECTED";
  }

  function pomodoro(timer, deviceName, wifi) {
    frame("POMODORO", deviceName, network(wifi));
    const remaining = timer.remainingSeconds;
    const duration = (timer.phase === "focus" ? timer.focusMinutes : timer.breakMinutes) * 60;
    text(timer.phase === "focus" ? "FOCUS SESSION" : "SHORT BREAK", 160, 72, 10, color.accent, "center");
    text(`${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`, 160, 92, 58, color.text, "center");
    box(16, 172, 288, 6, color.surface);
    box(16, 172, Math.max(0, Math.min(288, Math.floor(288 * (duration - remaining) / duration))), 6, color.accent);
    text(timerStates[timer.state] || "--", 160, 188, 10, color.muted, "center");
  }

  function wrap(value, columns, rows) {
    const lines = [];
    let rest = value;
    let pending = Boolean(rest);
    while (pending && lines.length < rows) {
      rest = rest.replace(/^ +/, "");
      const nextBreak = rest.indexOf("\n");
      let end = Math.min(columns, nextBreak < 0 ? rest.length : nextBreak);
      const chunk = rest.slice(0, end);
      const wordBreak = chunk.search(/ +[^ ]*$/);
      if (end === columns && /^[^ \n]/.test(rest.slice(end)) && wordBreak > 0) end = wordBreak;
      lines.push(rest.slice(0, end).trimEnd());
      rest = rest.slice(end).replace(/^ +/, "");
      pending = Boolean(rest);
      if (rest.startsWith("\n")) rest = rest.slice(1);
    }
    if (pending) lines[lines.length - 1] = lines.at(-1).slice(0, columns - 3) + "...";
    return lines;
  }

  function message(data, deviceName, wifi) {
    frame("CUSTOM MESSAGE", deviceName, network(wifi));
    if (!data.text) {
      text("Set a message in the dashboard", 160, 127, 10, color.muted, "center");
      return;
    }
    const lineHeight = 8 * data.size;
    const lines = wrap(data.text, Math.floor(288 / (6 * data.size)), Math.floor(134 / lineHeight));
    const x = { left: 16, center: 160, right: 304 }[data.alignment];
    const y = 64 + Math.floor((134 - lines.length * lineHeight) / 2);
    lines.forEach((line, index) => text(line, x, y + index * lineHeight, 9 * data.size, data.color, data.alignment));
  }

  function render(frameData) {
    if (!ctx) return;
    const key = JSON.stringify(frameData);
    if (key === previousFrame) return;
    previousFrame = key;
    previousMode = frameData.mode;
    if (previousMode === "github") {
      github(frameData.github, frameData.githubUsername, frameData.localEpoch, frameData.theme);
      previousPetPose = undefined;
      render.pet(petElapsed);
      return;
    }
    color = palettes[frameData.theme] || palettes.dark;
    box(0, 0, 320, 240, color.bg);
    switch (frameData.mode) {
      case "stats": stats(frameData.github, frameData.deviceName); break;
      case "clock":
        if (frameData.calendar) clockCalendar(frameData.localEpoch, frameData.showSeconds, frameData.deviceName, frameData.calendar);
        else clock(frameData.localEpoch, frameData.showSeconds, frameData.deviceName, frameData.wifi);
        break;
      case "countdown": countdown(frameData.countdown, frameData.deviceName); break;
      case "codex":
      case "claude":
        quota(frameData.mode, frameData.quota, frameData.theme);
        previousPetPose = undefined;
        render.pet(petElapsed);
        break;
      case "pomodoro": pomodoro(frameData.timer, frameData.deviceName, frameData.wifi); break;
      case "message": message(frameData.message, frameData.deviceName, frameData.wifi); break;
      default: text("SMART DESK DISPLAY", 160, 114, 14, color.muted, "center");
    }
  }

  render.pet = (elapsed) => {
    if (elapsed === undefined) return;
    petElapsed = elapsed;
    if (!ctx) return;
    if (previousMode === "codex" || previousMode === "claude") {
      const phase = elapsed % 3600;
      const pose = phase >= 1600 && phase < 1900;
      if (pose === previousPetPose) return;
      previousPetPose = pose;
      window.paintDeskQuotaPet(ctx, previousMode, elapsed, 16, 16);
      ctx.globalCompositeOperation = "destination-over";
      box(16, 16, 48, 48, color.bg);
      ctx.globalCompositeOperation = "source-over";
      return;
    }
    if (previousMode !== "github") return;
    const pose = githubPetPose(elapsed);
    if (pose === previousPetPose) return;
    paintGithubPet(pose, previousPetPose);
    previousPetPose = pose;
  };

  render.petStep = (delta) => render.pet(petElapsed + delta);
  return render;
};
