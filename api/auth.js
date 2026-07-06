// /api/auth - the password gate + public branding config for the frontend.
//   GET  -> { enabled, authed, config }  (config: appName, username,
//            homeChannels, daily - so the UI brands itself from config.js)
//   POST { password } -> sets the session cookie on success, else 401
//
// When APP_PASSWORD is unset the gate is off (enabled:false, authed:true).

import { authEnabled, checkAuth, verifyPassword, loginCookie } from '../auth.js'
import { config } from '../config.js'

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      enabled: authEnabled(),
      authed: checkAuth(req),
      config: {
        appName: config.appName,
        username: config.username,
        homeChannels: config.homeChannels,
        quickReplies: config.quickReplies || [],
        brands: config.brands || [],
        daily: config.daily,
      },
    })
    return
  }
  if (req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!verifyPassword(body.password)) {
      // small constant delay to blunt brute force
      await new Promise((r) => setTimeout(r, 400))
      res.status(401).json({ error: 'wrong password' })
      return
    }
    res.setHeader('Set-Cookie', loginCookie())
    res.status(200).json({ ok: true })
    return
  }
  res.status(405).json({ error: 'method not allowed' })
}
