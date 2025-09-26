# Tuntihinta-sovellus – kaupallinen v7

© 2025 E-P:n Sähkötekniikka. Kaikki oikeudet pidätetään.

## Kehitys
npm i
npm run dev

## Build
npm run build
npm run preview

## Julkaisu (Vercel)
1) Luo projekti Verceliin (Framework: Vite).
2) Lisää ympäristömuuttujat (Project → Settings → Environment):
   - STRIPE_SECRET_KEY
   - STRIPE_WEBHOOK_SECRET
   - KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN (Vercel KV)
3) Ota Vercel KV käyttöön (Storage → KV) ja kopioi env-muuttujat.
4) (Valinnainen) VITE_PAYMENT_LINK_URL jos käytät myyntisivua.

## Stripe Webhook
- Webhook-osoite: https://<oma-domain>/api/stripe-webhook
- Tapahtumat: checkout.session.completed, invoice.paid
- STRIPE_WEBHOOK_SECRET env-muuttujaan.

## Payment Link / Checkout asetukset
- Aseta **success_url** Stripeen (Payment Linkin asetuksista tai Checkout Sessionin luonnissa):
  https://<oma-domain>/thankyou?session_id={{CHECKOUT_SESSION_ID}}
- Kun maksu onnistuu, käyttäjä ohjataan yllä olevaan osoitteeseen. Sivu kutsuu `/api/claim` →
  selain avaa automaattisesti sovelluksen `/?token=...` ja lisenssi aktivoituu.
