// ═══════════════════════════════════════════════════════════════
//  Tesla App — Backend API
//  Port : 3003
//  Updated with OpenAI GPT-4o Vision scan endpoint
// ═══════════════════════════════════════════════════════════════

// ⚠️ CHARGER DOTENV EN PREMIER (avant tout import qui utilise process.env)
require('dotenv').config();

const express    = require("express");
const cors       = require("cors");
const fs         = require("fs");
const path       = require("path");
const db         = require('./realtime');
// Use Resend for transactional emails (reads key from process.env.RESEND_API_KEY)
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY );

const app = express();

// ───────────────────────────────────────────────────────────────
//  CORS Configuration
//  Allow requests from Vercel frontend
// ───────────────────────────────────────────────────────────────

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Pas d'origine (Postman, curl, mobile) => autorisé
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // En dev on est permissif
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());

// ───────────────────────────────────────────────────────────────
//  Configuration
// ───────────────────────────────────────────────────────────────
const CHARGING_FILE     = path.join(__dirname, "charging-centers.json");
const OTP_EXPIRY_MS     = 2 * 60 * 1000; // 2 minutes
const EMAIL_SENDER      ="onboarding@resend.dev";

// ───────────────────────────────────────────────────────────────
//  Dynamic Import of ES Module Routes (Gemini Scan)
//  ⚠️  Le serveur ne démarre QU'APRÈS l'import pour éviter
//      les requêtes /api/scan qui arrivent avant l'enregistrement
//      de la route (ce qui causait une réponse HTML 404).
// ───────────────────────────────────────────────────────────────

let scanRoutesRegistered = false;

// ── Chargement des routes de scan (CommonJS, pas d'import async) ──
try {
  const { registerScanRoutes } = require('./scan-routes.js');
  registerScanRoutes(app);
  scanRoutesRegistered = true;
  console.log('[INIT] ✓ Gemini scan routes loaded');
} catch (err) {
  console.error('[INIT] ✗ Scan routes FAILED:', err.message);
  console.error('[INIT] Stack:', err.stack);
  // Route fallback pour éviter le 404 HTML
  app.post('/api/scan', (_req, res) => {
    res.status(503).json({
      success: false,
      error: 'Scan service unavailable: ' + err.message + '. Vérifiez les logs Render.',
    });
  });
}

(async () => {

  // ── Middleware 404 JSON (doit être après toutes les routes) ──
  // Évite qu'Express renvoie une page HTML pour les routes inconnues
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `Route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  // ── Middleware d'erreur global ──
  // Attrape les erreurs non gérées et les retourne en JSON
  app.use((err, req, res, _next) => {
    console.error('[ERROR]', err.message);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal server error',
    });
  });

  // ── Démarrage du serveur ──
  const PORT =3003;
  app.listen(PORT, () => {
    console.log(`\n Tesla App API démarrée sur port ${PORT}\n`);
    console.log('[INFO] Features:');
    console.log('  ✓ Car management');
    console.log('  ✓ OTP authentication');
    console.log('  ✓ Reservations');
    console.log(`  ${scanRoutesRegistered ? '✓' : '✗'} Image scanning with Gemini 1.5 Flash`);
    console.log(`  ${process.env.GEMINI_API_KEY ? '✓' : '✗'} Gemini API configured\n`);
  });
})();

// ───────────────────────────────────────────────────────────────
//  Mailer (Resend)
//  Uses `process.env.RESEND_API_KEY`. If not set, OTPs are logged for testing.
// ───────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────
//  Helpers — lecture de fichier JSON statique
// ───────────────────────────────────────────────────────────────

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

// ───────────────────────────────────────────────────────────────
//  Helpers — normalisation plaque
//  "88tun209" | "88 TUN 209" | "88  tun  209" → "88 TUN 209"
// ───────────────────────────────────────────────────────────────

function normalizePlate(plate) {
  if (!plate || typeof plate !== "string") return "";
  return plate.toUpperCase().replace(/\s+/g, " ").trim();
}

function platesMatch(a, b) {
  return normalizePlate(a) === normalizePlate(b);
}

// ───────────────────────────────────────────────────────────────
//  Helpers — OTP
// ───────────────────────────────────────────────────────────────

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(toEmail, otp) {
  const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #E31937; text-align: center;">Tesla App</h2>
        <h3 style="color: #333;">Code de vérification</h3>
        <p>Bonjour,</p>
        <p>Voici votre code OTP pour vous connecter :</p>
        <div style="
          background: #f5f5f5;
          border-left: 4px solid #E31937;
          padding: 20px;
          text-align: center;
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 8px;
          margin: 24px 0;
          border-radius: 4px;
        ">
          ${otp}
        </div>
        <p style="color: #888; font-size: 13px;">
          Ce code expire dans <strong>2 minutes</strong>. Ne le partagez avec personne.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 12px; text-align: center;">
          L'équipe Tesla App
        </p>
      </div>
    `;

  if (!process.env.RESEND_API_KEY || !RESEND_API_KEY) {
    console.log(`[OTP] RESEND_API_KEY not set — OTP for ${toEmail}: ${otp}`);
    return;
  }

  try {
    await resend.emails.send({
      from: EMAIL_SENDER,
      to: toEmail,
      subject: "Votre code OTP — Tesla App",
      html,
    });
    console.log(`[OTP] Envoyé à ${toEmail} via Resend`);
  } catch (err) {
    console.error("[OTP] Erreur envoi email via Resend:", err && err.message ? err.message : err);
    throw err;
  }
}

// ───────────────────────────────────────────────────────────────
//  Route — Santé du serveur
// ───────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Tesla App API opérationnelle",
    features: {
      cars: true,
      authentication: true,
      reservations: true,
      scan: scanRoutesRegistered ? "enabled (Gemini 1.5 Flash)" : "disabled"
    }
  });
});

