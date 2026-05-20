const axios = require('axios');

const DELAY_MS = 600; // ~1.6 req/sec — safely under Shopify's 2/sec REST limit

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ShopifyUploader {
  constructor() {
    this.store = process.env.SHOPIFY_STORE_DOMAIN;
    this.token = process.env.SHOPIFY_ACCESS_TOKEN;
    this.version = process.env.SHOPIFY_API_VERSION || '2024-01';
    this.base = `https://${this.store}/admin/api/${this.version}`;
    this.client = axios.create({
      baseURL: this.base,
      headers: {
        'X-Shopify-Access-Token': this.token,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async testConnection() {
    const res = await this.client.get('/shop.json');
    return res.data.shop;
  }

  async createProduct(product) {
    const res = await this.client.post('/products.json', { product });
    return res.data.product;
  }

  async updateProduct(id, product) {
    const res = await this.client.put(`/products/${id}.json`, { product });
    return res.data.product;
  }

  async getAllSkus() {
    const skus = new Set();
    let pageInfo = null;
    let first = true;

    do {
      const params = { limit: 250 };
      if (first) params.fields = 'id,variants';
      if (pageInfo) params.page_info = pageInfo;

      const res = await this.client.get('/products.json', { params });
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

  // Upload products one by one with rate-limit delay.
  // onProgress(done, total, result) is called after each product.
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
