'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

function storedOrder(overrides) {
  return Object.assign({
    id: 1,
    date: '01/01/2021',
    customer: 'In-memory customer',
    status: 'completed',
    coupon: '',
    items: [{
      id: 1,
      sku: 'SKU-1',
      name: 'In-memory product',
      hsn: '1006',
      price: 640,
      qty: 1
    }]
  }, overrides);
}

test('invoice uses the HSN slab and matches order totals when gstRate is absent', () => {
  const order = storedOrder();
  const priced = pricing.computeTotals(order.items, order.coupon);
  order.subtotal = priced.subtotal;
  order.discount = priced.discount;
  order.tax = priced.tax;
  order.total = priced.total;

  const invoiced = invoice.computeInvoiceFigures(order);
  const reconciliation = reports.getGstReconciliation({
    orders: [order],
    products: [],
    customers: []
  });

  assert.deepEqual(
    { subtotal: priced.subtotal, tax: priced.tax, total: priced.total },
    { subtotal: 640, tax: 32, total: 672 }
  );
  assert.deepEqual(
    {
      gstPercent: invoiced.rows[0].gstPercent,
      lineTax: invoiced.rows[0].lineTax,
      tax: invoiced.tax,
      cgst: invoiced.cgst,
      sgst: invoiced.sgst,
      total: invoiced.total
    },
    { gstPercent: 5, lineTax: 32, tax: 32, cgst: 16, sgst: 16, total: 672 }
  );
  assert.equal(reconciliation.rows[0].matched, true);
  assert.equal(reconciliation.rows[0].delta, 0);
});

test('invoice matches SAVE10 cap and taxes the discounted taxable amount', () => {
  const order = storedOrder({
    coupon: 'SAVE10',
    items: [{
      id: 2,
      sku: 'SKU-2',
      name: 'In-memory tea',
      hsn: '0902',
      price: 2000,
      qty: 1
    }]
  });
  const priced = pricing.computeTotals(order.items, order.coupon);
  order.subtotal = priced.subtotal;
  order.discount = priced.discount;
  order.tax = priced.tax;
  order.total = priced.total;

  const invoiced = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    { discount: priced.discount, tax: priced.tax, total: priced.total },
    { discount: 150, tax: 333, total: 2183 }
  );
  assert.deepEqual(
    {
      discount: invoiced.discount,
      lineTax: invoiced.rows[0].lineTax,
      tax: invoiced.tax,
      cgst: invoiced.cgst,
      sgst: invoiced.sgst,
      total: invoiced.total
    },
    { discount: 150, lineTax: 333, tax: 333, cgst: 166.5, sgst: 166.5, total: 2183 }
  );
});

test('invoice preserves the stored discount for an order with an inactive coupon', () => {
  const order = storedOrder({
    coupon: 'DIWALI20',
    discount: 200,
    subtotal: 1000,
    tax: 144,
    total: 944,
    items: [{
      id: 3,
      sku: 'SKU-3',
      name: 'In-memory tea',
      hsn: '0902',
      price: 1000,
      qty: 1
    }]
  });

  const invoiced = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    { discount: invoiced.discount, lineTax: invoiced.rows[0].lineTax, tax: invoiced.tax, total: invoiced.total },
    { discount: 200, lineTax: 144, tax: 144, total: 944 }
  );
});

test('GST reconciliation marks invoice and order totals as balanced', () => {
  const order = storedOrder();
  const priced = pricing.computeTotals(order.items, '');
  order.subtotal = priced.subtotal;
  order.discount = priced.discount;
  order.tax = priced.tax;
  order.total = priced.total;

  const result = reports.getGstReconciliation({
    orders: [order],
    products: [],
    customers: []
  });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].matched, true);
  assert.equal(result.rows[0].ledgerTax, 32);
  assert.equal(result.rows[0].invoiceTax, 32);
  assert.equal(result.rows[0].ledgerTotal, 672);
  assert.equal(result.rows[0].invoiceTotal, 672);
});
