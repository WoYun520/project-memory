// Called only for an explicit prepare action, never while polling or reading context.
export async function prepareHandoff({bridge,sourceChecks,sourceReviews},id,input){
 // Validate task, project, revision and inbox before touching source documents.
 if(input?.sourceReviewId){
  bridge.prepare(id,input,{validateOnly:true});if(!sourceReviews)throw Error('来源对照不可用，请重新准备。');
  const checked=await sourceChecks.check(id,input.revision,{forHandoff:true});
  await sourceReviews.assertCurrent(id,input.sourceReviewId);
  const prepared=bridge.prepare(id,input);bridge.assertReady(id,prepared.ticket.id);
  return {...prepared,sourceCheck:checked.report};
 }
 const prepared=bridge.prepare(id,input);
 const checked=await sourceChecks.check(id,prepared.ticket.revision,{forHandoff:true});
 // New drafts or saved versions may arrive while the worker is reading files.
 bridge.assertReady(id,prepared.ticket.id);
 return {...prepared,sourceCheck:checked.report};
}
