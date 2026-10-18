const nodemailer=require("nodemailer"),express=require("express"),{Pool}=require("pg"),session=require("express-session"),PgStore=require("connect-pg-simple")(session),bcrypt=require("bcryptjs"),helmet=require("helmet"),multer=require("multer");
const app=express(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}}),pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false});
app.set("trust proxy",1);app.use(helmet({contentSecurityPolicy:false}));app.use(express.urlencoded({extended:true,limit:"15mb"}));app.use(express.json({limit:"15mb"}));app.use(session({store:new PgStore({pool,tableName:"user_sessions",createTableIfMissing:true}),secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:43200000}}));
const Q=(s,p=[])=>pool.query(s,p),D=v=>{if(v&&v.Json!=null){try{return typeof v.Json==="string"?JSON.parse(v.Json):v.Json}catch{}}return v||{}},E=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),A=(req,res,n)=>req.session.user?n():res.redirect("/login");
async function init(){
  await Q("create table if not exists app_users(id bigserial primary key,email text unique not null,password_hash text not null,role text not null default 'admin',created_at timestamptz default now())");
  await Q("create table if not exists records(record_key text primary key,record_type text not null,payload jsonb not null,updated_at timestamptz default now())");
  await Q("create table if not exists backups(id bigserial primary key,created_at timestamptz default now(),record_count int not null,payload jsonb not null)");
  await Q("create table if not exists invoice_share_links(token_hash text primary key,record_key text not null references records(record_key),expires_at timestamptz not null,created_at timestamptz not null default now())");
  let n=(await Q("select count(*)::int n from app_users")).rows[0].n;
  if(!n&&process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD)await Q("insert into app_users(email,password_hash) values($1,$2)",[process.env.ADMIN_EMAIL.toLowerCase(),await bcrypt.hash(process.env.ADMIN_PASSWORD,12)]);
  // No automatic creation of sample or customer-specific invoices on startup.
  // Import data only via explicit authenticated import after backup review.
}
function L(t,b,u){return `<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>${E(t)}</title><style>body{font-family:system-ui;margin:0;background:#f3f6f4;color:#17221c}header{background:#143b2a;color:#fff;padding:15px 22px;display:flex;gap:18px;flex-wrap:wrap}header a{color:#fff;text-decoration:none}.w{max-width:1180px;margin:auto;padding:22px}.c{background:#fff;padding:18px;border-radius:12px;margin-bottom:16px;box-shadow:0 1px 5px #0002}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.m{font-size:30px;font-weight:700}input,button{padding:10px;border:1px solid #ccd2d8;border-radius:7px}button{background:#176b45;color:#fff;border:0}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}small{color:#667}@media print{header,.noprint{display:none!important}.w{max-width:none;padding:0}.c{box-shadow:none}}.job{max-width:340px} @media(max-width:700px){.w{padding:14px}header{padding:12px 14px;gap:12px}.c{padding:12px}h1{font-size:32px}}</style></head><body>${u?'<header><b>Greenair Invoice</b><a href="/">Dashboard</a><a href="/r/customer">Customers</a><a href="/r/invoice">Invoices</a><a href="/r/payment">Payments</a><a href="/r/product">Products</a><a href="/backup">Backup / Import</a><a href="/logout">Logout</a></header>':""}<main class=w>${b}</main></body></html>`}
app.get("/health",async(req,res)=>{try{await Q("SELECT 1");res.json({ok:true,database:"connected"});}catch(e){console.error("health database unavailable",e.code||e.message);res.status(503).json({ok:false,database:"unavailable"});}});
app.get("/setup",async(req,res)=>{let n=(await Q("select count(*)::int n from app_users")).rows[0].n;if(n)return res.redirect("/login");res.send(L("Create Admin",'<div class=c style="max-width:460px;margin:60px auto"><h1>Create Greenair Admin</h1><p>This page disables itself after the first account is created.</p><form method=post><p><input name=email type=email placeholder="Admin email" required style="width:90%"></p><p><input name=password type=password minlength=12 placeholder="Password (12+ characters)" required style="width:90%"></p><p><input name=confirm type=password minlength=12 placeholder="Confirm password" required style="width:90%"></p><button>Create administrator</button></form></div>'))});
app.post("/setup",async(req,res)=>{let n=(await Q("select count(*)::int n from app_users")).rows[0].n;if(n)return res.redirect("/login");let email=(req.body.email||"").trim().toLowerCase(),pw=req.body.password||"";if(!email||pw.length<12||pw!==req.body.confirm)return res.status(400).send(L("Setup","<div class=c>Email is required, passwords must match, and password must be at least 12 characters.</div>"));try{await Q("insert into app_users(email,password_hash,role) values($1,$2,'admin')",[email,await bcrypt.hash(pw,12)]);req.session.user={email};res.redirect("/")}catch(e){res.status(400).send(L("Setup","<div class=c>Administrator setup could not be completed.</div>"))}});

