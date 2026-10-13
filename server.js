const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (our browser UI)
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('No URL provided');
  }

  let url = targetUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      maxRedirects: 5,
    });

    // Strip headers that block iframe embedding
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');

    // Set permissive headers
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Forward content type
    const contentType = response.headers['content-type'] || 'text/html';
    res.setHeader('Content-Type', contentType);

    // If HTML, rewrite links to go through proxy
    if (contentType.includes('text/html')) {
      let html = response.data.toString('utf-8');

      // Rewrite absolute links
      const base = new URL(url);
      const origin = base.origin;
      const proxyBase = '/proxy?url=';

      // Inject base rewriting script
      const injectScript = `
<script>
(function() {
  const PROXY = '/proxy?url=';
  const BASE = '${origin}';

  function rewriteUrl(u) {
    if (!u || u.startsWith('javascript:') || u.startsWith('data:') || u.startsWith('#') || u.startsWith('mailto:')) return u;
    if (u.startsWith('http://') || u.startsWith('https://')) return PROXY + encodeURIComponent(u);
    if (u.startsWith('//')) return PROXY + encodeURIComponent('https:' + u);
    if (u.startsWith('/')) return PROXY + encodeURIComponent(BASE + u);
    return u;
  }

  // Intercept link clicks
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a');
    if (a && a.href) {
      e.preventDefault();
      const newUrl = PROXY + encodeURIComponent(a.href.replace(PROXY, ''));
      window.top.postMessage({ type: 'navigate', url: a.href }, '*');
    }
  }, true);

  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.action) {
      e.preventDefault();
      const action = rewriteUrl(form.action);
      form.action = action;
      form.submit();
    }
  }, true);
})();
</script>`;

      // Inject before </head> or at start of body
      if (html.includes('</head>')) {
        html = html.replace('</head>', injectScript + '</head>');
      } else {
        html = injectScript + html;
      }

      return res.send(html);
    }

    // For non-HTML (images, CSS, JS, etc.) just pipe through
    res.send(response.data);

  } catch (err) {
    const msg = err.response
      ? `Site returned ${err.response.status}`
      : err.code === 'ECONNABORTED'
      ? 'Request timed out'
      : 'Could not reach site';

    res.status(502).send(`
      <html><body style="background:#202124;color:#e8eaed;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px;">
        <div style="font-size:48px">⚠️</div>
        <h2>Proxy Error</h2>
        <p style="color:#9aa0a6">${msg}</p>
        <p style="color:#5f6368;font-size:12px">${url}</p>
      </body></html>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
