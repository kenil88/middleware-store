const express = require('express');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const { parseXml } = require('../services/xmlParser');
const shopify = require('../services/shopifyUploader');
const { getPublicKeyPem, decryptToken } = require('../services/cryptoKeys');

const router = express.Router();

// Memory storage — serverless environments (Vercel) have no writable disk path
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/xml' || file.mimetype === 'application/xml' || file.originalname.endsWith('.xml')) {
      cb(null, true);
    } else {
      cb(new Error('Only XML files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// GET /api/pubkey — returns the RSA-OAEP public key so the browser can encrypt
// the API auth token before sending it to this server
router.get('/pubkey', (req, res) => {
  res.json({ publicKey: getPublicKeyPem() });
});

// GET /api/test — verify Shopify connection
router.get('/test', async (req, res) => {
  try {
    const shop = await shopify.testConnection();
    res.json({ ok: true, shop: shop.name, domain: shop.domain, plan: shop.plan_name });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.response?.data || err.message });
  }
});

// POST /api/fetch-from-url — fetch XML from an external API URL, parse it,
// filter out SKUs already in Shopify, return only new products.
// encryptedToken (optional): RSA-OAEP encrypted Basic auth token from the browser.
router.post('/fetch-from-url', async (req, res) => {
  const { url, encryptedToken, filters } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  // Decrypt the auth token on the server — never logged or stored
  let authToken = process.env.API_AUTH_TOKEN || '';
  if (encryptedToken) {
    try {
      authToken = decryptToken(encryptedToken);
    } catch {
      return res.status(400).json({ error: 'Failed to decrypt auth token. Please refresh the page and try again.' });
    }
  }

  // Extract the Dynamics NAV page name from the URL to build the correct namespace.
  // URL format: .../WS/[Company]/Page/[PageName]
  const pageMatch = url.match(/\/Page\/([^/?&#]+)/i);
  const pageName = pageMatch ? pageMatch[1].toLowerCase() : 'items';
  const soapNs = `urn:microsoft-dynamics-schemas/page/${pageName}`;

  // Build optional <filter> elements from user-supplied criteria
  const activeFilters = Array.isArray(filters) ? filters.filter(f => f.field && f.criteria) : [];
  const filterXml = activeFilters
    .map(f => `    <filter><Field>${f.field}</Field><Criteria>${f.criteria}</Criteria></filter>`)
    .join('\n');

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ReadMultiple xmlns="${soapNs}">
${filterXml}
      <setSize>500</setSize>
    </ReadMultiple>
  </soap:Body>
</soap:Envelope>`;

  const headers = {
    'SOAPAction': 'ReadMultiple',
    'Content-Type': 'application/xml',
    'Accept': 'application/xml, text/xml, */*',
  };
  if (authToken) headers['Authorization'] = `Basic ${authToken}`;

  let xml;
  try {
    const xmlRes = await axios.post(url, soapBody, { responseType: 'text', headers, timeout: 120000 });
    xml = typeof xmlRes.data === 'string' ? xmlRes.data : String(xmlRes.data);
  } catch (err) {
    const status = err.response?.status;
    // Include response body so the caller can see the upstream error detail
    const detail = err.response?.data
      ? (typeof err.response.data === 'string'
          ? err.response.data.slice(0, 500)
          : JSON.stringify(err.response.data).slice(0, 500))
      : null;
    const msg = status === 401 ? 'Unauthorised — check your auth token'
              : status === 403 ? 'Forbidden — check your auth token'
              : `Failed to fetch URL (HTTP ${status ?? 'network error'}): ${err.message}`;
    console.error('[fetch-from-url] upstream error', status, detail ?? err.message);
    return res.status(502).json({ error: msg, detail });
  }

  let allProducts;
  try {
    allProducts = await parseXml(xml);
  } catch (err) {
    return res.status(422).json({ error: `XML parse error: ${err.message}` });
  }

  // Return all parsed products — the client filters against /api/shopify-skus
  res.json({ total: allProducts.length, products: allProducts });
});

// POST /api/browse-seasons — fetches a small sample from NAV and returns unique Season Codes.
// Uses setSize:200 so it responds quickly even without filters.
router.post('/browse-seasons', async (req, res) => {
  const { url, encryptedToken } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  let authToken = process.env.API_AUTH_TOKEN || '';
  if (encryptedToken) {
    try { authToken = decryptToken(encryptedToken); }
    catch { return res.status(400).json({ error: 'Failed to decrypt auth token. Please refresh and try again.' }); }
  }

  const pageMatch = url.match(/\/Page\/([^/?&#]+)/i);
  const pageName = pageMatch ? pageMatch[1].toLowerCase() : 'items';
  const soapNs = `urn:microsoft-dynamics-schemas/page/${pageName}`;

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ReadMultiple xmlns="${soapNs}">
      <setSize>200</setSize>
    </ReadMultiple>
  </soap:Body>
</soap:Envelope>`;

  const headers = {
    'SOAPAction': 'ReadMultiple',
    'Content-Type': 'application/xml',
    'Accept': 'application/xml, text/xml, */*',
  };
  if (authToken) headers['Authorization'] = `Basic ${authToken}`;

  try {
    const xmlRes = await axios.post(url, soapBody, { responseType: 'text', headers, timeout: 30000 });
    const xml = typeof xmlRes.data === 'string' ? xmlRes.data : String(xmlRes.data);
    // Extract Season_Code directly from the raw XML instead of going through the full parser
    const xml2js = require('xml2js');
    const rawParsed = await new xml2js.Parser({ explicitArray: false, trim: true }).parseStringPromise(xml);

    // Walk envelope → body → result → items
    let items = [];
    try {
      const envKey = Object.keys(rawParsed).find(k => k.toLowerCase().includes('envelope'));
      const bodyKey = Object.keys(rawParsed[envKey]).find(k => k.toLowerCase().includes('body'));
      const body = rawParsed[envKey][bodyKey];
      const outerKey = Object.keys(body).find(k => k !== '$');
      const outer = body[outerKey];
      const innerKey = Object.keys(outer).find(k => k !== '$');
      const inner = outer[innerKey];
      const itemsKey = Object.keys(inner).find(k => k !== '$');
      const raw = inner[itemsKey];
      items = Array.isArray(raw) ? raw : [raw];
    } catch { /* if structure differs, items stays empty */ }

    const seasons = [...new Set(
      items.map(it => (it.Season_Code || '')).filter(Boolean)
    )].sort();

    res.json({ total: items.length, seasons });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data
      ? (typeof err.response.data === 'string' ? err.response.data.slice(0, 300) : JSON.stringify(err.response.data).slice(0, 300))
      : null;
    const msg = status === 401 ? 'Unauthorised — check your auth token'
              : status === 403 ? 'Forbidden — check your auth token'
              : `Failed to fetch (HTTP ${status ?? 'network error'}): ${err.message}`;
    res.status(502).json({ error: msg, detail });
  }
});

// GET /api/shopify-skus — returns all SKUs currently in Shopify.
// Called in parallel with /api/fetch-from-url so neither blocks the other.
router.get('/shopify-skus', async (req, res) => {
  try {
    const skus = await shopify.getAllSkus();
    res.json({ skus: [...skus] });
  } catch (err) {
    res.status(502).json({ error: `Shopify error: ${err.message}` });
  }
});

// POST /api/parse — parse XML and return preview (no Shopify upload)
router.post('/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const xml = req.file.buffer.toString('utf8');
    const products = await parseXml(xml);
    res.json({ count: products.length, products });
  } catch (err) {
    res.status(422).json({ error: `XML parse error: ${err.message}` });
  }
});

// POST /api/upload-products — accept pre-parsed JSON products from the browser
// The client parses the XML locally (avoiding Vercel's 4.5 MB body limit) and
// posts products in small batches as JSON.
router.post('/upload-products', async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'products array is required' });
  }

  try {
    await shopify.testConnection();
    const summary = await shopify.bulkUpload(products);
    res.json(summary);
  } catch (err) {
    const message = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.status(500).json({ error: message });
  }
});

// GET /api/sample — download generic sample XML
router.get('/sample', (req, res) => {
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', 'attachment; filename="sample-products.xml"');
  res.sendFile(path.join(__dirname, '../sample-product.xml'));
});

// GET /api/sample-dynamics — download Microsoft Dynamics NAV/BC SOAP sample XML
router.get('/sample-dynamics', (req, res) => {
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', 'attachment; filename="sample-dynamics.xml"');
  res.sendFile(path.join(__dirname, '../sample-dynamics.xml'));
});

module.exports = router;
