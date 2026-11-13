"use strict";

window.deskTransport = (() => {
  const remote = location.origin === "https://desk.thezah.space" ||
    document.documentElement.dataset.transport === "remote";
  let csrfToken;

  async function exchange(url, body, authenticated = false, signal, headers = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    try {
      const options = { cache: "no-store", signal: controller.signal, credentials: "same-origin", headers };
      if (body !== undefined) {
        options.method = "POST";
        options.headers = { "Content-Type": "application/json" };
        if (authenticated && csrfToken) options.headers["X-CSRF-Token"] = csrfToken;
        options.body = JSON.stringify(body);
      }
      const response = await fetch(url, options);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(data?.error?.message || `Yêu cầu thất bại (HTTP ${response.status}).`);
        error.status = response.status;
        error.code = data?.error?.code;
        error.field = data?.error?.field;
        throw error;
      }
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          (body !== undefined && data.ok !== true && !data.authenticated)) {
        throw new Error("Phản hồi máy chủ không hợp lệ.");
      }
      return { data, fixture: response.headers.get("X-SmartDesk-Fixture") === "1" };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Hết thời gian chờ phản hồi.");
      if (error instanceof TypeError) throw new Error("Không thể kết nối.");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }

  if (!remote) return { request: (path, body, signal) => exchange(`./api/${path}`, body, false, signal), kind: "local" };

  async function session(password) {
    const { data } = await (password === undefined
      ? exchange("/api/auth/session")
      : exchange("/api/auth/login", { password }));
    csrfToken = data.authenticated ? data.csrfToken : undefined;
    return data.authenticated;
  }

  return {
    kind: "remote",
    session,
    clearSession() { csrfToken = undefined; },
    async logout() {
      await exchange("/api/auth/logout", {}, true);
      csrfToken = undefined;
    },
    async readCalendar() {
      const { data } = await exchange("/api/admin/integrations");
      return data.calendar;
    },
    async calendar(action) {
      return (await exchange(`/api/admin/calendar/${action}`, {}, true)).data;
    },
    async state(signal) {
      return (await exchange("/api/admin/state", undefined, false, signal, document.hidden ? {} : { "X-Desk-Interactive": "1" })).data;
    },
    async send(type, payload) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const body = { id, type, payload };
      try {
        return (await exchange("/api/admin/commands", body, true)).data.command;
      } catch (error) {
        if (error.status) throw error;
        // A response may have been lost after the server queued the command.
        return (await exchange("/api/admin/commands", body, true)).data.command;
      }
    },
    async result(id) {
      return (await exchange(`/api/admin/commands/${id}`)).data.command;
    },
  };
})();
