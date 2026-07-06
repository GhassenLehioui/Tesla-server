const fs = require('fs');
const path = require('path');
let admin;
let db = null;

function init() {
  if (db) return db;

  try {
    admin = require('firebase-admin');
  } catch (e) {
    throw new Error('[FIRESTORE] firebase-admin is not installed');
  }

  // Lire la clé de service depuis le fichier local `server/firebase-service-account.json`.
  const svcPath = path.join(__dirname, 'firebase-service-account.json');
  let serviceAccount = null;

  if (fs.existsSync(svcPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(svcPath, 'utf-8'));
  }

  if (!serviceAccount) {
    throw new Error('[FIRESTORE] Aucun compte de service trouvé. Crée le fichier server/firebase-service-account.json');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  db = admin.firestore();
  return db;
}

function carDocRef(vin) {
  init();
  return db.collection('cars').doc(vin);
}

module.exports = {
  getAllCars: async () => {
    init();
    const snap = await db.collection('cars').get();
    return snap.docs.map(d => ({ vin: d.id, ...d.data() })).map(({otp, otp_expires, ...rest}) => rest);
  },

  findCarByVin: async (vin) => {
    init();
    const doc = await carDocRef(vin).get();
    return doc.exists ? { vin: doc.id, ...doc.data() } : null;
  },

  findCarByVinAndPlate: async (vin, plate) => {
    init();
    const doc = await carDocRef(vin).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return data.plate === plate ? { vin: doc.id, ...data } : null;
  },

  findCarByPlate: async (plate) => {
    init();
    const snap = await db.collection('cars').where('plate', '==', plate).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { vin: d.id, ...d.data() };
  },

  addCar: async (car) => {
    init();
    // use VIN as document ID
    await carDocRef(car.vin).set({ plate: car.plate, email: car.email, otp: car.otp || null, otp_expires: car.otp_expires || null });
    return true;
  },

  updateCarOTP: async (vin, otp, expires) => {
    init();
    await carDocRef(vin).update({ otp: otp, otp_expires: expires });
  },

  clearCarOTP: async (vin) => {
    init();
    await carDocRef(vin).update({ otp: admin.firestore.FieldValue.delete(), otp_expires: admin.firestore.FieldValue.delete() });
  },

  // Reservations
  getAllReservations: async () => {
    init();
    const snap = await db.collection('reservations').orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  getReservationsByVin: async (vin) => {
    init();
    const snap = await db.collection('reservations').where('vin', '==', vin).orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  getReservationsByCenter: async (centerId) => {
    init();
    const snap = await db.collection('reservations').where('centerId', '==', Number(centerId)).orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  isSlotReserved: async (centerId, date, time) => {
    init();
    const snap = await db.collection('reservations')
      .where('centerId', '==', Number(centerId))
      .where('date', '==', date)
      .where('time', '==', time)
      .limit(1)
      .get();
    return !snap.empty;
  },

  addReservation: async (reservation) => {
    init();
    const docRef = db.collection('reservations').doc(reservation.id);
    await docRef.set({
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
      mapsLink: reservation.mapsLink
    });
  }
};
