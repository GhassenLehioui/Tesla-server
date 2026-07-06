// ═══════════════════════════════════════════════════════════════
//  Google Gemini 1.5 Flash Configuration
//  Handles vehicle registration card scanning and data extraction
// ═══════════════════════════════════════════════════════════════

const { GoogleGenAI } = require('@google/genai');

// ───────────────────────────────────────────────────────────────
//  Initialize Gemini Client
// ───────────────────────────────────────────────────────────────

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    '[Gemini] GEMINI_API_KEY is missing. Set it in your .env (local) ' +
      'or in your Render/Vercel environment variables.'
  );
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ───────────────────────────────────────────────────────────────
//  Extract Vehicle Data from Registration Card Image
// ───────────────────────────────────────────────────────────────

async function extractVehicleDataFromImage(imageBuffer, fileName) {
  try {
    if (!imageBuffer || imageBuffer.length === 0) {
      return { success: false, data: null, error: 'Image buffer is empty' };
    }

    if (!process.env.GEMINI_API_KEY) {
      return {
        success: false,
        data: null,
        error: 'GEMINI_API_KEY is not configured on the server',
      };
    }

    const base64Image = imageBuffer.toString('base64');
    const mediaType = getMediaType(fileName);

    const prompt = `Analyze this vehicle registration card (carte grise) image and extract ONLY the following information in valid JSON format:

{
  "matricule": "vehicle license plate (format: XX XXX XXX or similar)",
  "vin": "17-character Vehicle Identification Number"
}

IMPORTANT RULES:
- Return ONLY valid JSON, no extra text or markdown
- matricule: Extract the license plate number (keep original format)
- vin: Extract exactly 17 characters
- If you cannot find a field, set it to empty string ""
- Do not include any explanation or extra text`;

    // Appel à l'API Gemini — syntaxe compatible SDK @google/genai v1+
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-lite',
      config: {
        responseMimeType: 'application/json',
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Image,
                mimeType: mediaType,
              },
            },
          ],
        },
      ],
    });

    // Lecture du texte de la réponse (compatible toutes versions du SDK)
    const rawText = typeof response.text === 'function'
      ? response.text()
      : response.text;
    const responseText = (rawText || '').trim();

    if (!responseText) {
      return {
        success: false,
        data: null,
        error: 'Réponse vide reçue de Gemini 1.5 Flash',
      };
    }

    // Nettoyer les backticks markdown si Gemini en ajoute malgré responseMimeType
    const cleanText = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsedData;
    try {
      parsedData = JSON.parse(cleanText);
    } catch (parseError) {
      console.error("[Gemini] Erreur parsing JSON brut reçu :", cleanText);
      return {
        success: false,
        data: null,
        error: 'L\'API a renvoyé un format corrompu ou illisible.',
      };
    }

    const { matricule = '', vin = '' } = parsedData;

    if (vin && vin.length !== 17) {
      console.warn(`[Gemini] VIN length unexpected: "${vin}" (${vin.length})`);
    }

    return {
      success: true,
      data: { matricule, vin },
      error: null,
    };
  } catch (error) {
    console.error('[Gemini 1.5 Flash] Extraction error:', error);
    return {
      success: false,
      data: null,
      error: error.message || 'Failed to process image with Gemini 1.5 Flash',
    };
  }
}

// ───────────────────────────────────────────────────────────────
//  Helper: Determine Media Type from Filename
// ───────────────────────────────────────────────────────────────

function getMediaType(fileName) {
  if (!fileName) return 'image/jpeg';
  const ext = fileName.toLowerCase().split('.').pop();
  const mimeTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return mimeTypes[ext] || 'image/jpeg';
}

module.exports = {
  extractVehicleDataFromImage,
  ai
};