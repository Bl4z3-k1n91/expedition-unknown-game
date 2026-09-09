export default function handler(_req, res) {
  res.statusCode = 410;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Event 2 is Manual Override: 50 tabular junction readings, not an image round.");
}