// ───────────────────────────────────────────────────────────────
//  Route — GET /api/cars
//  Retourne la liste de toutes les voitures
// ───────────────────────────────────────────────────────────────

app.get("/api/cars", async (req, res) => {
  const cars = await db.getAllCars();
  res.json(cars);
});

// ───────────────────────────────────────────────────────────────
//  Route — POST /api/cars/add
//  Enregistre une nouvelle voiture
//  Body : { vin, plate, email }
// ───────────────────────────────────────────────────────────────

app.post("/api/cars/add", async (req, res) => {
  const { vin, plate, email } = req.body;

  // Validation des champs
  if (!vin || !plate || !email) {
    return res.status(400).json({
      success: false,
      message: "Données manquantes (vin, plate, email requis)",
    });
  }

  const normalizedPlate = normalizePlate(plate);
  // Vérifier doublon par VIN ou par plaque
  const existingByVin = await db.findCarByVin(vin);
  const existingByPlate = await db.findCarByPlate(normalizedPlate);

  const duplicate = existingByVin || existingByPlate;

  if (duplicate) {
    return res.status(409).json({
      success: false,
      message: "Cette voiture est déjà enregistrée",
    });
  }

  // Générer l'OTP immédiatement
  const otp     = generateOTP();
  const expires = Date.now() + OTP_EXPIRY_MS;

  const newCar = {
    vin,
    plate: normalizedPlate,
    email,
    otpStore: { otp, expires },
  };

  await db.addCar({ vin, plate: normalizedPlate, email, otp, otp_expires: expires });

  console.log(`[ADD] Voiture ajoutée — VIN: ${vin} | Plaque: ${normalizedPlate}`);
  
  // Envoyer l'OTP par email en tâche de fond (ne pas bloquer la réponse)
  sendOTPEmail(email, otp)
    .then(() => console.log(`[ADD] OTP envoyé à ${email} pour VIN: ${vin}`))
    .catch((err) => console.error("[ADD] Erreur envoi email:", err && err.message ? err.message : err));

  // Répondre immédiatement pour que le client puisse saisir l'OTP sans délai
  res.status(201).json({
    success: true,
    message: "Voiture ajoutée — OTP envoyé (en cours)",
  });
  // (envoi d'email en arrière-plan géré ci-dessus)
});

