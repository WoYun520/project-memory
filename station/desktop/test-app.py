#!/usr/bin/env python3
"""Native app smoke tests against isolated data; no formal user project is read or modified."""
import json, os, pathlib, socket, subprocess, tempfile, time, urllib.request, shutil, hashlib, plistlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
APP=ROOT.parent/'desktop-release/记忆站.app'
EXE=APP/'Contents/MacOS/MemoryStation'
NODE=APP/'Contents/Resources/runtime/node'
SERVER=APP/'Contents/Resources/project-memory/station/server/index.mjs'
TEMP=pathlib.Path(tempfile.mkdtemp(prefix='memory-desktop-qa-'))
def port():
    with socket.socket() as sock: sock.bind(('127.0.0.1',0)); return sock.getsockname()[1]
def health(p):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{p}/api/health',timeout=1) as r:return json.load(r)
    except Exception:return None
def wait_for(fn, seconds=8):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if fn():return
        time.sleep(.1)
    raise AssertionError('Condition timed out')
def run(name,p,data,expected=True,application=APP):
    data.mkdir(exist_ok=True)
    report=TEMP/(name+'.json')
    env={**os.environ,'MEMORY_DESKTOP_TEST_DATA':str(data),'MEMORY_DESKTOP_TEST_PORT':str(p),'MEMORY_DESKTOP_SMOKE_RESULT':str(report),'PATH':'/usr/bin:/bin'}
    began=time.monotonic()
    process=subprocess.Popen([str(application/'Contents/MacOS/MemoryStation'),'--smoke-test'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try: process.wait(timeout=50)
    except subprocess.TimeoutExpired:
        process.terminate();process.wait(timeout=5);raise AssertionError('Application did not quit')
    result=json.loads(report.read_text())
    assert result['ok'] is expected,result
    result['elapsedSeconds']=round(time.monotonic()-began,2)
    return result
results={}
p=port();results['selfStarted']=run('owned',p,TEMP/'owned')
wait_for(lambda:not health(p));results['ownedServiceStopped']=True
p=port();shared=TEMP/'shared';shared.mkdir()
server=subprocess.Popen([str(NODE),str(SERVER)],env={**os.environ,'MEMORY_STATION_PORT':str(p),'MEMORY_STATION_DATA_DIR':str(shared),'MEMORY_STATION_EMPTY':'1'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    wait_for(lambda:health(p))
    def post(route, body):
        request=urllib.request.Request(f'http://127.0.0.1:{p}/api'+route,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Memory-Station':'1'})
        return json.load(urllib.request.urlopen(request))
    project=post('/projects',{'name':'Desktop fixture','goal':'','reviewed':True})['bundle']['project']['id']
    worklog={'format':'project-memory-worklog','version':'0.1','project_id':project,'session':{'id':'desktop-isolated-qa','agent':'fixture','actor':{'kind':'agent','id':'fixture'}},'entries':[{'id':'entry-'+str(i),'kind':'fact','title':'Synthetic observation '+str(i),'detail':'Synthetic native menu check','origin':'observation','source':{'speaker':{'kind':'agent','id':'fixture'},'text':'Synthetic isolated fixture, not a user observation.'}} for i in range(2)]}
    post('/projects/'+project+'/work-stage',{'worklog':worklog,'sourceReviewed':True})
    results['reused']=run('reuse',p,shared)
    assert results['reused']['menuCount']==2
    assert health(p);results['reusedServicePreserved']=True
    results['wrongDataBlocked']=run('wrong-data',p,TEMP/'different',False)
    assert health(p);results['conflictingServicePreserved']=True
finally:
    server.terminate();server.wait(timeout=8)
# Reopen an owned service against the same pending queue and formal archive.
retained={str(f.relative_to(shared)):hashlib.sha256(f.read_bytes()).hexdigest() for f in shared.rglob('*') if f.is_file()}
for name in ['restart-one','restart-two']:
    restartPort=port();results[name]=run(name,restartPort,shared)
    assert results[name]['menuCount']==2
    wait_for(lambda:not health(restartPort))
    assert retained=={str(f.relative_to(shared)):hashlib.sha256(f.read_bytes()).hexdigest() for f in shared.rglob('*') if f.is_file()}
results['pendingAndArchivePreserved']=True
# These modifications apply only to temporary copies, never the installed app.
def delayed_copy(source,name):
    copy=TEMP/(name+'.app');shutil.copytree(source,copy)
    hub=copy/'Contents/Resources/project-memory/station/hub.mjs'
    content=hub.read_text();content=content.replace('#!/usr/bin/env node\n','',1)
    hub.write_text('await new Promise(resolve=>setTimeout(resolve,15000));\n'+content)
    subprocess.run(['codesign','--force','--deep','--sign','-',str(copy)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    return copy
old=pathlib.Path.home()/'Applications'/'\u8bb0\u5fc6\u7ad9.app'
oldInfo=old/'Contents/Info.plist'
# The old regression control applies only while the 0.15 app is installed.
if oldInfo.exists() and plistlib.loads(oldInfo.read_bytes()).get('CFBundleShortVersionString')=='0.15.0':
    results['oldDelayedLaunch']=run('old-delay',port(),TEMP/'old-delay',False,delayed_copy(old,'old-delay'))
slow=delayed_copy(APP,'slow')
p=port();results['delayedLaunch']=run('slow',p,TEMP/'slow-data',True,slow)
assert results['delayedLaunch']['elapsedSeconds']>=15
wait_for(lambda:not health(p))
bad=TEMP/'bad-config';bad.mkdir();(bad/'local-tools.json').write_text('{ malformed synthetic config')
results['invalidConfig']=run('bad-config',port(),bad,False)
assert '配置' in results['invalidConfig']['error']
blocked=TEMP/'blocked-config';blocked.mkdir();blockedFile=blocked/'local-tools.json';blockedFile.write_text('{}');blockedFile.chmod(0)
try:
    results['permissionDenied']=run('permission',port(),blocked,False)
    assert '权限' in results['permissionDenied']['error']
finally:blockedFile.chmod(0o600)
def retry_copy(name,failures):
    copy=TEMP/(name+'.app');shutil.copytree(APP,copy)
    hub=copy/'Contents/Resources/project-memory/station/hub.mjs'
    content=hub.read_text().replace('#!/usr/bin/env node\n','',1)
    probe="import probeFs from 'node:fs'; const probePath=process.env.MEMORY_STATION_DATA_DIR+'/.retry-probe'; let probeCount=0; try{probeCount=Number(probeFs.readFileSync(probePath,'utf8'));}catch{} probeFs.writeFileSync(probePath,String(probeCount+1)); if(probeCount<"+str(failures)+")process.exit(1);\n"
    hub.write_text(probe+content)
    subprocess.run(['codesign','--force','--deep','--sign','-',str(copy)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    return copy
retryData=TEMP/'retry';p=port();results['automaticRetry']=run('retry',p,retryData,True,retry_copy('retry',2))
assert (retryData/'.retry-probe').read_text()=='3';wait_for(lambda:not health(p))
exhaustedData=TEMP/'exhausted';results['retryLimit']=run('exhausted',port(),exhaustedData,False,retry_copy('exhausted',10))
assert (exhaustedData/'.retry-probe').read_text()=='3'
(TEMP/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
print('Report:',TEMP/'results.json')
