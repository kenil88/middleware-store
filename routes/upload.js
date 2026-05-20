const express = require('express');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const { parseXml } = require('../services/xmlParser');
const shopify = require('../services/shopifyUploader');

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
// filter out SKUs already in Shopify, return only new products
router.post('/fetch-from-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  let xml;
  try {
    const xmlRes = await axios.get(url, {
      responseType: 'text',
      headers: { Accept: 'application/xml, text/xml, */*' },
      timeout: 30000,
    });
    xml = typeof xmlRes.data === 'string' ? xmlRes.data : String(xmlRes.data);
  } catch (err) {
    return res.status(502).json({ error: `Failed to fetch URL: ${err.message}` });
  }

  let allProducts;
  try {
    allProducts = await parseXml(xml);
  } catch (err) {
    return res.status(422).json({ error: `XML parse error: ${err.message}` });
  }

  let existingSkus;
  try {
    existingSkus = await shopify.getAllSkus();
  } catch (err) {
    return res.status(502).json({ error: `Shopify error: ${err.message}` });
  }

  const newProducts = [];
  const skipped = [];

  for (const p of allProducts) {
    const sku = p.variants?.[0]?.sku?.trim();
    if (sku && existingSkus.has(sku)) {
      skipped.push({ title: p.title, sku });
    } else {
      newProducts.push(p);
    }
  }

  res.json({
    total: allProducts.length,
    newCount: newProducts.length,
    skippedCount: skipped.length,
    products: newProducts,
    skipped,
  });
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
