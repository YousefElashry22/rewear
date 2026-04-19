require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// CORS — لازم يكون أول حاجة
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://courageous-pudding-3d68b2.netlify.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ───────────────────────────────
// AUTH ROUTES
// ───────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'تم التسجيل، تحقق من الإيميل', user: data.user });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(401).json({ error: 'إيميل أو باسورد غلط' });

  res.json({
    token: data.session.access_token,
    user: data.user
  });
});

app.post('/auth/logout', async (req, res) => {
  await supabase.auth.signOut();
  res.json({ message: 'تم تسجيل الخروج' });
});

// ───────────────────────────────
// MIDDLEWARES
// ───────────────────────────────
const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'محتاج تسجيل دخول' });
  }

  const token = authHeader.replace('Bearer ', '');

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'الـ token غلط أو انتهى' });
  }

  req.user = user; 
  next();
};

const requireAdmin = async (req, res, next) => {
  await requireAuth(req, res, async () => {
    // يمكنك تعديل الإيميل هنا ليكون إيميل الآدمن الخاص بك
    if (req.user.email !== 'admin@yourstore.com') {
      return res.status(403).json({ error: 'مش مسموح لك بإجراء العمليات الإدارية' });
    }
    next();
  });
};

// ───────────────────────────────
// PRODUCTS ROUTES
// ───────────────────────────────
app.get('/products', async (req, res) => {
  try {
    let query = supabase.from('products').select('*');
    if (req.query.category && req.query.category !== 'All') {
      query = query.eq('category', req.query.category);
    }
    const { data, error } = await query;

    if (error) {
      console.log('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (e) {
    console.log('❌ السبب الحقيقي:', e.message);
    console.log('❌ التفاصيل:', e.cause);
    res.status(500).json({ error: e.message, cause: e.cause });
  }
});

app.get('/products/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'المنتج مش موجود' });
  res.json(data);
});

app.post('/products', requireAdmin, async (req, res) => {
  const { name, price, category, image_url, stock } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'الاسم والسعر مطلوبين' });
  }

  const { data, error } = await supabase
    .from('products')
    .insert([{ name, price, category, image_url, stock }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

app.put('/products/:id', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .update(req.body)
    .eq('id', req.params.id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'المنتج مش موجود' });
  res.json(data[0]);
});

app.delete('/products/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'تم حذف المنتج' });
});

// ───────────────────────────────
// CART ROUTES
// ───────────────────────────────
app.get('/cart', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('cart')
    .select(`
      *,
      products (
        id,
        name,
        price,
        image_url
      )
    `)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/cart', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { product_id, quantity } = req.body;

  const { data: existing } = await supabase
    .from('cart')
    .select('id, quantity')
    .eq('user_id', userId)
    .eq('product_id', product_id)
    .single();

  if (existing) {
    const { data, error } = await supabase
      .from('cart')
      .update({ quantity: existing.quantity + quantity })
      .eq('id', existing.id)
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data[0]);
  } else {
    const { data, error } = await supabase
      .from('cart')
      .insert([{ user_id: userId, product_id, quantity }])
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data[0]);
  }
});

app.put('/cart/:id', requireAuth, async (req, res) => {
  const { quantity } = req.body;
  if (quantity <= 0) {
    await supabase.from('cart').delete().eq('id', req.params.id);
    return res.json({ message: 'Item removed' });
  }
  const { data, error } = await supabase
    .from('cart')
    .update({ quantity })
    .eq('id', req.params.id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/cart/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('cart').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Item removed from cart' });
});

app.delete('/cart', requireAuth, async (req, res) => {
  const { error } = await supabase.from('cart').delete().eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Cart cleared' });
});

// ───────────────────────────────
// ORDERS ROUTES
// ───────────────────────────────
app.post('/orders', requireAuth, async (req, res) => {
  const { customer_email, items } = req.body;
  const userId = req.user.id;

  const total_price = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert([{ customer_email, total_price, user_id: userId }])
    .select()
    .single();

  if (orderError) return res.status(500).json({ error: orderError.message });

  const orderItems = items.map(item => ({
    ...item,
    order_id: order.id
  }));

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(orderItems);

  if (itemsError) return res.status(500).json({ error: itemsError.message });

  res.status(201).json({ order, items: orderItems });
});

app.get('/orders', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (
        *,
        products ( name, price, image_url )
      )
    `)
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;

  const allowed = ['pending', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `الحالة لازم تكون: ${allowed.join(', ')}` });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', req.params.id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

const axios = require('axios');

// Paymob Payment Route
app.post('/payment/create', requireAuth, async (req, res) => {
  const { amount } = req.body;
  const user = req.user;

  try {
    // Step 1: Auth Token
    const authRes = await axios.post('https://accept.paymob.com/api/auth/tokens', {
      api_key: process.env.PAYMOB_API_KEY
    });
    const token = authRes.data.token;

    // Step 2: Order
    const orderRes = await axios.post('https://accept.paymob.com/api/ecommerce/orders', {
      auth_token: token,
      delivery_needed: false,
      amount_cents: amount * 100,
      currency: 'EGP',
      items: []
    });
    const orderId = orderRes.data.id;

    // Step 3: Payment Key
    const keyRes = await axios.post('https://accept.paymob.com/api/acceptance/payment_keys', {
      auth_token: token,
      amount_cents: amount * 100,
      expiration: 3600,
      order_id: orderId,
      billing_data: {
        first_name: 'Customer',
        last_name: '.',
        email: user.email,
        phone_number: '01000000000',
        apartment: 'NA', floor: 'NA', street: 'NA',
        building: 'NA', shipping_method: 'NA',
        postal_code: 'NA', city: 'NA',
        country: 'EG', state: 'NA'
      },
      currency: 'EGP',
      integration_id: process.env.PAYMOB_INTEGRATION_ID
    });
    const paymentKey = keyRes.data.token;

    const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentKey}`;

    res.json({ iframeUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('🚀 Server running'));
