import express from "express";
import cors from "cors";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: "60mb" }));

app.get("/", (req, res) => {
  res.json({ ok: true, endpoint: "POST /schaetzen" });
});

app.post("/schaetzen", async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt." });
    }

    const neu = req.body && req.body.neu;
    const referenzen = (req.body && req.body.referenzen) || [];

    if (!neu || !Array.isArray(neu.bereiche) || !neu.bereiche.length) {
      return res.status(400).json({ error: "Keine Vorher-Fotos für die Schätzung übergeben." });
    }

    const content = [];
    content.push({ type: "text", text: buildIntro(referenzen) });

    referenzen.forEach((job, i) => {
      content.push({
        type: "text",
        text: "\n--- Referenzauftrag " + (i + 1) + ": " + safe(job.marke) + " " + safe(job.modell) +
          " — tatsächlicher Preis: " + safe(job.preis) + " € — tatsächliche Dauer: " + fmtDauer(job.dauerSekunden) + " ---"
      });
      (job.bereiche || []).forEach((b) => {
        if (b.vorherBase64) {
          content.push({ type: "text", text: "Vorher-Foto (" + safe(b.name) + "):" });
          content.push(imgBlock(b.vorherBase64));
        }
        if (b.nachherBase64) {
          content.push({ type: "text", text: "Nachher-Foto (" + safe(b.name) + "):" });
          content.push(imgBlock(b.nachherBase64));
        }
      });
    });

    content.push({ type: "text", text: "\n--- Neuer Auftrag zur Schätzung: " + safe(neu.marke) + " " + safe(neu.modell) + " ---" });
    neu.bereiche.forEach((b) => {
      if (b.fotoBase64) {
        content.push({ type: "text", text: "Vorher-Foto (" + safe(b.name) + "):" });
        content.push(imgBlock(b.fotoBase64));
      }
    });

    content.push({
      type: "text",
      text: "Schätze jetzt für den neuen Auftrag einen fairen Preis in Euro und eine erwartete Dauer in Minuten, " +
        "basierend auf dem Verschmutzungsgrad und den Bereichen im Vergleich zu den Referenzaufträgen oben. " +
        "Antworte NUR mit einem JSON-Objekt, ohne weiteren Text, in diesem Format: " +
        "{\"preis\": <Zahl>, \"dauerMinuten\": <Zahl>, \"begruendung\": \"<kurzer Satz auf Deutsch>\"}"
    });

    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: content }]
      })
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      return res.status(502).json({ error: "Anthropic API Fehler (" + apiResp.status + "): " + errText });
    }

    const data = await apiResp.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    const match = text.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = JSON.parse(match ? match[0] : text);
    } catch (e) {
      return res.status(502).json({ error: "Antwort der KI konnte nicht gelesen werden.", raw: text });
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
});

function imgBlock(dataUrl) {
  const match = /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(dataUrl || "");
  const mediaType = match ? match[1] : "image/jpeg";
  const data = match ? match[2] : dataUrl;
  return { type: "image", source: { type: "base64", media_type: mediaType, data: data } };
}

function fmtDauer(sec) {
  if (!sec) return "unbekannt";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return (h ? h + "h " : "") + m + "min";
}

function safe(v) {
  return v === undefined || v === null ? "" : String(v);
}

function buildIntro(referenzen) {
  return "Du bist ein erfahrener Preisschätzer für mobile Fahrzeug-Innenreinigung und Fahrzeugaufbereitung. " +
    "Du bekommst gleich " + referenzen.length + " Referenzaufträge mit Fotos, dem tatsächlich berechneten Preis " +
    "und der tatsächlichen Arbeitszeit, danach die Vorher-Fotos eines neuen Fahrzeugs.";
}

app.listen(PORT, () => {
  console.log("valu-ki-server läuft auf Port " + PORT);
});
