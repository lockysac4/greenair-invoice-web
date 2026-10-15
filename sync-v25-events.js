"use strict";
// Greenair Invoice v2.5 staged sync API. Requires existing session middleware.
// Do not mount in production until migration and client tests are complete.
const express=require("express");
const crypto=require("crypto");
const types=new Set(["customer","invoice","quote","payment","product","schedule"]);
const revision=p=>crypto.createHash("sha256").update(JSON.stringify(p)).digest("hex");
function createSyncRouter(pool){
  const router=express.Router();
  router.use((req,res,next)=>req.session?.user?next():res.status(401).json({error:"authentication_required"}));
  async function initialize(){
    await pool.query(`CREATE TABLE IF NOT EXISTS sync_events(
      sequence BIGSERIAL PRIMARY KEY,
      record_key TEXT NOT NULL,
      record_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      revision TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query("CREATE INDEX IF NOT EXISTS sync_events_record_key_idx ON sync_events(record_key)");
  }
  router.get("/status",async(req,res,next)=>{
    try{
      const [records,events]=await Promise.all([
        pool.query("SELECT COUNT(*)::int AS count FROM records"),
        pool.query("SELECT COALESCE(MAX(sequence),0)::text AS cursor FROM sync_events")
      ]);
      res.json({version:"2.5-staging",record_count:records.rows[0].count,cursor:events.rows[0].cursor});
    }catch(e){next(e);}
  });
  router.get("/snapshot",async(req,res,next)=>{
    try{
      const limit=Math.min(Math.max(parseInt(req.query.limit,10)||100,1),250);
      const after=typeof req.query.after==="string"?req.query.after:"";
      const r=await pool.query("SELECT record_key,record_type,payload,updated_at FROM records WHERE record_key>$1 ORDER BY record_key LIMIT $2",[after,limit+1]);
      const page=r.rows.slice(0,limit);
      res.json({records:page.map(x=>({...x,revision:revision(x.payload)})),has_more:r.rows.length>limit,next_after:page.at(-1)?.record_key||after});
    }catch(e){next(e);}
  });
  router.get("/changes",async(req,res,next)=>{
    try{
      const cursor=String(req.query.cursor??"0");
      if(!/^(0|[1-9][0-9]{0,18})$/.test(cursor))return res.status(400).json({error:"invalid_cursor"});
      const limit=Math.min(Math.max(parseInt(req.query.limit,10)||100,1),250);
      const r=await pool.query("SELECT sequence::text AS sequence,record_key,record_type,payload,revision FROM sync_events WHERE sequence>$1::bigint ORDER BY sequence LIMIT $2",[cursor,limit+1]);
      const page=r.rows.slice(0,limit);
      res.json({changes:page,has_more:r.rows.length>limit,next_cursor:page.at(-1)?.sequence||cursor});
    }catch(e){next(e);}
  });
  router.put("/record",async(req,res,next)=>{
    const b=req.body||{};
    if(typeof b.record_key!=="string"||b.record_key.length>180||
      typeof b.record_type!=="string"||!types.has(b.record_type)||
      !b.record_key.startsWith(b.record_type+":")||
      !b.payload||typeof b.payload!=="object"||Array.isArray(b.payload)||
      !Object.prototype.hasOwnProperty.call(b,"expected_revision")||
      (b.expected_revision!==null&&!(typeof b.expected_revision==="string"&&/^[0-9a-f]{64}$/.test(b.expected_revision))))
      return res.status(400).json({error:"invalid_record_or_revision"});
    let client;
    try{
      client=await pool.connect();
      await client.query("BEGIN");
      // Serialize writes to this record, including first-time inserts.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[b.record_key]);
      const existing=await client.query("SELECT payload FROM records WHERE record_key=$1 FOR UPDATE",[b.record_key]);
      const old=existing.rows[0];
      if((!old&&b.expected_revision!==null)||(old&&revision(old.payload)!==b.expected_revision)){
        await client.query("ROLLBACK");
        return res.status(409).json({error:"conflict",current_revision:old?revision(old.payload):null});
      }
      await client.query("INSERT INTO records(record_key,record_type,payload,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(record_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()",[b.record_key,b.record_type,b.payload]);
      const rev=revision(b.payload);
      const e=await client.query("SELECT currval(pg_get_serial_sequence('sync_events','sequence'))::text AS sequence");
      await client.query("COMMIT");
      res.json({ok:true,revision:rev,cursor:e.rows[0].sequence});
    }catch(e){if(client)await client.query("ROLLBACK").catch(()=>{});next(e);}
    finally{client?.release();}
  });
  return {router,initialize};
}
module.exports={createSyncRouter};
