# PrimeBite V2

A real full-stack starter for a Ghana-focused food delivery service.

## Included
- Node.js + Express API
- SQLite database
- Customer registration/login
- Menu stored in database
- Cart and checkout
- Real order records and order items
- Customer order history
- Admin authentication and dashboard
- Admin order status updates
- Admin food creation
- Payment endpoint reserved for a verified payment provider

## Run locally
1. Install Node.js 18+.
2. Copy `.env.example` to `.env` and change `JWT_SECRET` and admin password.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

Default admin credentials come from `.env` (change them before deployment).

## Production next steps
- Use PostgreSQL/Supabase instead of SQLite for multi-instance hosting.
- Connect a Ghana-supported payment gateway through `/api/payments/create` and a verified webhook. Never trust a browser callback to mark an order paid.
- Add SMS/WhatsApp notifications.
- Add delivery zones/fees and restaurant/vendor accounts.
- Add HTTPS, rate limiting, validation, backups and monitoring.
