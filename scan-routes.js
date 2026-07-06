// ═══════════════════════════════════════════════════════════════
//  Scan Routes — Vehicle Registration Card Analysis
//  POST /api/scan — Upload and analyze carte grise image
//  Converti en CommonJS pour compatibilité avec index.js (CJS)
// ═══════════════════════════════════════════════════════════════

const multer = require('multer');
const { extractVehicleDataFromImage } = require('./openai');

// ───────────────────────────────────────────────────────────────
//  Multer Configuration — Memory Storage Only
// ───────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error(`Type de fichier invalide. Types autorisés: ${allowedMimes.join(', ')}`), false);
    }
    cb(null, true);
  },
});

// ───────────────────────────────────────────────────────────────
//  POST /api/scan
// ───────────────────────────────────────────────────────────────

function registerScanRoutes(app) {
  app.post('/api/scan', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          data: null,
          error: 'Aucune image fournie. Veuillez uploader une image.',
        });
      }

      console.log(`[SCAN] Processing: ${req.file.originalname} (${req.file.size} bytes)`);

      const result = await extractVehicleDataFromImage(
        req.file.buffer,
        req.file.originalname
      );

      if (!result.success) {
        console.error(`[SCAN] Extraction failed: ${result.error}`);
        return res.status(400).json({
          success: false,
          data: null,
          error: result.error || 'Échec de l\'extraction des données véhicule',
        });
      }

      const { matricule, vin } = result.data;
      const isValidVIN = vin && vin.length === 17;

      if (!isValidVIN) {
        console.warn(`[SCAN] VIN invalide: "${vin}" (longueur: ${vin ? vin.length : 0})`);
      }

      console.log(`[SCAN] Extrait — Matricule: ${matricule} | VIN: ${vin}`);

      res.json({
        success: true,
        data: { matricule, vin, isValidVIN },
        error: null,
      });

    } catch (error) {
      console.error('[SCAN] Unexpected error:', error);

      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            success: false,
            data: null,
            error: 'Fichier trop grand (limite: 10 MB)',
          });
        }
        return res.status(400).json({
          success: false,
          data: null,
          error: `Erreur upload: ${error.message}`,
        });
      }

      res.status(500).json({
        success: false,
        data: null,
        error: error.message || 'Erreur interne lors du traitement de l\'image',
      });
    }
  });

  console.log('[ROUTES] Scan endpoint registered: POST /api/scan');
}

module.exports = { registerScanRoutes, upload };
