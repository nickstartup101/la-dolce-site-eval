// Serverless function — runs on Vercel's servers only.
// The Gemini key here is NEVER sent to the browser, unlike a key embedded in client-side JS.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCx8n7JH-E_DSSJhaZQ5v1btcCfcA024XM";
const GEMINI_MODEL = "gemini-2.5-flash";

const KPI_SCHEMA = `{
  "kpi": {
    "customer": {"score": number (0-20), "comment": string},
    "access": {"score": number (0-15), "comment": string},
    "competition": {"score": number (0-10), "comment": string},
    "parking": {"score": number (0-10), "comment": string},
    "facilities": {"score": number (0-10), "comment": string},
    "rental": {"score": number (0-10), "comment": string},
    "growth": {"score": number (0-15), "comment": string},
    "safety": {"score": number (0-10), "comment": string}
  },
  "overallScore": number (0-100, sum of the above),
  "status": one of ["excellent","recommended","review","not_recommended"],
  "summary": string (2-4 sentences, written in Lao language, professional franchise-consultant tone),
  "recommendations": array of 4-6 short strings in Lao language,
  "notes": array of 3-5 short observation strings in Lao language,
  "tags": array of 2-4 short Lao tag strings (e.g. "ຕົວເມືອງ", "ເໝາະສຳລັບກາເຟ")
}`;

function buildPrompt({ lat, lng, mapUrl, cafeCount }) {
  return `You are a franchise site-evaluation analyst for "La Dolce", a coffee/café franchise brand in Laos.
Evaluate the following business location and respond with STRICT JSON ONLY — no markdown fences, no prose before or after.

Location data:
- Coordinates: ${lat}, ${lng}
- Google Maps link: ${mapUrl}
- Nearby cafés/competitors found within 500m (from Google Places): ${cafeCount}

Score each KPI category using the maximum points shown, based on realistic assumptions for this kind of coordinate/area (road type, density, likely competition level, etc). Be specific and concise. Return JSON matching exactly this schema:

${KPI_SCHEMA}

Only output the JSON object, nothing else.`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed, use POST" });
    return;
  }

  try {
    const { lat, lng, mapUrl, cafeCount } = req.body || {};
    if (lat === undefined || lng === undefined) {
      res.status(400).json({ error: "Missing lat/lng in request body" });
      return;
    }

    const prompt = buildPrompt({ lat, lng, mapUrl, cafeCount });

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
        }),
      }
    );

    const upstreamData = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: "Gemini API error",
        status: upstream.status,
        details: upstreamData,
      });
      return;
    }

    const text =
      upstreamData?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      res.status(502).json({
        error: "Could not parse Gemini response as JSON",
        raw: text,
      });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
