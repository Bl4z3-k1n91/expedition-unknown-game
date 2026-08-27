export default function handler(_req, res) {
  res.status(200).json({ ok: true, service: "arcade-router", time: new Date().toISOString() });
}
