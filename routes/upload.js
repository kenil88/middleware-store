const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parseXml } = require('../services/xmlParser');
const shopify = require('../services/shopifyUploader');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => cb(null, `upload_${Date.now()}.xml`),
});

const upload = multer({
  storage,
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
    const xml = fs.readFileSync(req.file.path, 'utf8');
    const products = await parseXml(xml);
    fs.unlinkSync(req.file.path);
    res.json({ count: products.length, products });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(422).json({ error: `XML parse error: ${err.message}` });
  }
});

// POST /api/upload — parse XML and push to Shopify (streaming SSE response)
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Server-Sent Events for real-time progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const xml = fs.readFileSync(req.file.path, 'utf8');
    fs.unlinkSync(req.file.path);

    send({ type: 'status', message: 'Parsing XML…' });
    const products = await parseXml(xml);
    send({ type: 'parsed', count: products.length, message: `Found ${products.length} product(s)` });

    if (products.length === 0) {
      send({ type: 'done', created: 0, failed: 0, errors: [] });
      return res.end();
    }

    send({ type: 'status', message: 'Connecting to Shopify…' });
    await shopify.testConnection();

    send({ type: 'status', message: `Uploading ${products.length} product(s) to Shopify…` });

    const summary = await shopify.bulkUpload(products, (done, total, result) => {
      send({ type: 'progress', done, total, result });
    });

    send({ type: 'done', ...summary });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    send({ type: 'error', message: err.response?.data ? JSON.stringify(err.response.data) : err.message });
  }

  res.end();
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