// ───────────────────────────────────────────────────────────────
//  Route — POST /api/cars/check-etr
//  Vérifie l'existence d'une voiture étrangère (plaque libre + vin)
//  et envoie un OTP par email
//  Body : { vin, plate }
// ───────────────────────────────────────────────────────────────

app.post("/api/cars/check-etr", async (req, res) => {
  const { vin, plate } = req.body;

  if (!vin || !plate) {
    return res.status(400).json({
      exists: false,
      message: "Données manquantes (vin, plate requis)",
    });
  }

  // Recherche par VIN + plaque (exacte)
  const car = await db.findCarByVinAndPlate(vin, plate);

  if (!car) {
    console.log(`[CHECK-ETR] Véhicule étranger introuvable — VIN: ${vin} | Plaque: ${plate}`);
    return res.json({
      exists: false,
      message: "Véhicule introuvable, vérifiez vos informations ou enregistrez-vous d'abord",
    });
  }

  // Générer l'OTP et mettre à jour le fichier
  const otp     = generateOTP();
  const expires = Date.now() + OTP_EXPIRY_MS;

  await db.updateCarOTP(vin, otp, expires);
  // Envoyer l'email en tâche de fond et répondre immédiatement
  sendOTPEmail(car.email, otp)
    .then(() => console.log(`[CHECK-ETR] OTP envoyé à ${car.email} pour VIN: ${vin}`))
    .catch((err) => console.error("[CHECK-ETR] Erreur envoi email:", err && err.message ? err.message : err));

  return res.json({
    exists: true,
    message: "Véhicule trouvé — OTP en cours d'envoi",
  });
});

// ───────────────────────────────────────────────────────────────
//  Route — POST /api/cars/verify-otp
//  Vérifie l'OTP pour une voiture et enregistre si valide
//  Body : { vin, otp }
// ───────────────────────────────────────────────────────────────

app.post("/api/cars/verify-otp", async (req, res) => {
  const { vin, otp } = req.body;

  // Validation
  if (!vin || !otp) {
    return res.status(400).json({
      success: false,
      message: "Données manquantes (vin, otp requis)",
    });
  }

  const car = await db.findCarByVin(vin);

  if (!car) {
    return res.status(404).json({
      success: false,
      message: "Voiture non trouvée",
    });
  }

  // Vérifier l'OTP et sa date d'expiration
  const { otp: storedOTP, otp_expires } = car;
  const now = Date.now();

  if (storedOTP !== otp) {
    return res.status(401).json({
      success: false,
      message: "OTP invalide",
    });
  }

  if (otp_expires && now > otp_expires) {
    return res.status(401).json({
      success: false,
      message: "OTP expiré",
    });
  }

  // OTP valide : enregistrer la voiture
  await db.verifyCarByVin(vin);

  console.log(`[VERIFY] Voiture vérifiée — VIN: ${vin}`);

  res.json({
    success: true,
    message: "Voiture vérifiée avec succès",
    car: {
      vin: car.vin,
      plate: car.plate,
      email: car.email,
    },
  });
});

// ───────────────────────────────────────────────────────────────
//  Route — GET /api/available-hours
//  Retourne les créneaux horaires disponibles pour un centre et une date
//  Query: ?centerId=1&date=2024-06-21
// ───────────────────────────────────────────────────────────────

app.get("/api/available-hours", async (req, res) => {
  const { centerId, date } = req.query;

  if (!centerId || !date) {
    return res.status(400).json({
      success: false,
      message: "Paramètres manquants (centerId et date requis)",
    });
  }

  try {
    const centerIdNumber = Number(centerId);
    if (Number.isNaN(centerIdNumber)) {
      return res.status(400).json({
        success: false,
        message: "centerId invalide",
      });
    }

    // Récupérer les créneaux réservés pour ce centre/date
    const reservedSlots = await db.getReservedSlotsByDateAndCenter(
      centerIdNumber,
      date
    );

    // Heures disponibles : 08:00 à 18:00 (slot d'une heure)
    const availableHours = [];
    for (let hour = 8; hour < 18; hour++) {
      const timeSlot = `${hour.toString().padStart(2, "0")}:00`;

      // Vérifier si ce créneau est déjà réservé
      const isReserved = reservedSlots.some((slot) => slot.time === timeSlot);

      if (!isReserved) {
        availableHours.push(timeSlot);
      }
    }

    res.json({
      success: true,
      centerId: centerIdNumber,
      date: date,
      availableHours: availableHours,
      totalSlots: availableHours.length,
    });
  } catch (error) {
    console.error("[AVAILABLE-HOURS] Erreur:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des créneaux disponibles",
    });
  }
});

