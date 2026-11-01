const nodemailer=require("nodemailer"),express=require("express"),{Pool}=require("pg"),session=require("express-session"),PgStore=require("connect-pg-simple")(session),bcrypt=require("bcryptjs"),helmet=require("helmet"),multer=require("multer");
const app=express(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}}),pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false});
app.set("trust proxy",1);app.use(helmet({contentSecurityPolicy:false}));app.use(express.urlencoded({extended:true,limit:"15mb"}));app.use(express.json({limit:"15mb"}));app.use(session({store:new PgStore({pool,tableName:"user_sessions",createTableIfMissing:true}),secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:43200000}}));
const Q=(s,p=[])=>pool.query(s,p),D=v=>{if(v&&v.Json!=null){try{return typeof v.Json==="string"?JSON.parse(v.Json):v.Json}catch{}}return v||{}},E=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),A=(req,res,n)=>req.session.user?n():res.redirect("/login");
async function init(){
  await Q("create table if not exists app_users(id bigserial primary key,email text unique not null,password_hash text not null,role text not null default 'admin',created_at timestamptz default now())");
  await Q("create table if not exists records(record_key text primary key,record_type text not null,payload jsonb not null,updated_at timestamptz default now())");
  await Q("create table if not exists invoice_photos(id bigserial primary key,invoice_key text not null references records(record_key) on delete cascade,filename text not null,mime text not null,photo bytea not null,created_at timestamptz default now())");
  await Q("create index if not exists invoice_photos_invoice_key_idx on invoice_photos(invoice_key)");
  await Q("create table if not exists receipts(id bigserial primary key,supplier text not null default '',receipt_date date,amount numeric(12,2),gst numeric(12,2),notes text not null default '',invoice_key text references records(record_key) on delete set null,filename text not null,mime text not null,file_data bytea not null,created_at timestamptz default now())");
  await Q("create index if not exists receipts_invoice_key_idx on receipts(invoice_key)");
  await Q("create table if not exists backups(id bigserial primary key,created_at timestamptz default now(),record_count int not null,payload jsonb not null)");
  await Q("create table if not exists invoice_share_links(token_hash text primary key,record_key text not null references records(record_key),expires_at timestamptz not null,created_at timestamptz not null default now())");
  let n=(await Q("select count(*)::int n from app_users")).rows[0].n;
  if(!n&&process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD)await Q("insert into app_users(email,password_hash) values($1,$2)",[process.env.ADMIN_EMAIL.toLowerCase(),await bcrypt.hash(process.env.ADMIN_PASSWORD,12)]);
  // No automatic creation of sample or customer-specific invoices on startup.
  // Import data only via explicit authenticated import after backup review.
}
function L(t,b,u){return `<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>${E(t)}</title><style>body{font-family:system-ui;margin:0;background:#f3f6f4;color:#17221c}header{background:#143b2a;color:#fff;padding:15px 22px;display:flex;gap:18px;flex-wrap:wrap}header a{color:#fff;text-decoration:none}.w{max-width:1180px;margin:auto;padding:22px}.c{background:#fff;padding:18px;border-radius:12px;margin-bottom:16px;box-shadow:0 1px 5px #0002}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.m{font-size:30px;font-weight:700}input,button{padding:10px;border:1px solid #ccd2d8;border-radius:7px}button{background:#176b45;color:#fff;border:0}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}small{color:#667}@media print{header,.noprint{display:none!important}.w{max-width:none;padding:0}.c{box-shadow:none}}.job{max-width:340px} @media(max-width:700px){.w{padding:14px}header{padding:12px 14px;gap:12px}.c{padding:12px}h1{font-size:32px}}</style></head><body>${u?'<header><b>Greenair Invoice</b><a href="/">Dashboard</a><a href="/r/customer">Customers</a><a href="/r/invoice">Invoices</a><a href="/quote/convert">Convert Quote</a><a href="/r/payment">Payments</a><a href="/receipts">Receipts</a><a href="/r/product">Products</a><a href="/backup">Backup / Import</a><a href="/logout">Logout</a></header>':""}<main class=w>${b}</main></body></html>`}
app.get("/health",async(req,res)=>{try{await Q("SELECT 1");res.json({ok:true,database:"connected"});}catch(e){console.error("health database unavailable",e.code||e.message);res.status(503).json({ok:false,database:"unavailable"});}});
app.get("/setup",async(req,res)=>{let n=(await Q("select count(*)::int n from app_users")).rows[0].n;if(n)return res.redirect("/login");res.send(L("Create Admin",'<div class=c style="max-width:460px;margin:60px auto"><h1>Create Greenair Admin</h1><p>This page disables itself after the first account is created.</p><form method=post><p><input name=email type=email placeholder="Admin email" required style="width:90%"></p><p><input name=password type=password minlength=12 placeholder="Password (12+ characters)" required style="width:90%"></p><p><input name=confirm type=password minlength=12 placeholder="Confirm password" required style="width:90%"></p><button>Create administrator</button></form></div>'))});
app.post("/setup",async(req,res)=>{let n=(await Q("select count(*)::int n from app_users")).rows[0].n;if(n)return res.redirect("/login");let email=(req.body.email||"").trim().toLowerCase(),pw=req.body.password||"";if(!email||pw.length<12||pw!==req.body.confirm)return res.status(400).send(L("Setup","<div class=c>Email is required, passwords must match, and password must be at least 12 characters.</div>"));try{await Q("insert into app_users(email,password_hash,role) values($1,$2,'admin')",[email,await bcrypt.hash(pw,12)]);req.session.user={email};res.redirect("/")}catch(e){res.status(400).send(L("Setup","<div class=c>Administrator setup could not be completed.</div>"))}});

