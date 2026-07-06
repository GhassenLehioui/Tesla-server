const DATABASE_URL = "https://abcd-caa45-default-rtdb.europe-west1.firebasedatabase.app";

function encodeQuery(params) {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

async function realtimeGet(path, params = {}) {
  const query = Object.keys(params).length ? `?${encodeQuery(params)}` : '';
  const url = `${DATABASE_URL}/${path}.json${query}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Realtime DB GET failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

async function realtimePut(path, data) {
  const url = `${DATABASE_URL}/${path}.json`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Realtime DB PUT failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

async function realtimePatch(path, data) {
  const url = `${DATABASE_URL}/${path}.json`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Realtime DB PATCH failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

module.exports = {
  getAllCars: async () => {
    const data = await realtimeGet('cars');
    if (!data) return [];
    return Object.entries(data).map(([vin, value]) => ({ vin, ...value }));
  },

  findCarByVin: async (vin) => {
    const data = await realtimeGet(`cars/${encodeURIComponent(vin)}`);
    return data ? { vin, ...data } : null;
  },

  findCarByVinAndPlate: async (vin, plate) => {
    const car = await module.exports.findCarByVin(vin);
    if (!car || car.plate !== plate) return null;
    return car;
  },

  findCarByPlate: async (plate) => {
    const data = await realtimeGet('cars');
    if (!data) return null;
    const found = Object.entries(data).find(([, value]) => value && value.plate === plate);
    if (!found) return null;
    const [vin, value] = found;
    return { vin, ...value };
  },

  addCar: async (car) => {
    return await realtimePut(`cars/${encodeURIComponent(car.vin)}`, {
      plate: car.plate,
      email: car.email,
      otp: car.otp || null,
      otp_expires: car.otp_expires || null,
    });
  },

  updateCarOTP: async (vin, otp, expires) => {
    return await realtimePatch(`cars/${encodeURIComponent(vin)}`, {
      otp,
      otp_expires: expires,
    });
  },

  clearCarOTP: async (vin) => {
    return await realtimePatch(`cars/${encodeURIComponent(vin)}`, {
      otp: null,
      otp_expires: null,
    });
  },

  getAllReservations: async () => {
    const data = await realtimeGet('reservations');
    if (!data) return [];
    return Object.entries(data).map(([id, value]) => ({ id, ...value }));
  },

  getReservationsByVin: async (vin) => {
    const data = await realtimeGet('reservations');
    if (!data) return [];
    return Object.entries(data)
      .filter(([, value]) => value.vin === vin)
      .map(([id, value]) => ({ id, ...value }));
  },

  getReservationsByCenter: async (centerId) => {
    const data = await realtimeGet('reservations');
    if (!data) return [];
    return Object.entries(data)
      .filter(([, value]) => Number(value.centerId) === Number(centerId))
      .map(([id, value]) => ({ id, ...value }));
  },

  isSlotReserved: async (centerId, date, time) => {
    const reservations = await module.exports.getReservationsByCenter(centerId);
    return reservations.some(r => r.date === date && r.time === time);
  },

  addReservation: async (reservation) => {
    return await realtimePut(`reservations/${encodeURIComponent(reservation.id)}`, {
      vin: reservation.vin,
      email: reservation.email,
      centerId: Number(reservation.centerId),
      centerName: reservation.centerName,
      centerAddress: reservation.centerAddress,
      centerLat: reservation.centerLat,
      centerLng: reservation.centerLng,
      date: reservation.date,
      time: reservation.time,
      dateFormated: reservation.dateFormated,
      status: reservation.status,
      createdAt: reservation.createdAt,
      mapsLink: reservation.mapsLink,
    });
  },
};
