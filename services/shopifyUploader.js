const axios = require('axios');

const DELAY_MS = 600; // ~1.6 req/sec — safely under Shopify's 2/sec REST limit

// ── Token cache (in-memory; survives warm instances, resets on cold start) ────
let _cachedToken = null;
let _tokenExpiresAt = 0;

async function getAccessToken() {
  // Return cached token if still valid (with 60s safety buffer)
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  // Permanent custom-app token — use as-is, never expires
  if (process.env.SHOPIFY_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ACCESS_TOKEN;
  }

  // OAuth Client Credentials flow — auto-refresh on expiry
  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const store        = process.env.SHOPIFY_STORE_DOMAIN;

  if (!clientId || !clientSecret) {
    throw new Error('No Shopify credentials found. Set SHOPIFY_ACCESS_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET in env.');
  }

  const res = await axios.post(
    `https://${store}/admin/oauth/access_token`,
    { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
  );

  _cachedToken     = res.data.access_token;
  _tokenExpiresAt  = Date.now() + (res.data.expires_in ?? 86400) * 1000;

  console.log(`[shopify] OAuth token refreshed. Expires in ${res.data.expires_in ?? 86400}s`);
  return _cachedToken;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ShopifyUploader {
  constructor() {
    this.store   = process.env.SHOPIFY_STORE_DOMAIN;
    this.version = process.env.SHOPIFY_API_VERSION || '2024-01';
    this.base    = `https://${this.store}/admin/api/${this.version}`;
  }

  // Build axios instance with a fresh (or cached) token for every call
  async _client() {
    const token = await getAccessToken();
    return axios.create({
      baseURL: this.base,
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  async testConnection() {
    const client = await this._client();
    const res = await client.get('/shop.json');
    return res.data.shop;
  }

  async createProduct(product) {
    const client = await this._client();
    const res = await client.post('/products.json', { product });
    return res.data.product;
  }

  async updateProduct(id, product) {
    const client = await this._client();
    const res = await client.put(`/products/${id}.json`, { product });
    return res.data.product;
  }

  async getAllSkus() {
    const skus = new Set();
    let pageInfo = null;
    let first = true;

    do {
      const client = await this._client();
      const params = { limit: 250 };
      if (first) params.fields = 'id,variants';
      if (pageInfo) params.page_info = pageInfo;

      const res = await client.get('/products.json', { params });
      for (const p of res.data.products) {
        for (const v of p.variants || []) {
          if (v.sku) skus.add(v.sku.trim());
        }
      }

      const link = res.headers['link'] || '';
      const next = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
      pageInfo = next ? decodeURIComponent(next[1]) : null;
      first = false;
    } while (pageInfo);

    return skus;
  }

  async bulkUpload(products, onProgress) {
    const results = { created: 0, failed: 0, errors: [] };
    const total = products.length;

    for (let i = 0; i < total; i++) {
      const product = products[i];
      try {
        const created = await this.createProduct(product);
        results.created++;
        if (onProgress) onProgress(i + 1, total, { success: true, title: created.title, id: created.id });
      } catch (err) {
        // If token expired mid-batch, clear cache so next call refreshes it
        if (err.response?.status === 401) {
          _cachedToken   = null;
          _tokenExpiresAt = 0;
        }
        const message = err.response?.data?.errors
          ? JSON.stringify(err.response.data.errors)
          : err.message;
        results.failed++;
        results.errors.push({ index: i, title: product.title, error: message });
        if (onProgress) onProgress(i + 1, total, { success: false, title: product.title, error: message });
      }

      if (i < total - 1) await sleep(DELAY_MS);
    }

    return results;
  }
}

module.exports = new ShopifyUploader();
