#pragma once

namespace desk {

constexpr char provisionPage[] = R"HTML(<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Desk Display setup</title>
<style>
:root{color-scheme:dark;font:16px system-ui;background:#0d1117;color:#e6edf3}
main{max-width:30rem;margin:10vh auto;padding:1.25rem} form{display:grid;gap:1rem}
label{display:grid;gap:.35rem} input,button{font:inherit;padding:.7rem;border-radius:.4rem;border:1px solid #586069}
button{background:#39d353;color:#0d1117;font-weight:700} a{color:#79c0ff}
</style>
<main>
<h1>Connect Smart Desk Display</h1>
<p>Enter the details of your 2.4 GHz Wi-Fi network. Leave the password blank for an open network.</p>
<form>
<label>Wi-Fi network name<input id="ssid" required maxlength="32" autocomplete="off"></label>
<label>Wi-Fi password<input id="pass" type="password" maxlength="63" autocomplete="off"></label>
<button>Connect</button>
</form>
<p id="result" role="status" aria-live="polite"></p>
</main>
<script>
const form = document.querySelector('form');
const button = form.querySelector('button');
const result = document.querySelector('#result');
const password = document.querySelector('#pass');
const network = document.querySelector('#ssid');
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Request failed.');
  return data;
}
async function poll() {
  for (let i = 0; i < 27; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const status = await api('/api/provision/status');
    if (status.state === 'failed') throw new Error(status.error);
    if (status.state === 'connected') {
      const link = document.createElement('a');
      link.href = 'http://' + status.ip + '/';
      link.textContent = status.ip;
      result.replaceChildren('Connected. Rejoin your Wi-Fi, then open ', link, '.');
      return;
    }
  }
  throw new Error('Setup timed out. Check the TFT and reconnect to the setup network if needed.');
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  result.textContent = 'Connecting. Stay on the setup network until the device gets an IP.';
  try {
    await api('/api/provision', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ssid: network.value, password: password.value})
    });
    password.value = '';
    await poll();
  } catch (error) {
    result.textContent = error.message;
    button.disabled = false;
  }
});
</script></html>)HTML";

constexpr char fallbackPage[] = R"HTML(<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Desk Display</title><h1>Smart Desk Display</h1>
<p>The dashboard files are missing. Upload the LittleFS dashboard image to continue.</p>
<p><a href="/api/status">Device status</a></p></html>)HTML";

}
