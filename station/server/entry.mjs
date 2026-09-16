// Desktop bootstrap reports only fixed categories; no paths, content or error logs.
function fail(error){
 const stage=['EACCES','EPERM'].includes(error?.code)?'permission_denied':'service_error';
 console.error('MEMORY_STATION_STARTUP:'+stage);
 process.exit(1);
}
process.on('uncaughtException',fail);
try{await import('./index.mjs');}catch(error){fail(error);}
