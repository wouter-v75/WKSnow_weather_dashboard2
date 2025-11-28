/**
 * Minimal Test - Does refresh-data endpoint work at all?
 */

export default async function handler(req, res) {
  return res.status(200).json({
    success: true,
    message: "refresh-data endpoint works!",
    timestamp: new Date().toISOString(),
    query: req.query,
    method: req.method
  });
}
