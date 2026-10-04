require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const db = new Database(path.join(__dirname, 'data', 'primebite.db'));

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS foods (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT DEFAULT '', price INTEGER NOT NULL, image TEXT DEFAULT '', available INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT UNIQUE NOT NULL, user_id INTEGER, customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending', status TEXT NOT NULL DEFAULT 'received', total INTEGER NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, food_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id));
`);

const seed = db.prepare('SELECT COUNT(*) c FROM foods').get().c;
if (!seed) {
  const foods = [
    ['Jollof Rice & Chicken','Local','Classic Ghana jollof served with chicken.',45],['Fried Rice & Chicken','Local','Fried rice with seasoned chicken.',48],['Waakye Special','Local','Waakye with protein and sides.',40],['Beef Burger','Burgers','Juicy beef burger with fresh toppings.',50],['Chicken Burger','Burgers','Crispy chicken burger with fresh toppings.',48],['Chicken Pizza','Pizza','Chicken, cheese and house sauce.',65],['Beef Pizza','Pizza','Beef, cheese and fresh toppings.',70],['French Fries','Sides','Crispy golden fries.',25],['Chicken Wings','Sides','Seasoned chicken wings.',35],['Soft Drink','Drinks','Chilled soft drink.',12]
  ];
  const ins = db.prepare('INSERT INTO foods(name,category,description,price) VALUES(?,?,?,?)');
  const tx = db.transaction(() => foods.forEach(f=>ins.run(...f))); tx();
}
const adminEmail = process.env.ADMIN_EMAIL || 'admin@primebite.local';
const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
if (!db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) {
  db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run('PrimeBite Admin',adminEmail,bcrypt.hashSync(adminPassword,10),'admin');
}

app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname,'public')));
function tokenFor(user){ return jwt.sign({id:user.id,role:user.role,email:user.email},JWT_SECRET,{expiresIn:'7d'}); }
function auth(req,res,next){ const h=req.headers.authorization||''; try { req.user=jwt.verify(h.replace('Bearer ',''),JWT_SECRET); next(); } catch { res.status(401).json({error:'Authentication required'}); } }
function admin(req,res,next){ if(req.user?.role!=='admin') return res.status(403).json({error:'Admin access required'}); next(); }
function code(){ return 'PB-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase(); }

app.get('/api/health',(req,res)=>res.json({ok:true,service:'PrimeBite V2'}));
app.get('/api/foods',(req,res)=>res.json(db.prepare('SELECT * FROM foods WHERE available=1 ORDER BY id DESC').all()));
app.post('/api/register',(req,res)=>{
  const {name,email,password}=req.body||{}; if(!name||!email||!password||password.length<6) return res.status(400).json({error:'Name, valid email and password (6+ characters) are required'});
  try { const r=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email.toLowerCase(),bcrypt.hashSync(password,10)); const u={id:r.lastInsertRowid,name,email:email.toLowerCase(),role:'customer'}; res.json({user:u,token:tokenFor(u)}); } catch { res.status(409).json({error:'Email is already registered'}); }
});
app.post('/api/login',(req,res)=>{ const {email,password}=req.body||{}; const u=db.prepare('SELECT * FROM users WHERE email=?').get((email||'').toLowerCase()); if(!u||!bcrypt.compareSync(password||'',u.password_hash)) return res.status(401).json({error:'Invalid email or password'}); res.json({user:{id:u.id,name:u.name,email:u.email,role:u.role},token:tokenFor(u)}); });
app.get('/api/me',auth,(req,res)=>res.json(req.user));

app.post('/api/orders',auth,(req,res)=>{
  const {customerName,phone,address,paymentMethod,note,items}=req.body||{};
  if(!customerName||!phone||!address||!Array.isArray(items)||!items.length) return res.status(400).json({error:'Customer details and at least one item are required'});
  const ids=items.map(x=>Number(x.foodId)); const foods=db.prepare(`SELECT * FROM foods WHERE id IN (${ids.map(()=>'?').join(',')})`).all(...ids);
  const map=new Map(foods.map(f=>[f.id,f])); let total=0; const normalized=[];
  for(const i of items){const f=map.get(Number(i.foodId)); const q=Math.max(1,Math.min(50,Number(i.quantity)||1)); if(!f) return res.status(400).json({error:'One of the selected foods is unavailable'}); total+=f.price*q; normalized.push({f,q});}
  const orderCode=code(); const tx=db.transaction(()=>{ const r=db.prepare('INSERT INTO orders(order_code,user_id,customer_name,phone,address,payment_method,total,note) VALUES(?,?,?,?,?,?,?,?)').run(orderCode,req.user.id,customerName,phone,address,paymentMethod||'cash',total,note||''); const ins=db.prepare('INSERT INTO order_items(order_id,food_id,name,price,quantity) VALUES(?,?,?,?,?)'); normalized.forEach(x=>ins.run(r.lastInsertRowid,x.f.id,x.f.name,x.f.price,x.q)); return r.lastInsertRowid; });
  const id=tx(); res.status(201).json({orderId:id,orderCode,total,status:'received',paymentStatus:'pending'});
});
app.get('/api/orders/my',auth,(req,res)=>{ const orders=db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id); const get=db.prepare('SELECT * FROM order_items WHERE order_id=?'); res.json(orders.map(o=>({...o,items:get.all(o.id)}))); });
app.get('/api/orders/:code',auth,(req,res)=>{const o=db.prepare('SELECT * FROM orders WHERE order_code=?').get(req.params.code); if(!o||(o.user_id!==req.user.id&&req.user.role!=='admin')) return res.status(404).json({error:'Order not found'}); o.items=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id); res.json(o);});

app.get('/api/admin/orders',auth,admin,(req,res)=>{const orders=db.prepare('SELECT * FROM orders ORDER BY id DESC').all(); const get=db.prepare('SELECT * FROM order_items WHERE order_id=?'); res.json(orders.map(o=>({...o,items:get.all(o.id)})));});
app.patch('/api/admin/orders/:id/status',auth,admin,(req,res)=>{const allowed=['received','confirmed','preparing','out_for_delivery','delivered','cancelled']; if(!allowed.includes(req.body.status)) return res.status(400).json({error:'Invalid status'}); const r=db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status,req.params.id); if(!r.changes) return res.status(404).json({error:'Order not found'}); res.json({ok:true});});
app.patch('/api/admin/orders/:id/payment',auth,admin,(req,res)=>{const allowed=['pending','paid','failed','refunded']; if(!allowed.includes(req.body.paymentStatus)) return res.status(400).json({error:'Invalid payment status'}); db.prepare('UPDATE orders SET payment_status=? WHERE id=?').run(req.body.paymentStatus,req.params.id); res.json({ok:true});});
app.post('/api/admin/foods',auth,admin,(req,res)=>{const {name,category,description,price,image}=req.body||{}; if(!name||!category||!price) return res.status(400).json({error:'Name, category and price required'}); const r=db.prepare('INSERT INTO foods(name,category,description,price,image) VALUES(?,?,?,?,?)').run(name,category,description||'',Number(price),image||''); res.status(201).json(db.prepare('SELECT * FROM foods WHERE id=?').get(r.lastInsertRowid));});
app.patch('/api/admin/foods/:id',auth,admin,(req,res)=>{const f=db.prepare('SELECT * FROM foods WHERE id=?').get(req.params.id); if(!f)return res.status(404).json({error:'Food not found'}); const a={...f,...req.body}; db.prepare('UPDATE foods SET name=?,category=?,description=?,price=?,image=?,available=? WHERE id=?').run(a.name,a.category,a.description||'',Number(a.price),a.image||'',a.available?1:0,f.id); res.json({ok:true});});
app.get('/api/admin/stats',auth,admin,(req,res)=>{const sales=db.prepare("SELECT COALESCE(SUM(total),0) total FROM orders WHERE payment_status='paid'").get().total; const pending=db.prepare("SELECT COUNT(*) c FROM orders WHERE status NOT IN ('delivered','cancelled')").get().c; const count=db.prepare('SELECT COUNT(*) c FROM orders').get().c; res.json({sales,pending,orders:count});});

// Payment adapter placeholder: never mark a payment as paid from the browser. Connect a verified provider webhook here.
app.post('/api/payments/create',auth,(req,res)=>res.status(501).json({error:'Payment gateway not connected yet. This endpoint is reserved for the verified Ghana payment provider integration.'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`PrimeBite V2 running on http://localhost:${PORT}`));
