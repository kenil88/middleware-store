const xml2js = require('xml2js');

const parser = new xml2js.Parser({ explicitArray: false, trim: true });

function val(v, fallback = '') {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'object' && v._) return v._;
  return String(v).trim() || fallback;
}

function toNumber(v, fallback = 0) {
  const n = parseFloat(val(v, String(fallback)));
  return isNaN(n) ? fallback : n;
}

function toInt(v, fallback = 0) {
  const n = parseInt(val(v, String(fallback)), 10);
  return isNaN(n) ? fallback : n;
}

function parseVariant(v) {
  const variant = {
    price: val(v.price, '0.00'),
    sku: val(v.sku, ''),
    inventory_management: 'shopify',
    inventory_quantity: toInt(v.inventory_quantity, 0),
    requires_shipping: val(v.requires_shipping, 'true') !== 'false',
    taxable: val(v.taxable, 'true') !== 'false',
    weight: toNumber(v.weight, 0),
    weight_unit: val(v.weight_unit, 'kg'),
  };

  if (v.compare_at_price) variant.compare_at_price = val(v.compare_at_price);
  if (v.barcode) variant.barcode = val(v.barcode);
  if (v.option1) variant.option1 = val(v.option1);
  if (v.option2) variant.option2 = val(v.option2);
  if (v.option3) variant.option3 = val(v.option3);

  return variant;
}

function parseImage(img) {
  return {
    src: val(img.src),
    alt: val(img.alt, ''),
  };
}

function parseOptions(opts) {
  if (!opts) return [];
  const list = Array.isArray(opts.option) ? opts.option : [opts.option];
  return list.filter(Boolean).map((o, i) => ({
    name: val(o.name || o, `Option ${i + 1}`),
    values: o.values
      ? (Array.isArray(o.values.value) ? o.values.value : [o.values.value]).map(v => val(v))
      : ['Default Title'],
  }));
}

function parseProduct(p) {
  const variants = p.variants
    ? (Array.isArray(p.variants.variant) ? p.variants.variant : [p.variants.variant]).filter(Boolean).map(parseVariant)
    : [{ price: val(p.price, '0.00'), sku: val(p.sku, ''), inventory_management: 'shopify', inventory_quantity: toInt(p.inventory_quantity, 0), option1: 'Default Title' }];

  const images = p.images
    ? (Array.isArray(p.images.image) ? p.images.image : [p.images.image]).filter(Boolean).map(parseImage).filter(i => i.src)
    : (p.image_url ? [{ src: val(p.image_url) }] : []);

  const options = parseOptions(p.options) || [];

  const product = {
    title: val(p.title, 'Untitled Product'),
    body_html: val(p.body_html || p.description, ''),
    vendor: val(p.vendor, ''),
    product_type: val(p.product_type || p.category, ''),
    tags: val(p.tags, ''),
    status: val(p.status, 'active'),
    variants,
    images,
  };

  if (options.length > 0) product.options = options;

  return product;
}

async function parseXml(xmlString) {
  const result = await parser.parseStringPromise(xmlString);

  const root = result.products || result.catalog || result.feed || result;
  const productKey = Object.keys(root).find(k => k !== '$') || 'product';
  const rawProducts = root[productKey] || root.product || [];

  const list = Array.isArray(rawProducts) ? rawProducts : [rawProducts];
  return list.filter(Boolean).map(parseProduct);
}

module.exports = { parseXml };
