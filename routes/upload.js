const express = require('express');
const multer = require('multer');
const path = require('path');
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

// POST /api/upload — parse XML and push to Shopify, returns JSON summary
// (SSE streaming is not used — Vercel serverless does not support it)
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const xml = req.file.buffer.toString('utf8');
    const products = await parseXml(xml);

    if (products.length === 0) {
      return res.json({ created: 0, failed: 0, errors: [], total: 0 });
    }

    await shopify.testConnection();

    const summary = await shopify.bulkUpload(products);
    res.json({ ...summary, total: products.length });
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
