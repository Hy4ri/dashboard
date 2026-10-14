const fs=require('fs'),vm=require('vm'),assert=require('assert');
(async()=>{
 const handlers={},puts=[];
 const cache={addAll:async paths=>{assert(!paths.includes('/')&&!paths.includes('/index.html'),'Do not precache authenticated HTML');},put:async(req,res)=>puts.push(req.url)};
 const ctx={URL,Response,console,self:{location:{origin:'http://localhost'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>[],match:async()=>null,delete:async()=>true},fetch:async()=>new Response('<html>login</html>',{status:200,headers:{'Content-Type':'text/html'}})};
 vm.runInNewContext(fs.readFileSync('sw.js','utf8'),ctx);
 let install;handlers.install({waitUntil:p=>install=p});await install;
 let responded;const pending=[];
 handlers.fetch({request:{url:'http://localhost/dist/client/main.js',method:'GET',mode:'cors'},respondWith:p=>responded=p,waitUntil:p=>pending.push(p)});
 if(responded)await responded;await Promise.all(pending);await Promise.resolve();
 assert.strictEqual(puts.length,0,'Login HTML must not poison JavaScript cache');
 responded=null;
 handlers.fetch({request:{url:'http://localhost/',method:'GET',mode:'navigate'},respondWith:p=>responded=p,waitUntil:p=>pending.push(p)});
 assert.strictEqual(responded,null,'Navigation must remain network-only to respect authentication');
 console.log('Service worker auth/cache regressions passed');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
