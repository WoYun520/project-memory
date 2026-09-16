import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const STATION_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const RADAR_PUBLIC_FILES=Object.freeze([
  'index.html','app.js','repository-data.js','styles.css','favicon.svg',
  'website/index.html','website/about.html','website/project.html','website/note.html','website/cover.html','website/case.html',
  'website/styles.css','website/v2.css','website/case.css','website/site.js','website/page.js','website/common.js',
  'website/content.js','website/site-config.js','website/about.js','website/cover-core.js','website/cover-editor.js','website/case.js',
  'website/time-compounding.md','output/time-compounding/case-portrait.png','output/time-compounding/case-landscape.png',
]);
const PUBLIC_FILES=new Set(RADAR_PUBLIC_FILES);
const digest=value=>createHash('sha256').update(value).digest('hex');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain; charset=utf-8'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};

function configError(message){const error=Error(message);error.code='STATION_CONFIG';return error;}
function port(value,fallback){const result=Number(value??fallback);if(!Number.isInteger(result)||result<1||result>65535)throw configError('本机端口配置无效。');return result;}
export function readLocalToolsConfig({stationRoot=STATION_ROOT,env=process.env}={}){
  const configPath=path.join(path.resolve(env.MEMORY_STATION_DATA_DIR||path.join(stationRoot,'data')),'local-tools.json');
  let saved={};
  if(fs.existsSync(configPath)){
    if(fs.statSync(configPath).size>16_384)throw configError('本机工具配置文件过大。');
    try{saved=JSON.parse(fs.readFileSync(configPath,'utf8'));}catch(cause){const error=Error('本机工具配置无法读取，请检查 local-tools.json。');error.code=['EACCES','EPERM'].includes(cause.code)?cause.code:'STATION_CONFIG';throw error;}
    if(!saved||typeof saved!=='object'||Array.isArray(saved))throw configError('本机工具配置格式无效。');
  }
  const radarRoot=env.MEMORY_RADAR_ROOT||saved.radarRoot||null;
  if(radarRoot!==null&&(typeof radarRoot!=='string'||!path.isAbsolute(radarRoot)))throw configError('观察仓库需要填写本机绝对目录。');
  return {radarRoot,radarPort:port(env.MEMORY_RADAR_PORT,4174),stationPort:port(env.MEMORY_STATION_PORT,4180)};
}

