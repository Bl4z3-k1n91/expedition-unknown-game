import { json } from "./_gateway.js";

export default function handler(_req, res) {
  return json(res, 410, { error: "Event 1 is outside the current scope. Operation Clearway begins here at Event 2: Manual Override." });
}
