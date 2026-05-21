const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');

jest.setTimeout(60000); // 60 seconds

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Products API', () => {
  let productId;

  it('should create a new product', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({
        name: 'Test Product',
        price: 100,
        gst: 18
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('_id');
    expect(res.body.name).toBe('Test Product');
    productId = res.body._id;
  });

  it('should get all products', async () => {
    const res = await request(app).get('/api/products');
    expect(res.statusCode).toEqual(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('should update a product and handle 0 values correctly', async () => {
    const res = await request(app)
      .put(`/api/products/${productId}`)
      .send({
        price: 0,
        gst: 0
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body.price).toBe(0);
    expect(res.body.gst).toBe(0);
  });

  it('should delete a product', async () => {
    const res = await request(app).delete(`/api/products/${productId}`);
    expect(res.statusCode).toEqual(200);
  });
});

describe('Customers API', () => {
  let customerId;

  it('should create a new customer', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({
        name: 'Test Customer',
        phone: '1234567890'
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('_id');
    expect(res.body.name).toBe('Test Customer');
    customerId = res.body._id;
  });

  it('should get all customers', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.statusCode).toEqual(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('should update a customer', async () => {
    const res = await request(app)
      .put(`/api/customers/${customerId}`)
      .send({ phone: '0987654321' });
    expect(res.statusCode).toEqual(200);
    expect(res.body.phone).toBe('0987654321');
  });

  it('should delete a customer', async () => {
    const res = await request(app).delete(`/api/customers/${customerId}`);
    expect(res.statusCode).toEqual(200);
  });
});

describe('Bills API', () => {
  it('should return 400 if items array is not valid', async () => {
    const res = await request(app)
      .post('/api/bills')
      .send({
        customerName: 'Test Customer',
        items: { productName: 'invalid' } // not an array
      });
    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toBe('No valid bill items provided');
  });

  it('should return 400 if item has negative price or quantity', async () => {
    const res = await request(app)
      .post('/api/bills')
      .send({
        customerName: 'Test Customer',
        items: [
          { productName: 'Item 1', price: -10, quantity: 2, gst: 18 }
        ]
      });
    expect(res.statusCode).toEqual(400);
  });

  it('should create a bill and calculate total accurately', async () => {
    const res = await request(app)
      .post('/api/bills')
      .send({
        customerName: 'Test Customer',
        items: [
          { productName: 'Item 1', price: 100, quantity: 2, gst: 18 }, // (100*2) + 18% = 200 + 36 = 236
          { productName: 'Item 2', price: 50, quantity: 1, gst: 5 }    // (50*1) + 5% = 50 + 2.5 = 52.5
        ]
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('_id');
    expect(res.body.total).toBe(288.5); // 236 + 52.5 = 288.5
  });

  it('should get all bills', async () => {
    const res = await request(app).get('/api/bills');
    expect(res.statusCode).toEqual(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('Real User Flow', () => {
  it('should create a product, customer, and then a bill', async () => {
    const prodRes = await request(app).post('/api/products').send({ name: 'Flow Product', price: 100, gst: 10 });
    const custRes = await request(app).post('/api/customers').send({ name: 'Flow Customer', phone: '1112223334' });
    
    expect(prodRes.statusCode).toBe(201);
    expect(custRes.statusCode).toBe(201);

    const billRes = await request(app).post('/api/bills').send({
      customerName: custRes.body.name,
      items: [{
        productName: prodRes.body.name,
        price: prodRes.body.price,
        quantity: 3,
        gst: prodRes.body.gst
      }]
    });

    expect(billRes.statusCode).toBe(201);
    expect(billRes.body.total).toBe(330); // (100 * 3) + 10% = 330
  });
});
