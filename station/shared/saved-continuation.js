export const continuationNames={codex:'Codex',claude:'Claude Code'};

// Starts only from the completed save event; rendering or polling never launches.
export async function openSavedWork({api,projectId,revision,target,isCurrent=()=>true}){
 if(!continuationNames[target])throw Error('请选择 Codex 或 Claude Code。');
 const info=await api(`/projects/${projectId}/${target}`);
 if(!isCurrent())return {cancelled:true};
 if(info.currentRevision!==revision)throw Error('记录又有更新，请重新核对最新版本后打开。');
 if(info.pendingCount>0)throw Error('又收到新记录，请先检查后继续。');
 if(!info.connected||!info.configured||info.updateAvailable)throw Error('请先完成这个项目的接续设置，再打开 AI。已保存的记录不受影响。');
 const opened=await api(target==='claude'?`/projects/${projectId}/claude/open`:'/desktop-ai/open',target==='claude'?{}:{target:'codex',projectId});
 if(!opened.dispatched||!opened.projectRequested)throw Error('尚未确认已请求打开这个项目，请检查接续设置。');
 return {opened,baseline:info.lastRead??null};
}

export function savedReadStatus(info,revision,baseline){
 if(info.pendingCount>0)return 'pending';
 if(info.currentRevision!==revision)return 'changed';
 const read=info.lastRead;
 return read?.revision===revision&&typeof read.at==='string'&&Number.isFinite(Date.parse(read.at))&&(!baseline||Date.parse(read.at)>Date.parse(baseline.at))?'received':'waiting';
}
