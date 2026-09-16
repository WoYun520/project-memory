import React,{useEffect,useRef} from 'react';
export function Icon({name,size=20}) {
 const paths={home:<><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/></>,inbox:<><path d="m4 4-2 11v6h20v-6L20 4zM2 15h6l2 3h4l2-3h6"/></>,search:<><circle cx="10" cy="10" r="7"/><path d="m16 16 5 5"/></>,globe:<><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,radar:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7"/></>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/></>,shield:<path d="m12 3 8 3v7c0 4-8 8-8 8s-8-4-8-8V6z"/>,check:<path d="m5 12 4 4L20 5"/>,copy:<><path d="M8 8h13v13H8zM16 4V2H2v14h2"/></>,bookmark:<path d="M6 3h12v18l-6-3-6 3z"/>,folder:<path d="M3 6h7l2 2h9v12H3z"/>,link:<><path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4M16 8l2-2a4 4 0 0 1 6 6l-4 4" transform="translate(2 0) scale(.85)"/></>,plus:<path d="M12 5v14M5 12h14"/>,arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,monitor:<><path d="M3 4h18v13H3zM8 21h8M12 17v4"/></>,target:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 6v1"/></>};
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.info}</svg>;
}
export function Modal({title,onClose,children,wide=false}){
 const ref=useRef();
 useEffect(()=>{const d=ref.current;d.showModal();return()=>d.close();},[]);
 return <dialog ref={ref} className={wide?'modal wide':'modal'} onCancel={onClose}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close"/></button></header>{children}</dialog>;
}
export function Field({label,children}){return <label className="field"><span>{label}</span>{children}</label>;}
export function Check({children,...props}){return <label className="check"><input type="checkbox" {...props}/><span>{children}</span></label>;}
export async function api(path,input){const r=await fetch('/api'+path,input?{method:'POST',headers:{'Content-Type':'application/json','X-Memory-Station':'1'},body:JSON.stringify(input)}:{});const j=await r.json();if(!r.ok)throw Error(j.error||'操作失败');return j;}
export function download(name,content,type='text/plain'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
