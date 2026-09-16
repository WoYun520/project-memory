export function submitErrorMessage(error){
 const codes=new Set();
 function visit(e,depth=0){if(!e||depth>5)return;if(e.code)codes.add(e.code);visit(e.cause,depth+1);if(Array.isArray(e.errors))e.errors.forEach(x=>visit(x,depth+1));}
 visit(error);
 if(codes.has('EPERM')||codes.has('EACCES'))return '当前任务没有访问本机记忆站端口的权限；这不表示服务未启动。请通过运行环境的正常权限申请流程，获准后重试同一批次、保留原编号。不要绕过权限限制；若无法获准，保留可导入草稿。尚未确认送达，请勿宣称已提交。';
 if(codes.has('ECONNREFUSED'))return '本机端口拒绝连接，请检查记忆站是否运行、端口是否正确，再重试同一批次。尚未确认送达。';
 if(error?.name==='TimeoutError'||codes.has('ETIMEDOUT'))return '提交等待超时，无法确认是否送达。请先查看记忆站，必要时用相同编号重试，避免重复记录。';
 return error?.message==='fetch failed'?'连接本机记忆站失败，原因尚未确定；请检查服务与当前任务权限，不要直接认定服务未启动。':error?.message||'提交失败，原因尚未确定。';
}
