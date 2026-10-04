import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const GEOFENCE_TASK = 'trusttab-geofence-task';
const API_BASE_URL = 'http://localhost:4000'; // <-- replace with your deployed backend URL

export async function startWatchingShops(shops) {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission was not granted.');
  }

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') {
    console.warn('Background location denied — geofencing will only work while the app is open.');
  }

  const regions = shops.map((shop) => ({
    identifier: shop.id,
    latitude: shop.lat,
    longitude: shop.lng,
    radius: shop.radius_m,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));

  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
}

export async function stopWatchingShops() {
  await Location.stopGeofencingAsync(GEOFENCE_TASK);
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Geofencing task error:', error);
    return;
  }

  const { eventType, region } = data;

  if (eventType === Location.GeofencingEventType.Enter) {
    await checkInToShop(region.identifier);
  }

  if (eventType === Location.GeofencingEventType.Exit) {
    await notifyLeftShop(region.identifier);
  }
});

async function checkInToShop(shopId) {
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  const customer = await getStoredCustomerProfile(); // { id, name } from local storage / auth

  const res = await fetch(`${API_BASE_URL}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.id,
      customerName: customer.name,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    }),
  });

  const result = await res.json();

  if (result.inRange) {
    await storeActiveTempId(shopId, result.tempId, result.expiresAt);
    // Trigger a local notification here so the customer sees their temp ID
    // without having to open the app — e.g. expo-notifications.
  }
}

async function notifyLeftShop(shopId) {
  const active = await getActiveTempId(shopId);
  if (!active) return;

  await fetch(`${API_BASE_URL}/api/checkin/${active.tempId}/leave`, {
    method: 'POST',
  });
  await clearActiveTempId(shopId);
}

async function getStoredCustomerProfile() {
  return { id: 'customer-123', name: 'Zider' };
}
async function storeActiveTempId(shopId, tempId, expiresAt) {
  console.log('Store temp ID', { shopId, tempId, expiresAt });
}
async function getActiveTempId(shopId) {
  return null;
}
async function clearActiveTempId(shopId) {}
