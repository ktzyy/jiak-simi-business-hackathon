import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Id, MenuSchema } from "../shared/contracts";
import { dishPhotoCandidateSchema, dishPhotoJobSchema, dishPhotoRequestSchema, dishPhotoSelectionSchema, publishedDishPhotosSchema, MAX_DISH_PHOTO_BYTES } from "../shared/dish-photo";
import { createDishPhoto, DishPhotoError } from "./ai/dish-photo";
import { validateMenuImage, MenuExtractionError } from "./ai/menu-extraction";
import { databaseRpc, getBackendClient, verifiedActor, requireSameOrigin, type BackendClient } from "./supabase-backend";
import { errorResponse, HttpError, readBoundedBody } from "./http";

const bucket = "dish-photos-private";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const resultSchema = z.object({ objectKey: z.string(), sizeBytes: z.number().int().positive().max(MAX_DISH_PHOTO_BYTES), candidate: dishPhotoCandidateSchema });
const recordSchema = z.object({ jobId: Id, status: z.enum(["dispatch_unknown", "ready", "failed"]), result: resultSchema.nullable(), dispatchAllowed: z.boolean().optional() });
const manifestSchema = z.array(z.object({ dishId: Id, dishName: z.string(), jobId: Id, candidate: dishPhotoCandidateSchema, objectKey: z.string() })).max(100);
const publishSchema = z.strictObject({ restaurantId: Id, menu: MenuSchema, stallDetailsVersion: z.number().int().positive(), selections: z.array(dishPhotoSelectionSchema).max(100) });
interface PhotoStorage {
 upload(key: string, bytes: Uint8Array, mime: string): Promise<void>;
 download(key: string): Promise<Uint8Array>;
}
type StorageClient = BackendClient & { storage: { from(bucket: string): {
 upload(key: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: unknown }>;
 download(key: string): Promise<{ data: Blob | null; error: unknown }>;
} } };
function storageFor(client: BackendClient): PhotoStorage {
 const store = (client as StorageClient).storage.from(bucket);
 return {
  async download(key) {
   const { data, error } = await store.download(key);
   if (error || !data || data.size > MAX_DISH_PHOTO_BYTES) throw new HttpError(502,"PHOTO_STORAGE_ERROR","The photo could not be loaded.");
   return new Uint8Array(await data.arrayBuffer());
  },
  async upload(key, bytes, mime) {
   const { error } = await store.upload(key, bytes, { contentType: mime, upsert: false });
   if (!error) return;
   // An immutable key may already exist after an interrupted upload. Verify exact
   // bytes instead of replacing it, regardless of the provider's error wording.
   const { data, error: readError } = await store.download(key);
   if (readError || !data || data.size !== bytes.length || digest(new Uint8Array(await data.arrayBuffer())) !== digest(bytes)) throw new HttpError(502,"PHOTO_STORAGE_ERROR","The immutable photo could not be saved.");
  },
 };
}
function photoClient(client: BackendClient): BackendClient {
 return { auth: client.auth, rpc: async (name,args) => {
  const result = await client.rpc(name,args);
  if (result.error?.code === "P0001") {
   if (result.error.message === "PHOTO_NOT_FOUND") throw new HttpError(404,"PHOTO_NOT_FOUND","This photo job was not found.");
   if (result.error.message === "STALE_PHOTO") throw new HttpError(409,"STALE_PHOTO","Review a current photo for this dish before publishing.");
  }
  return result;
 } };
}
function parsed<T>(schema: z.ZodType<T>, input: unknown): T { const result=schema.safeParse(input);if(!result.success)throw new HttpError(400,"INVALID_REQUEST","The photo request is invalid.");return result.data; }
const job = (record: z.infer<typeof recordSchema>) => dishPhotoJobSchema.parse({ jobId:record.jobId,status:record.status,candidate:record.result?.candidate??null });
function publicPhotos(photos: z.infer<typeof manifestSchema>, restaurantId:string, menuId:string, version:number) {
 return publishedDishPhotosSchema.parse(photos.map(photo=>({dishId:photo.dishId,dishName:photo.dishName,jobId:photo.jobId,candidate:photo.candidate,imageUrl:`/api/v1/dish-photos/media/${photo.jobId}?restaurantId=${restaurantId}&menuId=${menuId}&menuVersion=${version}`})));
}
export function dishPhotoHandlers(deps: { backend?:()=>BackendClient; storage?:(client:BackendClient)=>PhotoStorage; create?:typeof createDishPhoto; apiKey?:()=>string|undefined }={}) {
 const clientFor=()=>photoClient((deps.backend??getBackendClient)());
 const json=(value:unknown)=>Response.json(value,{headers:{"Cache-Control":"no-store"}});
 const run=(action:()=>Promise<Response>)=>action().catch(error=>{
  if(error instanceof DishPhotoError) return errorResponse(new HttpError(error.code==='not_configured'?503:error.code==='invalid_source'||error.code==='invalid_request'?400:502,"PHOTO_"+error.code.toUpperCase(),error.message));
  if(error instanceof MenuExtractionError) return errorResponse(new HttpError(400,"INVALID_IMAGE",error.message));
  return errorResponse(error);
 });
 const scoped=async(request:Request,restaurantId:string)=>{const client=clientFor();return {client,actor:await verifiedActor(request,client,restaurantId)};};
 const storage=(client:BackendClient)=>deps.storage?deps.storage(client):storageFor((deps.backend??getBackendClient)());
 const readManifest=async(client:BackendClient,request:Request)=>{
  const q=new URL(request.url).searchParams;const restaurantId=parsed(Id,q.get('restaurantId')),menuId=parsed(Id,q.get('menuId')),version=parsed(z.coerce.number().int().positive(),q.get('menuVersion'));
  const photos=await databaseRpc(client,'read_published_photos',{p_restaurant_id:restaurantId,p_menu_id:menuId,p_menu_version:version},manifestSchema);
  return {photos,restaurantId,menuId,version};
 };
 return {
  create:(request:Request)=>run(async()=>{
   requireSameOrigin(request);
   const contentType=request.headers.get('content-type')??'';
   if(!contentType.startsWith('multipart/form-data;'))throw new HttpError(415,'INVALID_CONTENT_TYPE','Send the photo form.');
   const bytes=await readBoundedBody(request,5*1024*1024+64000);
   const form=await new Request(request.url,{method:'POST',headers:{'content-type':contentType},body:new Uint8Array(bytes)}).formData();
   if([...form.keys()].some(k=>!['restaurantId','key','request','source'].includes(k))||['restaurantId','key','request','source'].some(k=>form.getAll(k).length>1))throw new HttpError(400,'INVALID_REQUEST','Send one photo request.');
   const restaurantId=parsed(Id,form.get('restaurantId')),key=parsed(Id,form.get('key'));
   const {client,actor}=await scoped(request,restaurantId);
   let input:unknown;try{input=JSON.parse(String(form.get('request')));}catch{throw new HttpError(400,'INVALID_REQUEST','Photo details must be JSON.');}
   const photoRequest=parsed(dishPhotoRequestSchema,input);
   const apiKey=(deps.apiKey??(()=>process.env.OPENAI_API_KEY))();
   if(photoRequest.mode !== 'source_crop' && !apiKey)throw new HttpError(503,'NOT_CONFIGURED','Photo generation is not configured.');
   let source:null|{sourceImageId:string;bytes:Uint8Array;mimeType:string}=null;
   const file=form.get('source');
   if(photoRequest.mode==='enhance_visible'||photoRequest.mode==='source_crop'){
    if(!file||typeof file==='string'||file.size>5*1024*1024)throw new HttpError(400,'INVALID_IMAGE','Choose the original menu photo.');
    const sourceBytes=new Uint8Array(await file.arrayBuffer());validateMenuImage(sourceBytes,file.type);
    if(photoRequest.mode==='source_crop'&&file.type!=='image/jpeg')throw new HttpError(400,'INVALID_IMAGE','Original crops must be JPEG.');
    source={sourceImageId:photoRequest.sourceImageId,bytes:sourceBytes,mimeType:file.type};
   }else if(file)throw new HttpError(400,'INVALID_REQUEST','Illustration generation does not take an original photo.');
   const sourceMetadata=source?{sourceImageId:source.sourceImageId,objectKey:`${restaurantId}/sources/${source.sourceImageId}`,sha256:digest(source.bytes),mimeType:source.mimeType,sizeBytes:source.bytes.length}:null;
   const record=await databaseRpc(client,'reserve_dish_photo_job',{p_actor_id:actor,p_restaurant_id:restaurantId,p_idempotency_key:key,p_request:photoRequest,p_source:sourceMetadata},recordSchema);
   if(!record.dispatchAllowed)return json(job(record));
   let dispatched=false;
   try{
    const objects=storage(client);
    if(source&&sourceMetadata)await objects.upload(sourceMetadata.objectKey,source.bytes,source.mimeType);
    dispatched=photoRequest.mode !== 'source_crop';
    const output=photoRequest.mode === 'source_crop' && source ? {
     imageBase64: Buffer.from(source.bytes).toString('base64'),
     candidate: {
      id:randomUUID(),dishId:photoRequest.dishId,status:'needs_review',mode:'source_crop',label:'Original photo',disclosureRequired:false,
      mimeType:'image/jpeg',imageSha256:digest(source.bytes),sourceImageSha256:digest(source.bytes),
      sourceImageId:photoRequest.sourceImageId,sourceEntryId:photoRequest.sourceEntryId,region:null,
      model:null,quality:null,size:null,promptSha256:digest(new TextEncoder().encode('original crop; no AI generation')),createdAt:new Date().toISOString(),
     },
    } : await (deps.create??createDishPhoto)(photoRequest,{apiKey:apiKey!,sourceImage:source??undefined,signal:AbortSignal.any([request.signal,AbortSignal.timeout(185000)])});
    const candidate=dishPhotoCandidateSchema.parse(output.candidate);
    const image=new Uint8Array(Buffer.from(output.imageBase64,'base64'));
    if(image.length>MAX_DISH_PHOTO_BYTES||image.length<3||image[0]!==255||image[1]!==216||image[2]!==255||digest(image)!==candidate.imageSha256)throw new HttpError(502,'INVALID_RESPONSE','Generated photo validation failed.');
    const objectKey=`${restaurantId}/candidates/${record.jobId}`;
    await objects.upload(objectKey,image,'image/jpeg');
    const finished=await databaseRpc(client,'finish_dish_photo_job',{p_actor_id:actor,p_restaurant_id:restaurantId,p_job_id:record.jobId,p_result:{objectKey,sizeBytes:image.length,candidate}},recordSchema);
    return json(job(finished));
   }catch(error){
    if(dispatched && error instanceof DishPhotoError && error.code==='provider_error' && error.definitelyRejected){
     console.warn('Dish photo provider rejected request:', error.code);
     try {
      const failed=await databaseRpc(client,'finish_dish_photo_job',{p_actor_id:actor,p_restaurant_id:restaurantId,p_job_id:record.jobId,p_result:null},recordSchema);
      return json(job(failed));
     } catch { return json(job(record)); }
    }
    if(!dispatched)await databaseRpc(client,'finish_dish_photo_job',{p_actor_id:actor,p_restaurant_id:restaurantId,p_job_id:record.jobId,p_result:null},recordSchema).catch(()=>undefined);
    // Paid outcome or save acknowledgement may be unknown. Preserve the job;
    // caller can inspect it, but this code never repeats provider dispatch.
    if(dispatched)return json(job(record));
    throw error;
   }
  }),
  read:(request:Request,jobId:string)=>run(async()=>{const restaurantId=parsed(Id,new URL(request.url).searchParams.get('restaurantId'));const {client,actor}=await scoped(request,restaurantId);return json(job(await databaseRpc(client,'read_dish_photo_job',{p_actor_id:actor,p_restaurant_id:restaurantId,p_job_id:parsed(Id,jobId)},recordSchema)));}),
  byKey:(request:Request,key:string)=>run(async()=>{const restaurantId=parsed(Id,new URL(request.url).searchParams.get('restaurantId'));const {client,actor}=await scoped(request,restaurantId);return json(job(await databaseRpc(client,'read_dish_photo_job',{p_actor_id:actor,p_restaurant_id:restaurantId,p_job_id:null,p_idempotency_key:parsed(Id,key)},recordSchema)));}),
  preview:(request:Request,jobId:string)=>run(async()=>{
   const restaurantId=parsed(Id,new URL(request.url).searchParams.get('restaurantId'));const {client,actor}=await scoped(request,restaurantId);
   const record=await databaseRpc(client,'read_dish_photo_job',{p_actor_id:actor,p_restaurant_id:restaurantId,p_job_id:parsed(Id,jobId)},recordSchema);
   if(record.status!=='ready'||!record.result)throw new HttpError(409,'PHOTO_NOT_READY','This photo is not ready.');
   const expected=`${restaurantId}/candidates/${record.jobId}`;if(record.result.objectKey!==expected)throw new HttpError(502,'INVALID_RESPONSE','Photo scope mismatch.');
   const bytes=await storage(client).download(expected);if(digest(bytes)!==record.result.candidate.imageSha256)throw new HttpError(502,'INVALID_RESPONSE','Photo content mismatch.');
   return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }),
  published:(request:Request)=>run(async()=>{const m=await readManifest(clientFor(),request);return json(publicPhotos(m.photos,m.restaurantId,m.menuId,m.version));}),
  media:(request:Request,jobId:string)=>run(async()=>{
   const client=clientFor(),m=await readManifest(client,request);const photo=m.photos.find(p=>p.jobId===parsed(Id,jobId));
   if(!photo)throw new HttpError(404,'PHOTO_NOT_FOUND','This photo is not published in this menu.');
   const expected=`${m.restaurantId}/candidates/${photo.jobId}`;if(photo.objectKey!==expected)throw new HttpError(502,'INVALID_RESPONSE','Photo scope mismatch.');
   const bytes=await storage(client).download(expected);if(digest(bytes)!==photo.candidate.imageSha256)throw new HttpError(502,'INVALID_RESPONSE','Photo content mismatch.');
   return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
  }),
  publish:(request:Request)=>run(async()=>{
   requireSameOrigin(request);if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new HttpError(415,'INVALID_CONTENT_TYPE','Send JSON.');
   let value:unknown;try{value=JSON.parse(new TextDecoder().decode(await readBoundedBody(request,300000)));}catch{throw new HttpError(400,'INVALID_REQUEST','Send valid publication JSON.');}
   const input=parsed(publishSchema,value);if(input.restaurantId!==input.menu.restaurantId)throw new HttpError(400,'INVALID_REQUEST','Menu scope mismatch.');
   const {client,actor}=await scoped(request,input.restaurantId);
   const result=await databaseRpc(client,'publish_menu_with_photos',{p_restaurant_id:input.restaurantId,p_actor_id:actor,p_menu:input.menu,p_stall_details_version:input.stallDetailsVersion,p_selections:input.selections},z.object({menu:MenuSchema,photos:manifestSchema}));
   if(JSON.stringify(result.menu)!==JSON.stringify(input.menu))throw new HttpError(502,'INVALID_RESPONSE','Published menu mismatch.');
   return json({menu:result.menu,photos:publicPhotos(result.photos,input.restaurantId,result.menu.id,result.menu.version)});
  }),
 };
}
