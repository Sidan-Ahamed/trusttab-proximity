/**
 * Quick way to create a demo shop without curl.
 * Edit the lat/lng below to YOUR current location (use Google Maps:
 * long-press a point -> the coordinates appear at the bottom) so that
 * the web demo's "use my location" button actually falls inside range.
 *
 * Run with: npm run seed
 */
const API = 'http://localhost:4000/api/shops';

const shop = {
  name: 'Demo Kirana Store',
  lat: 12.9698, // <-- replace with your latitude
  lng: 79.1559, // <-- replace with your longitude
  radius_m: 75, // geofence radius in meters
};

fetch(API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(shop),
})
  .then((r) => r.json())
  .then((data) => {
    console.log('Shop created:');
    console.log(data);
    console.log('\nUse this shopId in owner.html ->', data.id);
  })
  .catch((err) => {
    console.error('Could not reach the backend. Is `npm start` running in another terminal?');
    console.error(err.message);
  });
