const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),dist=process.env.MONIT_TEST_DIST;
if(!dist)throw new Error('MONIT_TEST_DIST required');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.MONIT_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage',...(process.env.MONIT_CHROME_SINGLE_PROCESS ? ['--single-process','--no-zygote','--disable-gpu'] : [])]});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 const fixture={timestamp:Date.now(),authEnabled:false,cpu:24,cpuCores:[20,28],loadavg:[1,1.1,1.2],memory:{MemTotal:1000000,MemAvailable:600000,MemFree:100000,Buffers:100000,Cached:200000,used_pct:40},swap:{total:100000,free:80000},disk:{total:1000000,used:300000,available:700000,used_pct:30,io:{}},network:{wlan0:{rx_bytes:1000,tx_bytes:2000,rx_rate:100,tx_rate:20}},internet:{ok:true,latency:10},dns:{ok:true,latency:1},system:{hostname:'fixture-host'},thermal:[{name:'battery',temp:34}],pm2:[{id:1,name:'A&B',status:'online',cpu:2,memory:1024,restarts:0,pid:1},{id:99,name:'dashboard',status:'online',cpu:1,memory:2048,restarts:0,pid:2}],torrents:[{hash:'a'.repeat(40),name:'Fixture ISO',progress:0.5,state:'downloading',dlspeed:100,upspeed:10,size:1000,ratio:0.1,num_seeds:1,num_peers:2,eta:20}],claudeUsage:{fiveHour:{utilization:25}},services:{Hermes:true}};
 const actions=[],dialogs=[];let ws;
 page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
 await page.routeWebSocket('**/ws',socket=>{ws=socket;socket.send(JSON.stringify(fixture))});
 await page.route('http://127.0.0.1:54321/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/status')return route.fulfill({json:fixture});
  if(url.pathname.startsWith('/api/pm2/logs/'))return route.fulfill({json:{success:true,out:'fixture stdout',err:'fixture stderr'}});
  if(url.pathname.startsWith('/api/')){actions.push(url.pathname);return route.fulfill({status:500,json:{success:false,error:'fixture action failure'}})}
  const file=url.pathname==='/'?path.join(root,'index.html'):url.pathname.startsWith('/dist/')?path.join(dist,url.pathname.slice(6)):path.join(root,url.pathname.slice(1));
  if(!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'}[path.extname(file)];
  return route.fulfill({body:fs.readFileSync(file),contentType:type});
 });
 await page.goto('http://127.0.0.1:54321/');
 await page.waitForFunction(()=>document.querySelector('#pm2-body strong')?.textContent==='A&B');
 assert.strictEqual(await page.locator('#cpu-pct').textContent(),'24.0%');
 assert.strictEqual(await page.locator('#antigravity-content').textContent().then(t=>t.includes('Unknown')),true);
 await page.locator('#torrent-list button[data-action="pause"]').evaluate(el=>{window.savedTorrentButton=el;el.disabled=true;el.focus()});
 fixture.timestamp++;fixture.cpu=26;fixture.torrents[0].progress=0.6;ws.send(JSON.stringify(fixture));
 await page.waitForFunction(()=>document.querySelector('#cpu-pct')?.textContent==='26.0%');
 assert(await page.evaluate(()=>document.querySelector('#torrent-list button[data-action="pause"]')===window.savedTorrentButton&&window.savedTorrentButton.disabled),'torrent button identity/state lost');
 await page.locator('#pm2-search').fill('dashboard');
 assert.strictEqual(await page.locator('#pm2-body tr[data-pm-id]').count(),1);
 await page.locator('#restart-all-btn').click();
 await page.waitForFunction(()=>!document.querySelector('#restart-all-btn').disabled);
 assert.strictEqual(actions[0],'/api/pm2/restart-all','Restart All must make one server call');
 assert(dialogs.some(t=>t.includes('fixture action failure')),'bulk failure must be visible');
 await page.locator('#pm2-search').fill('');
 await page.locator('#pm2-body .logs').first().click();
 await page.waitForFunction(()=>document.querySelector('#pm2-log-content')?.textContent==='fixture stdout');
 await page.keyboard.press('Escape');assert.strictEqual(await page.locator('#pm2-logs-modal').count(),0);
 await page.locator('#cpu-card [data-accordion-trigger]').click();assert.strictEqual(await page.locator('#cpu-card').getAttribute('data-state'),'closed');
 await page.locator('#cpu-card [data-accordion-trigger]').press('Enter');assert.strictEqual(await page.locator('#cpu-card').getAttribute('data-state'),'open');
 await page.setViewportSize({width:390,height:844});
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className:'svg',rect:e.getBoundingClientRect().toJSON()})).filter(e=>e.rect.right>innerWidth+1||e.rect.left< -1)}));
 if(overflow.scroll>overflow.width){console.log(JSON.stringify(overflow));await page.screenshot({path:path.join(path.dirname(dist),'monit-overflow.png'),fullPage:true})}
 assert(overflow.scroll<=overflow.width,'mobile horizontal overflow');
 assert.deepStrictEqual(errors,[],'browser exceptions');
 const out=process.env.MONIT_SCREENSHOT||path.join(path.dirname(dist),'monit-mobile.png');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out,fullPage:true,animations:'disabled'});
 await page.locator('#antigravity-card').scrollIntoViewIfNeeded();
 assert(await page.locator('#mem-card').isVisible(), 'Memory card missing');
 assert(await page.locator('#antigravity-card').isVisible(), 'AI card missing');
 await page.locator('#antigravity-card').screenshot({path:out.replace(/\.png$/, '-ai.png'),animations:'disabled'});
 console.log('Chromium desktop/mobile smoke passed: rendering, retained buttons, filters, bulk failure, logs, keyboard accordions. Screenshot: '+out);
 }finally{await browser.close()}
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