// ───────────────────────────────────────────────────────────────
//  Route — POST /api/reservation/confirm
//  Confirme une réservation et envoie un email de confirmation
//  Body : { vin, centerId, centerName, centerLat, centerLng, centerAddress, 
//           date, time, dateFormated }
// ───────────────────────────────────────────────────────────────

app.post("/api/reservation/confirm", async (req, res) => {
  const { vin, centerId, centerName, centerLat, centerLng, centerAddress, date, time, dateFormated } = req.body;

  // Validation des champs
  if (!vin || !centerId || !centerName || !date || !time) {
    return res.status(400).json({
      success: false,
      message: "Données manquantes (vin, centerId, centerName, date, time requis)",
    });
  }

  // Récupérer l'email du client à partir du VIN
  const car = await db.findCarByVin(vin);

  if (!car || !car.email) {
    return res.status(404).json({
      success: false,
      message: "Voiture ou email non trouvé",
    });
  }

  const userEmail = car.email;

  // Générer le lien Google Maps
  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${centerLat},${centerLng}`;

  // Créer le contenu de l'email
  const emailSubject = `Confirmation de réservation - ${centerName}`;
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #E31937 0%, #a01129 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">Tesla App</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0 0;">Confirmation de Réservation</p>
      </div>

      <div style="background: #f9f9f9; padding: 30px; border-bottom: 1px solid #ddd;">
        <p style="margin: 0 0 20px 0; color: #333;">Bonjour,</p>
        <p style="margin: 0 0 25px 0; color: #555;">Votre réservation a été confirmée avec succès.</p>

        <!-- Détails de la réservation -->
        <div style="background: white; border-left: 4px solid #E31937; padding: 20px; margin: 20px 0; border-radius: 4px;">
          <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Détails de votre réservation</h2>
          
          <div style="margin-bottom: 15px;">
            <p style="margin: 0 0 5px 0; color: #888; font-size: 12px; text-transform: uppercase; font-weight: bold;">Centre de Charge</p>
            <p style="margin: 0; color: #333; font-size: 16px; font-weight: bold;">${centerName}</p>
          </div>

          <div style="margin-bottom: 15px;">
            <p style="margin: 0 0 5px 0; color: #888; font-size: 12px; text-transform: uppercase; font-weight: bold;">Adresse</p>
            <p style="margin: 0; color: #333; font-size: 14px;">${centerAddress}</p>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
              <p style="margin: 0 0 5px 0; color: #888; font-size: 12px; text-transform: uppercase; font-weight: bold;">Date</p>
              <p style="margin: 0; color: #333; font-size: 16px; font-weight: bold;">${dateFormated}</p>
            </div>
            <div>
              <p style="margin: 0 0 5px 0; color: #888; font-size: 12px; text-transform: uppercase; font-weight: bold;">Heure</p>
              <p style="margin: 0; color: #333; font-size: 16px; font-weight: bold;">${time}</p>
            </div>
          </div>
        </div>

        <!-- Bouton Google Maps -->
        <div style="text-align: center; margin: 25px 0;">
          <a href="${mapsLink}" style="
            display: inline-block;
            background: #E31937;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
            font-size: 14px;
            transition: background 0.3s ease;
          " onmouseover="this.style.background='#d41730'" onmouseout="this.style.background='#E31937'">
            📍 Voir sur Google Maps
          </a>
        </div>

        <p style="margin: 20px 0 0 0; color: #666; font-size: 13px; text-align: center;">
          Assurez-vous d'arriver 10 minutes avant l'heure prévue.
        </p>
      </div>

      <div style="background: #f0f0f0; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
        <p style="margin: 0; color: #888; font-size: 12px;">
          © 2026 Tesla App. Tous droits réservés.
        </p>
        <p style="margin: 5px 0 0 0; color: #aaa; font-size: 11px;">
          Cet email a été généré automatiquement. Veuillez ne pas répondre à cet email.
        </p>
      </div>
    </div>
  `;

  try {
    const centerIdNumber = Number(centerId);
  if (Number.isNaN(centerIdNumber)) {
    return res.status(400).json({
      success: false,
      message: "centerId invalide",
    });
  }

  // Vérifier les créneaux déjà réservés pour ce centre/date/heure
  const conflict = await db.isSlotReserved(centerIdNumber, date, time);

  if (conflict) {
    return res.status(409).json({
      success: false,
      message: "Ce créneau est déjà réservé pour ce centre.",
    });
  }

  // Créer l'objet de réservation
  const reservation = {
    id: Date.now().toString(),
    vin: vin,
    email: userEmail,
    centerId: centerIdNumber,
    centerName: centerName,
    centerAddress: centerAddress,
    centerLat: centerLat,
    centerLng: centerLng,
    date: date,
    time: time,
    dateFormated: dateFormated,
    status: "confirmed",
    createdAt: new Date().toISOString(),
    mapsLink: mapsLink
  };

  // Sauvegarder la réservation dans la base de données
  await db.addReservation(reservation);

  // Envoyer l'email de confirmation via Resend
  await resend.emails.send({
    from: EMAIL_SENDER,
    to: userEmail,
    subject: emailSubject,
    html: emailHtml,
  });

  console.log(`[RESERVATION] Email de confirmation envoyé à ${userEmail} via Resend`);
  console.log(`[RESERVATION] VIN: ${vin} | Centre: ${centerName} | Date: ${date} | Heure: ${time}`);

    res.json({
      success: true,
      message: "Réservation confirmée et email envoyé avec succès",
      reservationDetails: {
        id: reservation.id,
        vin: vin,
        center: centerName,
        date: date,
        time: time,
        email: userEmail,
        mapsLink: mapsLink
      }
    });
  } catch (error) {
    console.error("[RESERVATION] Erreur lors de l'envoi de l'email:", error.message);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'envoi de l'email de confirmation: " + error.message
    });
  }
});

