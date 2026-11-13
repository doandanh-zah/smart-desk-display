"use strict";

window.deskTransport = (() => {
  const remote = location.origin === "https://desk.thezah.space" ||
    document.documentElement.dataset.transport === "remote";
  let csrfToken;

  async function exchange(url, body, authenticated = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const options = { cache: "no-store", signal: controller.signal, credentials: "same-origin" };
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
    }
  }

  if (!remote) return { request: (path, body) => exchange(`./api/${path}`, body), kind: "local" };

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
    async integrations() {
      return (await exchange("/api/admin/integrations")).data;
    },
    async state() {
      return (await exchange("/api/admin/state")).data;
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
