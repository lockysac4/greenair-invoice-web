"use strict";
/* Greenair Invoice v2.5 staging sync API.
 * Mount only after session middleware. Never enable on production without testing.
 * Uses existing records(record_key,record_type,payload,updated_at).
 */
const express = require("express");
const crypto = require("crypto");
function createSyncRouter(pool) {
  const router = express.Router();
  router.use((req,res,next)=>{
    if (!req.session || !req.session.user) return res.status(401).json({error:"authentication_required"});
    next();
  });
  const allowed = new Set(["customer","invoice","quote","payment","product","schedule"]);
  const hash = payload => crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  router.get("/status",async(req,res,next)=>{
    try {
      const r=await pool.query("SELECT COUNT(*)::int AS count, MAX(updated_at) AS latest FROM records");
      res.json({api:"greenair-sync",version:"2.5-staging",count:r.rows[0].count,latest:r.rows[0].latest});
    } catch(e){next(e);}
  });
  router.get("/changes",async(req,res,next)=>{
    try {
      const since = req.query.since ? new Date(req.query.since) : new Date(0);
      if(Number.isNaN(since.getTime())) return res.status(400).json({error:"invalid_since"});
      const limit = Math.min(Math.max(Number(req.query.limit)||200,1),500);
      const r=await pool.query(
        "SELECT record_key,record_type,payload,updated_at FROM records WHERE updated_at > $1 ORDER BY updated_at,record_key LIMIT $2",
        [since.toISOString(),limit]
      );
      res.json({records:r.rows.map(x=>({...x,revision:hash(x.payload)})),hasMore:r.rows.length===limit,
        nextSince:r.rows.length?r.rows[r.rows.length-1].updated_at:since.toISOString(),
        warning:"Timestamp-only cursor is insufficient for ties; production clients must use a composite cursor."});
    }catch(e){next(e);}
  });
  router.put("/record",async(req,res,next)=>{
    const {record_key,record_type,payload,expected_revision}=req.body||{};
    if(typeof record_key!=="string"||record_key.length>180||!record_key.startsWith(record_type+":")||
      !allowed.has(record_type)||!payload||typeof payload!=="object"||Array.isArray(payload)||
      (expected_revision!==null&&typeof expected_revision!=="string"))
      return res.status(400).json({error:"invalid_record"});
    const client=await pool.connect().catch(next); if(!client)return;
    try{
      await client.query("BEGIN");
      const existing=await client.query("SELECT payload FROM records WHERE record_key=$1 FOR UPDATE",[record_key]);
      const current=existing.rows[0];
      if(current && hash(current.payload)!==expected_revision){
        await client.query("ROLLBACK");
        return res.status(409).json({error:"conflict",server_revision:hash(current.payload)});
      }
      if(!current && expected_revision!==null){
        await client.query("ROLLBACK");
        return res.status(409).json({error:"missing_record"});
      }
      await client.query("INSERT INTO records(record_key,record_type,payload,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(record_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()",[record_key,record_type,payload]);
      await client.query("COMMIT");
      res.json({ok:true,revision:hash(payload)});
    }catch(e){await client.query("ROLLBACK").catch(()=>{});next(e);}finally{client.release();}
  });
  return router;
}
module.exports={createSyncRouter};
