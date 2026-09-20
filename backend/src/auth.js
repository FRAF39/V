import argon2 from "argon2";
export async function hashPassword(p) { return argon2.hash(p, {type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1}); }
export async function verifyPassword(hash,p) { try { return await argon2.verify(hash,p); } catch { return false; } }
export function requireAuth(req,res,next) { if (!req.session.user) return res.status(401).json({error:"Authentication required"}); next(); }
export function requireAdmin(req,res,next) { if (!req.session.user?.isAdmin) return res.status(403).json({error:"Admin only"}); next(); }
export function accountUsable(user) { return !!user && user.enabled && (!user.expires_at || new Date(user.expires_at) > new Date()); }