// Exact names and real paths are both checked: an allowed filename cannot link to a private file elsewhere.
export function resolvePublicAsset(root,requestPath){
  let decoded;try{decoded=decodeURIComponent(requestPath);}catch{return null;}
  if(decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').some(part=>part==='.'||part==='..'))return null;
  const relative=decoded==='/'?'index.html':decoded==='/website/'?'website/index.html':decoded.replace(/^\//,'');
  if(!PUBLIC_FILES.has(relative))return null;
  try{
    const realRoot=fs.realpathSync(root);
    let cursor=realRoot;for(const part of relative.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())return null;}
    const file=fs.realpathSync(path.join(realRoot,relative));
    if(!file.startsWith(realRoot+path.sep)||!fs.statSync(file).isFile())return null;
    return file;
  }catch{return null;}
}
function localAsset(root,relative){const file=resolvePublicAsset(root,'/'+relative);if(!file)throw Error('观察仓库的公开页面或脚本不完整，请检查目录。');return fs.readFileSync(file);}
export function radarFingerprint(root){return digest(Buffer.concat(['index.html','app.js'].map(name=>localAsset(root,name))));}

// Dial 127.0.0.1 directly; the visible localhost origin is preserved without using DNS or remote URLs.
export function readLoopback({port:targetPort,pathname='/',host='localhost',timeout=1200,maxBytes=2_000_000}){
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port:targetPort,path:pathname,headers:{Host:`${host}:${targetPort}`}},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){const error=Error('本机服务返回内容过大。');error.code='ETOOBIG';req.destroy(error);}else chunks.push(chunk);});
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
      res.on('error',reject);
    });
    req.setTimeout(timeout,()=>{const error=Error('本机服务响应超时。');error.code='ETIMEDOUT';req.destroy(error);});req.on('error',reject);
  });
}
export async function inspectRadar(config,{request=readLoopback}={}){
  if(!config.radarRoot)return {status:'unconfigured',message:'还没有连接观察仓库。'};
  let fingerprint;
  try{fingerprint=radarFingerprint(config.radarRoot);}catch{return {status:'unavailable',message:'找不到观察仓库页面，请检查本机目录配置。'};}
  const get=pathname=>request({port:config.radarPort,pathname});
  try{
    const health=await get('/__local_tools_health');
    let identity;try{identity=JSON.parse(health.body.toString());}catch{}
    if(health.status===200&&identity?.service==='creator-opportunity-radar-local'){
      if(identity.fingerprint!==fingerprint)return {status:'conflict',message:'这个端口连接着另一份观察仓库，请先检查原启动窗口。'};
      return {status:'ready',connectionMode:'workspace-launcher',message:'已连接本机观察仓库。'};
    }
    const responses=await Promise.all(['index.html','app.js'].map(name=>get('/'+name)));
    if(responses.every((response,i)=>response.status===200&&digest(response.body)===digest(localAsset(config.radarRoot,['index.html','app.js'][i]))))
      return {status:'ready',connectionMode:'existing-preview',message:'已连接原有预览服务，保留原浏览器地址。'};
    return {status:'conflict',message:'端口正在被其他服务使用，尚未连接观察仓库。启动器不会停止它。'};
  }catch(error){
    if(error.code==='ECONNREFUSED')return {status:'stopped',message:'双击“打开工作台”即可启动。'};
    if(['EPERM','EACCES'].includes(error.code))return {status:'unavailable',message:'当前环境没有访问本机服务的权限，无法判断是否已启动。'};
    return {status:'unavailable',message:'本机服务没有正常响应，请检查原启动窗口。'};
  }
}
export async function getLocalToolStatus(options={}){
  let config;try{config=readLocalToolsConfig(options);}catch(error){const problem={configured:false,status:'unavailable',url:null,message:error.message};return {radar:{...problem},website:{...problem}};}
  const radar=await inspectRadar(config,options),configured=Boolean(config.radarRoot),url=`http://localhost:${config.radarPort}/`;
  let website={...radar};
  if(configured&&!resolvePublicAsset(config.radarRoot,'/website/index.html'))website={status:'unavailable',message:'这份观察仓库没有个人网站页面。'};
  else if(radar.status==='ready'){
    try{
      const response=await (options.request||readLoopback)({port:config.radarPort,pathname:'/website/index.html'});
      if(response.status!==200||digest(response.body)!==digest(localAsset(config.radarRoot,'website/index.html')))website={status:'conflict',message:'网站预览与本机配置不一致，请检查原启动窗口。'};
    }catch{website={status:'unavailable',message:'个人网站暂时无法打开。'};}
  }
  return {radar:{configured,...radar,url:configured?url:null},website:{configured,...website,url:configured?url+'website/':null}};
}

export function createRadarServer({radarRoot,radarPort=4174}){
  radarFingerprint(radarRoot);
  return http.createServer((req,res)=>{
    const send=(status,body,extra={})=>{res.writeHead(status,{...headers,...extra});res.end(req.method==='HEAD'?undefined:body);};
    if(![`localhost:${radarPort}`,`127.0.0.1:${radarPort}`].includes(req.headers.host))return send(403,'只允许本机访问。');
    if(!['GET','HEAD'].includes(req.method))return send(405,'只提供公开页面。',{'Allow':'GET, HEAD'});
    const rawPath=req.url.split('?')[0];
    if(rawPath==='/__local_tools_health'){
      try{return send(200,JSON.stringify({service:'creator-opportunity-radar-local',version:'0.1.0',fingerprint:radarFingerprint(radarRoot)}),{'Content-Type':'application/json; charset=utf-8'});}catch{return send(503,'公开页面不完整。');}
    }
    if(rawPath==='/website')return send(308,'',{'Location':'/website/'});
    const file=resolvePublicAsset(radarRoot,rawPath);if(!file)return send(404,'未找到公开页面。');
    try{const content=fs.readFileSync(file);send(200,content,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});}catch{send(404,'未找到公开页面。');}
  });
}