app.get("/login",(req,res)=>res.send(L("Login",'<div class=c style="max-width:420px;margin:60px auto"><h1>Greenair Invoice</h1><form method=post><p><input name=email type=email placeholder=Email required></p><p><input name=password type=password placeholder=Password required></p><button>Sign in</button></form></div>')));
app.post("/login",async(req,res)=>{let u=(await Q("select * from app_users where email=$1",[(req.body.email||"").toLowerCase()])).rows[0];if(!u||!await bcrypt.compare(req.body.password||"",u.password_hash))return res.status(401).send(L("Login","<div class=c>Invalid login.</div>"));req.session.user={email:u.email};res.redirect("/")});app.get("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/login")));
app.get("/",(req,res)=>A(req,res,async()=>{let body=`<style>.home{max-width:680px;margin:auto;text-align:center}.logo{background:linear-gradient(#087c19,#1e9c31,#075c13);color:#ddd;font-family:Georgia,serif;font-weight:700;font-size:clamp(42px,10vw,78px);letter-spacing:4px;padding:10px;border:3px solid #163d1d;text-shadow:2px 2px 3px #222;margin-bottom:12px}.subtitle{font-size:28px;font-weight:300;margin:12px 0 35px}.homebtn{display:block;background:#65b849;color:white;text-decoration:none;font-size:30px;font-weight:300;padding:34px 15px;margin:0 0 24px;border-radius:0;box-shadow:0 2px 3px #0002}.settings{display:block;background:#d9dcdb;color:#333;text-decoration:none;font-size:20px;padding:18px;margin-top:38px}.version{color:#999;margin-top:12px}@media(max-width:600px){header{display:none}.w{padding:28px 26px}.homebtn{font-size:28px;padding:31px 12px}.subtitle{font-size:26px}.logo{font-size:50px}}</style><div class=home><div class=logo>GREENAIR</div><div class=subtitle>INVOICING</div><a class=homebtn href="/invoice/new">NEW INVOICE</a><a class=homebtn href="/quote/new">NEW QUOTE</a><a class=homebtn href="/quote/convert">CONVERT QUOTE TO INVOICE</a><a class=homebtn href="/r/customer">CLIENTS</a><a class=homebtn href="/r/invoice">VIEWED INVOICES</a><a class=homebtn href="/receipts">RECEIPTS</a><a class=settings href="/backup">More / Settings</a><div class=version>Greenair Web Invoice • v0.4.0 • Secure cloud database</div></div>`;res.send(L("Greenair Invoicing",body,req.session.user))}));
app.get("/r/:type",(req,res)=>A(req,res,async()=>{let t=req.params.type.toLowerCase(),search=(req.query.q||"").trim(),p=[t],sql="select record_key,payload,updated_at from records where record_type=$1";if(search){sql+=" and payload::text ilike $2";p.push("%"+search+"%")}sql+=" order by updated_at desc limit 500";let rows=(await Q(sql,p)).rows;if(t==="customer"){const val=(v,...ks)=>{for(const k of ks)if(v[k]!=null&&String(v[k]).trim())return v[k];return ""};let body=rows.map(r=>{let v=D(r.payload),name=val(v,"Name","CustomerName","CompanyName","DisplayName","ContactName"),phone=val(v,"Phone","PhoneNumber","Mobile","MobileNumber","Telephone"),email=val(v,"Email","EmailAddress"),addr=val(v,"Address","StreetAddress","BillingAddress","PostalAddress");if(addr&&typeof addr==="object")addr=[addr.Line1,addr.Line2,addr.Suburb,addr.State,addr.Postcode].filter(Boolean).join(", ");let id=r.record_key.split(":").slice(1).join(":");return `<tr><td><a href="/edit/customer/${encodeURIComponent(id)}"><b>${E(name||"Unnamed customer")}</b></a></td><td>${E(phone)}</td><td>${E(email)}</td><td>${E(addr)}</td></tr>`}).join("");return res.send(L("Customers",`<h1>Customers</h1><p><a href="/customer/new"><button>+ New Customer</button></a></p><div class=c><form><input name=q value="${E(search)}" placeholder="Search name, phone, email or address"><button>Search</button></form></div><div class="c scroll"><table><tr><th>Customer / Company</th><th>Phone</th><th>Email</th><th>Address</th></tr>${body}</table></div>`,req.session.user))}if(t==="payment"){
  const all=(await Q("select record_key,record_type,payload from records where record_type in ('invoice','payment') order by updated_at desc limit 5000")).rows;
  const invoices=all.filter(r=>r.record_type==="invoice"),payments=all.filter(r=>r.record_type==="payment");
  const value=(v,...keys)=>{for(const k of keys)if(v[k]!==undefined&&v[k]!==null&&String(v[k]).trim()!=="")return v[k];return ""};
  const num=x=>{const n=Number(String(x??"").replace(/[$,]/g,""));return Number.isFinite(n)?n:0};
  const money=x=>num(x).toLocaleString("en-AU",{style:"currency",currency:"AUD"});
  const day=x=>{if(!x)return "";const d=new Date(x);return isNaN(d.getTime())?"":d.toLocaleDateString("en-AU")};
  const today=new Date();today.setHours(0,0,0,0);
  const data=invoices.map(r=>{
    const v=D(r.payload),id=r.record_key.slice("invoice:".length),number=String(value(v,"Number","InvoiceNumber")||id),customer=String(value(v,"CustomerName","ClientName","Name")||"Customer not specified");
    const total=Math.max(0,num(value(v,"Total","GrandTotal","TotalAmount")));
    const related=payments.map(p=>D(p.payload)).filter(p=>[value(p,"InvoiceId","InvoiceID","InvoiceKey","InvoiceNumber","InvoiceNo")].some(k=>String(k)===id||String(k)===r.record_key||String(k)===number));
    const paidFromRecords=related.reduce((a,p)=>a+Math.max(0,num(value(p,"Amount","PaymentAmount","AmountPaid"))),0);
    const explicitPaid=value(v,"AmountPaid","PaidAmount","TotalPaid");
    const paid=explicitPaid!==""?Math.max(0,num(explicitPaid)):paidFromRecords;
    const rawStatus=String(value(v,"Status","PaymentStatus")).toLowerCase();
    const settled=rawStatus==="paid"||rawStatus==="6";
    const outstanding=settled?0:Math.max(0,total-paid);
    const due=value(v,"DueDate","PaymentDueDate"),dueTime=due?new Date(due):null;
    const status=settled||total>0&&outstanding<0.005?"Paid":paid>0?"Partially paid":dueTime&&!isNaN(dueTime)&&dueTime<today?"Overdue":"Unpaid";
    return {id,number,customer,total,paid:settled?total:paid,outstanding,status,due:day(due),lastPayment:day(value(related[0]||{},"PaymentDate","Date","PaidDate"))};
  });
  const filter=String(req.query.status||"all").toLowerCase();
  const term=search.toLowerCase();
  const filtered=data.filter(x=>(!term||[x.customer,x.number].some(v=>v.toLowerCase().includes(term)))&&(filter==="all"||filter==="paid"&&x.status==="Paid"||filter==="unpaid"&&x.status!=="Paid"||filter===x.status.toLowerCase().replace(/ /g,"-")));
  const received=data.reduce((a,x)=>a+x.paid,0),owing=data.reduce((a,x)=>a+x.outstanding,0);
  const cards=filtered.map(x=>`<article class="paycard"><div><a href="/invoice/view/${encodeURIComponent(x.id)}"><strong>${E(x.customer)}</strong></a><div class="muted">Invoice ${E(x.number)}</div></div><div class="payright"><strong>${E(money(x.total))}</strong><span class="paystatus ${x.status==="Paid"?"paid":x.status==="Overdue"?"overdue":"unpaid"}">${E(x.status)}</span></div><div class="paydetail">Received: ${E(money(x.paid))} &nbsp; Outstanding: ${E(money(x.outstanding))}${x.due?" &nbsp; Due: "+E(x.due):""}${x.lastPayment?" &nbsp; Last payment: "+E(x.lastPayment):""}</div></article>`).join("");
  const body=`<style>.paystats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.paystats .c{margin:0}.paystats strong{font-size:clamp(19px,4vw,30px);overflow-wrap:anywhere}.muted{color:#667;font-size:13px}.payfilters{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.payfilters a{background:#e9f1eb;color:#143b2a;padding:9px 14px;border-radius:8px;text-decoration:none}.payfilters a.active{background:#176b45;color:white}.paycard{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:16px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}.payright{text-align:right}.paystatus{display:block;font-size:12px;font-weight:700;padding:3px 7px;border-radius:7px;background:#f5e7c8}.paystatus.paid{background:#d8f2df;color:#176b45}.paystatus.overdue{background:#fce0e0;color:#a52222}.paydetail{grid-column:1/-1;color:#526159;font-size:13px}.paysearch{display:flex;gap:8px}.paysearch input{min-width:0;flex:1}@media(max-width:480px){.paycard{padding:13px 4px}.paystats{gap:8px}.paystats .c{padding:10px}}</style><h1>Payments</h1><div class="paystats"><div class=c><div class=muted>Total received</div><strong>${E(money(received))}</strong></div><div class=c><div class=muted>Outstanding</div><strong>${E(money(owing))}</strong></div></div><div class=c style="margin-top:16px"><form class=paysearch method=get><input type=search name=q placeholder="Search customer or invoice" value="${E(search)}"><input type=hidden name=status value="${E(filter)}"><button>Search</button></form><nav class=payfilters>${[["all","All"],["paid","Paid"],["unpaid","Unpaid"],["partially-paid","Partially paid"],["overdue","Overdue"]].map(([key,label])=>`<a class="${filter===key?"active":""}" href="/r/payment?status=${key}&q=${encodeURIComponent(search)}">${label}</a>`).join("")}</nav></div><div class=c><h2>Invoice payments (${filtered.length})</h2>${cards||"<p>No matching invoices.</p>"}</div><p class=muted>Balances are calculated from available invoice and linked payment records. Check unmatched imported payments against original records.</p>`;
  return res.send(L("Payments",body,req.session.user));
}
if(t==="invoice"){const money=n=>"$"+Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{if(!x)return "";let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")},desc=v=>{let a=Array.isArray(v.Items)?v.Items:[];return a.map(i=>i.Description||"").filter(Boolean).join("; ").slice(0,120)},status=v=>{let x=v.Status;return typeof x==="string"?x:(x===6?"Paid":x===0?"Draft":String(x??""))};let body=rows.map(r=>{let v=D(r.payload);let id=r.record_key.split(":").slice(1).join(":");return `<tr><td><a href="/invoice/view/${encodeURIComponent(id)}"><b>${E(v.Number||"")}</b></a></td><td>${E(v.CustomerName||"")}</td><td>${E(date(v.IssueDate))}</td><td class=job>${E(desc(v))}</td><td><b>${E(money(v.Total))}</b></td><td>${E(status(v))}</td></tr>`}).join("");return res.send(L("Invoices",`<h1>Invoices</h1><p><a href="/invoice/new"><button>+ New Invoice</button></a></p><div class=c><form><input name=q value="${E(search)}" placeholder="Search invoice, customer or job"><button>Search</button></form></div><div class="c scroll"><table><tr><th>Invoice No.</th><th>Customer</th><th>Date</th><th>Job / Description</th><th>Total</th><th>Status</th></tr>${body}</table></div>`,req.session.user))}res.send(L(t,`<h1>${E(t)}s</h1><div class=c><form><input name=q value="${E(search)}" placeholder=Search><button>Search</button></form></div><div class="c scroll"><table><tr><th>Record</th><th>Details</th></tr>${rows.map(r=>`<tr><td>${E(r.record_key)}</td><td><small>${E(JSON.stringify(r.payload).slice(0,400))}</small></td></tr>`).join("")}</table></div>`,req.session.user))}));
app.get("/quote/convert",(req,res)=>A(req,res,async()=>{
 const q=String(req.query.q||"").trim();
 const rows=(await Q("select record_key,payload from records where record_type='quote' order by updated_at desc limit 1000")).rows.filter(r=>{const v=D(r.payload);return !q||JSON.stringify(v).toLowerCase().includes(q.toLowerCase())});
 const html=rows.map(r=>{const v=D(r.payload),id=r.record_key.slice(6),num=pick(v,"Number","QuoteNumber","QuoteNo"),customer=pick(v,"CustomerName","ClientName","Customer"),total=pick(v,"Total","GrandTotal");return '<tr><td>'+E(num)+'</td><td>'+E(customer)+'</td><td>'+E(total)+'</td><td><form method="post" action="/quote/convert/'+encodeURIComponent(id)+'"><button type="submit">Create draft invoice</button></form></td></tr>'}).join("");
 res.send(L("Convert Quote to Invoice",'<h1>Convert Quote to Invoice</h1><p>The original quote is retained. A new draft invoice will be created.</p><div class=c><form method=get><input name=q placeholder="Search quote or customer" value="'+E(q)+'"><button>Search</button></form></div><div class="c scroll"><table><tr><th>Quote</th><th>Customer</th><th>Total</th><th>Action</th></tr>'+ (html||'<tr><td colspan=4>No quotes found in this database.</td></tr>')+'</table></div>',req.session.user));
}));
app.post("/quote/convert/:id",(req,res)=>A(req,res,async()=>{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query("select pg_advisory_xact_lock(487211)");
  const key="quote:"+req.params.id;
  const source=(await client.query("select payload from records where record_key=$1",[key])).rows[0];
  if(!source){await client.query("ROLLBACK");return res.status(404).send("Quote not found")}
  const q=D(source.payload);
  const existing=(await client.query("select record_key,payload from records where record_type='invoice'")).rows;
  const previous=existing.find(r=>D(r.payload).SourceQuoteKey===key);
  if(previous){await client.query("ROLLBACK");return res.redirect("/invoice/view/"+encodeURIComponent(previous.record_key.slice(8)))}
  const nums=existing.map(r=>String(D(r.payload).Number||"")).filter(n=>/^21\d{3}$/.test(n)).map(Number);
  const number=String(Math.max(21474,...nums)+1),id=U();
  const items=Array.isArray(q.Items)?q.Items.map(i=>({...i})):[];
  const total=Number(q.Total??q.GrandTotal??items.reduce((a,i)=>a+Number(i.Quantity||0)*Number(i.UnitPrice||0),0));
  if(!Number.isFinite(total)||total<0)throw Error("Invalid quote total");
  const invoice={...q,Number:number,IssueDate:new Date().toISOString(),Status:"Draft",Items:items,Total:total,Subtotal:Number(q.Subtotal??total/1.1),Gst:Number(q.Gst??(total-total/1.1)),SourceQuoteKey:key,SourceQuoteNumber:pick(q,"Number","QuoteNumber","QuoteNo")};
  delete invoice.EmailOpenedUtc;delete invoice.EmailStatus;
  await client.query("insert into records(record_key,record_type,payload) values($1,'invoice',$2)",["invoice:"+id,{Id:id,Key:"invoice:"+id,Type:"invoice",Deleted:false,Json:J(invoice)}]);
  await client.query("COMMIT");
  res.redirect("/invoice/view/"+encodeURIComponent(id));
 }catch(e){await client.query("ROLLBACK").catch(()=>{});console.error("quote conversion",e);res.status(500).send(L("Conversion failed",'<h1>Could not convert quote</h1><p>No invoice was created.</p><a href="/quote/convert">Back</a>',req.session.user))}finally{client.release()}
}));

app.get("/schema/:type",(req,res)=>A(req,res,async()=>{let t=req.params.type.toLowerCase(),rows=(await Q("select payload from records where record_type=$1 limit 50",[t])).rows,counts={};for(const r of rows)for(const k of Object.keys(r.payload||{}))counts[k]=(counts[k]||0)+1;res.json({type:t,sampled:rows.length,fields:Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}))})}));
const U=()=>require("crypto").randomUUID(),J=v=>JSON.stringify(v),pick=(v,...ks)=>{for(const k of ks)if(v[k]!=null)return v[k];return ""};
app.get("/customer/new",(req,res)=>A(req,res,()=>res.send(L("New Customer",`<h1>New Customer</h1><div class=c><form method=post><p><input name=Name placeholder="Customer / Company name" required></p><p><input name=Phone placeholder="Phone"></p><p><input name=Email type=email placeholder="Email"></p><p><input name=Address placeholder="Address"></p><button>Create Customer</button></form></div>`,req.session.user))));
app.post("/customer/new",(req,res)=>A(req,res,async()=>{let id=U(),v={Name:req.body.Name||"",Phone:req.body.Phone||"",Email:req.body.Email||"",Address:req.body.Address||""};await Q("insert into records(record_key,record_type,payload) values($1,'customer',$2)",["customer:"+id,{Id:id,Key:"customer:"+id,Type:"customer",Deleted:false,Json:J(v)}]);res.redirect("/r/customer")}));
app.get("/invoice/new",(req,res)=>A(req,res,async()=>{let invs=(await Q("select payload from records where record_type='invoice'")).rows.map(r=>D(r.payload)),nums=invs.map(v=>String(v.Number||"").trim()).filter(x=>/^21\d{3}$/.test(x)).map(Number),nextNo=Math.max(21474,...nums)+1,cs=(await Q("select record_key,payload from records where record_type='customer' limit 1000")).rows.map(r=>({key:r.record_key,v:D(r.payload)})),ps=(await Q("select payload from records where record_type='product' limit 2000")).rows.map(r=>D(r.payload));let opts=cs.map(x=>{let v=x.v,name=pick(v,"Name","CustomerName","CompanyName","DisplayName","ContactName")||x.key,phone=pick(v,"Phone","PhoneNumber","Mobile","MobileNumber","Telephone"),email=pick(v,"Email","EmailAddress"),address=pick(v,"Address","StreetAddress","BillingAddress");if(address&&typeof address==="object")address=[address.Line1,address.Line2,address.Suburb,address.State,address.Postcode].filter(Boolean).join(", ");return `<option value="${E(x.key)}" data-phone="${E(phone)}" data-email="${E(email)}" data-address="${E(address)}">${E(name)}</option>`}).join(""),products=ps.map(p=>({n:pick(p,"Name","ProductName","Description","Item"),d:pick(p,"Description","Name","ProductName"),price:Number(pick(p,"Price","SellPrice","UnitPrice","Rate")||0)})).filter(p=>p.n).sort((a,b)=>String(a.n).localeCompare(String(b.n)));let po=products.map(p=>`<option value="${E(p.n)}" data-desc="${E(p.d)}" data-price="${p.price}">${E(p.n)}${p.price?" - $"+p.price.toFixed(2):""}</option>`).join("");res.send(L("New Invoice",`<style>.line{display:grid;grid-template-columns:2fr 3fr .7fr 1fr auto;gap:7px;margin:8px 0}.line input,.line select{width:100%;box-sizing:border-box}@media(max-width:700px){.line{grid-template-columns:1fr}.line button{width:100%}}</style><h1>New Invoice</h1><div class=c><form method=post id=inv><p><label for=clientSearch><b>Search Client</b></label><br><input id=clientSearch type=search placeholder="Search client name, company, phone or email" autocomplete=off style="width:100%;box-sizing:border-box" oninput="filterClients()"></p><p><label>Customer<br><select id=customerSelect name=customerKey required style="padding:10px;width:100%" onchange="showClient()"><option value="">Select a client</option>${opts}</select></label></p><div id=clientDetails role=status aria-live=polite style="padding:10px;background:#f3f6f4;border-radius:7px;margin-bottom:14px">Select a client to see their details.</div><p><a href="/customer/new">+ Add New Client</a></p><p><label>Invoice Number<br><input name=Number value="${E(String(nextNo))}" readonly></label></p><p><input name=IssueDate type=date></p><div id=lines></div><p><button type=button onclick="addLine()">+ ADD EXTRA LINE</button></p><p><b>Total: $<span id=tot>0.00</span></b></p><p><select name=Status><option>Draft</option><option>Sent</option><option>Paid</option></select></p><button>Create Invoice</button></form></div><template id=row><div class=line><input name=Product list="product-options" placeholder="Type to search products..." autocomplete=off oninput="prod(this)" onchange="prod(this)"><datalist id=product-options>${po}</datalist><input name=Description placeholder="Description / extra details"><input name=Quantity type=number step=.01 min=0 value=1 oninput=calc()><input name=UnitPrice type=number step=.01 min=0 placeholder="Rate" oninput=calc()><button type=button onclick="this.parentElement.remove();calc()">Remove</button></div></template><script>function addLine(){lines.append(row.content.cloneNode(true));calc()}function prod(s){let r=s.closest(".line"),o=Array.from(document.querySelectorAll("#product-options option")).find(x=>x.value.toLowerCase()===s.value.trim().toLowerCase());if(o){r.querySelector("[name=Description]").value=o.dataset.desc||o.value;r.querySelector("[name=UnitPrice]").value=o.dataset.price||0}calc()}function calc(){let t=0;document.querySelectorAll(".line").forEach(r=>t+=(+r.querySelector("[name=Quantity]").value||0)*(+r.querySelector("[name=UnitPrice]").value||0));tot.textContent=t.toFixed(2)}function filterClients(){const q=document.getElementById("clientSearch").value.trim().toLowerCase(),sel=document.getElementById("customerSelect");let count=0;for(const o of Array.from(sel.options)){if(!o.value)continue;const match=!q||[o.textContent,o.dataset.phone,o.dataset.email,o.dataset.address].some(v=>(v||"").toLowerCase().includes(q));o.hidden=!match;o.disabled=!match;if(match)count++}if(sel.selectedOptions[0]?.disabled)sel.value="";showClient();document.getElementById("clientDetails").textContent=count?sel.value?document.getElementById("clientDetails").textContent:count+" matching client(s). Select a client above.":"No matching clients. Use Add New Client."}function showClient(){const o=document.getElementById("customerSelect").selectedOptions[0],box=document.getElementById("clientDetails");if(!o||!o.value){box.textContent="Select a client to see their details.";return}box.textContent=[o.textContent,o.dataset.phone,o.dataset.email,o.dataset.address].filter(Boolean).join(" | ")}addLine()</script>`,req.session.user))}));
app.post("/invoice/new",(req,res)=>A(req,res,async()=>{let c=(await Q("select payload from records where record_key=$1",[req.body.customerKey])).rows[0],cv=c?D(c.payload):{},id=U(),arr=x=>Array.isArray(x)?x:[x],ds=arr(req.body.Description||""),qs=arr(req.body.Quantity||1),us=arr(req.body.UnitPrice||0),pn=arr(req.body.Product||""),items=ds.map((d,i)=>({Product:pn[i]||"",Description:d||"",Quantity:Number(qs[i]||1),UnitPrice:Number(us[i]||0)})).filter(x=>x.Description||x.Product),total=items.reduce((a,x)=>a+x.Quantity*x.UnitPrice,0),v={Number:req.body.Number||"",CustomerKey:req.body.customerKey,CustomerName:pick(cv,"Name","CustomerName","CompanyName"),CustomerAddress:pick(cv,"Address","StreetAddress","BillingAddress"),CustomerEmail:pick(cv,"Email","EmailAddress"),IssueDate:req.body.IssueDate||new Date().toISOString(),Items:items,Subtotal:total/1.1,Gst:total-total/1.1,Total:total,Status:req.body.Status||"Draft"};await Q("insert into records(record_key,record_type,payload) values($1,'invoice',$2)",["invoice:"+id,{Id:id,Key:"invoice:"+id,Type:"invoice",Deleted:false,Json:J(v)}]);res.redirect("/invoice/view/"+id)}));
app.get("/quote/new",(req,res)=>A(req,res,async()=>{let invs=(await Q("select payload from records where record_type='quote'")).rows.map(r=>D(r.payload)),nums=invs.map(v=>String(v.Number||"").trim()).filter(x=>/^Q\d+$/i.test(x)).map(x=>Number(x.replace(/^Q/i,""))),nextNo=Math.max(0,...nums)+1,cs=(await Q("select record_key,payload from records where record_type='customer' limit 1000")).rows.map(r=>({key:r.record_key,v:D(r.payload)})),ps=(await Q("select payload from records where record_type='product' limit 2000")).rows.map(r=>D(r.payload));let opts=cs.map(x=>`<option value="${E(x.key)}">${E(pick(x.v,"Name","CustomerName","CompanyName")||x.key)}</option>`).join(""),products=ps.map(p=>({n:pick(p,"Name","ProductName","Description","Item"),d:pick(p,"Description","Name","ProductName"),price:Number(pick(p,"Price","SellPrice","UnitPrice","Rate")||0)})).filter(p=>p.n).sort((a,b)=>String(a.n).localeCompare(String(b.n)));let po=products.map(p=>`<option value="${E(p.n)}" data-desc="${E(p.d)}" data-price="${p.price}">${E(p.n)}${p.price?" - $"+p.price.toFixed(2):""}</option>`).join("");res.send(L("New Quote",`<style>.line{display:grid;grid-template-columns:2fr 3fr .7fr 1fr auto;gap:7px;margin:8px 0}.line input,.line select{width:100%;box-sizing:border-box}@media(max-width:700px){.line{grid-template-columns:1fr}.line button{width:100%}}</style><h1>New Quote</h1><div class=c><form method=post id=inv><p><label>Customer<br><select name=customerKey required style="padding:10px;width:100%">${opts}</select></label></p><p><label>Quote Number<br><input name=Number value="${E("Q"+String(nextNo).padStart(5,"0"))}" readonly></label></p><p><input name=IssueDate type=date></p><div id=lines></div><p><button type=button onclick="addLine()">+ ADD EXTRA LINE</button></p><p><b>Total: $<span id=tot>0.00</span></b></p><p><select name=Status><option>Draft</option><option>Sent</option><option>Paid</option></select></p><button>Create Quote</button></form></div><template id=row><div class=line><input name=Product list="product-options" placeholder="Type to search products..." autocomplete=off oninput="prod(this)" onchange="prod(this)"><datalist id=product-options>${po}</datalist><input name=Description placeholder="Description / extra details"><input name=Quantity type=number step=.01 min=0 value=1 oninput=calc()><input name=UnitPrice type=number step=.01 min=0 placeholder="Rate" oninput=calc()><button type=button onclick="this.parentElement.remove();calc()">Remove</button></div></template><script>function addLine(){lines.append(row.content.cloneNode(true));calc()}function prod(s){let r=s.closest(".line"),o=Array.from(document.querySelectorAll("#product-options option")).find(x=>x.value.toLowerCase()===s.value.trim().toLowerCase());if(o){r.querySelector("[name=Description]").value=o.dataset.desc||o.value;r.querySelector("[name=UnitPrice]").value=o.dataset.price||0}calc()}function calc(){let t=0;document.querySelectorAll(".line").forEach(r=>t+=(+r.querySelector("[name=Quantity]").value||0)*(+r.querySelector("[name=UnitPrice]").value||0));tot.textContent=t.toFixed(2)}addLine()</script>`,req.session.user))}));
app.post("/quote/new",(req,res)=>A(req,res,async()=>{let c=(await Q("select payload from records where record_key=$1",[req.body.customerKey])).rows[0],cv=c?D(c.payload):{},id=U(),arr=x=>Array.isArray(x)?x:[x],ds=arr(req.body.Description||""),qs=arr(req.body.Quantity||1),us=arr(req.body.UnitPrice||0),pn=arr(req.body.Product||""),items=ds.map((d,i)=>({Product:pn[i]||"",Description:d||"",Quantity:Number(qs[i]||1),UnitPrice:Number(us[i]||0)})).filter(x=>x.Description||x.Product),total=items.reduce((a,x)=>a+x.Quantity*x.UnitPrice,0),v={Number:req.body.Number||"",CustomerKey:req.body.customerKey,CustomerName:pick(cv,"Name","CustomerName","CompanyName"),CustomerAddress:pick(cv,"Address","StreetAddress","BillingAddress"),CustomerEmail:pick(cv,"Email","EmailAddress"),IssueDate:req.body.IssueDate||new Date().toISOString(),Items:items,Subtotal:total/1.1,Gst:total-total/1.1,Total:total,Status:req.body.Status||"Draft"};await Q("insert into records(record_key,record_type,payload) values($1,'quote',$2)",["quote:"+id,{Id:id,Key:"quote:"+id,Type:"quote",Deleted:false,Json:J(v)}]);res.redirect("/quote/view/"+id)}));
app.get("/quote/view/:id",(req,res)=>A(req,res,async()=>{const r=(await Q("select payload from records where record_key=$1 and record_type=$2",["quote:"+req.params.id,"quote"])).rows[0];if(!r)return res.status(404).send("Quote not found");renderGreenairInvoice(res,D(r.payload),req.params.id,req.session.user,"quote");}));

app.get("/edit/:type/:id",(req,res)=>A(req,res,async()=>{let key=req.params.type+":"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Not found");let v=D(r.payload),fields=req.params.type==="customer"?["Name","Phone","Email","Address"]:["Number","CustomerName","IssueDate","Total","Status"];res.send(L("Edit",`<h1>Edit ${E(req.params.type)}</h1><div class=c><form method=post>${fields.map(k=>`<p><label>${E(k)}<br><input name="${E(k)}" value="${E(pick(v,k))}" style="width:90%"></label></p>`).join("")}<button>Save Changes</button></form></div>`,req.session.user))}));
app.post("/edit/:type/:id",(req,res)=>A(req,res,async()=>{let key=req.params.type+":"+req.params.id,r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Not found");let outer=r.payload||{},v=D(outer);for(const[k,val]of Object.entries(req.body))v[k]=k==="Total"?Number(val||0):val;outer.Json!=null?outer.Json=J(v):outer=v;await Q("update records set payload=$2,updated_at=now() where record_key=$1",[key,outer]);res.redirect("/r/"+req.params.type)}));
app.get("/greenair-logo",(req,res)=>res.redirect("https://greenair-bacnet-explorer-web.onrender.com/favicon.ico"));
// Expiring read-only customer invoice links. Treat tokens as confidential.
app.get("/invoice/shared/:token",async(req,res)=>{
  res.set("Cache-Control","no-store").set("Referrer-Policy","no-referrer").set("X-Robots-Tag","noindex, nofollow");
  if(!/^[a-f0-9]{64}$/.test(req.params.token))return res.status(404).send("Link unavailable");
  try{
    const hash=require("crypto").createHash("sha256").update(req.params.token).digest("hex");
    const q=await Q("SELECT records.payload FROM invoice_share_links JOIN records ON records.record_key=invoice_share_links.record_key WHERE token_hash=$1 AND expires_at>now() AND records.record_type='invoice'",[hash]);
    if(!q.rowCount)return res.status(404).send("Link expired or unavailable");
    renderGreenairInvoice(res,D(q.rows[0].payload),"",false);
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
app.get("/quote/shared/:token",async(req,res)=>{
  res.set("Cache-Control","no-store").set("Referrer-Policy","no-referrer").set("X-Robots-Tag","noindex, nofollow");
  if(!/^[a-f0-9]{64}$/.test(req.params.token))return res.status(404).send("Link unavailable");
  try{
    const hash=require("crypto").createHash("sha256").update(req.params.token).digest("hex");
    const q=await Q("SELECT records.payload FROM invoice_share_links JOIN records ON records.record_key=invoice_share_links.record_key WHERE token_hash=$1 AND expires_at>now() AND records.record_type='quote'",[hash]);
    if(!q.rowCount)return res.status(404).send("Link expired or unavailable");
    renderGreenairInvoice(res,D(q.rows[0].payload),"",false,"quote");
  }catch(e){console.error("quote share",e.message);res.status(503).send("Quote unavailable");}
});
app.get("/quote/email/:id",(req,res)=>A(req,res,async()=>{
  try{
    const key="quote:"+req.params.id;
    const r=await Q("SELECT payload FROM records WHERE record_key=$1 AND record_type='quote'",[key]);
    if(!r.rowCount)return res.status(404).send("Quote not found");
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
    const view="https://greenair-invoice-v25-staging.onrender.com/quote/shared/"+token;
    const subject="Greenair Quotation "+(v.Number||"");
    const body=["Hi "+(v.CustomerName||"")+",","","Your Greenair Quotation "+(v.Number||"")+" is available here:",view,"","This link expires in 30 days.","","Thank you,","Greenair"].join(String.fromCharCode(13,10));
    const mailto="mailto:"+encodeURIComponent(email)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    const html='<h1>Email quote '+E(v.Number||"")+'</h1><div class=c><p>To: '+E(email)+'</p><p>The email draft includes a private quote link. It expires after 30 days.</p><p><a href="'+E(mailto)+'">Open email app with quote link</a></p><p><a href="'+E(view)+'" target="_blank" rel="noopener noreferrer">Test customer quote link</a></p><p><a href="/quote/view/'+encodeURIComponent(req.params.id)+'">Back to quote</a></p><small>No email is sent until you press Send in your email app.</small></div>';
    res.set("Cache-Control","no-store").send(L("Email quote",html,req.session.user));
  }catch(e){console.error("email draft",e.message);res.status(503).send(L("Email error",'<div class=c>Could not prepare the quote email.</div>',req.session.user));}
}));
function renderGreenairInvoice(res,v,id,user,kind="invoice",paymentState=null,photos=[]){let items=Array.isArray(v.Items)?v.Items:[],money=n=>Number(n||0).toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}),date=x=>{let d=new Date(x);return isNaN(d)?"":d.toLocaleDateString("en-AU")};let total=Number(v.Total||0),subtotal=v.Subtotal!=null?Number(v.Subtotal):total/1.1,gst=v.Gst!=null?Number(v.Gst):total-subtotal;let rows=items.map(i=>`<tr><td>${E(i.Description||i.Name||"")}</td><td>${E(i.Quantity||1)}</td><td>${E(money(i.UnitPrice||i.Rate))}</td><td>${E(money(Number(i.Quantity||1)*Number(i.UnitPrice||i.Rate||0)))}</td></tr>`).join("");res.send(L((kind==="quote"?"Quote ":"Invoice ")+(v.Number||""),`<style>.inv{background:#fff;max-width:900px;margin:auto;padding:34px;color:#444}.green{color:#69ad45}.invtop{display:flex;justify-content:space-between;gap:30px}.brand{text-align:right;min-width:300px}.brand h1{font-size:30px;font-weight:400;margin:18px 0 0}.logoFix{width:280px;max-width:100%;box-sizing:border-box;background:linear-gradient(180deg,#075d12,#159a29 48%,#064d0e);border:3px solid #173c1d;color:#f1f1f1;font-family:Georgia,serif;font-size:38px;line-height:1;font-weight:700;letter-spacing:2px;text-align:center;padding:10px 12px;text-shadow:2px 2px 2px #222;white-space:nowrap;overflow:hidden}.bill{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:24px 0}.meta td{padding:3px 12px 3px 0;border:0}.items{width:100%;border-collapse:collapse}.items th{background:#e4f1dc;text-align:left;font-weight:400;padding:8px}.items td{padding:8px;border:0}.totals{margin:250px 0 55px auto;width:300px}.totals td{border:0;padding:5px}.balance{font-size:22px;color:#69ad45}.pay{background:#e4f1dc;padding:16px;display:flex;justify-content:space-between}.case{margin:25px 0}.actions{margin:18px auto;max-width:900px}@media(max-width:600px){.w{padding:8px}.inv{padding:16px;overflow:hidden}.invtop,.bill,.pay{display:block}.brand{text-align:left;margin-top:18px;min-width:0}.brand h1{margin-top:14px}.logoFix{width:100%;font-size:32px;letter-spacing:1px;padding:10px 8px}.brand img{margin-left:0!important;max-height:90px;object-fit:contain}.bill{margin-top:18px}.meta{width:100%;min-width:0!important;table-layout:fixed}.meta td{font-size:14px;overflow-wrap:anywhere}.items{width:100%!important;min-width:0!important;table-layout:fixed;font-size:11px}.items th,.items td{padding:6px 3px;overflow-wrap:anywhere}.items th:first-child,.items td:first-child{width:44%}.totals{margin-top:80px;width:100%;min-width:0}.pay{font-size:13px;overflow-wrap:anywhere}}@media print{@page{size:A4;margin:12mm}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}header,.actions{display:none!important}.inv{max-width:none;padding:12px}.w{max-width:none;padding:0}.logoFix{background:#087b20!important;color:#fff!important;border:3px solid #173c1d!important}.items th,.pay{background:#e4f1dc!important}.green,.balance{color:#69ad45!important}}</style><div class=inv><div class=invtop><div><b>Greenair</b><br>ABN 60202774371<br>Adelaide, SA<br>Locky 0412 395 325 | Brayden 0434 807 232<br>greenair.controls@gmail.com</div><div class=brand><div class="logoFix">GREENAIR</div><h1 class=green>${kind==="quote"?"Quotation":"Tax Invoice"}</h1></div></div><div class=bill><div><span class=green>${kind==="quote"?"QUOTE TO":"INVOICE TO"}</span><br><br><b>${E(v.CustomerName||"")}</b><br>${E(v.CustomerAddress||v.Address||"")}</div><table class=meta><tr><td>${kind==="quote"?"QUOTE":"INVOICE"}</td><td>${E(v.Number||"")}</td></tr><tr><td>DATE</td><td>${E(date(v.IssueDate))}</td></tr><tr><td>TERMS</td><td>${E(v.Terms||"Due on receipt")}</td></tr><tr><td>DUE DATE</td><td>${E(date(v.DueDate||v.IssueDate))}</td></tr></table></div><p><b>Email status:</b> ${E(v.EmailStatus||"Not sent")}${v.EmailSentUtc?" • Sent "+E(date(v.EmailSentUtc)):""}${v.EmailOpenedUtc?" • Opened "+E(new Date(v.EmailOpenedUtc).toLocaleString("en-AU")):""}</p><div class=case>CASE NO &nbsp;&nbsp;&nbsp;&nbsp; ${E(v.CaseNo||v.Job||v.Description||"")}</div><table class=items><tr><th>ACTIVITY</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr>${rows}</table><table class=totals><tr><td>SUBTOTAL</td><td>${money(subtotal)}</td></tr><tr><td>GST TOTAL</td><td>${money(gst)}</td></tr><tr><td>TOTAL</td><td>${money(total)}</td></tr><tr class=balance><td>BALANCE DUE</td><td>A${money(paymentState?paymentState.balance:total)}</td></tr>${paymentState?`<tr><td>PAYMENTS RECEIVED</td><td>A${money(paymentState.paid)}</td></tr>`:""}</table><div class=pay><div><b>BANK TRANSFER</b><br>Account: Lochlan Weeks<br>BSB: 062-692 &nbsp;&nbsp; Account: 83543903<br>Reference: ${E(v.Number||"")}</div><div class=green>PAYMENT</div></div>${kind==="invoice"&&photos.length?`<section style="break-before:page;page-break-before:always;margin-top:30px"><h2>Invoice photos</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">${photos.map(p=>`<figure style="margin:0;break-inside:avoid"><img src="/invoice/photo/${p.id}" alt="${E(p.filename)}" style="max-width:100%;max-height:500px;object-fit:contain"><figcaption>${E(p.filename)}</figcaption></figure>`).join("")}</div></section>`:""}</div>${user && kind==="quote" ? `<div class=actions><button onclick="window.print()">Print / Save PDF</button> <a href="/quote/email/${encodeURIComponent(id)}"><button type=button>Email Quote</button></a></div>` : user && kind==="invoice" ? `<div class=actions><a href="/edit/invoice/${encodeURIComponent(id)}"><button>Edit Invoice</button></a> <a href="/invoice/payment/${encodeURIComponent(id)}"><button type=button>Record Payment</button></a> <a href="/invoice/photos/${encodeURIComponent(id)}"><button type=button>Add / Manage Photos</button></a> <button onclick="window.print()">Print / Save PDF</button> <a href="/invoice/email/${encodeURIComponent(id)}" target="_blank" rel="noopener"><button type=button>Email Invoice</button></a></div>` : `<div class=actions><button onclick="window.print()">Print / Save PDF</button></div>`}`,user))}
async function invoicePaymentState(id,v){
 const rows=(await Q("select payload from records where record_type='payment'")).rows;
 const related=rows.map(r=>D(r.payload)).filter(p=>[p.InvoiceId,p.InvoiceID,p.InvoiceKey,p.InvoiceNumber,p.InvoiceNo].some(k=>String(k)===id||String(k)==="invoice:"+id||String(k)===String(v.Number)));
 const amount=p=>Number(p.Amount??p.PaymentAmount??p.AmountPaid??0)||0;
 const paid=related.reduce((sum,p)=>sum+Math.max(0,amount(p)),0);
 const total=Number(v.Total)||0;
 const legacy=Number(v.AmountPaid??v.PaidAmount??v.TotalPaid??0)||0;
 const effective=Math.max(paid,legacy);
 return {related,paid:effective,total,balance:Math.max(0,Math.round((total-effective)*100)/100)};
}
app.get("/invoice/payment/:id",(req,res)=>A(req,res,async()=>{
 const id=req.params.id,r=(await Q("select payload from records where record_key=$1 and record_type='invoice'",["invoice:"+id])).rows[0];
 if(!r)return res.status(404).send("Invoice not found");
 const v=D(r.payload),state=await invoicePaymentState(id,v);
 const fmt=n=>Number(n).toLocaleString("en-AU",{style:"currency",currency:"AUD"});
 const history=state.related.map(p=>`<tr><td>${E(String(p.PaymentDate||p.Date||"").slice(0,10))}</td><td>${E(p.Method||"")}</td><td>${E(fmt(p.Amount??p.PaymentAmount??p.AmountPaid))}</td><td>${E(p.Reference||"")}</td></tr>`).join("");
 res.send(L("Record Payment",`<h1>Record Payment</h1><div class=c><p><b>Invoice ${E(v.Number||id)}</b> • ${E(v.CustomerName||"")}</p><p>Total: ${E(fmt(state.total))} • Received: ${E(fmt(state.paid))} • <b>Outstanding: ${E(fmt(state.balance))}</b></p></div><div class=c><form method=post><p><label>Amount received (AUD)<br><input type=number name=amount min=0.01 step=0.01 max="${state.balance.toFixed(2)}" value="${state.balance.toFixed(2)}" required></label></p><p><label>Payment date<br><input type=date name=date value="${new Date().toISOString().slice(0,10)}" required></label></p><p><label>Method<br><select name=method><option>Bank transfer</option><option>Cash</option><option>Card</option><option>EFTPOS</option><option>Other</option></select></label></p><p><label>Reference (optional)<br><input name=reference maxlength=120></label></p><button ${state.balance<=0?"disabled":""}>Save Payment</button> <a href="/invoice/view/${encodeURIComponent(id)}">Cancel</a></form></div><div class="c scroll"><h2>Payment history</h2><table><tr><th>Date</th><th>Method</th><th>Amount</th><th>Reference</th></tr>${history}</table></div>`,req.session.user));
}));
app.post("/invoice/payment/:id",(req,res)=>A(req,res,async()=>{
 const id=req.params.id,r=(await Q("select payload from records where record_key=$1 and record_type='invoice'",["invoice:"+id])).rows[0];
 if(!r)return res.status(404).send("Invoice not found");
 const v=D(r.payload),state=await invoicePaymentState(id,v);
 const amount=Number(req.body.amount),date=String(req.body.date||""),method=String(req.body.method||""),reference=String(req.body.reference||"").trim();
 if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)!==amount*100||amount>state.balance+0.001||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||isNaN(new Date(date).getTime())||!["Bank transfer","Cash","Card","EFTPOS","Other"].includes(method)||reference.length>120)return res.status(400).send("Invalid payment details or amount exceeds outstanding balance.");
 const pid=U(),payment={InvoiceId:id,InvoiceKey:"invoice:"+id,InvoiceNumber:String(v.Number||""),Amount:amount,PaymentDate:date,Method:method,Reference:reference};
 await Q("insert into records(record_key,record_type,payload) values($1,'payment',$2)",["payment:"+pid,{Id:pid,Key:"payment:"+pid,Type:"payment",Deleted:false,Json:J(payment)}]);
 res.redirect("/invoice/view/"+encodeURIComponent(id));
}));
app.get("/invoice/receipts/:id",(req,res)=>res.redirect("/receipts?invoice="+encodeURIComponent("invoice:"+req.params.id)));
app.get("/invoice/view/:id",(req,res)=>A(req,res,async()=>{const key="invoice:"+req.params.id;const r=(await Q("select payload from records where record_key=$1",[key])).rows[0];if(!r)return res.status(404).send("Invoice not found");const v=D(r.payload),state=await invoicePaymentState(req.params.id,v);const photos=(await Q("select id,filename from invoice_photos where invoice_key=$1 order by id", [key])).rows;renderGreenairInvoice(res,v,req.params.id,req.session.user,"invoice",state,photos);}));

const photoUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:8}});
app.get("/invoice/photos/:id",(req,res)=>A(req,res,async()=>{
 const key="invoice:"+req.params.id;
 if(!(await Q("select 1 from records where record_key=$1 and record_type='invoice'",[key])).rowCount)return res.status(404).send("Invoice not found");
 const photos=(await Q("select id,filename from invoice_photos where invoice_key=$1 order by id",[key])).rows;
 res.send(L("Invoice Photos",`<h1>Invoice photos</h1><p><a href="/invoice/view/${encodeURIComponent(req.params.id)}">Back to invoice</a></p><div class=c><form method=post enctype="multipart/form-data"><label><b>Add photos (up to 8 at once, 8 MB each)</b><br><input type=file name=photos accept="image/jpeg,image/png,image/webp" multiple required></label><p>Photos appear on a separate page when printing or saving the invoice as PDF.</p><button>Upload photos</button></form></div><div class=c><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">${photos.map(p=>`<div><a href="/invoice/photo/${p.id}" target="_blank"><img src="/invoice/photo/${p.id}" style="width:100%;max-height:240px;object-fit:contain" alt="${E(p.filename)}"></a><div>${E(p.filename)}</div><form method=post action="/invoice/photos/${encodeURIComponent(req.params.id)}/delete/${p.id}" onsubmit="return confirm('Delete this photo?')"><button type=submit>Delete photo</button></form></div>`).join("")||"No photos attached yet."}</div></div>`,req.session.user));
}));
app.post("/invoice/photos/:id",photoUpload.array("photos",8),(req,res)=>A(req,res,async()=>{
 const key="invoice:"+req.params.id;
 if(!(await Q("select 1 from records where record_key=$1 and record_type='invoice'",[key])).rowCount)return res.status(404).send("Invoice not found");
 try{
  if(!req.files?.length)return res.status(400).send("Select photos");
  for(const f of req.files){
   if(!["image/jpeg","image/png","image/webp"].includes(f.mimetype)||!((f.mimetype==="image/jpeg"&&f.buffer.subarray(0,3).equals(Buffer.from([255,216,255])))||(f.mimetype==="image/png"&&f.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(f.mimetype==="image/webp"&&f.buffer.toString("ascii",0,4)==="RIFF"&&f.buffer.toString("ascii",8,12)==="WEBP")))return res.status(400).send("Only valid JPG, PNG and WebP photos are allowed");
  }
  for(const f of req.files)await Q("insert into invoice_photos(invoice_key,filename,mime,photo) values($1,$2,$3,$4)",[key,f.originalname.slice(0,180),f.mimetype,f.buffer]);
  res.redirect("/invoice/photos/"+encodeURIComponent(req.params.id));
 }catch(e){console.error("photo upload",e);res.status(500).send("Photo upload failed");}
}));
app.get("/invoice/photo/:photoId",(req,res)=>A(req,res,async()=>{
 const r=(await Q("select mime,photo from invoice_photos where id=$1",[req.params.photoId])).rows[0];
 if(!r)return res.sendStatus(404);
 res.set("Cache-Control","private, no-store");res.type(r.mime);res.send(r.photo);
}));
app.post("/invoice/photos/:id/delete/:photoId",(req,res)=>A(req,res,async()=>{
 await Q("delete from invoice_photos where id=$1 and invoice_key=$2",[req.params.photoId,"invoice:"+req.params.id]);
 res.redirect("/invoice/photos/"+encodeURIComponent(req.params.id));
}));
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

const receiptUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024,files:1}});
const receiptTypes={"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
function receiptForm(invoices,selected=""){return `<div class=c><h2>Upload Receipt</h2><form method=post action="/receipts/upload" enctype="multipart/form-data"><p><label>Receipt photo or PDF<br><input type=file name=receipt accept="image/jpeg,image/png,image/webp,application/pdf" capture=environment required onchange="scanReceipt(this)"></label></p><p id=scanStatus role=status>Choose a receipt to scan and auto-fill details.</p><div class=g><label>Supplier<br><input name=supplier maxlength=200 required></label><label>Date<br><input name=receipt_date type=date></label><label>Total (AUD, incl. GST)<br><input name=amount type=number min=0 step=.01></label><label>GST (AUD)<br><input name=gst type=number min=0 step=.01></label></div><p><label>Attach to invoice (optional)<br><select name=invoice_key style="padding:10px;max-width:100%"><option value="">Separate receipt / no invoice</option>${invoices.map(x=>`<option value="${E(x.record_key)}" ${x.record_key===selected?"selected":""}>${E(x.number)} - ${E(x.customer)}</option>`).join("")}</select></label></p><p><label>Notes<br><input name=notes maxlength=1000 style="width:90%"></label></p><button>Save Receipt</button><script>async function scanReceipt(input){const f=input.files[0];if(!f)return;const form=input.form,status=document.getElementById("scanStatus");status.textContent="Scanning receipt...";const data=new FormData();data.append("receipt",f);try{const response=await fetch("/receipts/scan",{method:"POST",body:data});const result=await response.json();if(!response.ok)throw Error(result.error||"Scan failed");for(const key of ["supplier","receipt_date","amount","gst"]){if(result[key]!==null&&result[key]!==undefined&&result[key]!==""&&form.elements[key])form.elements[key].value=result[key]}status.textContent=(result.supplier||result.amount!==null?"Scan complete. Check the fields carefully before saving. ":"No details extracted. ")+(result.warning||"");}catch(e){status.textContent="Automatic scan unavailable: "+e.message+". Enter the details manually."}}</script><p><small>JPEG, PNG, WebP or PDF, up to 12 MB. Stored privately in PostgreSQL.</small></p></form></div>`;}

function parseReceiptText(text){
 const raw=String(text||"").replace(/\u00a0/g," "),lines=raw.split(/\r?\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
 const money=s=>{const m=[...String(s||"").matchAll(/(?:AUD\s*)?\$?\s*(-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2})(?!\d)/gi)];return m.length?Number(m[m.length-1][1].replace(/,/g,"")):null};
 const labelValue=(pattern)=>{for(let i=lines.length-1;i>=0;i--){if(!pattern.test(lines[i]))continue;const direct=money(lines[i].replace(pattern,""));if(direct!==null)return direct;for(let j=i+1;j<=Math.min(i+2,lines.length-1);j++){if(/(?:total|gst|tax|balance|paid|amount|invoice|subtotal)/i.test(lines[j])&&!/^\$?\s*[\d,]+\.\d{2}\s*$/.test(lines[j]))break;const next=money(lines[j]);if(next!==null)return next;}}return null};
 const totalLabel=/\b(?:grand\s*total|invoice\s*total|total\s*(?:inc(?:luding)?\.?\s*(?:gst|tax)|due|payable|amount|aud)|amount\s*(?:payable|due|paid)|balance\s*due|total)\b\s*[:=\-]*/i;
 const taxLabel=/\b(?:gst\s*(?:amount|total|included|10%)?|tax\s*(?:amount|total|included))\b\s*[:=\-]*/i;
 let amount=labelValue(totalLabel),gst=null;
 // Australian Bunnings PowerPass digital receipts.
 // Match the explicit purchase total and GST, not PowerPass savings.
 const isBunnings=/\bBUNNINGS\b/i.test(raw);
 if(isBunnings){
   const totalLine=lines.find(line=>/^Total\s+\$?[\d,]+\.\d{2}\s*$/i.test(line))||lines.find(line=>/\bTotal\s+\$?[\d,]+\.\d{2}\b/i.test(line)&&!/savings|gst|sub\s*total/i.test(line));
   if(totalLine)amount=money(totalLine);
   const gstLine=lines.find(line=>/GST\s+INCLUDED\s+IN\s+THE\s+TOTAL/i.test(line));
   if(gstLine){const tax=money(gstLine.replace(/.*?GST\s+INCLUDED\s+IN\s+THE\s+TOTAL/i,""));if(tax!==null&&(amount===null||tax<=amount))gst=tax;}
 }
 // Find the tax amount explicitly, avoiding "Total incl GST" (which is the invoice total).
 const taxRows=lines.map((line,i)=>({line,i})).filter(({line})=>/\b(?:gst|tax)\b/i.test(line)&&!/\b(?:total\s+(?:inc|incl|including)\s*gst|including\s+gst|gst\s+inclusive|inc\.?\s*gst)\b/i.test(line));
 for(const {line,i} of taxRows.reverse()){
   if(isBunnings&&gst!==null)break;
   const prefix=/\b(?:gst(?:\s*(?:amount|total|payable|charged|included|10\s*%))?|tax\s*(?:amount|total|payable|charged))\b\s*[:=\-]*/i;
   const match=prefix.exec(line);if(!match)continue;
   const rest=line.slice(match.index+match[0].length);
   let candidate=money(rest);
   if(candidate===null&&i+1<lines.length&&/^(?:AUD\s*)?\$?\s*[\d,]+\.\d{2}\s*$/.test(lines[i+1]))candidate=money(lines[i+1]);
   if(candidate!==null&&candidate>=0&&(amount===null||candidate<=amount)){gst=candidate;break;}
 }
 // OCR sometimes puts the GST figure before its label on the same line.
 if(gst===null){for(const line of lines){const match=line.match(/(?:^|\s)(\$?\s*[\d,]+\.\d{2})\s+(?:GST|GST\s+AMOUNT|TAX\s+AMOUNT)\b/i);if(match){const candidate=money(match[1]);if(candidate!==null&&(amount===null||candidate<=amount)){gst=candidate;break;}}}}
 // For PDF summary tables, the heading and the numeric cell may be far apart
 // in text-reading order. Accept a 10% GST amount only if that exact number
 // is actually printed in the document and a GST heading is present.
 if(gst===null&&amount!==null&&/\bGST\b/i.test(raw)){
   const expected=Math.round(amount/11*100)/100;
   const values=[...raw.matchAll(/(?<![\d.])(?:AUD\s*)?\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?!\d)/gi)].map(m=>Number(m[1].replace(/,/g,"")));
   if(values.some(v=>Math.abs(v-expected)<0.005))gst=expected;
 }
 // Calculate only where the document explicitly confirms every item is taxed at 10%.
 const fullTaxable=/\b(?:all\s+items\s+(?:include|subject\s+to)\s+(?:10\s*%\s*)?gst|all\s+items\s+taxable\s+at\s+10\s*%|100\s*%\s+taxable\s+at\s+10\s*%)\b/i.test(raw);
 if(gst===null&&amount!==null&&fullTaxable)gst=Math.round(amount/11*100)/100;
 if(amount===null){const candidate=lines.filter(x=>/^\s*(?:AUD\s*)?\$?\s*[\d,]+\.\d{2}\s*$/i.test(x)).map(money).filter(x=>x!==null);if(candidate.length===1)amount=candidate[0];}
 // Prepaid invoices can show Invoice Total / Balance as $0.00 while
 // Deposit Amount contains the actual paid total. Cross-check against
 // merchandise subtotal plus printed GST; never use an unverified sum.
 if(gst!==null&&(amount===null||amount===0)){
   const printed=[...raw.matchAll(/(?<![\d.])(?:AUD\s*)?\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?!\d)/gi)]
     .map(m=>Number(m[1].replace(/,/g,""))).filter(Number.isFinite);
   const cents=x=>Math.round(x*100);
   const unique=[...new Set(printed.map(cents))];
   const gstCents=cents(gst);
   const matches=unique.filter(total=>total>gstCents&&unique.some(sub=>sub>0&&Math.abs(sub+gstCents-total)<=1));
   // Require a single supported total and evidence this is a prepaid invoice.
   if(matches.length===1&&/\b(?:prepay|prepaid|deposit|payment\s+terms)\b/i.test(raw)){
     amount=matches[0]/100;
   }
 }
 if(gst!==null&&amount!==null&&gst>amount)gst=null;
 // Date can be split into separate PDF text items; tolerate spaces around separators.
 const normalizedDates=raw.replace(/(\d{1,2})\s*([\/.-])\s*(\d{1,2})\s*\2\s*(20\d{2}|\d{2})/g,"$1/$3/$4");
 const dateMatch=normalizedDates.match(/\b([0-3]?\d)[\/.-]([01]?\d)[\/.-](20\d{2}|\d{2})\b/);
 let date=null;if(dateMatch){const y=dateMatch[3].length===2?"20"+dateMatch[3]:dateMatch[3],m=dateMatch[2].padStart(2,"0"),d=dateMatch[1].padStart(2,"0");const dt=new Date(y+"-"+m+"-"+d+"T00:00:00Z");if(!isNaN(dt)&&dt.getUTCDate()===Number(d)&&dt.getUTCMonth()+1===Number(m))date=y+"-"+m+"-"+d;}
 const supplierCandidates=lines.slice(0,24).filter(x=>/[a-z]{3}/i.test(x)&&!/(^.{0,12}\d{2,}|tax invoice|receipt|abn|gst|total|date|invoice|cash|visa|eftpos|thank you|www\.|http|customer|deliver|ship to|bill to|account|purchase order|reference|job no|phone|mobile|email|address|page \d|\b(?:SA|NSW|VIC|QLD|WA|TAS|ACT|NT)\s+\d{4}\b|\b(?:street|st|road|rd|avenue|ave|drive|dr|po box)\b)/i.test(x)&&x.length<=90);
 const poolSupplier=/\bpool\s*systems?\b/i.test(raw);
 const supplier=isBunnings?"Bunnings Warehouse":(poolSupplier?"Pool Systems":(supplierCandidates[0]||""));
 const warning=[!supplier?"Supplier not confidently identified.":"",amount===null?"Total amount not confidently identified.":"",gst===null?"GST not confidently identified.":""].filter(Boolean).join(" ");
 return {supplier:supplier.slice(0,200),receipt_date:date,amount,gst,warning};
}
app.post("/receipts/scan",(req,res)=>A(req,res,()=>receiptUpload.single("receipt")(req,res,async err=>{
 if(err)return res.status(400).json({error:"Invalid or oversized receipt"});
 const f=req.file;if(!f||!receiptTypes[f.mimetype])return res.status(400).json({error:"Unsupported receipt type"});
 try{
 let text="";
 if(f.mimetype==="application/pdf"){if(f.buffer.subarray(0,5).toString()!=="%PDF-")return res.status(400).json({error:"Invalid PDF"});try{const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");const task=pdfjs.getDocument({data:new Uint8Array(f.buffer),useSystemFonts:true,disableFontFace:true,stopAtErrors:false});const doc=await task.promise;try{for(let i=1;i<=Math.min(doc.numPages,3);i++){const page=await doc.getPage(i);const content=await page.getTextContent();text+=content.items.map(x=>(x.str||"")+(x.hasEOL?"\\n":" ")).join("")+"\\n";
 // Preserve PDF column geometry: GST can be a table heading with its amount below.
 const items=content.items.filter(x=>x.str&&x.transform&&Number.isFinite(x.transform[4])&&Number.isFinite(x.transform[5])).map(x=>({str:x.str.trim(),x:x.transform[4],y:x.transform[5],w:x.width||0})).filter(x=>x.str);
 for(const heading of items.filter(x=>/^GST(?:\s*AMOUNT)?$/i.test(x.str))){
  const candidates=items.filter(x=>x.y<heading.y-2&&heading.y-x.y<85&&Math.abs((x.x+x.w/2)-(heading.x+heading.w/2))<Math.max(32,heading.w/2+12)&&/^\$?\s*[\d,]+\.\d{2}$/.test(x.str)).sort((a,b)=>b.y-a.y);
  if(candidates.length){text+="\nGST "+candidates[0].str+"\n";break;}
 }}}finally{await doc.destroy();}}catch(modernError){console.warn("Modern PDF extraction failed",modernError.message);try{const pdf=require("pdf-parse");const doc=await pdf(f.buffer,{max:3});text=doc.text||"";}catch(oldError){console.warn("Legacy PDF extraction failed",oldError.message);return res.json({warning:"This PDF could not be decoded automatically. Try a screenshot or photo of the receipt."});}}if(!text.trim()){try{const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");const {createCanvas}=require("@napi-rs/canvas");const {createWorker}=require("tesseract.js");const doc=await pdfjs.getDocument({data:new Uint8Array(f.buffer),useSystemFonts:true,disableFontFace:true}).promise;const worker=await createWorker("eng");try{for(let i=1;i<=Math.min(doc.numPages,2);i++){const page=await doc.getPage(i),viewport=page.getViewport({scale:1.8}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)),ctx=canvas.getContext("2d");await page.render({canvasContext:ctx,viewport}).promise;const result=await worker.recognize(canvas.toBuffer("image/png"));text+=(result.data.text||"")+"\n";}}finally{await worker.terminate();await doc.destroy();}}catch(ocrError){console.warn("PDF image OCR failed",ocrError.message);return res.json({warning:"Unable to scan PDF page images. Try a screenshot or photo of the receipt."});}}}
 else{const {createWorker}=require("tesseract.js");const worker=await createWorker("eng");try{const result=await worker.recognize(f.buffer);text=result.data.text||"";}finally{await worker.terminate();}}
 res.set("Cache-Control","no-store").json(parseReceiptText(text));
 }catch(e){console.error("receipt scan",e.message);res.status(503).json({error:"Scanner could not read this file. Enter details manually."});}
})));

app.get("/receipts",(req,res)=>A(req,res,async()=>{try{const search=String(req.query.q||"").slice(0,200),selected=String(req.query.invoice||"");const inv=(await Q("select record_key,payload from records where record_type='invoice' order by updated_at desc limit 1000")).rows.map(x=>({record_key:x.record_key,number:D(x.payload).Number||x.record_key,customer:D(x.payload).CustomerName||""}));const rows=(await Q("select id,supplier,receipt_date,amount,gst,notes,invoice_key,filename,created_at from receipts where ($1='' or supplier ilike '%'||$1||'%' or filename ilike '%'||$1||'%' or notes ilike '%'||$1||'%') and ($2='' or invoice_key=$2) order by created_at desc limit 500",[search,selected])).rows;const body=`<h1>Receipts</h1>${receiptForm(inv,selected)}<div class=c><h2>Receipt Register</h2><form method=get><input name=q placeholder="Search supplier, file or notes" value="${E(search)}"><button>Search</button></form><div class=scroll><table><tr><th>Date</th><th>Supplier</th><th>Amount</th><th>GST</th><th>Invoice</th><th>File</th></tr>${rows.map(x=>`<tr><td>${E(x.receipt_date?String(x.receipt_date).slice(0,10):"")}</td><td>${E(x.supplier)}</td><td>${x.amount==null?"":E("$"+Number(x.amount).toFixed(2))}</td><td>${x.gst==null?"":E("$"+Number(x.gst).toFixed(2))}</td><td>${x.invoice_key?`<a href="/invoice/view/${encodeURIComponent(x.invoice_key.slice(8))}">${E(x.invoice_key)}</a>`:"Unlinked"}</td><td><a href="/receipts/file/${x.id}">${E(x.filename)}</a></td></tr>`).join("")}</table></div></div>`;res.send(L("Receipts",body,req.session.user));}catch(e){console.error("receipts list",e);res.status(500).send("Receipt register unavailable")}}));
app.post("/receipts/upload",(req,res)=>A(req,res,()=>receiptUpload.single("receipt")(req,res,async err=>{if(err)return res.status(400).send("Receipt upload failed: file too large or invalid request");try{const f=req.file;if(!f||!receiptTypes[f.mimetype])return res.status(400).send("Use a PDF, JPEG, PNG or WebP receipt");const b=f.buffer;const valid=f.mimetype==="application/pdf"?b.subarray(0,5).toString()==="%PDF-":f.mimetype==="image/jpeg"?b[0]===255&&b[1]===216:f.mimetype==="image/png"?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):b.subarray(0,4).toString()==="RIFF"&&b.subarray(8,12).toString()==="WEBP";if(!valid)return res.status(400).send("File content does not match its format");const supplier=String(req.body.supplier||"").trim().slice(0,200);if(!supplier)return res.status(400).send("Supplier required");const invoice=String(req.body.invoice_key||"");if(invoice&&!(await Q("select 1 from records where record_key=$1 and record_type='invoice'",[invoice])).rowCount)return res.status(400).send("Invoice not found");const amount=req.body.amount===""?null:Number(req.body.amount),gst=req.body.gst===""?null:Number(req.body.gst);if((amount!==null&&(!Number.isFinite(amount)||amount<0))||(gst!==null&&(!Number.isFinite(gst)||gst<0))||(amount!==null&&gst!==null&&gst>amount))return res.status(400).send("Invalid amount or GST");let date=String(req.body.receipt_date||"").trim();const au=date.match(/^([0-3]?\d)\/([01]?\d)\/(\d{4})$/);if(au)date=au[3]+"-"+au[2].padStart(2,"0")+"-"+au[1].padStart(2,"0");if(date){const m=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return res.status(400).send("Invalid date. Use DD/MM/YYYY or YYYY-MM-DD.");const d=new Date(date+"T00:00:00Z");if(!Number.isFinite(d.getTime())||d.getUTCFullYear()!==Number(m[1])||d.getUTCMonth()+1!==Number(m[2])||d.getUTCDate()!==Number(m[3]))return res.status(400).send("Invalid calendar date");}await Q("insert into receipts(supplier,receipt_date,amount,gst,notes,invoice_key,filename,mime,file_data) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",[supplier,date||null,amount,gst,String(req.body.notes||"").slice(0,1000),invoice||null,f.originalname.slice(0,200),f.mimetype,b]);res.redirect(invoice?"/receipts?invoice="+encodeURIComponent(invoice):"/receipts");}catch(e){console.error("receipt upload",e);res.status(500).send("Receipt could not be saved")}})));
app.get("/receipts/file/:id",(req,res)=>A(req,res,async()=>{if(!/^\\d+$/.test(req.params.id))return res.sendStatus(400);try{const r=(await Q("select filename,mime,file_data from receipts where id=$1",[req.params.id])).rows[0];if(!r)return res.sendStatus(404);res.set("Cache-Control","private, no-store");res.set("X-Content-Type-Options","nosniff");res.set("Content-Security-Policy","sandbox");res.set("Content-Disposition","attachment; filename="+JSON.stringify(r.filename.replace(/[\\r\\n]/g,"_")));res.type(r.mime).send(r.file_data);}catch(e){console.error("receipt download",e);res.sendStatus(500)}}));

const PORT=Number(process.env.PORT)||10000;app.listen(PORT,"0.0.0.0",()=>console.log(`Greenair Invoice listening on ${PORT}`));init().then(()=>{console.log("Database initialised");scheduledSnapshot();setInterval(scheduledSnapshot,SNAPSHOT_INTERVAL_MS).unref();}).catch(e=>console.error("Database init error",e));
