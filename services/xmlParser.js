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

function toFixed2(n) {
  return n.toFixed(2);
}

function toHtml(text) {
  const s = val(text);
  if (!s) return '';
  if (s.trimStart().startsWith('<')) return s;
  return `<p>${s}</p>`;
}

// ─── Microsoft Dynamics NAV / Business Central SOAP parser ───────────────────
//
// Field mapping (Dynamics XML → Shopify):
//   No                    → variant.sku
//   Description           → product.title
//   Web_Description       → product.body_html
//   BarcodeNo             → variant.barcode
//   Unit_Price_Including_VAT → variant.price
//   Unit_Price            → variant.compare_at_price
//   Inventory             → variant.inventory_quantity
//   Item_Category_Code    → product.product_type
//   Division_Code         → metafield dynamics/division_code + tag
//   Retail_Product_Code   → metafield dynamics/retail_product_code + tag
//   Attrib_1_Code         → product.vendor (brand)
//   Attrib_2_Code         → option1 "Color"
//   Attrib_3_Code         → option2 "Compatible Model"
//   Attrib_4_Code         → option3 "Screen Size"
//   Season_Code           → tag (collection/season)
//   VAT_Prod_Posting_Group → metafield dynamics/vat_group + tag
//   Vendor_No             → metafield dynamics/vendor_no + tag
//   Search_Description    → tag (SEO search tag)
//   Key                   → metafield dynamics/record_key

function parseDynamicsItem(item) {
  // Build variant options from Attrib_2/3/4
  const attrDefs = [
    { name: 'Color', value: val(item.Attrib_2_Code) },
    { name: 'Compatible Model', value: val(item.Attrib_3_Code) },
    { name: 'Screen Size', value: val(item.Attrib_4_Code) },
  ].filter(a => a.value);

  const optionDefs = attrDefs.map(a => ({ name: a.name, values: [a.value] }));
  const variantOptions = {};
  attrDefs.forEach((a, i) => { variantOptions[`option${i + 1}`] = a.value; });

  // Tags: Season_Code, Division_Code, Retail_Product_Code, Search_Description,
  //       VAT_Prod_Posting_Group, Vendor_No
  const tags = [
    val(item.Season_Code),
    val(item.Division_Code),
    val(item.Retail_Product_Code),
    val(item.Search_Description),
    val(item.VAT_Prod_Posting_Group),
    val(item.Vendor_No),
  ].filter(Boolean).join(', ');

  const variant = {
    sku: val(item.No),
    price: toFixed2(toNumber(item.Unit_Price_Including_VAT)),
    compare_at_price: toFixed2(toNumber(item.Unit_Price)),
    barcode: val(item.BarcodeNo),
    inventory_management: 'shopify',
    inventory_quantity: toInt(item.Inventory),
    taxable: true,
    requires_shipping: true,
    ...variantOptions,
  };

  const metafields = [
    { namespace: 'dynamics', key: 'record_key',         value: val(item.Key),                    type: 'single_line_text_field' },
    { namespace: 'dynamics', key: 'vendor_no',          value: val(item.Vendor_No),               type: 'single_line_text_field' },
    { namespace: 'dynamics', key: 'division_code',      value: val(item.Division_Code),           type: 'single_line_text_field' },
    { namespace: 'dynamics', key: 'retail_product_code',value: val(item.Retail_Product_Code),     type: 'single_line_text_field' },
    { namespace: 'dynamics', key: 'vat_group',          value: val(item.VAT_Prod_Posting_Group),  type: 'single_line_text_field' },
    { namespace: 'dynamics', key: 'item_family_code',   value: val(item.Item_Family_Code),        type: 'single_line_text_field' },
  ].filter(m => m.value);

  const product = {
    title: val(item.Description, 'Untitled Product'),
    body_html: toHtml(item.Web_Description),
    vendor: val(item.Attrib_1_Code, ''),
    product_type: val(item.Item_Category_Code, ''),
    tags,
    status: 'active',
    variants: [variant],
    metafields,
  };

  if (optionDefs.length > 0) product.options = optionDefs;

  return product;
}

function parseDynamicsEnvelope(result) {
  // Normalise the SOAP envelope key regardless of prefix (Soap:, soap:, SOAP:)
  const envKey = Object.keys(result).find(k => k.toLowerCase().includes('envelope'));
  if (!envKey) return [];
  const envelope = result[envKey];

  const bodyKey = Object.keys(envelope).find(k => k.toLowerCase().includes('body'));
  if (!bodyKey) return [];
  const body = envelope[bodyKey];

  // Navigate: Body > ReadMultiple_Result (outer) > ReadMultiple_Result (inner) > RetailItemList
  const outerKey = Object.keys(body).find(k => k !== '$');
  if (!outerKey) return [];
  const outer = body[outerKey];

  const innerKey = Object.keys(outer).find(k => k !== '$');
  if (!innerKey) return [];
  const inner = outer[innerKey];

  const itemsKey = Object.keys(inner).find(k => k !== '$');
  if (!itemsKey) return [];

  const raw = inner[itemsKey];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map(parseDynamicsItem);
}

// ─── Generic XML parser ───────────────────────────────────────────────────────

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

// ─── Entry point ──────────────────────────────────────────────────────────────

async function parseXml(xmlString) {
  const result = await parser.parseStringPromise(xmlString);

  // Detect Microsoft Dynamics NAV / Business Central SOAP envelope
  if (Object.keys(result).some(k => k.toLowerCase().includes('envelope'))) {
    return parseDynamicsEnvelope(result);
  }

  // Generic <products> / <catalog> / <feed> format
  const root = result.products || result.catalog || result.feed || result;
  const productKey = Object.keys(root).find(k => k !== '$') || 'product';
  const rawProducts = root[productKey] || root.product || [];

  const list = Array.isArray(rawProducts) ? rawProducts : [rawProducts];
  return list.filter(Boolean).map(parseProduct);
}

module.exports = { parseXml };
