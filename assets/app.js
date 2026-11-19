(function(){
'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const S=window.SERVICES,UI=window.UI,Q=window.QUESTIONS,REG=window.REGIONS,CUR=window.CURRENCIES;
/* ---------- base (fallback) prices, us-east-1, USD. Overridden per region by data/prices.json ---------- */
const BASE={ec2_small:.0208,ec2_med:.0416,ec2_m6i_l:.096,lam_req:.20,lam_gbs:.0000166667,s3_gb:.023,cf_gb:.085,r53_zone:.5,apigw_http_1m:1,alb_hr:.0225,alb_lcu:.008,nat_hr:.045,nat_gb:.045,rds_med_hr:.065,rds_gb:.115,aur_acu_hr:.12,aur_gb:.10,ddb_wr_1m:1.25,ddb_rd_1m:.25,ddb_gb:.25,ec_small_hr:.032,cog_mau:.0055,waf_acl:5,waf_rule:1,waf_req_1m:.6,kms_key:1,cw_gb:.5,sqs_1m:.4,ses_1k:.1,backup_gb:.05,bedrock_1m:4,sm_hr:.115,os_node_hr:.128,athena_tb:5,glue_dpu_hr:.44,rs_rpu_hr:.375,qs_author:24,eks_hr:.10,fg_vcpu_hr:.04048,fg_gb_hr:.004445};
let PRICES={meta:{source:'fallback'},unit:{}};
const st={lang:'en',region:'us-east-1',cur:'USD',tab:'search',level:'b',tier:'bal',answers:{},step:0,manual:new Set(),removed:new Set(),period:'m',vat:false,q:''};
const DEF={type:'saas',users:1000,traffic:'normal',geo:'one',growth:'steady',security:'standard',compliance:'none',availability:'standard',dr:'none',budget:'balanced',skill:'dev',aimode:'chat',aivol:10,dsize:100};
const t=k=>(UI[st.lang]&&UI[st.lang][k])||UI.en[k]||k, qt=o=>o[st.lang]||o.en;
let curSvc=null, usedKeys={};
function mult(){return (REG.find(r=>r[0]===st.region)||REG[0])[3]}
function P(k){(usedKeys[curSvc]=usedKeys[curSvc]||new Set()).add(k);const u=PRICES.unit&&PRICES.unit[st.region]&&PRICES.unit[st.region][k];return u!=null?u:BASE[k]*mult()}
function isLive(k){return !!(PRICES.unit&&PRICES.unit[st.region]&&PRICES.unit[st.region][k]!=null)}
/* ---------- effective answers + sizing context ---------- */
function eff(){const a={...DEF,...st.answers};
 if(st.tier==='lean'){a.availability='standard';if(a.dr!=='none')a.dr='backup'}
 if(st.tier==='scal'){if(a.availability==='standard')a.availability='high';if(a.dr==='none')a.dr='backup'}
 return a}
function ctx(a){const tm={low:.3,normal:1,high:3}[a.traffic]||1,gf={steady:1,fast:1.5,viral:2.5}[a.growth]||1,U=+a.users;
 const R=U*(a.type==='shop'?500:300)*tm*gf, E=Math.max(5,(a.type==='web'?.8:.06)*U*tm*gf);
 let Sg=Math.max(5,U*.03);if(a.type==='web')Sg=2+U*.002;if(a.type==='shop')Sg=20+U*.05;if(a.type==='ai'&&a.aimode==='rag')Sg=50;if(a.type==='analytics'||a.type==='dw')Sg=+a.dsize;
 return{a,U,R,E,S:Sg,maz:a.availability!=='standard',crit:a.availability==='critical',lean:st.tier==='lean',H:730,dr2:['pilot','multisite'].includes(a.dr)}}
const COST={
 ec2:c=>{const n=c.maz?2:1,k=c.U<=1000?'ec2_small':c.U<=10000?'ec2_med':'ec2_m6i_l';return n*(c.U>100000?3:1)*c.H*P(k)+n*20*.08},
 lambda:c=>(c.R/1e6)*P('lam_req')+c.R*.075*P('lam_gbs'),
 fargate:c=>{const n=Math.max(c.maz?2:1,Math.ceil(c.U/25000));return n*c.H*(.5*P('fg_vcpu_hr')+1*P('fg_gb_hr'))},
 eks:c=>c.H*P('eks_hr')+2*c.H*P('ec2_med'),
 s3:c=>c.S*P('s3_gb')+(c.R*.05/1000)*.005,
 cloudfront:c=>c.E*P('cf_gb')+(c.R/1e6)*.85,
 route53:c=>P('r53_zone')+(c.R/1e6)*.12,
 apigw:c=>(c.R/1e6)*P('apigw_http_1m'),
 alb:c=>c.H*(P('alb_hr')+P('alb_lcu')*Math.max(1,Math.ceil(c.R/20e6))),
 nat:c=>(c.maz?2:1)*c.H*P('nat_hr')+P('nat_gb')*Math.max(10,c.E*.3),
 rds:c=>{const sz=c.U<=1000?.5:c.U<=10000?1:c.U<=100000?4:10,m=c.maz?2:1;return c.H*P('rds_med_hr')*sz*m+Math.max(20,c.S)*P('rds_gb')*m},
 aurora:c=>{const acu=c.U<=1000?.5:c.U<=10000?2:c.U<=100000?8:24;return c.H*acu*P('aur_acu_hr')*(c.maz?2:1)+Math.max(10,c.S)*P('aur_gb')*1.3},
 dynamodb:c=>(c.R*.2/1e6)*P('ddb_wr_1m')+(c.R*.8/1e6)*P('ddb_rd_1m')+Math.max(1,c.S)*P('ddb_gb'),
 elasticache:c=>(c.maz?2:1)*(c.U>=100000?4:1)*c.H*P('ec_small_hr'),
 cognito:c=>Math.max(0,c.U-50000)*P('cog_mau'),
 waf:c=>P('waf_acl')+5*P('waf_rule')+(c.R/1e6)*P('waf_req_1m'),
 guardduty:c=>4+(c.R/1e6)*.4,
 kms:c=>2*P('kms_key')+(c.R*.5/1e4)*.03+3*.4,
 cloudwatch:c=>Math.max(2,c.R/1e6*.5)*P('cw_gb')+15*.3+3*.1+3,
 sqs:c=>(c.R*.5/1e6)*P('sqs_1m'),
 ses:c=>(c.U*4/1000)*P('ses_1k'),
 backup:c=>c.S*3*P('backup_gb')*(c.dr2?2:1),
 bedrock:c=>(+c.a.aivol||10)*P('bedrock_1m'),
 sagemaker:c=>(c.maz?2:1)*c.H*P('sm_hr'),
 opensearch:c=>(c.lean?1:2)*(c.H*P('os_node_hr')+50*.122),
 athena:c=>(c.S/1000)*3*P('athena_tb'),
 glue:c=>20*Math.sqrt(Math.max(1,c.S/100))*P('glue_dpu_hr')*2,
 redshift:c=>P('rs_rpu_hr')*8*200*(c.S>=1000?2:1)+c.S*.024,
 quicksight:c=>P('qs_author')+3*5,
 amplify:c=>.01*200*2+.15*c.E+.023*c.S
};
function cost(id,a){curSvc=id;usedKeys[id]=new Set();const v=COST[id](ctx(a));return Math.max(0,v)}
function liveFor(id){const u=usedKeys[id];if(!u||!u.size)return false;for(const k of u)if(isLive(k))return true;return false}
const WHY_AR={amplify:'فريقك مبتدئ: Amplify ينشر موقعك مباشرة من Git دون أي بنية تحتية تتعلمها.',s3:'يخزّن S3 الملفات (صفحات الموقع، الرفع، البيانات) بتكلفة منخفضة وبمتانة عالية.',cloudfront:'يسرّع CloudFront تحميل الصفحات للمستخدمين ويخفف الضغط عن خوادمك عند الذروة.',route53:'نطاقك يحتاج DNS؛ Route 53 يدعم فحوص الصحة والتحويل التلقائي عند الأعطال.',ses:'النماذج والنشرات والإشعارات تحتاج بريدًا إلكترونيًا موثوقًا ورخيصًا.',cognito:'المستخدمون يحتاجون تسجيل دخول آمنًا؛ Cognito يوفره مع المصادقة الثنائية دون بنائه بنفسك.',ec2:'خادم بسيط يناسب فريقًا مبتدئًا لأداة داخلية ويحافظ على المألوف.',alb:'يوزّع الزيارات على عدة نسخ من تطبيقك في أكثر من منطقة توافر ويوفر HTTPS.',fargate:'مع حركة مرور مرتفعة ومستمرة تكون الحاويات أرخص وأكثر استقرارًا من الدوال لكل طلب.',nat:'الحاويات تعمل في شبكات خاصة وتحتاج مخرجًا محكومًا إلى الإنترنت.',lambda:'تكلفة Lambda شبه معدومة عند الخمول وتتوسع فورًا مع زيادة الطلبات.',apigw:'يتحقق API Gateway من الهوية ويحدّ المعدل ويوجه الطلبات إلى دوالك.',dynamodb:'يوفر وصولًا سريعًا ومتوقعًا للبيانات يتسع لأي عدد من المستخدمين والأجهزة.',aurora:'الحجم الكبير والتوافر العالي يتطلبان تحويلًا سريعًا عند الأعطال ونسخ قراءة؛ Aurora يوفرهما.',rds:'الطلبات والحسابات والفواتير بيانات علائقية؛ قاعدة SQL مُدارة هي الأنسب والأأمن.',elasticache:'عند هذا الحجم تزيل الذاكرة المؤقتة القراءات المتكررة عن قاعدة البيانات.',sqs:'الأعمال الخلفية (بريد، فواتير، معالجة صور) تدخل طابورًا فلا ينتظر المستخدم.',bedrock:'نموذج ذكاء اصطناعي جاهز عبر واجهة واحدة دون وحدات معالجة رسومية أو فريق تعلم آلة.',opensearch:'البحث الشعاعي يجد المقاطع الصحيحة داخل مستنداتك الخاصة.',sagemaker:'تحتاج إلى تدريب نموذجك أو استضافته، وهذا ما صُمم له SageMaker.',glue:'ينظّف Glue البيانات ويحوّلها ويفهرسها.',redshift:'المستودع يجيب بسرعة عن كثير من استعلامات التقارير المعقدة.',athena:'استعلم عن الملفات مباشرة بـ SQL وادفع فقط مقابل كل استعلام.',quicksight:'يستكشف المديرون الأرقام عبر لوحات معلومات.',waf:'يحجب الهجمات الشائعة والروبوتات الضارة.',kms:'يشفّر البيانات ويحفظ الأسرار بأمان.',guardduty:'يكتشف النشاط المشبوه تلقائيًا.',backup:'نسخ احتياطي بسياسات، ويُنسخ إلى منطقة ثانية للتعافي من الكوارث عند الحاجة.',cloudwatch:'لا يمكنك إصلاح ما لا تراه: سجلات ومقاييس وتنبيهات.'};
/* ---------- recommendation engine (rules; explanations are static text) ---------- */
function recommend(a){const r=[],add=(id,why)=>{if(!r.find(x=>x.id===id))r.push({id,why})};
 const big=a.users>=100000,hi=a.availability!=='standard',U=+a.users,ty=a.type,beg=a.skill==='beginner',global=a.geo==='global'||a.geo==='multi';
 const web=['web','saas','mobile','shop','ai'].includes(ty);
 if(ty==='web'){
  if(beg){add('amplify','Beginner team: Amplify publishes your site straight from Git with no infrastructure to learn.')}
  else{add('s3','A content website is static files; S3 stores them cheaply and durably.');add('cloudfront','CloudFront makes pages fast for '+(global?'visitors worldwide':'every visitor')+' and absorbs traffic spikes.')}
  add('route53','Your domain name needs DNS; Route 53 supports health checks and failover later.');
  if(!beg)add('ses','A contact form or newsletter needs reliable, cheap email.');
 }
 if(ty==='saas'||ty==='shop'||ty==='internal'||ty==='mobile'){
  if(ty!=='internal'||U>100)add('cognito','Users must sign in; Cognito gives secure login, MFA and social sign-in without building it yourself.');
  const containers=(big||a.availability==='critical'||U>=100000)&&!beg||a.traffic==='high'&&U>=10000&&a.skill==='expert';
  if(ty==='internal'&&beg){add('ec2','Internal tool with a beginner team: a simple server keeps things familiar.');add('alb','Load balancer gives a stable address and HTTPS.')}
  else if(containers){add('fargate','Sustained high traffic ('+U.toLocaleString()+' users) is cheaper and steadier on containers than per-request functions.');add('alb','Distributes traffic across containers in several Availability Zones.');add('nat','Containers sit in private subnets and need a controlled way out.')}
  else{add('lambda','Traffic is '+(a.traffic==='high'?'spiky':'low-to-moderate')+'; Lambda costs almost nothing when idle and scales instantly.');add('apigw','API Gateway authenticates, throttles and routes requests to your functions.')}
  if(ty==='mobile'){add('dynamodb','Mobile apps need fast, predictable key-value access that scales to any number of devices.')}
  else if(big&&(hi||ty==='shop')||a.availability==='critical'){add('aurora','High scale and availability need fast failover and read replicas; Aurora delivers both.')}
  else add('rds','Orders, accounts and billing are relational; a managed SQL database is the safest fit.');
  add('s3','Uploads, exports and static assets belong in S3, not on a server disk.');
  if(global||ty==='shop'||ty==='mobile')add('cloudfront','Serves images and static content close to users and offloads your servers.');
  if(big&&ty!=='mobile')add('elasticache','At this scale a cache removes repeated reads from the database.');
  if(ty!=='internal')add('sqs','Background work (emails, invoices, image processing) goes into a queue so users never wait.');
  if(ty==='shop'||ty==='saas')add('ses','Receipts, resets and notifications need transactional email.');
  add('route53','DNS for your domain with fast failover options.');
 }
 if(ty==='ai'){
  add('cognito','Only signed-in users should be able to spend your AI budget.');add('apigw','Front door and throttle for the AI endpoint.');add('lambda','Thin orchestration layer calling the model.');add('dynamodb','Stores conversation history and user settings.');
  if(a.aimode==='custom'){add('sagemaker','You need to train or host your own model, which is what SageMaker is for.');add('s3','Training data and model artifacts live in S3.')}
  else{add('bedrock','A ready-made foundation model through one API: no GPUs or ML team needed.');
   if(a.aimode==='rag'){add('opensearch','Vector search finds the right passages in your own documents.');add('s3','Source documents are stored in S3 and indexed.')}}
  add('route53','DNS for your domain.');
 }
 if(ty==='analytics'||ty==='dw'){
  add('s3','Raw and curated data sits in S3, the cheapest durable place for it.');add('glue','Glue cleans, transforms and catalogues the data.');
  if(ty==='dw'){add('redshift','A warehouse answers many complex reporting queries fast.')}else add('athena','Query the files directly with SQL and pay only per query.');
  add('quicksight','Managers explore the numbers in dashboards.');
 }
 if(web&&(a.security==='high'||a.compliance==='pci'||(a.security==='standard'&&big)))add('waf','Blocks common attacks and bad bots'+(a.compliance==='pci'?' (PCI DSS expects it)':'')+'.');
 if(a.security!=='basic'||a.compliance!=='none'){add('kms','Encrypts data and stores secrets safely'+(a.compliance!=='none'?' as '+a.compliance.toUpperCase()+' requires':'')+'.');add('guardduty','Detects suspicious activity automatically.')}
 if(a.dr!=='none'||a.compliance!=='none'||a.security==='high')add('backup','Policy-based backups'+(['pilot','multisite'].includes(a.dr)?' copied to a second region for disaster recovery':'')+'.');
 add('cloudwatch','You cannot fix what you cannot see: logs, metrics and alarms.');
 if(ty==='analytics'||ty==='dw'||ty==='web'&&beg){/* fine */}
 return r}
/* ---------- helpers ---------- */
function fmt(usd){const [sym,rate]=CUR[st.cur]||CUR.USD;const fx=(PRICES.fx&&PRICES.fx[st.cur])||rate;const v=usd*fx;
 let n;try{n=new Intl.NumberFormat(st.lang==='ar'?'en-US':st.lang,{maximumFractionDigits:v>=100?0:2,minimumFractionDigits:v>=100?0:2}).format(v)}catch(e){n=v.toFixed(2)}
 const word=sym.length>1&&/^[A-Z]+$/.test(sym);return '\u200E'+(word?n+'\u00A0'+sym:sym+n)}
function activeIds(){const a=eff();const ids=new Set(st.answers.type?recommend(a).map(x=>x.id):[]);st.manual.forEach(i=>ids.add(i));st.removed.forEach(i=>ids.delete(i));return [...ids]}
function visibleQs(){const a={...st.answers};return Q.filter(q=>!q.show||q.show(a))}
function toast(m){const e=$('#toast');e.textContent=m;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',1800)}
function persist(){try{localStorage.setItem('velo-adv',JSON.stringify({lang:st.lang,region:st.region,cur:st.cur}))}catch(e){}}
/* ---------- smart search ---------- */
const norm=s=>s.toLowerCase().replace(/[^a-z0-9؀-ۿ+. ]/g,' ').replace(/\s+/g,' ').trim();
const INDEX=[];Object.entries(S).forEach(([id,s])=>{INDEX.push({id,term:norm(s.n),cloud:'aws'});Object.entries(s.kw).forEach(([cl,str])=>str.split(',').map(x=>x.trim()).filter(Boolean).forEach(tm=>INDEX.push({id,term:norm(tm),cloud:cl,raw:tm})))});
function lev(a,b){if(Math.abs(a.length-b.length)>1)return 9;const m=[];for(let i=0;i<=a.length;i++){m[i]=[i];for(let j=1;j<=b.length;j++)m[i][j]=i?0:j}
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)m[i][j]=Math.min(m[i-1][j]+1,m[i][j-1]+1,m[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return m[a.length][b.length]}
function search(q){q=norm(q);if(!q)return[];const toks=q.split(' ').filter(x=>x.length>1),best={};
 INDEX.forEach(e=>{let sc=0;if(e.term===q)sc=100;else if(q.length>=3&&(e.term.includes(q)||(e.term.length>=4&&q.includes(e.term))))sc=60-Math.min(30,Math.abs(e.term.length-q.length));
  else{const words=e.term.split(' ');toks.forEach(tk=>{if(words.includes(tk))sc+=18;else if(tk.length>=3&&words.some(w=>w.startsWith(tk)))sc+=10;else if(tk.length>=5&&words.some(w=>lev(w,tk)<=1))sc+=8})}
  if(sc>0&&(!best[e.id]||sc>best[e.id].sc))best[e.id]={id:e.id,sc,hit:e}});
 return Object.values(best).sort((a,b)=>b.sc-a.sc).filter((r,i,arr)=>r.sc>=arr[0].sc*.4).slice(0,8)}
const CLOUD={gcp:'Google Cloud',az:'Azure',oth:'Other / SaaS',gen:'General',aws:'AWS'};
/* ---------- views ---------- */
function svcCard(id,why,full){const s=S[id],a=eff(),c=cost(id,st.answers.type?a:{...DEF}),live=liveFor(id);
 const lv=st.level,what=lv==='b'?s.w:lv==='d'?s.d:s.a;
 const alts=s.alt.length?'<ul>'+s.alt.map(([i,w])=>'<li><b>'+esc(S[i].n)+'</b> – '+esc(w)+'</li>').join('')+'</ul>':'—';
 const sec=(k,body,open)=>'<details'+(open?' open':'')+'><summary>'+esc(t(k))+'</summary><p>'+body+'</p></details>';
 return '<div class="card"><div class="res"><div class="ic">'+s.ic+'</div><div><h3>'+esc(s.n)+' <span class="tag">'+esc(s.cat)+'</span></h3>'+(why?'<div class="why">💡 <b>'+esc(t('why'))+':</b> '+esc(why)+'</div>':'')+'</div><div style="text-align:end"><b>'+fmt(c)+'</b><div class="sm mu">'+t('per_month')+'</div><div class="sm"><span class="tag '+(live?'g':'o')+'">'+t(live?'live':'approx')+'</span></div></div></div>'
 +sec('what',esc(what)+(lv==='a'?'<br><span class="mu">'+esc(s.d)+'</span>':''),true)
 +sec('biz',esc(s.biz))+sec('tech',esc(s.tech))+sec('role',esc(s.role))
 +sec('alts',alts)+sec('costimpact',esc(s.cost))+sec('learn',esc(s.learn))+sec('mist',esc(s.mist))
 +'<div class="row" style="margin-top:8px">'+(full?'<button class="btn sm" data-rm="'+id+'">'+t('remove')+'</button>':'')+'</div></div>'}
function vSearch(){const q=st.q,res=search(q);let h='<div class="card"><div class="searchbox"><input type="search" id="q" placeholder="'+esc(t('search_ph'))+'" value="'+esc(q)+'" autocomplete="off" aria-label="search"></div>';
 if(!q){h+='<p class="mu" style="margin:14px 0 4px">'+esc(t('intro_s'))+'</p><div class="chips"><span class="mu sm">'+t('try_ex')+'</span>'+['BigQuery','Azure Functions','Cloud Run','Firebase Auth','Redis','Kubernetes','Snowflake','Auth0','login','queue'].map(x=>'<span class="chip" data-q="'+x+'">'+x+'</span>').join('')+'</div>'}
 h+='</div>';
 if(q&&!res.length)h+='<div class="card mu">'+esc(t('no_results'))+'</div>';
 res.forEach(r=>{const s=S[r.id],hit=r.hit,inl=activeIds().includes(r.id),c=cost(r.id,{...DEF});
  h+='<div class="card"><div class="res"><div class="ic">'+s.ic+'</div><div><h3>'+esc(s.n)+' <span class="tag">'+esc(s.cat)+'</span></h3>'
  +(hit.cloud!=='aws'?'<div class="sm">'+esc(t('replaces'))+' <span class="tag o">'+esc(CLOUD[hit.cloud])+'</span><b>'+esc(hit.raw||'')+'</b></div>':'')
  +'<p class="mu" style="margin:6px 0 0">'+esc(s.w)+'</p><div class="chips">'+(s.alt.slice(0,2).map(([i])=>'<span class="chip" data-q="'+esc(S[i].n)+'">'+esc(S[i].n)+'</span>').join(''))+'</div></div>'
  +'<div style="text-align:end"><div class="sm mu">≈ '+fmt(c)+' '+t('per_month')+'</div><button class="btn sm '+(inl?'':'pri')+'" data-add="'+r.id+'" style="margin-top:6px">'+t(inl?'added':'add')+'</button> <button class="btn sm" data-det="'+r.id+'" style="margin-top:6px">'+t('view_details')+'</button></div></div>'
  +'<div class="det" id="det-'+r.id+'" hidden></div></div>'});
 return h}
function vAdvisor(){const vq=visibleQs(),i=Math.min(st.step,vq.length-1),q=vq[i],cur=st.answers[q.id];
 let h='<div class="card"><h2>'+esc(t('intro_t'))+'</h2><div class="row sm mu">'+t('step')+' '+(i+1)+' '+t('of')+' '+vq.length+'</div><div class="prog"><i style="width:'+Math.round((i+1)/vq.length*100)+'%"></i></div><h3>'+esc(qt(q.t))+'</h3><div class="opts">'
 +q.o.map(([v,l])=>'<button class="opt '+(String(cur)===String(v)?'on':'')+'" data-ans="'+q.id+'" data-v="'+v+'">'+esc(qt(l))+'</button>').join('')
 +'</div><div class="row"><button class="btn" data-back '+(i?'':'disabled')+'>← '+t('back')+'</button><button class="btn sp" data-restart>'+t('restart')+'</button></div></div>';return h}
function levelBar(){return '<div class="row" style="margin-bottom:12px"><span class="sm mu">'+t('explain_level')+'</span><div class="seg" role="group">'+[['b','level_b'],['d','level_d'],['a','level_a']].map(([k,l])=>'<button data-lv="'+k+'" class="'+(st.level===k?'on':'')+'">'+t(l)+'</button>').join('')+'</div><span class="sm mu sp">'+t('tier_hint')+'</span><div class="seg">'+[['lean','tier_lean'],['bal','tier_bal'],['scal','tier_scal']].map(([k,l])=>'<button data-tier="'+k+'" class="'+(st.tier===k?'on':'')+'">'+t(l)+'</button>').join('')+'</div></div>'}
function vRecs(){if(!st.answers.type)return '<div class="card">'+esc(t('answer_first'))+'<div class="row" style="margin-top:10px"><button class="btn pri" data-go="advisor">'+t('start')+'</button></div></div>';
 const a=eff(),rec=recommend(a),why={};rec.forEach(r=>why[r.id]=(st.lang==='ar'&&WHY_AR[r.id])||r.why);const ids=activeIds();
 return levelBar()+ids.map(id=>svcCard(id,why[id],true)).join('')}
const LAYERS=['Edge','Entry','Compute','Data','Async & insight','Security & ops'];
function diagram(ids){const rows=LAYERS.map((n,i)=>({n,i,ids:ids.filter(id=>S[id].L===i)})).filter(r=>r.ids.length);
 const W=760,rh=84,top=64,gap=10;let svg='<svg viewBox="0 0 '+W+' '+(top+rows.length*rh+10)+'" role="img" aria-label="architecture"><defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="#8E98B6"/></marker></defs>';
 svg+='<g><circle cx="'+W/2+'" cy="26" r="18" fill="#161d33" stroke="#232c47"/><text x="'+W/2+'" y="32" text-anchor="middle" font-size="18">👥</text></g>';
 let prevY=44,prevMain=true;
 rows.forEach((r,ri)=>{const y=top+ri*rh,sec=r.i===5,n=r.ids.length,bw=Math.min(132,(W-130-gap*(n-1))/n),tw=n*bw+(n-1)*gap,x0=120+(W-130-tw)/2;
  if(!sec&&prevMain)svg+='<line x1="'+W/2+'" y1="'+prevY+'" x2="'+W/2+'" y2="'+(y+2)+'" stroke="#8E98B6" stroke-width="1.5" marker-end="url(#ar)"/>';
  if(!sec){prevY=y+50;prevMain=true}
  svg+='<rect x="8" y="'+(y-4)+'" width="'+(W-16)+'" height="62" rx="10" fill="'+(sec?'none':'#0e1424')+'" stroke="#232c47" '+(sec?'stroke-dasharray="5 4"':'')+'/><text x="18" y="'+(y+30)+'" font-size="11" fill="#8E98B6">'+r.n+'</text>';
  r.ids.forEach((id,k)=>{const x=x0+k*(bw+gap),nm=S[id].n.replace(/^(Amazon|AWS) /,'');svg+='<g><rect x="'+x+'" y="'+y+'" width="'+bw+'" height="50" rx="9" fill="#161d33" stroke="'+(sec?'#4C8DFF':'#FF9900')+'"/><text x="'+(x+bw/2)+'" y="'+(y+21)+'" text-anchor="middle" font-size="16">'+S[id].ic+'</text><text x="'+(x+bw/2)+'" y="'+(y+39)+'" text-anchor="middle" font-size="11" fill="#E7EBF6">'+esc(nm.length>20?nm.slice(0,19)+'…':nm)+'</text></g>'})});
 return svg+'</svg>'}
function archText(a,ids){const has=i=>ids.includes(i),L=[];
 const comp=has('fargate')?'containers':has('lambda')?'serverless':has('ec2')?'servers':has('eks')?'k8s':'other';
 const scal=[];
 if(comp==='serverless')scal.push('Lambda scales out automatically per request. Protect the database with reserved concurrency and RDS Proxy, and set API Gateway throttling.');
 if(comp==='containers')scal.push('ECS service auto scaling on CPU or request count, minimum two tasks in different Availability Zones, ALB spreads load.');
 if(comp==='servers')scal.push('Put EC2 instances in an Auto Scaling group behind the load balancer; scale on CPU or request count.');
 if(has('aurora'))scal.push('Aurora adds read replicas and scales ACUs without downtime.');else if(has('rds'))scal.push('Scale RDS vertically first, then add read replicas for read-heavy load.');
 if(has('dynamodb'))scal.push('DynamoDB on-demand scales with traffic; design keys to avoid hot partitions.');
 if(has('cloudfront'))scal.push('CloudFront offloads most read traffic from the origin.');
 if(has('elasticache'))scal.push('A cache layer cuts database reads.');
 if(a.growth==='viral')scal.push('Expecting viral growth: load-test early and request quota increases before launch.');
 const sec=['Least-privilege IAM roles, MFA on all admin users, no long-lived access keys.','Private subnets for compute and data, security groups as the main firewall, VPC endpoints for S3/DynamoDB.'];
 if(has('waf'))sec.push('AWS WAF with managed rules at the edge.');if(has('cognito'))sec.push('Cognito handles user authentication; validate JWTs at the API layer.');
 if(has('kms'))sec.push('Encrypt data at rest with KMS and keep secrets in Secrets Manager, never in code.');if(has('guardduty'))sec.push('GuardDuty and CloudTrail provide detection and an audit trail.');
 if(a.compliance==='gdpr')sec.push('GDPR: keep personal data in an EU region you choose and document data flows.');if(a.compliance==='hipaa')sec.push('HIPAA: sign a BAA with AWS and use only HIPAA-eligible services.');if(a.compliance==='pci')sec.push('PCI DSS: isolate the cardholder data environment or use a hosted payment provider to shrink scope.');
 const ha={standard:'Single-AZ is acceptable for your stated tolerance. Keep backups and automate redeployment so recovery is quick.',high:'Spread across at least two Availability Zones: Multi-AZ database, load balancer and compute in two AZs. Target around 99.9%.',critical:'Multi-AZ everywhere plus a second region with Route 53 health-check failover (and Aurora Global Database if relational). Target 99.99% and test failover regularly.'}[a.availability];
 const co=['Set AWS Budgets alerts from day one and tag every resource.'];
 if(has('ec2')||has('fargate')||has('rds')||has('aurora'))co.push('For steady load buy Compute Savings Plans or Reserved Instances (30–70% saving).');
 if(has('nat'))co.push('NAT Gateways are costly: use VPC endpoints and keep traffic in-AZ.');if(has('s3'))co.push('S3 lifecycle rules move cold data to cheaper classes.');if(has('cloudwatch'))co.push('Set log retention (e.g. 30 days) to stop log costs growing.');
 co.push('Right-size after two weeks of real metrics; shut down non-production out of hours.');
 const dr={none:'No DR requested. Minimum: automated backups and infrastructure as code so you can rebuild.',backup:'Backup & restore: RPO hours, RTO hours. Automated backups copied off-site; rehearse restores.',pilot:'Pilot light / warm standby in a second region: data replicated, minimal compute running, scale up on failover. RPO minutes, RTO minutes to an hour.',multisite:'Active-active in two regions with global data replication and latency-based routing. Highest cost and complexity; RPO near zero.'}[a.dr];
 const alt=[];
 if(comp==='serverless')alt.push('Container-first: ECS Fargate + ALB. Steadier at high constant traffic, a little more to operate.');
 if(comp==='containers')alt.push('Serverless-first: Lambda + API Gateway. Cheaper when traffic is spiky or low.');
 if(comp!=='k8s')alt.push('Kubernetes on EKS if the team already runs Kubernetes elsewhere (portability, bigger ecosystem, more operations).');
 if(a.type==='web'||a.type==='saas')alt.push('PaaS style: Amplify Hosting or Elastic Beanstalk to minimise operations for a small team.');
 if(a.type==='ai')alt.push('Different model or provider through Bedrock, or self-hosted open models on SageMaker for strict data control.');
 return{scal,sec,ha:[ha],costopt:co,dr:[dr],alt}}
function vArch(){if(!st.answers.type)return vRecs();const a=eff(),ids=activeIds(),x=archText(a,ids);
 const blk=(k,arr)=>'<div class="card"><h3>'+t(k)+'</h3><ul>'+arr.map(i=>'<li>'+esc(i)+'</li>').join('')+'</ul></div>';
 return '<div class="card diagram"><h3>'+t('arch_diagram')+'</h3>'+diagram(ids)+'</div><div class="grid2">'+blk('scal',x.scal)+blk('sec',x.sec)+blk('ha',x.ha)+blk('costopt',x.costopt)+blk('dr',x.dr)+blk('altarch',x.alt)+'</div>'}
function vEst(){const a=st.answers.type?eff():{...DEF},ids=activeIds();
 const rows=ids.map(id=>({id,c:cost(id,a),live:liveFor(id)})).sort((x,y)=>y.c-x.c);let tot=rows.reduce((s,r)=>s+r.c,0);
 if(st.vat)tot*=1.2;if(st.period==='y')tot*=12;
 const live=rows.filter(r=>r.live).length;
 return '<h3>'+t('estimate')+'</h3><div class="row"><div class="seg"><button data-per="m" class="'+(st.period==='m'?'on':'')+'">'+t('monthly')+'</button><button data-per="y" class="'+(st.period==='y'?'on':'')+'">'+t('yearly')+'</button></div></div>'
 +'<label class="row sm" style="margin:10px 0"><input type="checkbox" id="vat" '+(st.vat?'checked':'')+'> '+t('vat')+'</label>'
 +'<div class="big">'+fmt(tot)+'</div><div class="sm mu">'+t('total')+' · '+t(st.period==='m'?'monthly':'yearly')+'</div>'
 +'<div class="side-h">'+t('breakdown')+'</div>'+(rows.length?rows.map(r=>'<div class="line"><span>'+S[r.id].ic+' '+esc(S[r.id].n)+(r.live?' <span class="tag g" title="'+t('live')+'">●</span>':'')+'</span><span>'+fmt(r.c*(st.vat?1.2:1)*(st.period==='y'?12:1))+' <button data-rm="'+r.id+'" aria-label="'+t('remove')+'">✕</button></span></div>').join(''):'<p class="mu sm">'+t('empty')+'</p>')
 +'<div class="sm mu" style="margin-top:8px">'+t('price_src')+': '+live+'/'+rows.length+' '+t('live').toLowerCase()+' · '+t('fx_note')+'</div>'
 +'<div class="disc">'+t('disclaimer')+'</div><button class="btn" data-reset style="width:100%">'+t('reset')+'</button>'
 +'<div class="coffee"><b>☕ '+t('coffee_t')+'</b><br>'+t('coffee_x')+'<br><a class="btn sm pri" style="display:inline-block;margin-top:6px;text-decoration:none" href="https://monzo.me/muneerahmed" target="_blank" rel="noopener">'+t('coffee_b')+' · @muneerahmed</a></div>'}
function renderNav(){const tabs=[['search','tab_search','🔎'],['advisor','tab_advisor','🧭'],['recs','tab_recs','✅'],['arch','tab_arch','🏗️']];
 $('#nav').innerHTML=tabs.map(([k,l,i],n)=>'<button data-go="'+k+'" class="'+(st.tab===k?'on':'')+'">'+i+' '+t(l)+'</button>').join('');
 $('#tpls').innerHTML=window.TEMPLATES.map(x=>'<button class="btn sm" style="width:100%;margin-bottom:6px;text-align:start" data-tpl="'+x.id+'">'+x.ic+' '+esc(qt(x.n))+'</button>').join('')}
function render(keepFocus){const d=document.documentElement;d.lang=st.lang;d.dir=st.lang==='ar'?'rtl':'ltr';document.body.dir=d.dir;
 $('#tagline').textContent=t('tagline');$('#lblRegion').textContent=t('region');$('#lblLang').textContent=t('language');$('#lblCur').textContent=t('currency');$('#btnShare').textContent='🔗 '+t('share');$('#btnPrint').textContent='🖨️ '+t('print');$('#tplH').textContent=t('templates');$('#kbH').textContent=t('shortcuts');$('#helpT').textContent=t('shortcuts');$('#helpX').textContent=t('help_close');
 const m=PRICES.meta||{};$('#priceNote').textContent=t('price_src')+': '+(m.source==='aws'?'AWS Price List':'approx.')+(m.updated?' · '+t('updated')+' '+m.updated:'');
 renderNav();
 const v={search:vSearch,advisor:vAdvisor,recs:vRecs,arch:vArch}[st.tab]();$('#work').innerHTML=v;$('#est').innerHTML=vEst();
 if(keepFocus){const q=$('#q');if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length)}}}
/* ---------- events ---------- */
function setTab(k){st.tab=k;render();window.scrollTo({top:0})}
function resetAll(){st.answers={};st.step=0;st.manual.clear();st.removed.clear();st.q='';st.tier='bal';st.tab='search';render()}
function share(){const o={a:st.answers,r:st.region,l:st.lang,c:st.cur,t:st.tier,m:[...st.manual],x:[...st.removed]};const url=location.origin+location.pathname+'#s='+btoa(unescape(encodeURIComponent(JSON.stringify(o))));
 (navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).then(()=>toast(t('copied')),()=>{prompt('URL',url)})}
function loadHash(){try{const m=location.hash.match(/s=([^&]+)/);if(!m)return;const o=JSON.parse(decodeURIComponent(escape(atob(m[1]))));st.answers=o.a||{};st.region=o.r||st.region;st.lang=o.l||st.lang;st.cur=o.c||st.cur;st.tier=o.t||'bal';st.manual=new Set(o.m||[]);st.removed=new Set(o.x||[]);if(st.answers.type)st.tab='recs'}catch(e){}}
document.addEventListener('click',e=>{const el=e.target.closest('[data-go],[data-q],[data-add],[data-det],[data-ans],[data-back],[data-restart],[data-lv],[data-tier],[data-per],[data-rm],[data-reset],[data-tpl]');if(!el)return;const D=el.dataset;
 if('go' in D)return setTab(D.go);
 if('q' in D){st.q=D.q;st.tab='search';return render()}
 if('add' in D){st.manual.add(D.add);st.removed.delete(D.add);return render(true)}
 if('det' in D){const box=$('#det-'+D.det);if(box.hidden){box.innerHTML=svcCard(D.det,'',false).replace('class="card"','class="card" style="margin:12px 0 0"');box.hidden=false}else box.hidden=true;return}
 if('ans' in D){const q=Q.find(x=>x.id===D.ans),opt=q.o.find(o=>String(o[0])===D.v);st.answers[D.ans]=opt[0];const vq=visibleQs();
  if(st.step>=vq.length-1){st.tier={lean:'lean',balanced:'bal',flex:'scal'}[st.answers.budget]||'bal';st.removed.clear();st.tab='recs';render();return window.scrollTo({top:0})}
  st.step++;return render()}
 if('back' in D){st.step=Math.max(0,st.step-1);return render()}
 if('restart' in D){st.answers={};st.step=0;return render()}
 if('lv' in D){st.level=D.lv;return render()}
 if('tier' in D){st.tier=D.tier;return render()}
 if('per' in D){st.period=D.per;return render()}
 if('rm' in D){st.manual.delete(D.rm);st.removed.add(D.rm);return render()}
 if('reset' in D)return resetAll();
 if('tpl' in D){const x=window.TEMPLATES.find(y=>y.id===D.tpl);st.answers={...x.a};st.tier={lean:'lean',balanced:'bal',flex:'scal'}[x.a.budget]||'bal';st.removed.clear();st.manual.clear();st.tab='recs';render();window.scrollTo({top:0})}});
document.addEventListener('input',e=>{if(e.target.id==='q'){st.q=e.target.value;const w=$('#work');w.innerHTML=vSearch();const q=$('#q');q.focus();q.setSelectionRange(q.value.length,q.value.length);$('#est').innerHTML=vEst()}});
document.addEventListener('change',e=>{if(e.target.id==='vat'){st.vat=e.target.checked;render()}});
document.addEventListener('keydown',e=>{const tg=e.target.tagName;if(e.key==='Escape'){$('#help').classList.remove('on');return}
 if(tg==='INPUT'||tg==='SELECT'||tg==='TEXTAREA'||e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key;if(k==='/'){e.preventDefault();setTab('search');const q=$('#q');q&&q.focus()}
 else if('1234'.includes(k)&&k)setTab(['search','advisor','recs','arch'][+k-1]);
 else if(k==='?')$('#help').classList.add('on');else if(k==='m'||k==='M'){st.period=st.period==='m'?'y':'m';render()}
 else if(k==='v'||k==='V'){st.vat=!st.vat;render()}else if(k==='p'||k==='P')window.print();else if(k==='R')resetAll()});
/* ---------- init ---------- */
function fillSelects(){$('#region').innerHTML=REG.map(r=>'<option value="'+r[0]+'">'+esc(r[1])+' · '+r[0]+'</option>').join('');
 $('#lang').innerHTML=Object.entries(window.LANGS).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');
 $('#cur').innerHTML=Object.keys(CUR).map(k=>'<option>'+k+'</option>').join('');
 $('#region').value=st.region;$('#lang').value=st.lang;$('#cur').value=st.cur}
$('#region').onchange=e=>{st.region=e.target.value;persist();render()};
$('#lang').onchange=e=>{st.lang=e.target.value;persist();render()};
$('#cur').onchange=e=>{st.cur=e.target.value;persist();render()};
$('#btnShare').onclick=share;$('#btnPrint').onclick=()=>window.print();$('#helpX').onclick=()=>$('#help').classList.remove('on');
try{const s=JSON.parse(localStorage.getItem('velo-adv')||'{}');if(s.lang&&UI[s.lang])st.lang=s.lang;if(s.region)st.region=s.region;if(s.cur&&CUR[s.cur])st.cur=s.cur}catch(e){}
loadHash();fillSelects();render();
fetch('data/prices.json?'+Date.now()).then(r=>r.ok?r.json():null).then(j=>{if(j){PRICES=j;render()}}).catch(()=>{});
window.__velo={st,search,recommend,eff,cost,activeIds,PRICES:()=>PRICES};
})();
