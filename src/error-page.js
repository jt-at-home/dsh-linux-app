const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ESCAPES[character])
}

/**
 * Local failure document. Its actions are `dsh-error://retry` and
 * `dsh-error://quit` links, intercepted by the window's navigation guard, so the
 * error page needs no preload or IPC surface.
 */
export function errorPageUrl({ title, message, details, logPath }) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DeepSeek Harness</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #1b1c1f; color: #e8e8ea;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 680px; padding: 32px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
  p { line-height: 1.55; color: #c8c8cc; margin: 0 0 12px; }
  pre { margin: 16px 0; padding: 12px; border: 1px solid #2c2d31; border-radius: 8px;
        background: #111214; color: #a9a9af; font-size: 12px; white-space: pre-wrap; }
  code { color: #c8c8cc; }
  .actions { display: flex; gap: 12px; margin-top: 24px; }
  a { display: inline-block; padding: 9px 18px; border-radius: 8px;
      text-decoration: none; font-size: 14px; }
  a.primary { background: #4c6ef5; color: #fff; }
  a.secondary { border: 1px solid #3a3b40; color: #e8e8ea; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  ${details === undefined ? '' : `<pre>${escapeHtml(details)}</pre>`}
  <p>Host log: <code>${escapeHtml(logPath)}</code></p>
  <div class="actions">
    <a class="primary" href="dsh-error://retry">Retry</a>
    <a class="secondary" href="dsh-error://quit">Quit</a>
  </div>
</main>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
