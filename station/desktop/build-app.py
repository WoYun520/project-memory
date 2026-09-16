#!/usr/bin/env python3
"""Build an offline macOS application. No project data or personal settings enter the bundle."""
import json, os, pathlib, shutil, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
PRODUCT = ROOT.parent
DEST = PRODUCT / 'desktop-release'
APP = DEST / '记忆站.app'
# npm can select a different Node installation from the invoking shell.
node=pathlib.Path(os.environ.get('MEMORY_STATION_BUILD_NODE') or shutil.which('node')).resolve()
node_license=node.parent.parent/'LICENSE'
if not node.is_file() or not node_license.is_file():
    raise RuntimeError('Select a Node distribution with its LICENSE using MEMORY_STATION_BUILD_NODE before replacing the build')
# A stable Apple signing identity lets updates retain their privacy identity.
# Never invent a weak designated requirement or silently fall back if signing was requested.
signing_identity=os.environ.get('MEMORY_STATION_SIGN_IDENTITY','-')
if signing_identity != '-':
    identities=subprocess.run(['security','find-identity','-v','-p','codesigning'],capture_output=True,text=True,check=True).stdout
    import re
    if not re.fullmatch(r'[A-Fa-f0-9]{40}',signing_identity) or signing_identity.upper() not in identities.upper():
        raise RuntimeError('MEMORY_STATION_SIGN_IDENTITY must be the SHA-1 of an installed valid code-signing identity')
if APP.exists(): shutil.rmtree(APP)
MAC = APP / 'Contents/MacOS'
RES = APP / 'Contents/Resources'
MAC.mkdir(parents=True)
RES.mkdir(parents=True)
subprocess.run(['npm','run','build'], cwd=ROOT, check=True)
subprocess.run(['swiftc','-swift-version','5','-O','-target','arm64-apple-macosx13.0','-framework','Cocoa','-framework','WebKit',str(ROOT/'desktop/MemoryStation.swift'),str(ROOT/'desktop/StartupPolicy.swift'),'-o',str(MAC/'MemoryStation')],check=True)
BUNDLED = RES/'project-memory/station'
BUNDLED.mkdir(parents=True)
for name in ['server','shared','dist']:
    shutil.copytree(ROOT/name, BUNDLED/name, ignore=shutil.ignore_patterns('*.test.mjs'))
for name in ['desktop-mcp.mjs','hub.mjs','bridge.mjs','memory.mjs','codex-bridge.mjs','claude-bridge.mjs','claude-wrap.mjs','submit-work.mjs','connect-project.mjs','package.json']:
    shutil.copy2(ROOT/name,BUNDLED/name)
shutil.copytree(PRODUCT/'spec',RES/'project-memory/spec')
# Server dependencies plus UI dependency license notices; never copy the development tree wholesale.
seen=set()
def dependency(name):
    if name in seen: return
    seen.add(name)
    source=ROOT/'node_modules'/name
    dest=BUNDLED/'node_modules'/name
    shutil.copytree(source,dest,ignore=shutil.ignore_patterns('test','tests','.github'))
    for child in json.loads((source/'package.json').read_text()).get('dependencies',{}): dependency(child)
for name in ['ajv','ajv-formats','@modelcontextprotocol/sdk','zod']: dependency(name)
notices=RES/'ThirdPartyNotices'; notices.mkdir()
shutil.copy2(PRODUCT/'LICENSE',RES/'LICENSE')
for name in ['react','react-dom','scheduler']:
    license_path=ROOT/'node_modules'/name/'LICENSE'
    if license_path.exists(): shutil.copy2(license_path,notices/(name+'-LICENSE'))
(RES/'runtime').mkdir()
shutil.copy2(node,RES/'runtime/node')
shutil.copy2(node_license,notices/'Node-LICENSE')
iconset=DEST/'MemoryStation.iconset'
subprocess.run(['swift',str(ROOT/'desktop/make-icon.swift'),str(iconset)],check=True)
subprocess.run(['iconutil','-c','icns',str(iconset),'-o',str(RES/'MemoryStation.icns')],check=True)
shutil.rmtree(iconset)
import plistlib
with (APP/'Contents/Info.plist').open('wb') as f:
    plistlib.dump({'CFBundleIconFile':'MemoryStation','CFBundleName':'记忆站','CFBundleDisplayName':'记忆站','CFBundleIdentifier':'local.projectmemory.desktop','CFBundleVersion':'39','CFBundleShortVersionString':'0.39.0','CFBundleExecutable':'MemoryStation','CFBundlePackageType':'APPL','LSMinimumSystemVersion':'13.0','NSHighResolutionCapable':True,'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'NSHumanReadableCopyright':'Project Memory · Local desktop preview'},f)
# Local preview defaults to ad-hoc; release builds may explicitly use a stable owner-provided identity.
# Notarization is a separate release step.
subprocess.run(['codesign','--force','--sign',signing_identity,str(RES/'runtime/node')],check=True)
subprocess.run(['codesign','--force','--deep','--sign',signing_identity,str(APP)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(APP)],check=True)
for file in APP.rglob('*'):
    if file.is_symlink(): raise RuntimeError('Unexpected symlink in package: '+str(file))
    if file.name in ['desktop.json','local-tools.json','project.json'] or file.name.endswith('.worklog.json'): raise RuntimeError('Personal data in bundle')
print(APP)