// ───────────────────────────────────────────────────────────────
//  Route — GET /api/reservations
//  Retourne toutes les réservations (admin)
// ───────────────────────────────────────────────────────────────

app.get("/api/reservations", async (req, res) => {
  const reservations = await db.getAllReservations();
  res.json({
    success: true,
    total: reservations.length,
    reservations: reservations
  });
});

// ───────────────────────────────────────────────────────────────
//  Route — GET /api/reservations/vin/:vin
//  Retourne les réservations d'une voiture spécifique
// ───────────────────────────────────────────────────────────────

app.get("/api/reservations/vin/:vin", async (req, res) => {
  const { vin } = req.params;
  const userReservations = await db.getReservationsByVin(vin);

  res.json({
    success: true,
    vin: vin,
    total: userReservations.length,
    reservations: userReservations
  });
});

// ───────────────────────────────────────────────────────────────
//  Route — GET /api/reservations/center/:centerId
//  Retourne les réservations d'un centre spécifique
// ───────────────────────────────────────────────────────────────

app.get("/api/reservations/center/:centerId", async (req, res) => {
  const { centerId } = req.params;
  const centerReservations = await db.getReservationsByCenter(centerId);
  
  res.json({
    success: true,
    centerId: centerId,
    total: centerReservations.length,
    reservations: centerReservations
  });
});



const PORT = 3003;

app.listen(PORT, () => {
  console.log(`\n Tesla App API démarrée sur port ${PORT}\n`);
  console.log('[INFO] Features:');
  console.log('  ✓ Car management');
  console.log('  ✓ OTP authentication');
  console.log('  ✓ Reservations');
  console.log(`  ${scanRoutesRegistered ? '✓' : '✗'} Image scanning with GPT-4o Vision`);
  console.log(`  ${process.env.OPENAI_API_KEY ? '✓' : '✗'} OpenAI API configured\n`);
});