app.get("/login",(req,res)=>res.send(L("Login",'<div class=c style="max-width:420px;margin:60px auto"><h1>Greenair Invoice</h1><form method=post><p><input name=email type=email placeholder=Email required></p><p><input name=password type=password placeholder=Password required></p><button>Sign in</button></form></div>')));
app.post("/login",async(req,res)=>{let u=(await Q("select * from app_users where email=$1",[(req.body.email||"").toLowerCase()])).rows[0];if(!u||!await bcrypt.compare(req.body.password||"",u.password_hash))return res.status(401).send(L("Login","<div class=c>Invalid login.</div>"));req.session.user={email:u.email};res.redirect("/")});app.get("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/login")));
app.get("/",(req,res)=>A(req,res,async()=>{let body=`<style>.home{max-width:680px;margin:auto;text-align:center}.logo{background:linear-gradient(#087c19,#1e9c31,#075c13);color:#ddd;font-family:Georgia,serif;font-weight:700;font-size:clamp(42px,10vw,78px);letter-spacing:4px;padding:10px;border:3px solid #163d1d;text-shadow:2px 2px 3px #222;margin-bottom:12px}.subtitle{font-size:28px;font-weight:300;margin:12px 0 35px}.homebtn{display:block;background:#65b849;color:white;text-decoration:none;font-size:30px;font-weight:300;padding:34px 15px;margin:0 0 24px;border-radius:0;box-shadow:0 2px 3px #0002}.settings{display:block;background:#d9dcdb;color:#333;text-decoration:none;font-size:20px;padding:18px;margin-top:38px}.version{color:#999;margin-top:12px}@media(max-width:600px){header{display:none}.w{padding:28px 26px}.homebtn{font-size:28px;padding:31px 12px}.subtitle{font-size:26px}.logo{font-size:50px}}</style><div class=home><div class=logo>GREENAIR</div><div class=subtitle>INVOICING</div><a class=homebtn href="/invoice/new">NEW INVOICE</a><a class=homebtn href="/quote/new">NEW QUOTE</a><a class=homebtn href="/r/customer">CLIENTS</a><a class=homebtn href="/r/invoice">VIEWED INVOICES</a><a class=settings href="/backup">More / Settings</a><div class=version>Greenair Web Invoice • v0.4.0 • Secure cloud database</div></div>`;res.send(L("Greenair Invoicing",body,req.session.user))}));
app.get("/r/:type",(req,res)=>A(req,res,async()=>{let t=req.params.type.toLowerCase(),search=(req.query.q||"").trim(),p=[t],sql="select record_key,payload,updated_at from records where record_type=$1";if(search){sql+=" and payload::text ilike $2";p.push("%"+search+"%")}sql+=" order by updated_at desc limit 500";let rows=(await Q(sql,p)).rows;if(t==="customer"){const val=(v,...ks)=>{for(const k of ks)if(v[k]!=null&&String(v[k]).trim())return v[k];return ""};let body=rows.map(r=>{let v=D(r.payload),name=val(v,"Name","CustomerName","CompanyName","DisplayName","ContactName"),phone=val(v,"Phone","PhoneNumber","Mobile","MobileNumber","Telephone"),email=val(v,"Email","EmailAddress"),addr=val(v,"Address","StreetAddress","BillingAddress","PostalAddress");if(addr&&typeof addr==="object")addr=[addr.Line1,addr.Line2,addr.Suburb,addr.State,addr.Postcode].filter(Boolean).join(", ");let id=r.record_key.split(":").slice(1).join(":");return `<tr><td><a href="/edit/customer/${encodeURIComponent(id)}"><b>${E(name||"Unnamed customer")}</b></a></td><td>${E(phone)}</td><td>${E(email)}</td><td>${E(addr)}</td></tr>`}).join("");return res.send(L("Customers",`<h1>Customers</h1><p><a href="/customer/new"><button>+ New Customer</button></a></p><div class=c><form><input name=q value="${E(search)}" placeholder="Search name, phone, email or address"><button>Search</button></form></div><div class="c scroll"><table><tr><th>Customer / Company</th><th>Phone</th><th>Email</th><th>Address</th></tr>${body}</table></div>`,req.session.user))}if(t==="invoice"){const money=n=>"$"+Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{if(!x)return "";let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")},desc=v=>{let a=Array.isArray(v.Items)?v.Items:[];return a.map(i=>i.Description||"").filter(Boolean).join("; ").slice(0,120)},status=v=>{let x=v.Status;return typeof x==="string"?x:(x===6?"Paid":x===0?"Draft":String(x??""))};let body=rows.map(r=>{let v=D(r.payload);let id=r.record_key.split(":").slice(1).join(":");return `<tr><td><a href="/invoice/view/${encodeURIComponent(id)}"><b>${E(v.Number||"")}</b></a></td><td>${E(v.CustomerName||"")}</td><td>${E(date(v.IssueDate))}</td><td class=job>${E(desc(v))}</td><td><b>${E(money(v.Total))}</b></td><td>${E(status(v))}</td></tr>`}).join("");return res.send(L("Invoices",`<h1>Invoices</h1><p><a href="/invoice/new"><button>+ New Invoice</button></a></p><div class=c><form><input name=q value="${E(search)}" placeholder="Search invoice, customer or job"><button>Search</button></form></div><div class="c scroll"><table><tr><th>Invoice No.</th><th>Customer</th><th>Date</th><th>Job / Description</th><th>Total</th><th>Status</th></tr>${body}</table></div>`,req.session.user))}res.send(L(t,`<h1>${E(t)}s</h1><div class=c><form><input name=q value="${E(search)}" placeholder=Search><button>Search</button></form></div><div class="c scroll"><table><tr><th>Record</th><th>Details</th></tr>${rows.map(r=>`<tr><td>${E(r.record_key)}</td><td><small>${E(JSON.stringify(r.payload).slice(0,400))}</small></td></tr>`).join("")}</table></div>`,req.session.user))}));
app.get("/schema/:type",(req,res)=>A(req,res,async()=>{let t=req.params.type.toLowerCase(),rows=(await Q("select payload from records where record_type=$1 limit 50",[t])).rows,counts={};for(const r of rows)for(const k of Object.keys(r.payload||{}))counts[k]=(counts[k]||0)+1;res.json({type:t,sampled:rows.length,fields:Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}))})}));
const U=()=>require("crypto").randomUUID(),J=v=>JSON.stringify(v),pick=(v,...ks)=>{for(const k of ks)if(v[k]!=null)return v[k];return ""};
app.get("/customer/new",(req,res)=>A(req,res,()=>res.send(L("New Customer",`<h1>New Customer</h1><div class=c><form method=post><p><input name=Name placeholder="Customer / Company name" required></p><p><input name=Phone placeholder="Phone"></p><p><input name=Email type=email placeholder="Email"></p><p><input name=Address placeholder="Address"></p><button>Create Customer</button></form></div>`,req.session.user))));
app.post("/customer/new",(req,res)=>A(req,res,async()=>{let id=U(),v={Name:req.body.Name||"",Phone:req.body.Phone||"",Email:req.body.Email||"",Address:req.body.Address||""};await Q("insert into records(record_key,record_type,payload) values($1,'customer',$2)",["customer:"+id,{Id:id,Key:"customer:"+id,Type:"customer",Deleted:false,Json:J(v)}]);res.redirect("/r/customer")}));
app.get("/invoice/new",(req,res)=>A(req,res,async()=>{let invs=(await Q("select payload from records where record_type='invoice'")).rows.map(r=>D(r.payload)),nums=invs.map(v=>String(v.Number||"").trim()).filter(x=>/^21\d{3}$/.test(x)).map(Number),nextNo=Math.max(21474,...nums)+1,cs=(await Q("select record_key,payload from records where record_type='customer' limit 1000")).rows.map(r=>({key:r.record_key,v:D(r.payload)})),ps=(await Q("select payload from records where record_type='product' limit 2000")).rows.map(r=>D(r.payload));let opts=cs.map(x=>`<option value="${E(x.key)}">${E(pick(x.v,"Name","CustomerName","CompanyName")||x.key)}</option>`).join(""),products=ps.map(p=>({n:pick(p,"Name","ProductName","Description","Item"),d:pick(p,"Description","Name","ProductName"),price:Number(pick(p,"Price","SellPrice","UnitPrice","Rate")||0)})).filter(p=>p.n).sort((a,b)=>String(a.n).localeCompare(String(b.n)));let po=products.map(p=>`<option value="${E(p.n)}" data-desc="${E(p.d)}" data-price="${p.price}">${E(p.n)}${p.price?" - $"+p.price.toFixed(2):""}</option>`).join("");res.send(L("New Invoice",`<style>.line{display:grid;grid-template-columns:2fr 3fr .7fr 1fr auto;gap:7px;margin:8px 0}.line input,.line select{width:100%;box-sizing:border-box}@media(max-width:700px){.line{grid-template-columns:1fr}.line button{width:100%}}</style><h1>New Invoice</h1><div class=c><form method=post id=inv><p><label>Customer<br><select name=customerKey required style="padding:10px;width:100%">${opts}</select></label></p><p><label>Invoice Number<br><input name=Number value="${E(String(nextNo))}" readonly></label></p><p><input name=IssueDate type=date></p><div id=lines></div><p><button type=button onclick="addLine()">+ ADD EXTRA LINE</button></p><p><b>Total: $<span id=tot>0.00</span></b></p><p><select name=Status><option>Draft</option><option>Sent</option><option>Paid</option></select></p><button>Create Invoice</button></form></div><template id=row><div class=line><select name=Product onchange="prod(this)"><option value="">Select product...</option>${po}</select><input name=Description placeholder="Description / extra details"><input name=Quantity type=number step=.01 min=0 value=1 oninput=calc()><input name=UnitPrice type=number step=.01 min=0 placeholder="Rate" oninput=calc()><button type=button onclick="this.parentElement.remove();calc()">Remove</button></div></template><script>function addLine(){lines.append(row.content.cloneNode(true));calc()}function prod(s){let o=s.options[s.selectedIndex],r=s.closest(".line");if(o.value){r.querySelector("[name=Description]").value=o.dataset.desc||o.value;r.querySelector("[name=UnitPrice]").value=o.dataset.price||0}calc()}function calc(){let t=0;document.querySelectorAll(".line").forEach(r=>t+=(+r.querySelector("[name=Quantity]").value||0)*(+r.querySelector("[name=UnitPrice]").value||0));tot.textContent=t.toFixed(2)}addLine()</script>`,req.session.user))}));
app.post("/invoice/new",(req,res)=>A(req,res,async()=>{let c=(await Q("select payload from records where record_key=$1",[req.body.customerKey])).rows[0],cv=c?D(c.payload):{},id=U(),arr=x=>Array.isArray(x)?x:[x],ds=arr(req.body.Description||""),qs=arr(req.body.Quantity||1),us=arr(req.body.UnitPrice||0),pn=arr(req.body.Product||""),items=ds.map((d,i)=>({Product:pn[i]||"",Description:d||"",Quantity:Number(qs[i]||1),UnitPrice:Number(us[i]||0)})).filter(x=>x.Description||x.Product),total=items.reduce((a,x)=>a+x.Quantity*x.UnitPrice,0),v={Number:req.body.Number||"",CustomerKey:req.body.customerKey,CustomerName:pick(cv,"Name","CustomerName","CompanyName"),CustomerAddress:pick(cv,"Address","StreetAddress","BillingAddress"),CustomerEmail:pick(cv,"Email","EmailAddress"),IssueDate:req.body.IssueDate||new Date().toISOString(),Items:items,Subtotal:total/1.1,Gst:total-total/1.1,Total:total,Status:req.body.Status||"Draft"};await Q("insert into records(record_key,record_type,payload) values($1,'invoice',$2)",["invoice:"+id,{Id:id,Key:"invoice:"+id,Type:"invoice",Deleted:false,Json:J(v)}]);res.redirect("/invoice/view/"+id)}));
app.get("/edit/:type/:id",(req,res)=>A(req,res,async()=>{let key=req.params.type+":"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Not found");let v=D(r.payload),fields=req.params.type==="customer"?["Name","Phone","Email","Address"]:["Number","CustomerName","IssueDate","Total","Status"];res.send(L("Edit",`<h1>Edit ${E(req.params.type)}</h1><div class=c><form method=post>${fields.map(k=>`<p><label>${E(k)}<br><input name="${E(k)}" value="${E(pick(v,k))}" style="width:90%"></label></p>`).join("")}<button>Save Changes</button></form></div>`,req.session.user))}));
app.post("/edit/:type/:id",(req,res)=>A(req,res,async()=>{let key=req.params.type+":"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Not found");let outer=r.payload||{},v=D(outer);for(const[k,val]of Object.entries(req.body))v[k]=k==="Total"?Number(val||0):val;outer.Json!=null?outer.Json=J(v):outer=v;await Q("update records set payload=$2,updated_at=now() where record_key=$1",[key,outer]);res.redirect("/r/"+req.params.type)}));
app.get("/greenair-logo",(req,res)=>res.redirect("https://greenair-bacnet-explorer-web.onrender.com/favicon.ico"));
app.get("/track/invoice/:id.gif",async(req,res)=>{try{let key="invoice:"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(r){let o=r.payload||{},v=D(o);v.EmailOpenedUtc=v.EmailOpenedUtc||new Date().toISOString();v.EmailStatus="Opened";o.Json!=null?o.Json=J(v):o=v;await Q("update records set payload=$2,updated_at=now() where record_key=$1",[key,o])}}catch(e){console.error("track",e)}res.set("Content-Type","image/gif");res.set("Cache-Control","no-store, no-cache, must-revalidate, private");res.send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","base64"))});
app.post("/invoice/send/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!process.env.RESEND_API_KEY)return res.status(503).send(L("Email setup required",'<h1>Email setup required</h1><div class=c>Add RESEND_API_KEY in Render.</div>',req.session.user));
    const key="invoice:"+req.params.id;
    const r=(await Q("select payload from records where record_key=$1",[key])).rows[0];
    if(!r)return res.status(404).send("Invoice not found");
    let o=r.payload||{},v=D(o),email=v.CustomerEmail||v.Email||"";
    if(!email&&v.CustomerKey){
      const c=(await Q("select payload from records where record_key=$1",[v.CustomerKey])).rows[0];
      if(c)email=pick(D(c.payload),"Email","EmailAddress");
    }
    if(!email)return res.status(400).send(L("No customer email",'<h1>No customer email</h1><div class=c>Add an email address to this customer before sending the invoice.</div>',req.session.user));
    const base=(process.env.PUBLIC_URL||("https://"+req.get("host"))).replace(/\/$/,"");
    const track=base+"/track/invoice/"+encodeURIComponent(req.params.id)+".gif";
    const view=base+"/invoice/view/"+encodeURIComponent(req.params.id);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    let api;
    try{
      api=await fetch("https://api.resend.com/emails",{
        method:"POST",
        signal:controller.signal,
        headers:{
          "Authorization":"Bearer "+process.env.RESEND_API_KEY,
          "Content-Type":"application/json",
          "Idempotency-Key":"greenair-invoice-"+req.params.id+"-"+String(v.Number||"")
        },
        body:JSON.stringify({
          from:process.env.EMAIL_FROM||"Greenair <onboarding@resend.dev>",
          to:[email],
          reply_to:process.env.EMAIL_REPLY_TO||"greenair.controls@gmail.com",
          subject:"Greenair Tax Invoice "+(v.Number||""),
          text:"Hi "+(v.CustomerName||"")+",\n\nYour Greenair Tax Invoice "+(v.Number||"")+" is ready: "+view+"\n\nThank you,\nGreenair",
          html:'<p>Hi '+E(v.CustomerName||"")+',</p><p>Your Greenair Tax Invoice <b>'+E(v.Number||"")+'</b> is ready.</p><p><a href="'+view+'">View invoice</a></p><p>Thank you,<br>Greenair</p><img src="'+track+'" width="1" height="1" alt="">'
        })
      });
    }finally{clearTimeout(timer)}
    const data=await api.json().catch(()=>({}));
    if(!api.ok)throw Error(data.message||data.name||("Email API returned "+api.status));
    v.EmailStatus="Sent";v.EmailSentUtc=new Date().toISOString();v.EmailProvider="Resend";v.EmailProviderId=data.id||"";
    if(o.Json!=null)o.Json=J(v);else o=v;
    await Q("update records set payload=$2,updated_at=now() where record_key=$1",[key,o]);
    res.redirect("/invoice/view/"+encodeURIComponent(req.params.id));
  }catch(e){
    console.error("invoice email",e);
    const msg=e.name==="AbortError"?"Email service timed out. Please try again.":e.message;
    res.status(502).send(L("Invoice email failed",'<h1>Invoice email failed</h1><div class=c>'+E(msg)+'</div><p><a href="/invoice/view/'+encodeURIComponent(req.params.id)+'">Back to invoice</a></p>',req.session.user));
  }
}));
// Expiring read-only customer invoice links. Treat tokens as confidential.
app.get("/invoice/shared/:token",async(req,res)=>{
  res.set("Cache-Control","no-store").set("Referrer-Policy","no-referrer").set("X-Robots-Tag","noindex, nofollow");
  if(!/^[a-f0-9]{64}$/.test(req.params.token))return res.status(404).send("Link unavailable");
  try{
    const hash=require("crypto").createHash("sha256").update(req.params.token).digest("hex");
    const q=await Q("SELECT records.payload FROM invoice_share_links JOIN records ON records.record_key=invoice_share_links.record_key WHERE token_hash=$1 AND expires_at>now() AND records.record_type='invoice'",[hash]);
    if(!q.rowCount)return res.status(404).send("Link expired or unavailable");
    const v=D(q.rows[0].payload),money=n=>Number(n||0).toFixed(2),items=Array.isArray(v.Items)?v.Items:[];
    const rows=items.map(i=>"<tr><td>"+E(i.Description||i.Name||"")+"</td><td>"+E(i.Quantity||1)+"</td><td>"+money(i.UnitPrice||i.Rate)+"</td></tr>").join("");
    const html='<style>.paper{max-width:800px;margin:auto}.brand{background:#087b20;color:#fff;padding:16px;font-size:28px;font-weight:bold}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}</style><div class="c paper"><div class=brand>GREENAIR</div><h1>Tax Invoice '+E(v.Number||"")+'</h1><p>Invoice to: '+E(v.CustomerName||"")+'</p><table><tr><th>Activity</th><th>Qty</th><th>Rate</th></tr>'+rows+'</table><h2>Total A$'+money(v.Total)+'</h2><p>Greenair, Adelaide SA</p><button onclick="window.print()">Print / Save PDF</button></div>';
    res.send(L("Greenair Tax Invoice",html,false));
  }catch(e){console.error("invoice share",e.message);res.status(503).send("Invoice unavailable");}
});
app.get("/invoice/email/:id",(req,res)=>A(req,res,async()=>{
  try{
    const key="invoice:"+req.params.id;
    const r=await Q("SELECT payload FROM records WHERE record_key=$1 AND record_type='invoice'",[key]);
    if(!r.rowCount)return res.status(404).send("Invoice not found");
    const v=D(r.rows[0].payload);
    let email=v.CustomerEmail||v.Email||"";
    if(!email&&v.CustomerKey){
      const c=await Q("SELECT payload FROM records WHERE record_key=$1",[v.CustomerKey]);
      if(c.rowCount)email=pick(D(c.rows[0].payload),"Email","EmailAddress");
    }
    if(!email)return res.status(400).send(L("Missing email",'<div class=c>Add a customer email first.</div>',req.session.user));
    const crypto=require("crypto"),token=crypto.randomBytes(32).toString("hex");
    const hash=crypto.createHash("sha256").update(token).digest("hex");
    await Q("INSERT INTO invoice_share_links(token_hash,record_key,expires_at) VALUES($1,$2,now()+interval '30 days')",[hash,key]);
    const view="https://greenair-invoice-v25-staging.onrender.com/invoice/shared/"+token;
    const subject="Greenair Tax Invoice "+(v.Number||"");
    const body=["Hi "+(v.CustomerName||"")+",","","Your Greenair Tax Invoice "+(v.Number||"")+" is available here:",view,"","This link expires in 30 days.","","Thank you,","Greenair"].join(String.fromCharCode(13,10));
    const mailto="mailto:"+encodeURIComponent(email)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    const html='<h1>Email invoice '+E(v.Number||"")+'</h1><div class=c><p>To: '+E(email)+'</p><p>The email draft includes a private invoice link. It expires after 30 days.</p><p><a href="'+E(mailto)+'">Open email app with invoice link</a></p><p><a href="'+E(view)+'" target="_blank" rel="noopener noreferrer">Test customer invoice link</a></p><p><a href="/invoice/view/'+encodeURIComponent(req.params.id)+'">Back to invoice</a></p><small>No email is sent until you press Send in your email app.</small></div>';
    res.set("Cache-Control","no-store").send(L("Email invoice",html,req.session.user));
  }catch(e){console.error("email draft",e.message);res.status(503).send(L("Email error",'<div class=c>Could not prepare the invoice email.</div>',req.session.user));}
}));
app.get("/invoice/view/:id",(req,res)=>A(req,res,async()=>{let key="invoice:"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Invoice not found");let v=D(r.payload),items=Array.isArray(v.Items)?v.Items:[],money=n=>Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")};let total=Number(v.Total||0),subtotal=v.Subtotal!=null?Number(v.Subtotal):total/1.1,gst=v.Gst!=null?Number(v.Gst):total-subtotal;let rows=items.map(i=>`<tr><td>${E(i.Description||i.Name||"")}</td><td>${E(i.Quantity||1)}</td><td>${E(money(i.UnitPrice||i.Rate))}</td><td>${E(money(Number(i.Quantity||1)*Number(i.UnitPrice||i.Rate||0)))}</td></tr>`).join("");res.send(L("Invoice "+(v.Number||""),`<style>.inv{background:#fff;max-width:900px;margin:auto;padding:34px;color:#444}.green{color:#69ad45}.invtop{display:flex;justify-content:space-between;gap:30px}.brand{text-align:right;min-width:300px}.brand h1{font-size:30px;font-weight:400;margin:18px 0 0}.logoFix{width:280px;max-width:100%;box-sizing:border-box;background:linear-gradient(180deg,#075d12,#159a29 48%,#064d0e);border:3px solid #173c1d;color:#f1f1f1;font-family:Georgia,serif;font-size:38px;line-height:1;font-weight:700;letter-spacing:2px;text-align:center;padding:10px 12px;text-shadow:2px 2px 2px #222;white-space:nowrap;overflow:hidden}.bill{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:24px 0}.meta td{padding:3px 12px 3px 0;border:0}.items{width:100%;border-collapse:collapse}.items th{background:#e4f1dc;text-align:left;font-weight:400;padding:8px}.items td{padding:8px;border:0}.totals{margin:250px 0 55px auto;width:300px}.totals td{border:0;padding:5px}.balance{font-size:22px;color:#69ad45}.pay{background:#e4f1dc;padding:16px;display:flex;justify-content:space-between}.case{margin:25px 0}.actions{margin:18px auto;max-width:900px}@media(max-width:600px){.w{padding:8px}.inv{padding:16px;overflow:hidden}.invtop,.bill,.pay{display:block}.brand{text-align:left;margin-top:18px;min-width:0}.brand h1{margin-top:14px}.logoFix{width:100%;font-size:32px;letter-spacing:1px;padding:10px 8px}.brand img{margin-left:0!important;max-height:90px;object-fit:contain}.bill{margin-top:18px}.meta{width:100%;min-width:0!important;table-layout:fixed}.meta td{font-size:14px;overflow-wrap:anywhere}.items{width:100%!important;min-width:0!important;table-layout:fixed;font-size:11px}.items th,.items td{padding:6px 3px;overflow-wrap:anywhere}.items th:first-child,.items td:first-child{width:44%}.totals{margin-top:80px;width:100%;min-width:0}.pay{font-size:13px;overflow-wrap:anywhere}}@media print{@page{size:A4;margin:12mm}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}header,.actions{display:none!important}.inv{max-width:none;padding:12px}.w{max-width:none;padding:0}.logoFix{background:#087b20!important;color:#fff!important;border:3px solid #173c1d!important}.items th,.pay{background:#e4f1dc!important}.green,.balance{color:#69ad45!important}}</style><div class=inv><div class=invtop><div><b>Greenair</b><br>ABN 60202774371<br>Adelaide, SA<br>Locky 0412 395 325 | Brayden 0434 807 232<br>greenair.controls@gmail.com</div><div class=brand><div class="logoFix">GREENAIR</div><h1 class=green>Tax Invoice</h1></div></div><div class=bill><div><span class=green>INVOICE TO</span><br><br><b>${E(v.CustomerName||"")}</b><br>${E(v.CustomerAddress||v.Address||"")}</div><table class=meta><tr><td>INVOICE</td><td>${E(v.Number||"")}</td></tr><tr><td>DATE</td><td>${E(date(v.IssueDate))}</td></tr><tr><td>TERMS</td><td>${E(v.Terms||"Due on receipt")}</td></tr><tr><td>DUE DATE</td><td>${E(date(v.DueDate||v.IssueDate))}</td></tr></table></div><p><b>Email status:</b> ${E(v.EmailStatus||"Not sent")}${v.EmailSentUtc?" • Sent "+E(date(v.EmailSentUtc)):""}${v.EmailOpenedUtc?" • Opened "+E(new Date(v.EmailOpenedUtc).toLocaleString("en-AU")):""}</p><div class=case>CASE NO &nbsp;&nbsp;&nbsp;&nbsp; ${E(v.CaseNo||v.Job||v.Description||"")}</div><table class=items><tr><th>ACTIVITY</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr>${rows}</table><table class=totals><tr><td>SUBTOTAL</td><td>${money(subtotal)}</td></tr><tr><td>GST TOTAL</td><td>${money(gst)}</td></tr><tr><td>TOTAL</td><td>${money(total)}</td></tr><tr class=balance><td>BALANCE DUE</td><td>A$${money(total)}</td></tr></table><div class=pay><div><b>BANK TRANSFER</b><br>Account: Lochlan Weeks<br>BSB: 062-692 &nbsp;&nbsp; Account: 83543903<br>Reference: ${E(v.Number||"")}</div><div class=green>PAYMENT</div></div></div><div class=actions><a href="/edit/invoice/${encodeURIComponent(req.params.id)}"><button>Edit Invoice</button></a> <button onclick="window.print()">Print / Save PDF</button> <a href="/invoice/email/${encodeURIComponent(req.params.id)}" target="_blank" rel="noopener"><button type=button>Email Invoice</button></a></div>`,req.session.user))}));
app.get("/backup",(req,res)=>A(req,res,()=>res.send(L("Backup",'<h1>Backup & Migration</h1><div class=c><h2>Import Greenair v2 JSON</h2><form method=post action="/import" enctype="multipart/form-data"><input type=file name=backup accept=".json" required> <button>Import</button></form></div><div class=c><form method=post action="/snapshot"><button>Create server snapshot</button></form><p><a href="/export">Download current JSON export</a></p></div>',req.session.user))));
app.post("/import",upload.single("backup"),(req,res)=>A(req,res,async()=>{try{let d=JSON.parse(req.file.buffer.toString()),r=d.Records||d.records;if(!r)throw Error("No Records map found");let c=await pool.connect();try{await c.query("begin");for(let[k,v]of Object.entries(r)){let t=k.includes(":")?k.split(":")[0]:(v.Type||v.type||"unknown").toLowerCase();await c.query("insert into records(record_key,record_type,payload) values($1,$2,$3) on conflict(record_key) do update set record_type=excluded.record_type,payload=excluded.payload,updated_at=now()",[k,t,v])}await c.query("commit")}catch(e){await c.query("rollback");throw e}finally{c.release()}res.redirect("/")}catch(e){res.status(400).send(L("Import error",'<div class=c>'+E(e.message)+'</div>',req.session.user))}}));
app.post("/snapshot",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows,o=Object.fromEntries(r.map(x=>[x.record_key,x.payload]));await Q("insert into backups(record_count,payload) values($1,$2)",[r.length,o]);await Q("delete from backups where id not in(select id from backups order by id desc limit 50)");res.redirect("/backup")}));
app.get("/export",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows;res.setHeader("Content-Disposition",'attachment; filename="greenair-web-backup.json"');res.json({SchemaVersion:2,ExportedUtc:new Date().toISOString(),Records:Object.fromEntries(r.map(x=>[x.record_key,x.payload]))})}));
// Staging-only scheduled database snapshots. These are NOT offsite disaster recovery.
const SNAPSHOT_INTERVAL_MS=24*60*60*1000;
async function scheduledSnapshot(){
  if(process.env.ENABLE_STAGING_SNAPSHOTS!=="true")return;
  const client=await pool.connect();
  let locked=false;
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(25370025) AS locked");
    locked=lock.rows[0].locked;
    if(!locked)return;
    await client.query("BEGIN");
    const recent=await client.query("SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1");
    if(recent.rows.length && Date.now()-new Date(recent.rows[0].created_at).getTime()<20*60*60*1000){
      await client.query("COMMIT");return;
    }
    const records=await client.query("SELECT record_key,payload FROM records ORDER BY record_key");
    const data=Object.fromEntries(records.rows.map(r=>[r.record_key,r.payload]));
    await client.query("INSERT INTO backups(record_count,payload) VALUES($1,$2)",[records.rowCount,data]);
    await client.query("DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 14)");
    await client.query("COMMIT");
    console.log("Scheduled staging snapshot completed; records:",records.rowCount);
  }catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    console.error("Scheduled staging snapshot failed:",err.message);
  }finally{
    if(locked)await client.query("SELECT pg_advisory_unlock(25370025)").catch(()=>{});
    client.release();
  }
}
// Portable offsite export of a retained snapshot, with an integrity digest.
// Download to a separate device or cloud drive; snapshots in this database are not offsite.
app.get("/backup/download/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).send("Invalid snapshot ID");
    const r=await Q("SELECT id,created_at,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).send("Snapshot not found");
    const snapshot=r.rows[0],records=snapshot.payload||{};
    if(!records||typeof records!=="object"||Array.isArray(records))throw Error("Invalid snapshot contents");
    const keys=Object.keys(records).sort();
    if(keys.length!==snapshot.record_count)throw Error("Snapshot record count mismatch");
    const ordered=Object.fromEntries(keys.map(k=>[k,records[k]]));
    const crypto=require("crypto");
    const digest=crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
    const date=new Date(snapshot.created_at).toISOString().slice(0,10);
    const exportData={SchemaVersion:2,ExportedUtc:new Date().toISOString(),SnapshotId:String(snapshot.id),SnapshotCreatedUtc:snapshot.created_at,RecordCount:keys.length,RecordsSha256:digest,Records:ordered};
    res.set("Cache-Control","no-store");
    res.set("X-Content-Type-Options","nosniff");
    res.set("Content-Disposition",'attachment; filename="greenair-invoice-v25-snapshot-'+date+'-'+snapshot.id+'.json"');
    res.type("application/json").send(JSON.stringify(exportData));
  }catch(err){
    console.error("snapshot export failed",err.message);
    res.status(500).send("Snapshot integrity check failed or export unavailable");
  }
}));
app.get("/backup/verify/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).json({ok:false,error:"invalid_snapshot_id"});
    const r=await Q("SELECT id,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).json({ok:false,error:"snapshot_not_found"});
    const snapshot=r.rows[0],data=snapshot.payload;
    const valid=!!data&&typeof data==="object"&&!Array.isArray(data)&&Object.keys(data).length===snapshot.record_count;
    res.set("Cache-Control","no-store").json({ok:valid,snapshot_id:String(snapshot.id),record_count:snapshot.record_count,storage:"same_database",restore_tested:false});
  }catch(e){res.status(503).json({ok:false,error:"verification_unavailable"});}
}));
app.get("/backup/status",(req,res)=>A(req,res,async()=>{
  try{
    const result=await Q("SELECT id,created_at,record_count FROM backups ORDER BY id DESC LIMIT 14");
    res.json({snapshots_enabled:process.env.ENABLE_STAGING_SNAPSHOTS==="true",storage:"same_postgres_database_not_offsite",snapshots:result.rows});
  }catch(e){res.status(503).json({error:"backup_status_unavailable"});}
}));
const PORT=Number(process.env.PORT)||10000;app.listen(PORT,"0.0.0.0",()=>console.log(`Greenair Invoice listening on ${PORT}`));init().then(()=>{console.log("Database initialised");scheduledSnapshot();setInterval(scheduledSnapshot,SNAPSHOT_INTERVAL_MS).unref();}).catch(e=>console.error("Database init error",e));+money(i.UnitPrice||i.Rate)+'</td><td>
  try{
    const key="invoice:"+req.params.id;
    const r=(await Q("select payload from records where record_key=$1",[key])).rows[0];
    if(!r)return res.status(404).send("Invoice not found");
    const v=D(r.payload);
    let email=v.CustomerEmail||v.Email||"";
    if(!email&&v.CustomerKey){
      const c=(await Q("select payload from records where record_key=$1",[v.CustomerKey])).rows[0];
      if(c)email=pick(D(c.payload),"Email","EmailAddress");
    }
    if(!email)return res.status(400).send(L("No customer email",'<h1>No customer email</h1><div class=c>Add an email address to this customer before sending the invoice.</div><p><a href="/invoice/view/'+encodeURIComponent(req.params.id)+'">Back to invoice</a></p>',req.session.user));
    // Use the OS email handler rather than Gmail's desktop compose URL.
    // The invoice view requires authentication, so never send that private URL to customers.
    const subject="Greenair Tax Invoice "+(v.Number||"");
    const body="Hi "+(v.CustomerName||"")+",\\r\\n\\r\\nPlease find your Greenair Tax Invoice "+(v.Number||"")+" attached.\\r\\n\\r\\nThank you,\\r\\nGreenair";
    const mailto="mailto:"+encodeURIComponent(email)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    const back="/invoice/view/"+encodeURIComponent(req.params.id);
    res.set("Cache-Control","no-store").send(L("Email Invoice",'<h1>Email invoice '+E(v.Number||"")+'</h1><div class=c><p><b>To:</b> '+E(email)+'</p><p>Save the invoice as a PDF using <b>Print / Save PDF</b> on the invoice page, then attach that PDF in your email app.</p><p><a href="'+E(mailto)+'" style="display:inline-block;background:#176b45;color:#fff;padding:13px 18px;border-radius:7px;text-decoration:none">Open email app</a></p><p><a href="'+back+'">Back to invoice / Save PDF</a></p><small>This opens a draft only. Check the attachment and press Send in your email app. No email has been sent automatically.</small></div>',req.session.user));
  }catch(e){
    console.error("gmail compose",e);
    res.status(500).send(L("Email could not open",'<h1>Email could not open</h1><div class=c>'+E(e.message)+'</div>',req.session.user));
  }
}));
app.get("/invoice/view/:id",(req,res)=>A(req,res,async()=>{let key="invoice:"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Invoice not found");let v=D(r.payload),items=Array.isArray(v.Items)?v.Items:[],money=n=>Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")};let total=Number(v.Total||0),subtotal=v.Subtotal!=null?Number(v.Subtotal):total/1.1,gst=v.Gst!=null?Number(v.Gst):total-subtotal;let rows=items.map(i=>`<tr><td>${E(i.Description||i.Name||"")}</td><td>${E(i.Quantity||1)}</td><td>${E(money(i.UnitPrice||i.Rate))}</td><td>${E(money(Number(i.Quantity||1)*Number(i.UnitPrice||i.Rate||0)))}</td></tr>`).join("");res.send(L("Invoice "+(v.Number||""),`<style>.inv{background:#fff;max-width:900px;margin:auto;padding:34px;color:#444}.green{color:#69ad45}.invtop{display:flex;justify-content:space-between;gap:30px}.brand{text-align:right;min-width:300px}.brand h1{font-size:30px;font-weight:400;margin:18px 0 0}.logoFix{width:280px;max-width:100%;box-sizing:border-box;background:linear-gradient(180deg,#075d12,#159a29 48%,#064d0e);border:3px solid #173c1d;color:#f1f1f1;font-family:Georgia,serif;font-size:38px;line-height:1;font-weight:700;letter-spacing:2px;text-align:center;padding:10px 12px;text-shadow:2px 2px 2px #222;white-space:nowrap;overflow:hidden}.bill{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:24px 0}.meta td{padding:3px 12px 3px 0;border:0}.items{width:100%;border-collapse:collapse}.items th{background:#e4f1dc;text-align:left;font-weight:400;padding:8px}.items td{padding:8px;border:0}.totals{margin:250px 0 55px auto;width:300px}.totals td{border:0;padding:5px}.balance{font-size:22px;color:#69ad45}.pay{background:#e4f1dc;padding:16px;display:flex;justify-content:space-between}.case{margin:25px 0}.actions{margin:18px auto;max-width:900px}@media(max-width:600px){.w{padding:8px}.inv{padding:16px;overflow:hidden}.invtop,.bill,.pay{display:block}.brand{text-align:left;margin-top:18px;min-width:0}.brand h1{margin-top:14px}.logoFix{width:100%;font-size:32px;letter-spacing:1px;padding:10px 8px}.brand img{margin-left:0!important;max-height:90px;object-fit:contain}.bill{margin-top:18px}.meta{width:100%;min-width:0!important;table-layout:fixed}.meta td{font-size:14px;overflow-wrap:anywhere}.items{width:100%!important;min-width:0!important;table-layout:fixed;font-size:11px}.items th,.items td{padding:6px 3px;overflow-wrap:anywhere}.items th:first-child,.items td:first-child{width:44%}.totals{margin-top:80px;width:100%;min-width:0}.pay{font-size:13px;overflow-wrap:anywhere}}@media print{@page{size:A4;margin:12mm}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}header,.actions{display:none!important}.inv{max-width:none;padding:12px}.w{max-width:none;padding:0}.logoFix{background:#087b20!important;color:#fff!important;border:3px solid #173c1d!important}.items th,.pay{background:#e4f1dc!important}.green,.balance{color:#69ad45!important}}</style><div class=inv><div class=invtop><div><b>Greenair</b><br>ABN 60202774371<br>Adelaide, SA<br>Locky 0412 395 325 | Brayden 0434 807 232<br>greenair.controls@gmail.com</div><div class=brand><div class="logoFix">GREENAIR</div><h1 class=green>Tax Invoice</h1></div></div><div class=bill><div><span class=green>INVOICE TO</span><br><br><b>${E(v.CustomerName||"")}</b><br>${E(v.CustomerAddress||v.Address||"")}</div><table class=meta><tr><td>INVOICE</td><td>${E(v.Number||"")}</td></tr><tr><td>DATE</td><td>${E(date(v.IssueDate))}</td></tr><tr><td>TERMS</td><td>${E(v.Terms||"Due on receipt")}</td></tr><tr><td>DUE DATE</td><td>${E(date(v.DueDate||v.IssueDate))}</td></tr></table></div><p><b>Email status:</b> ${E(v.EmailStatus||"Not sent")}${v.EmailSentUtc?" • Sent "+E(date(v.EmailSentUtc)):""}${v.EmailOpenedUtc?" • Opened "+E(new Date(v.EmailOpenedUtc).toLocaleString("en-AU")):""}</p><div class=case>CASE NO &nbsp;&nbsp;&nbsp;&nbsp; ${E(v.CaseNo||v.Job||v.Description||"")}</div><table class=items><tr><th>ACTIVITY</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr>${rows}</table><table class=totals><tr><td>SUBTOTAL</td><td>${money(subtotal)}</td></tr><tr><td>GST TOTAL</td><td>${money(gst)}</td></tr><tr><td>TOTAL</td><td>${money(total)}</td></tr><tr class=balance><td>BALANCE DUE</td><td>A$${money(total)}</td></tr></table><div class=pay><div><b>BANK TRANSFER</b><br>Account: Lochlan Weeks<br>BSB: 062-692 &nbsp;&nbsp; Account: 83543903<br>Reference: ${E(v.Number||"")}</div><div class=green>PAYMENT</div></div></div><div class=actions><a href="/edit/invoice/${encodeURIComponent(req.params.id)}"><button>Edit Invoice</button></a> <button onclick="window.print()">Print / Save PDF</button> <a href="/invoice/email/${encodeURIComponent(req.params.id)}" target="_blank" rel="noopener"><button type=button>Email Invoice</button></a></div>`,req.session.user))}));
app.get("/backup",(req,res)=>A(req,res,()=>res.send(L("Backup",'<h1>Backup & Migration</h1><div class=c><h2>Import Greenair v2 JSON</h2><form method=post action="/import" enctype="multipart/form-data"><input type=file name=backup accept=".json" required> <button>Import</button></form></div><div class=c><form method=post action="/snapshot"><button>Create server snapshot</button></form><p><a href="/export">Download current JSON export</a></p></div>',req.session.user))));
app.post("/import",upload.single("backup"),(req,res)=>A(req,res,async()=>{try{let d=JSON.parse(req.file.buffer.toString()),r=d.Records||d.records;if(!r)throw Error("No Records map found");let c=await pool.connect();try{await c.query("begin");for(let[k,v]of Object.entries(r)){let t=k.includes(":")?k.split(":")[0]:(v.Type||v.type||"unknown").toLowerCase();await c.query("insert into records(record_key,record_type,payload) values($1,$2,$3) on conflict(record_key) do update set record_type=excluded.record_type,payload=excluded.payload,updated_at=now()",[k,t,v])}await c.query("commit")}catch(e){await c.query("rollback");throw e}finally{c.release()}res.redirect("/")}catch(e){res.status(400).send(L("Import error",'<div class=c>'+E(e.message)+'</div>',req.session.user))}}));
app.post("/snapshot",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows,o=Object.fromEntries(r.map(x=>[x.record_key,x.payload]));await Q("insert into backups(record_count,payload) values($1,$2)",[r.length,o]);await Q("delete from backups where id not in(select id from backups order by id desc limit 50)");res.redirect("/backup")}));
app.get("/export",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows;res.setHeader("Content-Disposition",'attachment; filename="greenair-web-backup.json"');res.json({SchemaVersion:2,ExportedUtc:new Date().toISOString(),Records:Object.fromEntries(r.map(x=>[x.record_key,x.payload]))})}));
// Staging-only scheduled database snapshots. These are NOT offsite disaster recovery.
const SNAPSHOT_INTERVAL_MS=24*60*60*1000;
async function scheduledSnapshot(){
  if(process.env.ENABLE_STAGING_SNAPSHOTS!=="true")return;
  const client=await pool.connect();
  let locked=false;
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(25370025) AS locked");
    locked=lock.rows[0].locked;
    if(!locked)return;
    await client.query("BEGIN");
    const recent=await client.query("SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1");
    if(recent.rows.length && Date.now()-new Date(recent.rows[0].created_at).getTime()<20*60*60*1000){
      await client.query("COMMIT");return;
    }
    const records=await client.query("SELECT record_key,payload FROM records ORDER BY record_key");
    const data=Object.fromEntries(records.rows.map(r=>[r.record_key,r.payload]));
    await client.query("INSERT INTO backups(record_count,payload) VALUES($1,$2)",[records.rowCount,data]);
    await client.query("DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 14)");
    await client.query("COMMIT");
    console.log("Scheduled staging snapshot completed; records:",records.rowCount);
  }catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    console.error("Scheduled staging snapshot failed:",err.message);
  }finally{
    if(locked)await client.query("SELECT pg_advisory_unlock(25370025)").catch(()=>{});
    client.release();
  }
}
// Portable offsite export of a retained snapshot, with an integrity digest.
// Download to a separate device or cloud drive; snapshots in this database are not offsite.
app.get("/backup/download/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).send("Invalid snapshot ID");
    const r=await Q("SELECT id,created_at,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).send("Snapshot not found");
    const snapshot=r.rows[0],records=snapshot.payload||{};
    if(!records||typeof records!=="object"||Array.isArray(records))throw Error("Invalid snapshot contents");
    const keys=Object.keys(records).sort();
    if(keys.length!==snapshot.record_count)throw Error("Snapshot record count mismatch");
    const ordered=Object.fromEntries(keys.map(k=>[k,records[k]]));
    const crypto=require("crypto");
    const digest=crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
    const date=new Date(snapshot.created_at).toISOString().slice(0,10);
    const exportData={SchemaVersion:2,ExportedUtc:new Date().toISOString(),SnapshotId:String(snapshot.id),SnapshotCreatedUtc:snapshot.created_at,RecordCount:keys.length,RecordsSha256:digest,Records:ordered};
    res.set("Cache-Control","no-store");
    res.set("X-Content-Type-Options","nosniff");
    res.set("Content-Disposition",'attachment; filename="greenair-invoice-v25-snapshot-'+date+'-'+snapshot.id+'.json"');
    res.type("application/json").send(JSON.stringify(exportData));
  }catch(err){
    console.error("snapshot export failed",err.message);
    res.status(500).send("Snapshot integrity check failed or export unavailable");
  }
}));
app.get("/backup/verify/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).json({ok:false,error:"invalid_snapshot_id"});
    const r=await Q("SELECT id,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).json({ok:false,error:"snapshot_not_found"});
    const snapshot=r.rows[0],data=snapshot.payload;
    const valid=!!data&&typeof data==="object"&&!Array.isArray(data)&&Object.keys(data).length===snapshot.record_count;
    res.set("Cache-Control","no-store").json({ok:valid,snapshot_id:String(snapshot.id),record_count:snapshot.record_count,storage:"same_database",restore_tested:false});
  }catch(e){res.status(503).json({ok:false,error:"verification_unavailable"});}
}));
app.get("/backup/status",(req,res)=>A(req,res,async()=>{
  try{
    const result=await Q("SELECT id,created_at,record_count FROM backups ORDER BY id DESC LIMIT 14");
    res.json({snapshots_enabled:process.env.ENABLE_STAGING_SNAPSHOTS==="true",storage:"same_postgres_database_not_offsite",snapshots:result.rows});
  }catch(e){res.status(503).json({error:"backup_status_unavailable"});}
}));
const PORT=Number(process.env.PORT)||10000;app.listen(PORT,"0.0.0.0",()=>console.log(`Greenair Invoice listening on ${PORT}`));init().then(()=>{console.log("Database initialised");scheduledSnapshot();setInterval(scheduledSnapshot,SNAPSHOT_INTERVAL_MS).unref();}).catch(e=>console.error("Database init error",e));+money(Number(i.Quantity||1)*Number(i.UnitPrice||i.Rate||0))+'</td></tr>').join("");
    const body='<style>.invoice{max-width:760px;margin:auto}.logo{background:#087b20;color:white;padding:18px;font-size:30px;font-weight:bold;text-align:center}.invoice table{width:100%;border-collapse:collapse}.invoice th,.invoice td{padding:10px;border-bottom:1px solid #ddd;text-align:left}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.noprint{display:none}}</style><div class="c invoice"><div class=logo>GREENAIR</div><h1>Tax Invoice '+E(v.Number||"")+'</h1><p><b>Invoice to:</b> '+E(v.CustomerName||"")+'</p><p><b>Date:</b> '+E(v.IssueDate?new Date(v.IssueDate).toLocaleDateString("en-AU"):"")+'</p><table><tr><th>Activity</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>'+rows+'</table><p><b>Subtotal:</b> 
  try{
    const key="invoice:"+req.params.id;
    const r=(await Q("select payload from records where record_key=$1",[key])).rows[0];
    if(!r)return res.status(404).send("Invoice not found");
    const v=D(r.payload);
    let email=v.CustomerEmail||v.Email||"";
    if(!email&&v.CustomerKey){
      const c=(await Q("select payload from records where record_key=$1",[v.CustomerKey])).rows[0];
      if(c)email=pick(D(c.payload),"Email","EmailAddress");
    }
    if(!email)return res.status(400).send(L("No customer email",'<h1>No customer email</h1><div class=c>Add an email address to this customer before sending the invoice.</div><p><a href="/invoice/view/'+encodeURIComponent(req.params.id)+'">Back to invoice</a></p>',req.session.user));
    // Use the OS email handler rather than Gmail's desktop compose URL.
    // The invoice view requires authentication, so never send that private URL to customers.
    const subject="Greenair Tax Invoice "+(v.Number||"");
    const body="Hi "+(v.CustomerName||"")+",\\r\\n\\r\\nPlease find your Greenair Tax Invoice "+(v.Number||"")+" attached.\\r\\n\\r\\nThank you,\\r\\nGreenair";
    const mailto="mailto:"+encodeURIComponent(email)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    const back="/invoice/view/"+encodeURIComponent(req.params.id);
    res.set("Cache-Control","no-store").send(L("Email Invoice",'<h1>Email invoice '+E(v.Number||"")+'</h1><div class=c><p><b>To:</b> '+E(email)+'</p><p>Save the invoice as a PDF using <b>Print / Save PDF</b> on the invoice page, then attach that PDF in your email app.</p><p><a href="'+E(mailto)+'" style="display:inline-block;background:#176b45;color:#fff;padding:13px 18px;border-radius:7px;text-decoration:none">Open email app</a></p><p><a href="'+back+'">Back to invoice / Save PDF</a></p><small>This opens a draft only. Check the attachment and press Send in your email app. No email has been sent automatically.</small></div>',req.session.user));
  }catch(e){
    console.error("gmail compose",e);
    res.status(500).send(L("Email could not open",'<h1>Email could not open</h1><div class=c>'+E(e.message)+'</div>',req.session.user));
  }
}));
app.get("/invoice/view/:id",(req,res)=>A(req,res,async()=>{let key="invoice:"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Invoice not found");let v=D(r.payload),items=Array.isArray(v.Items)?v.Items:[],money=n=>Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")};let total=Number(v.Total||0),subtotal=v.Subtotal!=null?Number(v.Subtotal):total/1.1,gst=v.Gst!=null?Number(v.Gst):total-subtotal;let rows=items.map(i=>`<tr><td>${E(i.Description||i.Name||"")}</td><td>${E(i.Quantity||1)}</td><td>${E(money(i.UnitPrice||i.Rate))}</td><td>${E(money(Number(i.Quantity||1)*Number(i.UnitPrice||i.Rate||0)))}</td></tr>`).join("");res.send(L("Invoice "+(v.Number||""),`<style>.inv{background:#fff;max-width:900px;margin:auto;padding:34px;color:#444}.green{color:#69ad45}.invtop{display:flex;justify-content:space-between;gap:30px}.brand{text-align:right;min-width:300px}.brand h1{font-size:30px;font-weight:400;margin:18px 0 0}.logoFix{width:280px;max-width:100%;box-sizing:border-box;background:linear-gradient(180deg,#075d12,#159a29 48%,#064d0e);border:3px solid #173c1d;color:#f1f1f1;font-family:Georgia,serif;font-size:38px;line-height:1;font-weight:700;letter-spacing:2px;text-align:center;padding:10px 12px;text-shadow:2px 2px 2px #222;white-space:nowrap;overflow:hidden}.bill{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:24px 0}.meta td{padding:3px 12px 3px 0;border:0}.items{width:100%;border-collapse:collapse}.items th{background:#e4f1dc;text-align:left;font-weight:400;padding:8px}.items td{padding:8px;border:0}.totals{margin:250px 0 55px auto;width:300px}.totals td{border:0;padding:5px}.balance{font-size:22px;color:#69ad45}.pay{background:#e4f1dc;padding:16px;display:flex;justify-content:space-between}.case{margin:25px 0}.actions{margin:18px auto;max-width:900px}@media(max-width:600px){.w{padding:8px}.inv{padding:16px;overflow:hidden}.invtop,.bill,.pay{display:block}.brand{text-align:left;margin-top:18px;min-width:0}.brand h1{margin-top:14px}.logoFix{width:100%;font-size:32px;letter-spacing:1px;padding:10px 8px}.brand img{margin-left:0!important;max-height:90px;object-fit:contain}.bill{margin-top:18px}.meta{width:100%;min-width:0!important;table-layout:fixed}.meta td{font-size:14px;overflow-wrap:anywhere}.items{width:100%!important;min-width:0!important;table-layout:fixed;font-size:11px}.items th,.items td{padding:6px 3px;overflow-wrap:anywhere}.items th:first-child,.items td:first-child{width:44%}.totals{margin-top:80px;width:100%;min-width:0}.pay{font-size:13px;overflow-wrap:anywhere}}@media print{@page{size:A4;margin:12mm}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}header,.actions{display:none!important}.inv{max-width:none;padding:12px}.w{max-width:none;padding:0}.logoFix{background:#087b20!important;color:#fff!important;border:3px solid #173c1d!important}.items th,.pay{background:#e4f1dc!important}.green,.balance{color:#69ad45!important}}</style><div class=inv><div class=invtop><div><b>Greenair</b><br>ABN 60202774371<br>Adelaide, SA<br>Locky 0412 395 325 | Brayden 0434 807 232<br>greenair.controls@gmail.com</div><div class=brand><div class="logoFix">GREENAIR</div><h1 class=green>Tax Invoice</h1></div></div><div class=bill><div><span class=green>INVOICE TO</span><br><br><b>${E(v.CustomerName||"")}</b><br>${E(v.CustomerAddress||v.Address||"")}</div><table class=meta><tr><td>INVOICE</td><td>${E(v.Number||"")}</td></tr><tr><td>DATE</td><td>${E(date(v.IssueDate))}</td></tr><tr><td>TERMS</td><td>${E(v.Terms||"Due on receipt")}</td></tr><tr><td>DUE DATE</td><td>${E(date(v.DueDate||v.IssueDate))}</td></tr></table></div><p><b>Email status:</b> ${E(v.EmailStatus||"Not sent")}${v.EmailSentUtc?" • Sent "+E(date(v.EmailSentUtc)):""}${v.EmailOpenedUtc?" • Opened "+E(new Date(v.EmailOpenedUtc).toLocaleString("en-AU")):""}</p><div class=case>CASE NO &nbsp;&nbsp;&nbsp;&nbsp; ${E(v.CaseNo||v.Job||v.Description||"")}</div><table class=items><tr><th>ACTIVITY</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr>${rows}</table><table class=totals><tr><td>SUBTOTAL</td><td>${money(subtotal)}</td></tr><tr><td>GST TOTAL</td><td>${money(gst)}</td></tr><tr><td>TOTAL</td><td>${money(total)}</td></tr><tr class=balance><td>BALANCE DUE</td><td>A$${money(total)}</td></tr></table><div class=pay><div><b>BANK TRANSFER</b><br>Account: Lochlan Weeks<br>BSB: 062-692 &nbsp;&nbsp; Account: 83543903<br>Reference: ${E(v.Number||"")}</div><div class=green>PAYMENT</div></div></div><div class=actions><a href="/edit/invoice/${encodeURIComponent(req.params.id)}"><button>Edit Invoice</button></a> <button onclick="window.print()">Print / Save PDF</button> <a href="/invoice/email/${encodeURIComponent(req.params.id)}" target="_blank" rel="noopener"><button type=button>Email Invoice</button></a></div>`,req.session.user))}));
app.get("/backup",(req,res)=>A(req,res,()=>res.send(L("Backup",'<h1>Backup & Migration</h1><div class=c><h2>Import Greenair v2 JSON</h2><form method=post action="/import" enctype="multipart/form-data"><input type=file name=backup accept=".json" required> <button>Import</button></form></div><div class=c><form method=post action="/snapshot"><button>Create server snapshot</button></form><p><a href="/export">Download current JSON export</a></p></div>',req.session.user))));
app.post("/import",upload.single("backup"),(req,res)=>A(req,res,async()=>{try{let d=JSON.parse(req.file.buffer.toString()),r=d.Records||d.records;if(!r)throw Error("No Records map found");let c=await pool.connect();try{await c.query("begin");for(let[k,v]of Object.entries(r)){let t=k.includes(":")?k.split(":")[0]:(v.Type||v.type||"unknown").toLowerCase();await c.query("insert into records(record_key,record_type,payload) values($1,$2,$3) on conflict(record_key) do update set record_type=excluded.record_type,payload=excluded.payload,updated_at=now()",[k,t,v])}await c.query("commit")}catch(e){await c.query("rollback");throw e}finally{c.release()}res.redirect("/")}catch(e){res.status(400).send(L("Import error",'<div class=c>'+E(e.message)+'</div>',req.session.user))}}));
app.post("/snapshot",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows,o=Object.fromEntries(r.map(x=>[x.record_key,x.payload]));await Q("insert into backups(record_count,payload) values($1,$2)",[r.length,o]);await Q("delete from backups where id not in(select id from backups order by id desc limit 50)");res.redirect("/backup")}));
app.get("/export",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows;res.setHeader("Content-Disposition",'attachment; filename="greenair-web-backup.json"');res.json({SchemaVersion:2,ExportedUtc:new Date().toISOString(),Records:Object.fromEntries(r.map(x=>[x.record_key,x.payload]))})}));
// Staging-only scheduled database snapshots. These are NOT offsite disaster recovery.
const SNAPSHOT_INTERVAL_MS=24*60*60*1000;
async function scheduledSnapshot(){
  if(process.env.ENABLE_STAGING_SNAPSHOTS!=="true")return;
  const client=await pool.connect();
  let locked=false;
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(25370025) AS locked");
    locked=lock.rows[0].locked;
    if(!locked)return;
    await client.query("BEGIN");
    const recent=await client.query("SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1");
    if(recent.rows.length && Date.now()-new Date(recent.rows[0].created_at).getTime()<20*60*60*1000){
      await client.query("COMMIT");return;
    }
    const records=await client.query("SELECT record_key,payload FROM records ORDER BY record_key");
    const data=Object.fromEntries(records.rows.map(r=>[r.record_key,r.payload]));
    await client.query("INSERT INTO backups(record_count,payload) VALUES($1,$2)",[records.rowCount,data]);
    await client.query("DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 14)");
    await client.query("COMMIT");
    console.log("Scheduled staging snapshot completed; records:",records.rowCount);
  }catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    console.error("Scheduled staging snapshot failed:",err.message);
  }finally{
    if(locked)await client.query("SELECT pg_advisory_unlock(25370025)").catch(()=>{});
    client.release();
  }
}
// Portable offsite export of a retained snapshot, with an integrity digest.
// Download to a separate device or cloud drive; snapshots in this database are not offsite.
app.get("/backup/download/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).send("Invalid snapshot ID");
    const r=await Q("SELECT id,created_at,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).send("Snapshot not found");
    const snapshot=r.rows[0],records=snapshot.payload||{};
    if(!records||typeof records!=="object"||Array.isArray(records))throw Error("Invalid snapshot contents");
    const keys=Object.keys(records).sort();
    if(keys.length!==snapshot.record_count)throw Error("Snapshot record count mismatch");
    const ordered=Object.fromEntries(keys.map(k=>[k,records[k]]));
    const crypto=require("crypto");
    const digest=crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
    const date=new Date(snapshot.created_at).toISOString().slice(0,10);
    const exportData={SchemaVersion:2,ExportedUtc:new Date().toISOString(),SnapshotId:String(snapshot.id),SnapshotCreatedUtc:snapshot.created_at,RecordCount:keys.length,RecordsSha256:digest,Records:ordered};
    res.set("Cache-Control","no-store");
    res.set("X-Content-Type-Options","nosniff");
    res.set("Content-Disposition",'attachment; filename="greenair-invoice-v25-snapshot-'+date+'-'+snapshot.id+'.json"');
    res.type("application/json").send(JSON.stringify(exportData));
  }catch(err){
    console.error("snapshot export failed",err.message);
    res.status(500).send("Snapshot integrity check failed or export unavailable");
  }
}));
app.get("/backup/verify/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).json({ok:false,error:"invalid_snapshot_id"});
    const r=await Q("SELECT id,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).json({ok:false,error:"snapshot_not_found"});
    const snapshot=r.rows[0],data=snapshot.payload;
    const valid=!!data&&typeof data==="object"&&!Array.isArray(data)&&Object.keys(data).length===snapshot.record_count;
    res.set("Cache-Control","no-store").json({ok:valid,snapshot_id:String(snapshot.id),record_count:snapshot.record_count,storage:"same_database",restore_tested:false});
  }catch(e){res.status(503).json({ok:false,error:"verification_unavailable"});}
}));
app.get("/backup/status",(req,res)=>A(req,res,async()=>{
  try{
    const result=await Q("SELECT id,created_at,record_count FROM backups ORDER BY id DESC LIMIT 14");
    res.json({snapshots_enabled:process.env.ENABLE_STAGING_SNAPSHOTS==="true",storage:"same_postgres_database_not_offsite",snapshots:result.rows});
  }catch(e){res.status(503).json({error:"backup_status_unavailable"});}
}));
const PORT=Number(process.env.PORT)||10000;app.listen(PORT,"0.0.0.0",()=>console.log(`Greenair Invoice listening on ${PORT}`));init().then(()=>{console.log("Database initialised");scheduledSnapshot();setInterval(scheduledSnapshot,SNAPSHOT_INTERVAL_MS).unref();}).catch(e=>console.error("Database init error",e));+money(v.Subtotal!=null?v.Subtotal:total/1.1)+'</p><p><b>GST:</b> 
  try{
    const key="invoice:"+req.params.id;
    const r=(await Q("select payload from records where record_key=$1",[key])).rows[0];
    if(!r)return res.status(404).send("Invoice not found");
    const v=D(r.payload);
    let email=v.CustomerEmail||v.Email||"";
    if(!email&&v.CustomerKey){
      const c=(await Q("select payload from records where record_key=$1",[v.CustomerKey])).rows[0];
      if(c)email=pick(D(c.payload),"Email","EmailAddress");
    }
    if(!email)return res.status(400).send(L("No customer email",'<h1>No customer email</h1><div class=c>Add an email address to this customer before sending the invoice.</div><p><a href="/invoice/view/'+encodeURIComponent(req.params.id)+'">Back to invoice</a></p>',req.session.user));
    // Use the OS email handler rather than Gmail's desktop compose URL.
    // The invoice view requires authentication, so never send that private URL to customers.
    const subject="Greenair Tax Invoice "+(v.Number||"");
    const body="Hi "+(v.CustomerName||"")+",\\r\\n\\r\\nPlease find your Greenair Tax Invoice "+(v.Number||"")+" attached.\\r\\n\\r\\nThank you,\\r\\nGreenair";
    const mailto="mailto:"+encodeURIComponent(email)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    const back="/invoice/view/"+encodeURIComponent(req.params.id);
    res.set("Cache-Control","no-store").send(L("Email Invoice",'<h1>Email invoice '+E(v.Number||"")+'</h1><div class=c><p><b>To:</b> '+E(email)+'</p><p>Save the invoice as a PDF using <b>Print / Save PDF</b> on the invoice page, then attach that PDF in your email app.</p><p><a href="'+E(mailto)+'" style="display:inline-block;background:#176b45;color:#fff;padding:13px 18px;border-radius:7px;text-decoration:none">Open email app</a></p><p><a href="'+back+'">Back to invoice / Save PDF</a></p><small>This opens a draft only. Check the attachment and press Send in your email app. No email has been sent automatically.</small></div>',req.session.user));
  }catch(e){
    console.error("gmail compose",e);
    res.status(500).send(L("Email could not open",'<h1>Email could not open</h1><div class=c>'+E(e.message)+'</div>',req.session.user));
  }
}));
app.get("/invoice/view/:id",(req,res)=>A(req,res,async()=>{let key="invoice:"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Invoice not found");let v=D(r.payload),items=Array.isArray(v.Items)?v.Items:[],money=n=>Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")};let total=Number(v.Total||0),subtotal=v.Subtotal!=null?Number(v.Subtotal):total/1.1,gst=v.Gst!=null?Number(v.Gst):total-subtotal;let rows=items.map(i=>`<tr><td>${E(i.Description||i.Name||"")}</td><td>${E(i.Quantity||1)}</td><td>${E(money(i.UnitPrice||i.Rate))}</td><td>${E(money(Number(i.Quantity||1)*Number(i.UnitPrice||i.Rate||0)))}</td></tr>`).join("");res.send(L("Invoice "+(v.Number||""),`<style>.inv{background:#fff;max-width:900px;margin:auto;padding:34px;color:#444}.green{color:#69ad45}.invtop{display:flex;justify-content:space-between;gap:30px}.brand{text-align:right;min-width:300px}.brand h1{font-size:30px;font-weight:400;margin:18px 0 0}.logoFix{width:280px;max-width:100%;box-sizing:border-box;background:linear-gradient(180deg,#075d12,#159a29 48%,#064d0e);border:3px solid #173c1d;color:#f1f1f1;font-family:Georgia,serif;font-size:38px;line-height:1;font-weight:700;letter-spacing:2px;text-align:center;padding:10px 12px;text-shadow:2px 2px 2px #222;white-space:nowrap;overflow:hidden}.bill{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:24px 0}.meta td{padding:3px 12px 3px 0;border:0}.items{width:100%;border-collapse:collapse}.items th{background:#e4f1dc;text-align:left;font-weight:400;padding:8px}.items td{padding:8px;border:0}.totals{margin:250px 0 55px auto;width:300px}.totals td{border:0;padding:5px}.balance{font-size:22px;color:#69ad45}.pay{background:#e4f1dc;padding:16px;display:flex;justify-content:space-between}.case{margin:25px 0}.actions{margin:18px auto;max-width:900px}@media(max-width:600px){.w{padding:8px}.inv{padding:16px;overflow:hidden}.invtop,.bill,.pay{display:block}.brand{text-align:left;margin-top:18px;min-width:0}.brand h1{margin-top:14px}.logoFix{width:100%;font-size:32px;letter-spacing:1px;padding:10px 8px}.brand img{margin-left:0!important;max-height:90px;object-fit:contain}.bill{margin-top:18px}.meta{width:100%;min-width:0!important;table-layout:fixed}.meta td{font-size:14px;overflow-wrap:anywhere}.items{width:100%!important;min-width:0!important;table-layout:fixed;font-size:11px}.items th,.items td{padding:6px 3px;overflow-wrap:anywhere}.items th:first-child,.items td:first-child{width:44%}.totals{margin-top:80px;width:100%;min-width:0}.pay{font-size:13px;overflow-wrap:anywhere}}@media print{@page{size:A4;margin:12mm}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}header,.actions{display:none!important}.inv{max-width:none;padding:12px}.w{max-width:none;padding:0}.logoFix{background:#087b20!important;color:#fff!important;border:3px solid #173c1d!important}.items th,.pay{background:#e4f1dc!important}.green,.balance{color:#69ad45!important}}</style><div class=inv><div class=invtop><div><b>Greenair</b><br>ABN 60202774371<br>Adelaide, SA<br>Locky 0412 395 325 | Brayden 0434 807 232<br>greenair.controls@gmail.com</div><div class=brand><div class="logoFix">GREENAIR</div><h1 class=green>Tax Invoice</h1></div></div><div class=bill><div><span class=green>INVOICE TO</span><br><br><b>${E(v.CustomerName||"")}</b><br>${E(v.CustomerAddress||v.Address||"")}</div><table class=meta><tr><td>INVOICE</td><td>${E(v.Number||"")}</td></tr><tr><td>DATE</td><td>${E(date(v.IssueDate))}</td></tr><tr><td>TERMS</td><td>${E(v.Terms||"Due on receipt")}</td></tr><tr><td>DUE DATE</td><td>${E(date(v.DueDate||v.IssueDate))}</td></tr></table></div><p><b>Email status:</b> ${E(v.EmailStatus||"Not sent")}${v.EmailSentUtc?" • Sent "+E(date(v.EmailSentUtc)):""}${v.EmailOpenedUtc?" • Opened "+E(new Date(v.EmailOpenedUtc).toLocaleString("en-AU")):""}</p><div class=case>CASE NO &nbsp;&nbsp;&nbsp;&nbsp; ${E(v.CaseNo||v.Job||v.Description||"")}</div><table class=items><tr><th>ACTIVITY</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr>${rows}</table><table class=totals><tr><td>SUBTOTAL</td><td>${money(subtotal)}</td></tr><tr><td>GST TOTAL</td><td>${money(gst)}</td></tr><tr><td>TOTAL</td><td>${money(total)}</td></tr><tr class=balance><td>BALANCE DUE</td><td>A$${money(total)}</td></tr></table><div class=pay><div><b>BANK TRANSFER</b><br>Account: Lochlan Weeks<br>BSB: 062-692 &nbsp;&nbsp; Account: 83543903<br>Reference: ${E(v.Number||"")}</div><div class=green>PAYMENT</div></div></div><div class=actions><a href="/edit/invoice/${encodeURIComponent(req.params.id)}"><button>Edit Invoice</button></a> <button onclick="window.print()">Print / Save PDF</button> <a href="/invoice/email/${encodeURIComponent(req.params.id)}" target="_blank" rel="noopener"><button type=button>Email Invoice</button></a></div>`,req.session.user))}));
app.get("/backup",(req,res)=>A(req,res,()=>res.send(L("Backup",'<h1>Backup & Migration</h1><div class=c><h2>Import Greenair v2 JSON</h2><form method=post action="/import" enctype="multipart/form-data"><input type=file name=backup accept=".json" required> <button>Import</button></form></div><div class=c><form method=post action="/snapshot"><button>Create server snapshot</button></form><p><a href="/export">Download current JSON export</a></p></div>',req.session.user))));
app.post("/import",upload.single("backup"),(req,res)=>A(req,res,async()=>{try{let d=JSON.parse(req.file.buffer.toString()),r=d.Records||d.records;if(!r)throw Error("No Records map found");let c=await pool.connect();try{await c.query("begin");for(let[k,v]of Object.entries(r)){let t=k.includes(":")?k.split(":")[0]:(v.Type||v.type||"unknown").toLowerCase();await c.query("insert into records(record_key,record_type,payload) values($1,$2,$3) on conflict(record_key) do update set record_type=excluded.record_type,payload=excluded.payload,updated_at=now()",[k,t,v])}await c.query("commit")}catch(e){await c.query("rollback");throw e}finally{c.release()}res.redirect("/")}catch(e){res.status(400).send(L("Import error",'<div class=c>'+E(e.message)+'</div>',req.session.user))}}));
app.post("/snapshot",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows,o=Object.fromEntries(r.map(x=>[x.record_key,x.payload]));await Q("insert into backups(record_count,payload) values($1,$2)",[r.length,o]);await Q("delete from backups where id not in(select id from backups order by id desc limit 50)");res.redirect("/backup")}));
app.get("/export",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows;res.setHeader("Content-Disposition",'attachment; filename="greenair-web-backup.json"');res.json({SchemaVersion:2,ExportedUtc:new Date().toISOString(),Records:Object.fromEntries(r.map(x=>[x.record_key,x.payload]))})}));
// Staging-only scheduled database snapshots. These are NOT offsite disaster recovery.
const SNAPSHOT_INTERVAL_MS=24*60*60*1000;
async function scheduledSnapshot(){
  if(process.env.ENABLE_STAGING_SNAPSHOTS!=="true")return;
  const client=await pool.connect();
  let locked=false;
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(25370025) AS locked");
    locked=lock.rows[0].locked;
    if(!locked)return;
    await client.query("BEGIN");
    const recent=await client.query("SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1");
    if(recent.rows.length && Date.now()-new Date(recent.rows[0].created_at).getTime()<20*60*60*1000){
      await client.query("COMMIT");return;
    }
    const records=await client.query("SELECT record_key,payload FROM records ORDER BY record_key");
    const data=Object.fromEntries(records.rows.map(r=>[r.record_key,r.payload]));
    await client.query("INSERT INTO backups(record_count,payload) VALUES($1,$2)",[records.rowCount,data]);
    await client.query("DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 14)");
    await client.query("COMMIT");
    console.log("Scheduled staging snapshot completed; records:",records.rowCount);
  }catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    console.error("Scheduled staging snapshot failed:",err.message);
  }finally{
    if(locked)await client.query("SELECT pg_advisory_unlock(25370025)").catch(()=>{});
    client.release();
  }
}
// Portable offsite export of a retained snapshot, with an integrity digest.
// Download to a separate device or cloud drive; snapshots in this database are not offsite.
app.get("/backup/download/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).send("Invalid snapshot ID");
    const r=await Q("SELECT id,created_at,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).send("Snapshot not found");
    const snapshot=r.rows[0],records=snapshot.payload||{};
    if(!records||typeof records!=="object"||Array.isArray(records))throw Error("Invalid snapshot contents");
    const keys=Object.keys(records).sort();
    if(keys.length!==snapshot.record_count)throw Error("Snapshot record count mismatch");
    const ordered=Object.fromEntries(keys.map(k=>[k,records[k]]));
    const crypto=require("crypto");
    const digest=crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
    const date=new Date(snapshot.created_at).toISOString().slice(0,10);
    const exportData={SchemaVersion:2,ExportedUtc:new Date().toISOString(),SnapshotId:String(snapshot.id),SnapshotCreatedUtc:snapshot.created_at,RecordCount:keys.length,RecordsSha256:digest,Records:ordered};
    res.set("Cache-Control","no-store");
    res.set("X-Content-Type-Options","nosniff");
    res.set("Content-Disposition",'attachment; filename="greenair-invoice-v25-snapshot-'+date+'-'+snapshot.id+'.json"');
    res.type("application/json").send(JSON.stringify(exportData));
  }catch(err){
    console.error("snapshot export failed",err.message);
    res.status(500).send("Snapshot integrity check failed or export unavailable");
  }
}));
app.get("/backup/verify/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).json({ok:false,error:"invalid_snapshot_id"});
    const r=await Q("SELECT id,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).json({ok:false,error:"snapshot_not_found"});
    const snapshot=r.rows[0],data=snapshot.payload;
    const valid=!!data&&typeof data==="object"&&!Array.isArray(data)&&Object.keys(data).length===snapshot.record_count;
    res.set("Cache-Control","no-store").json({ok:valid,snapshot_id:String(snapshot.id),record_count:snapshot.record_count,storage:"same_database",restore_tested:false});
  }catch(e){res.status(503).json({ok:false,error:"verification_unavailable"});}
}));
app.get("/backup/status",(req,res)=>A(req,res,async()=>{
  try{
    const result=await Q("SELECT id,created_at,record_count FROM backups ORDER BY id DESC LIMIT 14");
    res.json({snapshots_enabled:process.env.ENABLE_STAGING_SNAPSHOTS==="true",storage:"same_postgres_database_not_offsite",snapshots:result.rows});
  }catch(e){res.status(503).json({error:"backup_status_unavailable"});}
}));
const PORT=Number(process.env.PORT)||10000;app.listen(PORT,"0.0.0.0",()=>console.log(`Greenair Invoice listening on ${PORT}`));init().then(()=>{console.log("Database initialised");scheduledSnapshot();setInterval(scheduledSnapshot,SNAPSHOT_INTERVAL_MS).unref();}).catch(e=>console.error("Database init error",e));+money(v.Gst!=null?v.Gst:total-total/1.1)+'</p><h2>Total: A
  try{
    const key="invoice:"+req.params.id;
    const r=(await Q("select payload from records where record_key=$1",[key])).rows[0];
    if(!r)return res.status(404).send("Invoice not found");
    const v=D(r.payload);
    let email=v.CustomerEmail||v.Email||"";
    if(!email&&v.CustomerKey){
      const c=(await Q("select payload from records where record_key=$1",[v.CustomerKey])).rows[0];
      if(c)email=pick(D(c.payload),"Email","EmailAddress");
    }
    if(!email)return res.status(400).send(L("No customer email",'<h1>No customer email</h1><div class=c>Add an email address to this customer before sending the invoice.</div><p><a href="/invoice/view/'+encodeURIComponent(req.params.id)+'">Back to invoice</a></p>',req.session.user));
    // Use the OS email handler rather than Gmail's desktop compose URL.
    // The invoice view requires authentication, so never send that private URL to customers.
    const subject="Greenair Tax Invoice "+(v.Number||"");
    const body="Hi "+(v.CustomerName||"")+",\\r\\n\\r\\nPlease find your Greenair Tax Invoice "+(v.Number||"")+" attached.\\r\\n\\r\\nThank you,\\r\\nGreenair";
    const mailto="mailto:"+encodeURIComponent(email)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    const back="/invoice/view/"+encodeURIComponent(req.params.id);
    res.set("Cache-Control","no-store").send(L("Email Invoice",'<h1>Email invoice '+E(v.Number||"")+'</h1><div class=c><p><b>To:</b> '+E(email)+'</p><p>Save the invoice as a PDF using <b>Print / Save PDF</b> on the invoice page, then attach that PDF in your email app.</p><p><a href="'+E(mailto)+'" style="display:inline-block;background:#176b45;color:#fff;padding:13px 18px;border-radius:7px;text-decoration:none">Open email app</a></p><p><a href="'+back+'">Back to invoice / Save PDF</a></p><small>This opens a draft only. Check the attachment and press Send in your email app. No email has been sent automatically.</small></div>',req.session.user));
  }catch(e){
    console.error("gmail compose",e);
    res.status(500).send(L("Email could not open",'<h1>Email could not open</h1><div class=c>'+E(e.message)+'</div>',req.session.user));
  }
}));
app.get("/invoice/view/:id",(req,res)=>A(req,res,async()=>{let key="invoice:"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Invoice not found");let v=D(r.payload),items=Array.isArray(v.Items)?v.Items:[],money=n=>Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")};let total=Number(v.Total||0),subtotal=v.Subtotal!=null?Number(v.Subtotal):total/1.1,gst=v.Gst!=null?Number(v.Gst):total-subtotal;let rows=items.map(i=>`<tr><td>${E(i.Description||i.Name||"")}</td><td>${E(i.Quantity||1)}</td><td>${E(money(i.UnitPrice||i.Rate))}</td><td>${E(money(Number(i.Quantity||1)*Number(i.UnitPrice||i.Rate||0)))}</td></tr>`).join("");res.send(L("Invoice "+(v.Number||""),`<style>.inv{background:#fff;max-width:900px;margin:auto;padding:34px;color:#444}.green{color:#69ad45}.invtop{display:flex;justify-content:space-between;gap:30px}.brand{text-align:right;min-width:300px}.brand h1{font-size:30px;font-weight:400;margin:18px 0 0}.logoFix{width:280px;max-width:100%;box-sizing:border-box;background:linear-gradient(180deg,#075d12,#159a29 48%,#064d0e);border:3px solid #173c1d;color:#f1f1f1;font-family:Georgia,serif;font-size:38px;line-height:1;font-weight:700;letter-spacing:2px;text-align:center;padding:10px 12px;text-shadow:2px 2px 2px #222;white-space:nowrap;overflow:hidden}.bill{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:24px 0}.meta td{padding:3px 12px 3px 0;border:0}.items{width:100%;border-collapse:collapse}.items th{background:#e4f1dc;text-align:left;font-weight:400;padding:8px}.items td{padding:8px;border:0}.totals{margin:250px 0 55px auto;width:300px}.totals td{border:0;padding:5px}.balance{font-size:22px;color:#69ad45}.pay{background:#e4f1dc;padding:16px;display:flex;justify-content:space-between}.case{margin:25px 0}.actions{margin:18px auto;max-width:900px}@media(max-width:600px){.w{padding:8px}.inv{padding:16px;overflow:hidden}.invtop,.bill,.pay{display:block}.brand{text-align:left;margin-top:18px;min-width:0}.brand h1{margin-top:14px}.logoFix{width:100%;font-size:32px;letter-spacing:1px;padding:10px 8px}.brand img{margin-left:0!important;max-height:90px;object-fit:contain}.bill{margin-top:18px}.meta{width:100%;min-width:0!important;table-layout:fixed}.meta td{font-size:14px;overflow-wrap:anywhere}.items{width:100%!important;min-width:0!important;table-layout:fixed;font-size:11px}.items th,.items td{padding:6px 3px;overflow-wrap:anywhere}.items th:first-child,.items td:first-child{width:44%}.totals{margin-top:80px;width:100%;min-width:0}.pay{font-size:13px;overflow-wrap:anywhere}}@media print{@page{size:A4;margin:12mm}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}header,.actions{display:none!important}.inv{max-width:none;padding:12px}.w{max-width:none;padding:0}.logoFix{background:#087b20!important;color:#fff!important;border:3px solid #173c1d!important}.items th,.pay{background:#e4f1dc!important}.green,.balance{color:#69ad45!important}}</style><div class=inv><div class=invtop><div><b>Greenair</b><br>ABN 60202774371<br>Adelaide, SA<br>Locky 0412 395 325 | Brayden 0434 807 232<br>greenair.controls@gmail.com</div><div class=brand><div class="logoFix">GREENAIR</div><h1 class=green>Tax Invoice</h1></div></div><div class=bill><div><span class=green>INVOICE TO</span><br><br><b>${E(v.CustomerName||"")}</b><br>${E(v.CustomerAddress||v.Address||"")}</div><table class=meta><tr><td>INVOICE</td><td>${E(v.Number||"")}</td></tr><tr><td>DATE</td><td>${E(date(v.IssueDate))}</td></tr><tr><td>TERMS</td><td>${E(v.Terms||"Due on receipt")}</td></tr><tr><td>DUE DATE</td><td>${E(date(v.DueDate||v.IssueDate))}</td></tr></table></div><p><b>Email status:</b> ${E(v.EmailStatus||"Not sent")}${v.EmailSentUtc?" • Sent "+E(date(v.EmailSentUtc)):""}${v.EmailOpenedUtc?" • Opened "+E(new Date(v.EmailOpenedUtc).toLocaleString("en-AU")):""}</p><div class=case>CASE NO &nbsp;&nbsp;&nbsp;&nbsp; ${E(v.CaseNo||v.Job||v.Description||"")}</div><table class=items><tr><th>ACTIVITY</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr>${rows}</table><table class=totals><tr><td>SUBTOTAL</td><td>${money(subtotal)}</td></tr><tr><td>GST TOTAL</td><td>${money(gst)}</td></tr><tr><td>TOTAL</td><td>${money(total)}</td></tr><tr class=balance><td>BALANCE DUE</td><td>A$${money(total)}</td></tr></table><div class=pay><div><b>BANK TRANSFER</b><br>Account: Lochlan Weeks<br>BSB: 062-692 &nbsp;&nbsp; Account: 83543903<br>Reference: ${E(v.Number||"")}</div><div class=green>PAYMENT</div></div></div><div class=actions><a href="/edit/invoice/${encodeURIComponent(req.params.id)}"><button>Edit Invoice</button></a> <button onclick="window.print()">Print / Save PDF</button> <a href="/invoice/email/${encodeURIComponent(req.params.id)}" target="_blank" rel="noopener"><button type=button>Email Invoice</button></a></div>`,req.session.user))}));
app.get("/backup",(req,res)=>A(req,res,()=>res.send(L("Backup",'<h1>Backup & Migration</h1><div class=c><h2>Import Greenair v2 JSON</h2><form method=post action="/import" enctype="multipart/form-data"><input type=file name=backup accept=".json" required> <button>Import</button></form></div><div class=c><form method=post action="/snapshot"><button>Create server snapshot</button></form><p><a href="/export">Download current JSON export</a></p></div>',req.session.user))));
app.post("/import",upload.single("backup"),(req,res)=>A(req,res,async()=>{try{let d=JSON.parse(req.file.buffer.toString()),r=d.Records||d.records;if(!r)throw Error("No Records map found");let c=await pool.connect();try{await c.query("begin");for(let[k,v]of Object.entries(r)){let t=k.includes(":")?k.split(":")[0]:(v.Type||v.type||"unknown").toLowerCase();await c.query("insert into records(record_key,record_type,payload) values($1,$2,$3) on conflict(record_key) do update set record_type=excluded.record_type,payload=excluded.payload,updated_at=now()",[k,t,v])}await c.query("commit")}catch(e){await c.query("rollback");throw e}finally{c.release()}res.redirect("/")}catch(e){res.status(400).send(L("Import error",'<div class=c>'+E(e.message)+'</div>',req.session.user))}}));
app.post("/snapshot",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows,o=Object.fromEntries(r.map(x=>[x.record_key,x.payload]));await Q("insert into backups(record_count,payload) values($1,$2)",[r.length,o]);await Q("delete from backups where id not in(select id from backups order by id desc limit 50)");res.redirect("/backup")}));
app.get("/export",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows;res.setHeader("Content-Disposition",'attachment; filename="greenair-web-backup.json"');res.json({SchemaVersion:2,ExportedUtc:new Date().toISOString(),Records:Object.fromEntries(r.map(x=>[x.record_key,x.payload]))})}));
// Staging-only scheduled database snapshots. These are NOT offsite disaster recovery.
const SNAPSHOT_INTERVAL_MS=24*60*60*1000;
async function scheduledSnapshot(){
  if(process.env.ENABLE_STAGING_SNAPSHOTS!=="true")return;
  const client=await pool.connect();
  let locked=false;
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(25370025) AS locked");
    locked=lock.rows[0].locked;
    if(!locked)return;
    await client.query("BEGIN");
    const recent=await client.query("SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1");
    if(recent.rows.length && Date.now()-new Date(recent.rows[0].created_at).getTime()<20*60*60*1000){
      await client.query("COMMIT");return;
    }
    const records=await client.query("SELECT record_key,payload FROM records ORDER BY record_key");
    const data=Object.fromEntries(records.rows.map(r=>[r.record_key,r.payload]));
    await client.query("INSERT INTO backups(record_count,payload) VALUES($1,$2)",[records.rowCount,data]);
    await client.query("DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 14)");
    await client.query("COMMIT");
    console.log("Scheduled staging snapshot completed; records:",records.rowCount);
  }catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    console.error("Scheduled staging snapshot failed:",err.message);
  }finally{
    if(locked)await client.query("SELECT pg_advisory_unlock(25370025)").catch(()=>{});
    client.release();
  }
}
// Portable offsite export of a retained snapshot, with an integrity digest.
// Download to a separate device or cloud drive; snapshots in this database are not offsite.
app.get("/backup/download/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).send("Invalid snapshot ID");
    const r=await Q("SELECT id,created_at,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).send("Snapshot not found");
    const snapshot=r.rows[0],records=snapshot.payload||{};
    if(!records||typeof records!=="object"||Array.isArray(records))throw Error("Invalid snapshot contents");
    const keys=Object.keys(records).sort();
    if(keys.length!==snapshot.record_count)throw Error("Snapshot record count mismatch");
    const ordered=Object.fromEntries(keys.map(k=>[k,records[k]]));
    const crypto=require("crypto");
    const digest=crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
    const date=new Date(snapshot.created_at).toISOString().slice(0,10);
    const exportData={SchemaVersion:2,ExportedUtc:new Date().toISOString(),SnapshotId:String(snapshot.id),SnapshotCreatedUtc:snapshot.created_at,RecordCount:keys.length,RecordsSha256:digest,Records:ordered};
    res.set("Cache-Control","no-store");
    res.set("X-Content-Type-Options","nosniff");
    res.set("Content-Disposition",'attachment; filename="greenair-invoice-v25-snapshot-'+date+'-'+snapshot.id+'.json"');
    res.type("application/json").send(JSON.stringify(exportData));
  }catch(err){
    console.error("snapshot export failed",err.message);
    res.status(500).send("Snapshot integrity check failed or export unavailable");
  }
}));
app.get("/backup/verify/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).json({ok:false,error:"invalid_snapshot_id"});
    const r=await Q("SELECT id,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).json({ok:false,error:"snapshot_not_found"});
    const snapshot=r.rows[0],data=snapshot.payload;
    const valid=!!data&&typeof data==="object"&&!Array.isArray(data)&&Object.keys(data).length===snapshot.record_count;
    res.set("Cache-Control","no-store").json({ok:valid,snapshot_id:String(snapshot.id),record_count:snapshot.record_count,storage:"same_database",restore_tested:false});
  }catch(e){res.status(503).json({ok:false,error:"verification_unavailable"});}
}));
app.get("/backup/status",(req,res)=>A(req,res,async()=>{
  try{
    const result=await Q("SELECT id,created_at,record_count FROM backups ORDER BY id DESC LIMIT 14");
    res.json({snapshots_enabled:process.env.ENABLE_STAGING_SNAPSHOTS==="true",storage:"same_postgres_database_not_offsite",snapshots:result.rows});
  }catch(e){res.status(503).json({error:"backup_status_unavailable"});}
}));
const PORT=Number(process.env.PORT)||10000;app.listen(PORT,"0.0.0.0",()=>console.log(`Greenair Invoice listening on ${PORT}`));init().then(()=>{console.log("Database initialised");scheduledSnapshot();setInterval(scheduledSnapshot,SNAPSHOT_INTERVAL_MS).unref();}).catch(e=>console.error("Database init error",e));+money(total)+'</h2><p class=noprint><button onclick="window.print()">Print / Save PDF</button></p><small>Greenair · Adelaide, SA</small></div>';
    res.send(L("Greenair Tax Invoice",body,false));
  }catch(e){console.error("shared invoice error",e.message);res.status(503).send("Invoice temporarily unavailable");}
});
app.get("/invoice/email/:id",(req,res)=>A(req,res,async()=>{
  try{
    const key="invoice:"+req.params.id;
    const r=(await Q("select payload from records where record_key=$1",[key])).rows[0];
    if(!r)return res.status(404).send("Invoice not found");
    const v=D(r.payload);
    let email=v.CustomerEmail||v.Email||"";
    if(!email&&v.CustomerKey){
      const c=(await Q("select payload from records where record_key=$1",[v.CustomerKey])).rows[0];
      if(c)email=pick(D(c.payload),"Email","EmailAddress");
    }
    if(!email)return res.status(400).send(L("No customer email",'<h1>No customer email</h1><div class=c>Add an email address to this customer before sending the invoice.</div><p><a href="/invoice/view/'+encodeURIComponent(req.params.id)+'">Back to invoice</a></p>',req.session.user));
    const crypto=require("crypto"),token=crypto.randomBytes(32).toString("hex");
    const hash=crypto.createHash("sha256").update(token).digest("hex");
    await Q("INSERT INTO invoice_share_links(token_hash,record_key,expires_at) VALUES($1,$2,now()+interval '30 days')",[hash,key]);
    const origin="https://greenair-invoice-v25-staging.onrender.com";
    const view=origin+"/invoice/shared/"+token;
    const subject="Greenair Tax Invoice "+(v.Number||"");
    const body=["Hi "+(v.CustomerName||"")+",","","Please view your Greenair Tax Invoice "+(v.Number||"")+" here:",view,"","This secure link expires in 30 days.","","Thank you,","Greenair"].join(String.fromCharCode(13,10))
    const mailto="mailto:"+encodeURIComponent(email)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    res.set("Cache-Control","no-store").send(L("Email Invoice",'<h1>Email invoice '+E(v.Number||"")+'</h1><div class=c><p><b>To:</b> '+E(email)+'</p><p>A private invoice link has been included in your email draft. It expires after 30 days. Anyone with the link can view this invoice, so only send it to the intended customer.</p><p><a href="'+E(mailto)+'" style="display:inline-block;background:#176b45;color:#fff;padding:13px 18px;border-radius:7px;text-decoration:none">Open email app</a></p><p><a href="'+E(view)+'" target="_blank" rel="noopener noreferrer">Test customer invoice link</a></p><p><a href="/invoice/view/'+encodeURIComponent(req.params.id)+'">Back to invoice</a></p><small>Check the recipient and press Send in your email app. No email has been sent automatically.</small></div>',req.session.user));
  }catch(e){
    console.error("gmail compose",e);
    res.status(500).send(L("Email could not open",'<h1>Email could not open</h1><div class=c>'+E(e.message)+'</div>',req.session.user));
  }
}));
app.get("/invoice/view/:id",(req,res)=>A(req,res,async()=>{let key="invoice:"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Invoice not found");let v=D(r.payload),items=Array.isArray(v.Items)?v.Items:[],money=n=>Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")};let total=Number(v.Total||0),subtotal=v.Subtotal!=null?Number(v.Subtotal):total/1.1,gst=v.Gst!=null?Number(v.Gst):total-subtotal;let rows=items.map(i=>`<tr><td>${E(i.Description||i.Name||"")}</td><td>${E(i.Quantity||1)}</td><td>${E(money(i.UnitPrice||i.Rate))}</td><td>${E(money(Number(i.Quantity||1)*Number(i.UnitPrice||i.Rate||0)))}</td></tr>`).join("");res.send(L("Invoice "+(v.Number||""),`<style>.inv{background:#fff;max-width:900px;margin:auto;padding:34px;color:#444}.green{color:#69ad45}.invtop{display:flex;justify-content:space-between;gap:30px}.brand{text-align:right;min-width:300px}.brand h1{font-size:30px;font-weight:400;margin:18px 0 0}.logoFix{width:280px;max-width:100%;box-sizing:border-box;background:linear-gradient(180deg,#075d12,#159a29 48%,#064d0e);border:3px solid #173c1d;color:#f1f1f1;font-family:Georgia,serif;font-size:38px;line-height:1;font-weight:700;letter-spacing:2px;text-align:center;padding:10px 12px;text-shadow:2px 2px 2px #222;white-space:nowrap;overflow:hidden}.bill{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:24px 0}.meta td{padding:3px 12px 3px 0;border:0}.items{width:100%;border-collapse:collapse}.items th{background:#e4f1dc;text-align:left;font-weight:400;padding:8px}.items td{padding:8px;border:0}.totals{margin:250px 0 55px auto;width:300px}.totals td{border:0;padding:5px}.balance{font-size:22px;color:#69ad45}.pay{background:#e4f1dc;padding:16px;display:flex;justify-content:space-between}.case{margin:25px 0}.actions{margin:18px auto;max-width:900px}@media(max-width:600px){.w{padding:8px}.inv{padding:16px;overflow:hidden}.invtop,.bill,.pay{display:block}.brand{text-align:left;margin-top:18px;min-width:0}.brand h1{margin-top:14px}.logoFix{width:100%;font-size:32px;letter-spacing:1px;padding:10px 8px}.brand img{margin-left:0!important;max-height:90px;object-fit:contain}.bill{margin-top:18px}.meta{width:100%;min-width:0!important;table-layout:fixed}.meta td{font-size:14px;overflow-wrap:anywhere}.items{width:100%!important;min-width:0!important;table-layout:fixed;font-size:11px}.items th,.items td{padding:6px 3px;overflow-wrap:anywhere}.items th:first-child,.items td:first-child{width:44%}.totals{margin-top:80px;width:100%;min-width:0}.pay{font-size:13px;overflow-wrap:anywhere}}@media print{@page{size:A4;margin:12mm}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}header,.actions{display:none!important}.inv{max-width:none;padding:12px}.w{max-width:none;padding:0}.logoFix{background:#087b20!important;color:#fff!important;border:3px solid #173c1d!important}.items th,.pay{background:#e4f1dc!important}.green,.balance{color:#69ad45!important}}</style><div class=inv><div class=invtop><div><b>Greenair</b><br>ABN 60202774371<br>Adelaide, SA<br>Locky 0412 395 325 | Brayden 0434 807 232<br>greenair.controls@gmail.com</div><div class=brand><div class="logoFix">GREENAIR</div><h1 class=green>Tax Invoice</h1></div></div><div class=bill><div><span class=green>INVOICE TO</span><br><br><b>${E(v.CustomerName||"")}</b><br>${E(v.CustomerAddress||v.Address||"")}</div><table class=meta><tr><td>INVOICE</td><td>${E(v.Number||"")}</td></tr><tr><td>DATE</td><td>${E(date(v.IssueDate))}</td></tr><tr><td>TERMS</td><td>${E(v.Terms||"Due on receipt")}</td></tr><tr><td>DUE DATE</td><td>${E(date(v.DueDate||v.IssueDate))}</td></tr></table></div><p><b>Email status:</b> ${E(v.EmailStatus||"Not sent")}${v.EmailSentUtc?" • Sent "+E(date(v.EmailSentUtc)):""}${v.EmailOpenedUtc?" • Opened "+E(new Date(v.EmailOpenedUtc).toLocaleString("en-AU")):""}</p><div class=case>CASE NO &nbsp;&nbsp;&nbsp;&nbsp; ${E(v.CaseNo||v.Job||v.Description||"")}</div><table class=items><tr><th>ACTIVITY</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr>${rows}</table><table class=totals><tr><td>SUBTOTAL</td><td>${money(subtotal)}</td></tr><tr><td>GST TOTAL</td><td>${money(gst)}</td></tr><tr><td>TOTAL</td><td>${money(total)}</td></tr><tr class=balance><td>BALANCE DUE</td><td>A$${money(total)}</td></tr></table><div class=pay><div><b>BANK TRANSFER</b><br>Account: Lochlan Weeks<br>BSB: 062-692 &nbsp;&nbsp; Account: 83543903<br>Reference: ${E(v.Number||"")}</div><div class=green>PAYMENT</div></div></div><div class=actions><a href="/edit/invoice/${encodeURIComponent(req.params.id)}"><button>Edit Invoice</button></a> <button onclick="window.print()">Print / Save PDF</button> <a href="/invoice/email/${encodeURIComponent(req.params.id)}" target="_blank" rel="noopener"><button type=button>Email Invoice</button></a></div>`,req.session.user))}));
app.get("/backup",(req,res)=>A(req,res,()=>res.send(L("Backup",'<h1>Backup & Migration</h1><div class=c><h2>Import Greenair v2 JSON</h2><form method=post action="/import" enctype="multipart/form-data"><input type=file name=backup accept=".json" required> <button>Import</button></form></div><div class=c><form method=post action="/snapshot"><button>Create server snapshot</button></form><p><a href="/export">Download current JSON export</a></p></div>',req.session.user))));
app.post("/import",upload.single("backup"),(req,res)=>A(req,res,async()=>{try{let d=JSON.parse(req.file.buffer.toString()),r=d.Records||d.records;if(!r)throw Error("No Records map found");let c=await pool.connect();try{await c.query("begin");for(let[k,v]of Object.entries(r)){let t=k.includes(":")?k.split(":")[0]:(v.Type||v.type||"unknown").toLowerCase();await c.query("insert into records(record_key,record_type,payload) values($1,$2,$3) on conflict(record_key) do update set record_type=excluded.record_type,payload=excluded.payload,updated_at=now()",[k,t,v])}await c.query("commit")}catch(e){await c.query("rollback");throw e}finally{c.release()}res.redirect("/")}catch(e){res.status(400).send(L("Import error",'<div class=c>'+E(e.message)+'</div>',req.session.user))}}));
app.post("/snapshot",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows,o=Object.fromEntries(r.map(x=>[x.record_key,x.payload]));await Q("insert into backups(record_count,payload) values($1,$2)",[r.length,o]);await Q("delete from backups where id not in(select id from backups order by id desc limit 50)");res.redirect("/backup")}));
app.get("/export",(req,res)=>A(req,res,async()=>{let r=(await Q("select record_key,payload from records")).rows;res.setHeader("Content-Disposition",'attachment; filename="greenair-web-backup.json"');res.json({SchemaVersion:2,ExportedUtc:new Date().toISOString(),Records:Object.fromEntries(r.map(x=>[x.record_key,x.payload]))})}));
// Staging-only scheduled database snapshots. These are NOT offsite disaster recovery.
const SNAPSHOT_INTERVAL_MS=24*60*60*1000;
async function scheduledSnapshot(){
  if(process.env.ENABLE_STAGING_SNAPSHOTS!=="true")return;
  const client=await pool.connect();
  let locked=false;
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(25370025) AS locked");
    locked=lock.rows[0].locked;
    if(!locked)return;
    await client.query("BEGIN");
    const recent=await client.query("SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1");
    if(recent.rows.length && Date.now()-new Date(recent.rows[0].created_at).getTime()<20*60*60*1000){
      await client.query("COMMIT");return;
    }
    const records=await client.query("SELECT record_key,payload FROM records ORDER BY record_key");
    const data=Object.fromEntries(records.rows.map(r=>[r.record_key,r.payload]));
    await client.query("INSERT INTO backups(record_count,payload) VALUES($1,$2)",[records.rowCount,data]);
    await client.query("DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 14)");
    await client.query("COMMIT");
    console.log("Scheduled staging snapshot completed; records:",records.rowCount);
  }catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    console.error("Scheduled staging snapshot failed:",err.message);
  }finally{
    if(locked)await client.query("SELECT pg_advisory_unlock(25370025)").catch(()=>{});
    client.release();
  }
}
// Portable offsite export of a retained snapshot, with an integrity digest.
// Download to a separate device or cloud drive; snapshots in this database are not offsite.
app.get("/backup/download/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).send("Invalid snapshot ID");
    const r=await Q("SELECT id,created_at,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).send("Snapshot not found");
    const snapshot=r.rows[0],records=snapshot.payload||{};
    if(!records||typeof records!=="object"||Array.isArray(records))throw Error("Invalid snapshot contents");
    const keys=Object.keys(records).sort();
    if(keys.length!==snapshot.record_count)throw Error("Snapshot record count mismatch");
    const ordered=Object.fromEntries(keys.map(k=>[k,records[k]]));
    const crypto=require("crypto");
    const digest=crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
    const date=new Date(snapshot.created_at).toISOString().slice(0,10);
    const exportData={SchemaVersion:2,ExportedUtc:new Date().toISOString(),SnapshotId:String(snapshot.id),SnapshotCreatedUtc:snapshot.created_at,RecordCount:keys.length,RecordsSha256:digest,Records:ordered};
    res.set("Cache-Control","no-store");
    res.set("X-Content-Type-Options","nosniff");
    res.set("Content-Disposition",'attachment; filename="greenair-invoice-v25-snapshot-'+date+'-'+snapshot.id+'.json"');
    res.type("application/json").send(JSON.stringify(exportData));
  }catch(err){
    console.error("snapshot export failed",err.message);
    res.status(500).send("Snapshot integrity check failed or export unavailable");
  }
}));
app.get("/backup/verify/:id",(req,res)=>A(req,res,async()=>{
  try{
    if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).json({ok:false,error:"invalid_snapshot_id"});
    const r=await Q("SELECT id,record_count,payload FROM backups WHERE id=$1",[req.params.id]);
    if(!r.rowCount)return res.status(404).json({ok:false,error:"snapshot_not_found"});
    const snapshot=r.rows[0],data=snapshot.payload;
    const valid=!!data&&typeof data==="object"&&!Array.isArray(data)&&Object.keys(data).length===snapshot.record_count;
    res.set("Cache-Control","no-store").json({ok:valid,snapshot_id:String(snapshot.id),record_count:snapshot.record_count,storage:"same_database",restore_tested:false});
  }catch(e){res.status(503).json({ok:false,error:"verification_unavailable"});}
}));
app.get("/backup/status",(req,res)=>A(req,res,async()=>{
  try{
    const result=await Q("SELECT id,created_at,record_count FROM backups ORDER BY id DESC LIMIT 14");
    res.json({snapshots_enabled:process.env.ENABLE_STAGING_SNAPSHOTS==="true",storage:"same_postgres_database_not_offsite",snapshots:result.rows});
  }catch(e){res.status(503).json({error:"backup_status_unavailable"});}
}));
const PORT=Number(process.env.PORT)||10000;app.listen(PORT,"0.0.0.0",()=>console.log(`Greenair Invoice listening on ${PORT}`));init().then(()=>{console.log("Database initialised");scheduledSnapshot();setInterval(scheduledSnapshot,SNAPSHOT_INTERVAL_MS).unref();}).catch(e=>console.error("Database init error",e));
